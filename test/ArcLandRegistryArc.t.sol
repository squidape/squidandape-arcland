// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcLandRegistry} from "../src/ArcLandRegistry.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/**
 * Tier 2: everything that needs REAL Arc state rather than a local EVM.
 *
 * Run with:
 *   forge test --match-contract ArcLandRegistryArcTest --fork-url arc_testnet -vv
 *
 * WHAT A FORK STILL CANNOT TEST
 * -----------------------------
 * A fork replays Arc's *state* inside a standard EVM, so it reproduces
 * contract storage but NOT Arc's protocol behaviour. Per Arc's porting guide,
 * the native-coin precompiles, EIP-7708 `Transfer` events and USDC blocklist
 * enforcement only surface against a real Arc RPC. Those live in
 * `script/arc-live-checks.sh`, which sends real transactions.
 *
 * What this file does verify against real Arc state:
 *   - the chain really is Arc (5042002),
 *   - the USDC ERC-20 interface exists at 0x3600...0000 and reports 6 decimals,
 *   - native and ERC-20 are ONE balance seen at 18 and 6 decimals (the 1e12
 *     relationship), which is the fact the whole pricing model rests on,
 *   - the registry deploys and claims against real chain state.
 */
contract ArcLandRegistryArcTest is Test {
    uint256 constant ARC_TESTNET_CHAIN_ID = 5042002;
    address constant USDC = 0x3600000000000000000000000000000000000000;

    /// Seeded by Arc Testnet: a value transfer to or from this address reverts.
    /// Index 1 of the standard `test test ... junk` mnemonic.
    address constant BLOCKLISTED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    ArcLandRegistry reg;

    function setUp() public {
        // Only meaningful on a fork; skip cleanly when run without --fork-url.
        if (block.chainid != ARC_TESTNET_CHAIN_ID) return;
        reg = new ArcLandRegistry(0);
    }

    modifier onlyArc() {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            vm.skip(true);
        }
        _;
    }

    function test_Arc_ChainIdIsArcTestnet() public onlyArc {
        assertEq(block.chainid, ARC_TESTNET_CHAIN_ID);
    }

    function test_Arc_UsdcErc20InterfaceExists() public onlyArc {
        assertGt(USDC.code.length, 0, "no code at the USDC ERC-20 address");
        assertEq(IERC20Metadata(USDC).decimals(), 6, "ERC-20 USDC must be 6 decimals");
    }

    /**
     * The single most important fact on Arc, and the one its own gas-and-fees
     * page gets wrong in an example: native USDC (msg.value) is 18 decimals
     * while the ERC-20 view of THE SAME BALANCE is 6. They must differ by
     * exactly 1e12, and the ERC-20 view truncates below 1e-6 USDC.
     */
    function test_Arc_NativeAndErc20AreOneBalanceAt1e12() public onlyArc {
        address probe = address(0xDEADBEEF);
        vm.deal(probe, 12_345_678_000_000_000_000); // 12.345678 USDC in wei

        uint256 native = probe.balance;
        uint256 erc20 = IERC20Metadata(USDC).balanceOf(probe);

        assertEq(native, 12_345_678_000_000_000_000);
        assertEq(erc20, native / 1e12, "ERC-20 view must be native / 1e12");
        assertEq(erc20, 12_345_678);
    }

    /// Truncation: anything below 1e-6 USDC reads as 0 through the ERC-20 view.
    function test_Arc_Erc20ViewTruncatesDust() public onlyArc {
        address dust = address(0xD05D);
        vm.deal(dust, 100); // 1e-16 USDC, far below one ERC-20 unit

        assertEq(dust.balance, 100);
        assertEq(IERC20Metadata(USDC).balanceOf(dust), 0, "dust must truncate to 0");
    }

    function test_Arc_RegistryDeploysAndClaims() public onlyArc {
        address claimer = address(0xC1A1);
        vm.deal(claimer, 1 ether);

        vm.prank(claimer);
        reg.claim(309, "arc");

        assertEq(reg.tileOwner(309), claimer);
        assertEq(reg.claimedCount(), 1);
        assertEq(reg.remainingCount(), 1790);
    }

    /**
     * The zero-address guard fires before any value moves. On real Arc the
     * protocol would also reject it ("Zero address not allowed"), but relying
     * on that would make the contract's behaviour chain-dependent.
     */
    function test_Arc_WithdrawToZeroAddressRejectedByGuard() public onlyArc {
        vm.deal(address(reg), 1 ether);
        vm.expectRevert(ArcLandRegistry.ZeroAddress.selector);
        reg.withdraw(address(0));
    }

    /**
     * Documents the limit of forking rather than asserting Arc behaviour: on a
     * fork the blocklist is NOT enforced, so this withdrawal succeeds here even
     * though it must revert on the live chain. The live assertion is in
     * script/arc-live-checks.sh.
     */
    function test_Arc_BlocklistNotEnforcedOnAFork_SeeLiveScript() public onlyArc {
        vm.deal(address(reg), 1 ether);
        reg.withdraw(BLOCKLISTED);
        assertEq(address(reg).balance, 0, "a fork does not enforce Arc's blocklist");
        emit log("NOTE: blocklist enforcement is protocol-level; verify live via script/arc-live-checks.sh");
    }
}
