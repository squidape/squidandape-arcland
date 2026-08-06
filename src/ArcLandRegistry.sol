// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcLandRegistry
 * @notice A shared registry of the 2,100 world tiles that Bitcoin Land draws.
 *
 * The map was drawn once: all 21,000,000 BTC as a 50 x 42 grid of 2,100 tiles,
 * 10,000 BTC each. The top-100 richest addresses already occupy the first 309
 * tiles. The remaining 1,791 are open, and this contract records who claimed
 * which one.
 *
 * WHAT THIS CONTRACT DELIBERATELY DOES NOT STORE
 * ----------------------------------------------
 * A deed says nothing about how much Bitcoin the claimer owns. There is no
 * field here that could carry a holding, and none may ever be added. Putting
 * "address -> amount of BTC owned" on a permanent, public, global ledger builds
 * a target list and is a physical-safety problem for the people in it. The
 * front end keeps its owner's ledger in localStorage and never transmits it.
 *
 * ARC-SPECIFIC DESIGN NOTES
 * -------------------------
 * On Arc the native gas token is USDC, so `msg.value` is USDC denominated in
 * 18 decimals (the ERC-20 interface at 0x3600...0000 is the same balance viewed
 * at 6 decimals; 1 ERC-20 unit = 1e12 wei). `price` below is therefore in
 * 18-decimal native units, while any figure shown to a human is 6-decimal.
 *
 * Arc's value-transfer rules mean an outbound native transfer can revert even
 * when the balance is sufficient: transfers to the zero address are forbidden,
 * burning is forbidden, and a runtime blocklist is enforced. Three consequences
 * are baked into this contract:
 *
 *   1. `claim` demands EXACT payment and has no refund path. A refund is an
 *      outbound transfer that could revert for reasons the caller does not
 *      control, which would strand an otherwise valid claim. Removing it
 *      removes the entire failure class.
 *   2. Every address argument that could receive value or ownership is checked
 *      against the zero address before use.
 *   3. There is no `receive()`, no `fallback()` and no `SELFDESTRUCT`. Value
 *      can only enter through `claim`, so nothing can arrive here by accident
 *      and become unrecoverable, and the contract can never be destroyed while
 *      holding funds.
 *
 * Arc block timestamps are non-decreasing rather than strictly increasing
 * (sub-second blocks may share one), so `claimedAt` is for DISPLAY ONLY.
 * Ordering is the insertion order of `_claimed`, never the timestamp.
 *
 * `PREVRANDAO` always returns 0 on Arc. Nothing here uses randomness; tile
 * assignment is purely positional.
 */
