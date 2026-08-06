# Arc Land Registry

A shared registry of the 2,100 world tiles that [Bitcoin Land](https://lim-agg.pages.dev/#/bitcoin-land)
draws, claimable on **[Arc](https://docs.arc.io)** — Circle's Layer-1, where the native gas
token is USDC.

The map was drawn once: all 21,000,000 BTC as a 50 × 42 grid of tiles worth 10,000 BTC each.
The 100 richest Bitcoin addresses already occupy the first 309. **The remaining 1,791 are
open**, and this contract records who claimed which.

| | |
|---|---|
| Contract | `src/ArcLandRegistry.sol` |
| Chain | Arc Testnet (`5042002`) |
| Address | *not yet deployed* |
| Front end | [`lim-landbank/website/arc.js`](../lim-landbank/website/arc.js) — zero dependencies |
| Tests | 56 local + 7 fork + a live-chain script |

---

## What a deed is, and what it is deliberately not

A deed records **a tile and an address**. That is the whole schema.

It does **not** record how much Bitcoin anyone owns, in any form — not a value, not a hash, not
a bucket, not a tier. There is no field it could hide in, and none may be added.

This is not an oversight to be tidied up later. Publishing "address → amount of BTC owned" to a
permanent, public, global ledger builds a target list, and a target list for a personal Bitcoin
holding is a physical-safety problem for the people on it. Bitcoin Land keeps its owner's ledger
in `localStorage` and never transmits it; this contract is designed so that connecting it to a
blockchain does not quietly undo that.

The separation is enforced, not merely intended:

- The contract has no holdings field (see `src/ArcLandRegistry.sol`).
- `arc.js` never reads the ledger key or `totalBtc()`, and `tests.html` asserts this by scanning
  the source of every pure function in the Arc layer.
- A claim payload is asserted to be exactly four ABI words — tile id, offset, length, label —
  so there is provably no third field carrying a holding.

---

## What we learned about Arc that the docs get wrong

Everything here was verified against `docs.arc.io` and then against the live testnet on
**2026-08-06**. Two findings are worth flagging to anyone else building on Arc.

### 1. `msg.value` is 18 decimals, and Arc's own gas page says otherwise

Arc's [gas and fees](https://docs.arc.io/arc/references/gas-and-fees) page shows:

```typescript
value: ethers.parseUnits("1", 6), // 1 USDC via native send
```

That is **10⁻¹² USDC**, not 1 USDC. Both
[EVM differences](https://docs.arc.io/arc/references/evm-differences) and the
[porting guide](https://docs.arc.io/arc/tutorials/porting-contracts-to-arc) state the correct
rule, the latter explicitly: *"`msg.value` is denominated in 18-decimal native USDC, while the
ERC-20 USDC interface uses 6 decimals … 1 ERC-20 unit = 10¹² wei."*

We did not take either on faith. `test_Arc_NativeAndErc20AreOneBalanceAt1e12` runs against real
Arc state and asserts `nativeBalance == erc20BalanceOf × 1e12`, plus that dust below 1e-6 USDC
truncates to zero through the ERC-20 view. **It passes.** Trust 18 decimals for `msg.value`.

Getting this backwards misprices everything by a factor of a trillion, so
`script/arc-live-checks.sh` re-checks it on the live chain every run.

### 2. Circle's own skill overrides Circle's own tutorial on keys

Arc's [deploy tutorial](https://docs.arc.io/arc/tutorials/deploy-on-arc) uses
`--private-key $PRIVATE_KEY`. Circle's official
[`use-arc` skill](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md)
lists that as a **Security Rule** violation:

> NEVER pass private keys as plain-text CLI flags in deployed environments, including testnet and
> staging … Prefer encrypted keystores or interactive import.

This repo follows the stricter rule. `script/deploy-testnet.sh` uses an encrypted keystore under
`.keystore/` (gitignored) and never the flag.

### 3. The rules that actually shaped the contract

| Arc rule | What it forced |
|---|---|
| A native transfer can revert **even with a sufficient balance** — zero address, blocklist, forbidden burn | `claim()` takes **exact payment with no refund path**. A refund is an outbound transfer that can fail for reasons the caller does not control, which would strand a valid claim. Deleting it deletes the failure class. |
| Transfers to `address(0)` revert with `"Zero address not allowed"` | Every address argument is checked before use, so behaviour does not depend on which chain it runs on |
| The blocklist is enforced **at runtime** | `withdraw` surfaces a failed transfer as `WithdrawFailed` and keeps the funds, rather than reporting a silent success |
| Block timestamps are **non-decreasing, not strictly increasing** | `claimedAt` is display-only; ordering comes from the registry's own insertion order |
| `PREVRANDAO` always returns `0` | No randomness anywhere — tile assignment is purely positional |
| `maxFeePerGas` below **20 Gwei** may hang "indefinitely" | The front end sets it explicitly rather than trusting wallet estimation |
| Finality is deterministic and sub-second | No confirmation counting, no reorg handling, no rollback logic |
| Arc is **not in the WalletConnect registry** | `wallet_addEthereumChain` is required, not optional |
| `anvil` runs a standard EVM, not Arc's | Testing is three-tier (below) |
| Docs ask for fees in dollars, not Gwei | The UI quotes a claim in USDC before anyone signs |

Also avoided because Arc forbids or breaks them: `SELFDESTRUCT`, any burn path, a `WUSDC`
wrapper, and pairing native against the ERC-20 interface (they are one asset).

---

## Testing is three-tier, because a fork is not Arc

Arc's porting guide is explicit that local simulation cannot reproduce the native-coin
precompiles, EIP-7708 `Transfer` events, or blocklist enforcement. A *fork* does not fix this
either: it replays Arc's **state** inside a standard EVM, so storage is real but protocol
behaviour is not.

| Tier | Command | Covers |
|---|---|---|
| 1 — logic | `forge test` | 56 tests: boundaries, payment, labels, pagination, access control, withdraw, fuzz |
| 2 — real state | `forge test --match-contract ArcLandRegistryArcTest --fork-url arc_testnet` | 7 tests: chain identity, the USDC 1e12 relationship, ERC-20 dust truncation |
| 3 — real chain | `script/arc-live-checks.sh <address>` | Blocklist revert, zero-address revert, on-chain reserved-tile refusal, fee floor |

Tier 2 includes `test_Arc_BlocklistNotEnforcedOnAFork_SeeLiveScript`, which deliberately asserts
the *limit* of forking rather than pretending to test Arc behaviour.

---

## The contract

Tile ids are `row * 50 + col` — byte-for-byte the same formula as `isoWorldIndex` in the
renderer's `iso.js`, so the map and the chain cannot disagree. `tests.html` asserts they match on
all 2,100 tiles.

`FIRST_CLAIMABLE = 309` is **frozen as a constant**, not derived on chain. The top 100 hold
3,087,162 BTC = 308.7162 tiles, so under the renderer's tile-centre rule the last whale tile is
308. That figure comes from a hand-captured snapshot which may be refreshed — and the set of
claimable land must not shift under existing deeds when it is. The front end re-derives the
boundary from the snapshot on every test run and fails loudly if it ever drifts.

Reads are shaped for a hand-written decoder:

```solidity
function claimedCount() external view returns (uint256);
function claimedPacked(uint256 from, uint256 count) external view returns (uint256[] memory);
//   each word = uint256(uint160(owner)) | (uint256(tileId) << 160)
function labelOf(uint16 tileId) external view returns (string memory);
```

One packed `uint256[]` is the cheapest thing a small pure-JS decoder can read, which is what
makes the zero-dependency front end possible.

---

## The front end has no build step and no npm

This was a constraint, not a choice — the machine has no Node — and it turned into the most
interesting part of the project. Every Circle example assumes `npm install wagmi viem`.
[`arc.js`](../lim-landbank/website/arc.js) instead:

- **reads** by posting raw JSON-RPC `eth_call` to an ordered list of Arc endpoints, so the map
  renders for visitors with **no wallet installed at all**;
- **writes** through the injected EIP-1193 provider, with `maxFeePerGas` pinned above Arc's floor;
- **encodes ABI by hand**, using function selectors precomputed with `cast sig` so no keccak
  implementation is needed in the browser.

The encoder is not trusted on inspection. `tests.html` compares its output against calldata
generated by `cast calldata`, byte for byte, for ASCII, empty, exactly-32-byte and
emoji-containing labels. The whole site runs **320 in-browser assertions** with no runner.

---

## Deploy

```sh
# 1. one-time: create the encrypted keystore
cast wallet new .keystore arcdeploy

# 2. fund it at https://faucet.circle.com  (select "Arc Testnet")

# 3. deploy + verify on ArcScan
script/deploy-testnet.sh            # price 0: a claim costs only gas
script/deploy-testnet.sh 500000000000000000   # or 0.5 USDC, in 18-decimal wei

# 4. live checks against the real chain
script/arc-live-checks.sh 0xYourContract
```

Then paste the address into `ARC_CONTRACT` in `lim-landbank/website/arc.js` and run
`lim-landbank/scripts/sync-bitcoin-land.sh`.

## Network reference

Verified reachable from Jakarta on 2026-08-06 — all five endpoints returned `0x4cef52`. This
mattered: the same project already found `okx.com`, Coinbase, Kraken and Binance unreachable from
Indonesia, so Arc was not assumed to be different.

| | |
|---|---|
| Chain ID | `5042002` (`0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.io` (+ Blockdaemon, dRPC, QuickNode fallbacks) |
| Explorer | https://testnet.arcscan.app (Blockscout) |
| Faucet | https://faucet.circle.com |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` (6 decimals) |
| Native gas | USDC, 18 decimals — same balance |
| EIP-7708 emitter | `0xfffffffffffffffffffffffffffffffffffffffe` (18 decimals) |
| CCTP domain | `26` |

> Note: `docs.arc.io` gives the RPC as `rpc.testnet.arc.io` while the `use-arc` skill gives
> `rpc.testnet.arc.network`. **Both resolve and both report chain `5042002`.** This repo treats
> `docs.arc.io` as authoritative.

Arc mainnet addresses are not published yet; the docs still say testnet-only.

## Licence

MIT.
