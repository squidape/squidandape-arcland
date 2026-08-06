// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcLandRegistry} from "../src/ArcLandRegistry.sol";

/// @dev Has neither `receive` nor a payable `fallback`, so a plain value
///      transfer to it fails. Used to exercise the WithdrawFailed path.
contract RejectsValue {}

/**
 * Tier 1 of a two-tier strategy. These run on Foundry's local EVM, which is a
 * STANDARD EVM, not Arc's: per Arc's own porting guide, `anvil` cannot
 * reproduce the native-coin precompiles, EIP-7708 Transfer events, or USDC
 * blocklist enforcement. Everything here is contract logic that holds on any
 * EVM. The Arc-specific paths live in ArcLandRegistryArc.t.sol, which only runs
 * against a real Arc RPC.
 */
contract ArcLandRegistryTest is Test {
    ArcLandRegistry reg;

    address admin = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint16 constant FIRST = 309;
    uint16 constant LAST = 2099;
    uint16 constant COUNT = 2100;

    event TileClaimed(uint16 indexed tileId, address indexed claimer, string label);
    event TileTransferred(uint16 indexed tileId, address indexed from, address indexed to);
    event LabelChanged(uint16 indexed tileId, string label);
    event Withdrawn(address indexed to, uint256 amount);

    function setUp() public {
        reg = new ArcLandRegistry(0);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    /* ------------------------------------------------------------ constants */

    function test_Constants() public view {
        assertEq(reg.WORLD_COLS(), 50);
        assertEq(reg.WORLD_ROWS(), 42);
        assertEq(reg.TILE_COUNT(), COUNT);
        assertEq(reg.FIRST_CLAIMABLE(), FIRST);
        assertEq(reg.MAX_LABEL_BYTES(), 32);
    }

    /// The whole point of the scarcity: 2,100 tiles less the 309 whale tiles.
    function test_ClaimableSupplyIs1791() public view {
        assertEq(uint256(COUNT - FIRST), 1791);
        assertEq(reg.remainingCount(), 1791);
    }

    /// tileIdOf must equal iso.js's `isoWorldIndex(col, row) = row * 50 + col`.
    function test_TileIdOfMatchesRenderer() public view {
        assertEq(reg.tileIdOf(0, 0), 0);
        assertEq(reg.tileIdOf(49, 0), 49);
        assertEq(reg.tileIdOf(0, 1), 50);
        assertEq(reg.tileIdOf(9, 6), 309); // first claimable tile
        assertEq(reg.tileIdOf(49, 41), 2099);
    }

    function test_TileIdOf_RevertsOffGrid() public {
        vm.expectRevert("out of grid");
        reg.tileIdOf(50, 0);
        vm.expectRevert("out of grid");
        reg.tileIdOf(0, 42);
    }

    function test_ConstructorSetsAdminAndPrice() public {
        ArcLandRegistry r = new ArcLandRegistry(5 ether);
        assertEq(r.admin(), address(this));
        assertEq(r.price(), 5 ether);
    }

    /* ---------------------------------------------------------- claim bounds */

    function test_Claim_SucceedsAtFirstClaimable() public {
        vm.prank(alice);
        reg.claim(FIRST, "first");
        assertEq(reg.tileOwner(FIRST), alice);
        assertEq(reg.claimedCount(), 1);
        assertEq(reg.remainingCount(), 1790);
    }

    function test_Claim_SucceedsAtLastTile() public {
        vm.prank(alice);
        reg.claim(LAST, "edge");
        assertEq(reg.tileOwner(LAST), alice);
    }

    function test_Claim_RevertsOnLastReservedTile() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileReserved.selector, uint16(308)));
        reg.claim(308, "");
    }

    function test_Claim_RevertsOnTileZero() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileReserved.selector, uint16(0)));
        reg.claim(0, "");
    }

    function test_Claim_RevertsPastEndOfGrid() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileOutOfRange.selector, uint16(COUNT)));
        reg.claim(COUNT, "");
    }

    /// Out-of-range must be reported before reserved, so 2100+ never reads as reserved.
    function test_Claim_OutOfRangeTakesPrecedence() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileOutOfRange.selector, uint16(65535)));
        reg.claim(65535, "");
    }

    function test_Claim_RevertsWhenAlreadyClaimed() public {
        vm.prank(alice);
        reg.claim(400, "mine");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileAlreadyClaimed.selector, uint16(400)));
        reg.claim(400, "also mine");
    }

    function test_Claim_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit TileClaimed(500, alice, "hello");
        vm.prank(alice);
        reg.claim(500, "hello");
    }

    /* --------------------------------------------------------------- payment */

    function test_Claim_RevertsOnUnderpayment() public {
        ArcLandRegistry r = new ArcLandRegistry(1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ArcLandRegistry.IncorrectPayment.selector, uint256(0.5 ether), uint256(1 ether))
        );
        r.claim{value: 0.5 ether}(FIRST, "");
    }

    /**
     * Overpayment must also revert. There is no refund path on purpose: a
     * refund is an outbound native transfer, and on Arc that can revert even
     * with a sufficient balance (blocklist, zero address, forbidden burn),
     * which would strand an otherwise valid claim.
     */
    function test_Claim_RevertsOnOverpayment() public {
        ArcLandRegistry r = new ArcLandRegistry(1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ArcLandRegistry.IncorrectPayment.selector, uint256(2 ether), uint256(1 ether))
        );
        r.claim{value: 2 ether}(FIRST, "");
    }

    function test_Claim_SucceedsOnExactPayment() public {
        ArcLandRegistry r = new ArcLandRegistry(1 ether);
        vm.prank(alice);
        r.claim{value: 1 ether}(FIRST, "");
        assertEq(address(r).balance, 1 ether);
        assertEq(r.tileOwner(FIRST), alice);
    }

    /// A free registry must reject value rather than quietly accept a donation.
    function test_Claim_RevertsWhenSendingValueToFreeRegistry() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.IncorrectPayment.selector, uint256(1), uint256(0)));
        reg.claim{value: 1}(FIRST, "");
    }

    /* ----------------------------------------------------------------- labels */

    function test_Claim_AcceptsExactly32ByteLabel() public {
        string memory label = "abcdefghijklmnopqrstuvwxyz012345"; // 32 bytes
        assertEq(bytes(label).length, 32);
        vm.prank(alice);
        reg.claim(600, label);
        assertEq(reg.labelOf(600), label);
    }

    function test_Claim_Reverts33ByteLabel() public {
        string memory label = "abcdefghijklmnopqrstuvwxyz0123456"; // 33 bytes
        assertEq(bytes(label).length, 33);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.LabelTooLong.selector, uint256(33)));
        reg.claim(600, label);
    }

    function test_Claim_EmptyLabelStoresNothing() public {
        vm.prank(alice);
        reg.claim(601, "");
        assertEq(reg.labelOf(601), "");
        assertEq(reg.tileOwner(601), alice);
    }

    function test_SetLabel_OwnerCanChange() public {
        vm.startPrank(alice);
        reg.claim(700, "before");
        reg.setLabel(700, "after");
        vm.stopPrank();
        assertEq(reg.labelOf(700), "after");
    }

    function test_SetLabel_EmptyClearsIt() public {
        vm.startPrank(alice);
        reg.claim(701, "something");
        reg.setLabel(701, "");
        vm.stopPrank();
        assertEq(reg.labelOf(701), "");
    }

    function test_SetLabel_RevertsForNonOwner() public {
        vm.prank(alice);
        reg.claim(702, "mine");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.NotTileOwner.selector, uint16(702)));
        reg.setLabel(702, "stolen");
    }

    function test_SetLabel_RevertsOnUnclaimedTile() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileNotClaimed.selector, uint16(703)));
        reg.setLabel(703, "nope");
    }

    function test_SetLabel_RevertsWhenTooLong() public {
        vm.startPrank(alice);
        reg.claim(704, "ok");
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.LabelTooLong.selector, uint256(33)));
        reg.setLabel(704, "abcdefghijklmnopqrstuvwxyz0123456");
        vm.stopPrank();
    }

    /* --------------------------------------------------------------- transfer */

    function test_TransferTile_MovesOwnership() public {
        vm.prank(alice);
        reg.claim(800, "mine");

        vm.expectEmit(true, true, true, false);
        emit TileTransferred(800, alice, bob);
        vm.prank(alice);
        reg.transferTile(800, bob);

        assertEq(reg.tileOwner(800), bob);
    }

    /// A tile must never be burned into an unclaimable state.
    function test_TransferTile_RevertsOnZeroAddress() public {
        vm.startPrank(alice);
        reg.claim(801, "");
        vm.expectRevert(ArcLandRegistry.ZeroAddress.selector);
        reg.transferTile(801, address(0));
        vm.stopPrank();
    }

    function test_TransferTile_RevertsForNonOwner() public {
        vm.prank(alice);
        reg.claim(802, "");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.NotTileOwner.selector, uint16(802)));
        reg.transferTile(802, bob);
    }

    function test_TransferTile_RevertsOnUnclaimedTile() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileNotClaimed.selector, uint16(803)));
        reg.transferTile(803, bob);
    }

    /// Transferring must not create a second entry in the ordering list.
    function test_TransferTile_DoesNotDuplicateInClaimedList() public {
        vm.startPrank(alice);
        reg.claim(804, "");
        reg.transferTile(804, bob);
        vm.stopPrank();
        assertEq(reg.claimedCount(), 1);

        uint256[] memory packed = reg.claimedPacked(0, 10);
        assertEq(packed.length, 1);
        assertEq(address(uint160(packed[0])), bob);
    }

    /* ----------------------------------------------------------- packed reads */

    function test_ClaimedPacked_EncodesOwnerAndTileId() public {
        vm.prank(alice);
        reg.claim(1234, "x");

        uint256[] memory packed = reg.claimedPacked(0, 1);
        assertEq(packed.length, 1);
        assertEq(address(uint160(packed[0])), alice);
        assertEq(uint16(packed[0] >> 160), uint16(1234));
    }

    function test_ClaimedPacked_PreservesInsertionOrder() public {
        vm.prank(alice);
        reg.claim(900, "a");
        vm.prank(bob);
        reg.claim(400, "b");
        vm.prank(alice);
        reg.claim(1500, "c");

        uint256[] memory packed = reg.claimedPacked(0, 3);
        assertEq(uint16(packed[0] >> 160), uint16(900));
        assertEq(uint16(packed[1] >> 160), uint16(400));
        assertEq(uint16(packed[2] >> 160), uint16(1500));
        assertEq(address(uint160(packed[1])), bob);
    }

    function test_ClaimedPacked_EmptyWhenNothingClaimed() public view {
        assertEq(reg.claimedPacked(0, 100).length, 0);
    }

    function test_ClaimedPacked_FromBeyondEndReturnsEmpty() public {
        vm.prank(alice);
        reg.claim(FIRST, "");
        assertEq(reg.claimedPacked(1, 10).length, 0);
        assertEq(reg.claimedPacked(999, 10).length, 0);
    }

    function test_ClaimedPacked_ClampsOverlongCount() public {
        vm.startPrank(alice);
        reg.claim(310, "");
        reg.claim(311, "");
        vm.stopPrank();
        assertEq(reg.claimedPacked(0, type(uint256).max).length, 2);
        assertEq(reg.claimedPacked(1, type(uint256).max).length, 1);
    }

    function test_ClaimedPacked_Paginates() public {
        vm.startPrank(alice);
        for (uint16 i = 0; i < 5; i++) {
            reg.claim(FIRST + i, "");
        }
        vm.stopPrank();

        uint256[] memory page1 = reg.claimedPacked(0, 2);
        uint256[] memory page2 = reg.claimedPacked(2, 2);
        uint256[] memory page3 = reg.claimedPacked(4, 2);

        assertEq(page1.length, 2);
        assertEq(page2.length, 2);
        assertEq(page3.length, 1);
        assertEq(uint16(page1[0] >> 160), FIRST);
        assertEq(uint16(page3[0] >> 160), FIRST + 4);
    }

    function test_ClaimedPacked_ZeroCountReturnsEmpty() public {
        vm.prank(alice);
        reg.claim(FIRST, "");
        assertEq(reg.claimedPacked(0, 0).length, 0);
    }

    /* --------------------------------------------------------------- tileInfo */

    function test_TileInfo_ReturnsAllFields() public {
        vm.warp(1754_000_000);
        vm.prank(alice);
        reg.claim(1000, "halim");

        (address holder, uint64 claimedAt, string memory label) = reg.tileInfo(1000);
        assertEq(holder, alice);
        assertEq(claimedAt, uint64(1754_000_000));
        assertEq(label, "halim");
    }

    function test_TileInfo_UnclaimedIsEmpty() public view {
        (address holder, uint64 claimedAt, string memory label) = reg.tileInfo(1001);
        assertEq(holder, address(0));
        assertEq(claimedAt, 0);
        assertEq(label, "");
    }

    function test_IsClaimable() public {
        assertTrue(reg.isClaimable(FIRST));
        assertTrue(reg.isClaimable(LAST));
        assertFalse(reg.isClaimable(308));
        assertFalse(reg.isClaimable(COUNT));

        vm.prank(alice);
        reg.claim(FIRST, "");
        assertFalse(reg.isClaimable(FIRST));
    }

    /* ------------------------------------------------------------ admin: price */

    function test_SetPrice_AdminCanChange() public {
        reg.setPrice(3 ether);
        assertEq(reg.price(), 3 ether);

        vm.prank(alice);
        reg.claim{value: 3 ether}(FIRST, "");
        assertEq(address(reg).balance, 3 ether);
    }

    function test_SetPrice_RevertsForNonAdmin() public {
        vm.prank(alice);
        vm.expectRevert(ArcLandRegistry.NotAdmin.selector);
        reg.setPrice(1 ether);
    }

    /* --------------------------------------------------------- admin: withdraw */

    function test_Withdraw_MovesFullBalance() public {
        reg.setPrice(2 ether);
        vm.prank(alice);
        reg.claim{value: 2 ether}(FIRST, "");

        uint256 before = bob.balance;
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(bob, 2 ether);
        reg.withdraw(bob);

        assertEq(bob.balance - before, 2 ether);
        assertEq(address(reg).balance, 0);
    }

    function test_Withdraw_RevertsForNonAdmin() public {
        vm.prank(alice);
        vm.expectRevert(ArcLandRegistry.NotAdmin.selector);
        reg.withdraw(alice);
    }

    /**
     * Arc rejects value transfers to the zero address at the protocol level
     * ("Zero address not allowed"), but the local EVM in this tier does not.
     * The contract therefore guards explicitly rather than relying on the
     * chain, and this test proves the guard is what fires.
     */
    function test_Withdraw_RevertsOnZeroAddress() public {
        reg.setPrice(1 ether);
        vm.prank(alice);
        reg.claim{value: 1 ether}(FIRST, "");

        vm.expectRevert(ArcLandRegistry.ZeroAddress.selector);
        reg.withdraw(address(0));
    }

    function test_Withdraw_RevertsWhenEmpty() public {
        vm.expectRevert(ArcLandRegistry.NothingToWithdraw.selector);
        reg.withdraw(bob);
    }

    /// Stands in for Arc's runtime blocklist: a recipient that cannot receive.
    function test_Withdraw_RevertsWhenRecipientRejects() public {
        reg.setPrice(1 ether);
        vm.prank(alice);
        reg.claim{value: 1 ether}(FIRST, "");

        RejectsValue sink = new RejectsValue();
        vm.expectRevert(ArcLandRegistry.WithdrawFailed.selector);
        reg.withdraw(address(sink));

        // The funds are still here, not lost.
        assertEq(address(reg).balance, 1 ether);
    }

    /* ------------------------------------------------------------ admin: role */

    function test_TransferAdmin() public {
        reg.transferAdmin(alice);
        assertEq(reg.admin(), alice);

        vm.prank(alice);
        reg.setPrice(7 ether);
        assertEq(reg.price(), 7 ether);
    }

    function test_TransferAdmin_RevertsOnZeroAddress() public {
        vm.expectRevert(ArcLandRegistry.ZeroAddress.selector);
        reg.transferAdmin(address(0));
    }

    function test_TransferAdmin_RevertsForNonAdmin() public {
        vm.prank(alice);
        vm.expectRevert(ArcLandRegistry.NotAdmin.selector);
        reg.transferAdmin(bob);
    }

    function test_OldAdminLosesRightsAfterTransfer() public {
        reg.transferAdmin(alice);
        vm.expectRevert(ArcLandRegistry.NotAdmin.selector);
        reg.setPrice(1 ether);
    }

    /* -------------------------------------------------------- no stray value */

    /**
     * There is no `receive` and no `fallback`, so value can only enter through
     * `claim`. Nothing can arrive by accident and become unrecoverable, and
     * there is no SELFDESTRUCT anywhere to move it out.
     */
    function test_PlainValueTransferToRegistryReverts() public {
        vm.prank(alice);
        (bool ok,) = address(reg).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(reg).balance, 0);
    }

    function test_UnknownSelectorReverts() public {
        vm.prank(alice);
        (bool ok,) = address(reg).call(abi.encodeWithSignature("noSuchFunction()"));
        assertFalse(ok);
    }

    /* ------------------------------------------------------------------ fuzz */

    function testFuzz_ClaimAcceptsAnyClaimableTile(uint16 tileId) public {
        tileId = uint16(bound(tileId, FIRST, LAST));
        vm.prank(alice);
        reg.claim(tileId, "");
        assertEq(reg.tileOwner(tileId), alice);
        assertEq(reg.claimedCount(), 1);
    }

    function testFuzz_ClaimRejectsAnyReservedTile(uint16 tileId) public {
        tileId = uint16(bound(tileId, 0, FIRST - 1));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcLandRegistry.TileReserved.selector, tileId));
        reg.claim(tileId, "");
    }

    function testFuzz_PackedRoundTrips(uint16 tileId, address holder) public {
        tileId = uint16(bound(tileId, FIRST, LAST));
        vm.assume(holder != address(0));

        vm.prank(holder);
        reg.claim(tileId, "");

        uint256[] memory packed = reg.claimedPacked(0, 1);
        assertEq(address(uint160(packed[0])), holder);
        assertEq(uint16(packed[0] >> 160), tileId);
    }
}