contract ArcLandRegistry {
    /* ---------------------------------------------------------------- layout */

    /// @notice Grid width, matching `WORLD_COLS` in the front end's whales.js.
    uint16 public constant WORLD_COLS = 50;

    /// @notice Grid height, matching `WORLD_ROWS` in the front end's whales.js.
    uint16 public constant WORLD_ROWS = 42;

    /// @notice 50 x 42. Every tile is 21,000,000 / 2,100 = 10,000 BTC.
    uint16 public constant TILE_COUNT = 2100;

    /**
     * @notice The first tile that may be claimed. Tiles 0..308 are reserved.
     *
     * The top-100 richest Bitcoin addresses hold 3,087,162 BTC, which is
     * 308.7162 tiles laid out as contiguous runs from tile 0. Under the front
     * end's tile-centre ownership rule the last whale-owned tile is 308, so the
     * first free tile is 309 and 1,791 tiles remain.
     *
     * This is FROZEN as a constant rather than derived on chain. The whale
     * figures come from a hand-captured snapshot that may be refreshed; the set
     * of claimable land must not move under existing deeds when it is. The
     * front end asserts that its snapshot still agrees with this number, so
     * drift is loud rather than silent.
     */
    uint16 public constant FIRST_CLAIMABLE = 309;

    /// @notice Longest permitted label, in bytes.
    uint256 public constant MAX_LABEL_BYTES = 32;

    /* ----------------------------------------------------------------- state */

    struct Tile {
        address owner;
        uint64 claimedAt; // display only; see the note on Arc timestamps
    }

    mapping(uint16 => Tile) private _tiles;
    mapping(uint16 => string) private _labels;

    /// @dev Insertion-ordered list of claimed tile ids. This is the ordering.
    uint16[] private _claimed;

    /// @notice Contract administrator.
    address public admin;

    /// @notice Exact price of a claim, in 18-decimal native USDC (wei).
    uint256 public price;

    /* ---------------------------------------------------------------- events */

    event TileClaimed(uint16 indexed tileId, address indexed claimer, string label);
    event TileTransferred(uint16 indexed tileId, address indexed from, address indexed to);
    event LabelChanged(uint16 indexed tileId, string label);
    event PriceChanged(uint256 oldPrice, uint256 newPrice);
    event Withdrawn(address indexed to, uint256 amount);
    event AdminTransferred(address indexed from, address indexed to);

    /* ---------------------------------------------------------------- errors */

    error NotAdmin();
    error NotTileOwner(uint16 tileId);
    error TileOutOfRange(uint16 tileId);
    error TileReserved(uint16 tileId);
    error TileAlreadyClaimed(uint16 tileId);
    error TileNotClaimed(uint16 tileId);
    error IncorrectPayment(uint256 sent, uint256 required);
    error LabelTooLong(uint256 length);
    error ZeroAddress();
    error NothingToWithdraw();
    error WithdrawFailed();

    /* ------------------------------------------------------------ modifiers */

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /* ----------------------------------------------------------- constructor */

    /**
     * @param initialPrice Exact claim price in 18-decimal native USDC. Zero
     *        means a claim costs only gas, which on Arc is itself USDC.
     */
    constructor(uint256 initialPrice) {
        admin = msg.sender;
        price = initialPrice;
        emit AdminTransferred(address(0), msg.sender);
        emit PriceChanged(0, initialPrice);
    }

    /* --------------------------------------------------------------- claims */

    /**
     * @notice Claim an unowned tile.
     * @dev Payment must be EXACT. There is no refund path by design; see the
     *      contract-level notes on Arc's value-transfer rules.
     * @param tileId Tile index, `row * WORLD_COLS + col`, in [309, 2100).
     * @param label  Free text, up to 32 bytes. May be empty.
     */
    function claim(uint16 tileId, string calldata label) external payable {
        _requireClaimable(tileId);
        if (_tiles[tileId].owner != address(0)) revert TileAlreadyClaimed(tileId);
        if (msg.value != price) revert IncorrectPayment(msg.value, price);
        _requireLabelFits(label);

        _tiles[tileId] = Tile({owner: msg.sender, claimedAt: uint64(block.timestamp)});
        if (bytes(label).length != 0) _labels[tileId] = label;
        _claimed.push(tileId);

        emit TileClaimed(tileId, msg.sender, label);
    }

    /**
     * @notice Hand a tile to somebody else.
     * @dev Records ownership only; it moves no value, so it cannot hit Arc's
     *      value-transfer rules. The zero address is rejected so a tile can
     *      never be burned into an unclaimable state.
     */
    function transferTile(uint16 tileId, address to) external {
        if (to == address(0)) revert ZeroAddress();
        address from = _tiles[tileId].owner;
        if (from == address(0)) revert TileNotClaimed(tileId);
        if (from != msg.sender) revert NotTileOwner(tileId);

        _tiles[tileId].owner = to;
        emit TileTransferred(tileId, from, to);
    }

    /// @notice Change the label on a tile you own.
    function setLabel(uint16 tileId, string calldata label) external {
        address holder = _tiles[tileId].owner;
        if (holder == address(0)) revert TileNotClaimed(tileId);
        if (holder != msg.sender) revert NotTileOwner(tileId);
        _requireLabelFits(label);

        if (bytes(label).length == 0) delete _labels[tileId];
        else _labels[tileId] = label;

        emit LabelChanged(tileId, label);
    }

    /* ------------------------------------------------------------- admin ops */

    /// @notice Set the exact claim price, in 18-decimal native USDC.
    function setPrice(uint256 newPrice) external onlyAdmin {
        uint256 old = price;
        price = newPrice;
        emit PriceChanged(old, newPrice);
    }

    /**
     * @notice Sweep the contract's balance.
     * @dev The zero address is rejected up front ("Zero address not allowed" is
     *      an Arc protocol revert). A blocklisted `to` reverts at runtime; that
     *      surfaces here as WithdrawFailed rather than a silent success.
     */
    function withdraw(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();

        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(to, amount);
    }

    /// @notice Hand administration to another address.
    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        address from = admin;
        admin = to;
        emit AdminTransferred(from, to);
    }

    /* ----------------------------------------------------------------- views */

    /// @notice Number of tiles claimed so far.
    function claimedCount() external view returns (uint256) {
        return _claimed.length;
    }

    /**
     * @notice A page of claimed tiles, packed one per word.
     * @dev Each word is `uint256(uint160(owner)) | (uint256(tileId) << 160)`.
     *      A single dynamic `uint256[]` is the cheapest thing for a small
     *      hand-written ABI decoder to read: slice 64-hex words, the last 40
     *      hex characters are the address and the bits above are the tile id.
     *      `count` is clamped to what is available, so callers can over-ask.
     */
    function claimedPacked(uint256 from, uint256 count) external view returns (uint256[] memory out) {
        uint256 total = _claimed.length;
        if (from >= total) return new uint256[](0);

        // Clamp by subtracting rather than computing `from + count`: a caller
        // passing type(uint256).max for "give me everything" would overflow
        // that sum, and checked arithmetic panics before any guard could run.
        uint256 available = total - from;
        uint256 n = count < available ? count : available;
        out = new uint256[](n);

        for (uint256 i = 0; i < n; ++i) {
            uint16 tileId = _claimed[from + i];
            out[i] = uint256(uint160(_tiles[tileId].owner)) | (uint256(tileId) << 160);
        }
    }

    /// @notice The label on a tile, or the empty string.
    function labelOf(uint16 tileId) external view returns (string memory) {
        return _labels[tileId];
    }

    /// @notice The owner of a tile, or the zero address if unclaimed.
    function tileOwner(uint16 tileId) external view returns (address) {
        return _tiles[tileId].owner;
    }

    /// @notice Everything about one tile, for a hover card.
    function tileInfo(uint16 tileId) external view returns (address holder, uint64 claimedAt, string memory label) {
        Tile storage t = _tiles[tileId];
        return (t.owner, t.claimedAt, _labels[tileId]);
    }

    /// @notice True when `tileId` is in range, not reserved, and unclaimed.
    function isClaimable(uint16 tileId) external view returns (bool) {
        return tileId >= FIRST_CLAIMABLE && tileId < TILE_COUNT && _tiles[tileId].owner == address(0);
    }

    /// @notice How many claimable tiles remain.
    function remainingCount() external view returns (uint256) {
        return (TILE_COUNT - FIRST_CLAIMABLE) - _claimed.length;
    }

    /**
     * @notice `row * WORLD_COLS + col`, mirroring `isoWorldIndex` in iso.js.
     * @dev Exists so the front end and the chain can be asserted to agree.
     */
    function tileIdOf(uint16 col, uint16 row) external pure returns (uint16) {
        require(col < WORLD_COLS && row < WORLD_ROWS, "out of grid");
        return uint16(row * WORLD_COLS + col);
    }

    /* -------------------------------------------------------------- internal */

    function _requireClaimable(uint16 tileId) private pure {
        if (tileId >= TILE_COUNT) revert TileOutOfRange(tileId);
        if (tileId < FIRST_CLAIMABLE) revert TileReserved(tileId);
    }

    function _requireLabelFits(string calldata label) private pure {
        uint256 len = bytes(label).length;
        if (len > MAX_LABEL_BYTES) revert LabelTooLong(len);
    }
}
