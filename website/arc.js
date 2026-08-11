/*
 * Arc Land Registry — the on-chain half.
 *
 * The world view draws all 21,000,000 BTC as a 50 x 42 grid of 2,100 tiles of
 * 10,000 BTC each. The top-100 richest addresses occupy the first 309. This
 * file makes the remaining 1,791 claimable on Arc, Circle's Layer-1 where the
 * native gas token is USDC.
 *
 * WHAT THIS FILE MUST NEVER DO
 * ----------------------------
 * It must never read the owner's ledger. Not `totalBtc`, not the localStorage
 * key that holds it, not a hash or a bucket or a tier of it. A deed records a
 * tile and an address; how much Bitcoin somebody owns stays in their browser.
 * Putting "address -> amount owned" on a permanent public ledger builds a
 * target list. tests.html asserts this file contains no reference to either.
 *
 * ARC SPECIFICS THAT SHAPE THE CODE (docs.arc.io, read 2026-08-06)
 * ---------------------------------------------------------------
 *   - USDC is the native gas token. `msg.value` is 18-decimal native USDC; the
 *     ERC-20 view of the SAME balance at 0x3600...0000 is 6-decimal. They
 *     differ by exactly 1e12 — verified against live testnet state, not just
 *     read. (Arc's own gas-and-fees page has an example that gets this wrong.)
 *     Anything shown to a human is dollars; only wei math is 18-decimal.
 *   - maxFeePerGas must be at least 20 Gwei. Below that floor a transaction
 *     "may remain pending indefinitely or fail outright", so this file sets it
 *     explicitly rather than trusting the wallet's estimate.
 *   - Finality is deterministic and sub-second. One confirmation is final:
 *     no confirmation counting, no reorg handling, no rollback logic.
 *   - Arc is not in the WalletConnect registry, so wallet_addEthereumChain is
 *     required rather than optional.
 *   - Testnet "may experience instability or unplanned downtime", so reads walk
 *     an ordered list of RPC endpoints and every failure returns null rather
 *     than throwing — the same shape as price.js.
 *
 * Everything above the divider is pure and covered by tests.html.
 */

'use strict';

/* ------------------------------------------------------------- the network */

const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_ID_HEX = '0x4cef52';
const ARC_EXPLORER = 'https://testnet.arcscan.app';

// All five verified reachable from Jakarta on 2026-08-06, all returning
// 0x4cef52. docs.arc.io is authoritative; the rest are documented fallbacks.
const ARC_RPCS = [
  'https://rpc.testnet.arc.io',
  'https://rpc.blockdaemon.testnet.arc.io',
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
];

/**
 * The deployed ArcLandRegistry, verified on ArcScan:
 * https://testnet.arcscan.app/address/0xaE6E1017427e437017202Ffa1A9854848c9BC56b
 *
 * Leave this empty and the whole module degrades quietly to "registry not
 * deployed" — the board, ledger and every supply figure keep working regardless.
 */
const ARC_CONTRACT = '0xaE6E1017427e437017202Ffa1A9854848c9BC56b';

const ARC_RPC_TIMEOUT_MS = 10000;
const ARC_REFRESH_MS = 30000;
const ARC_PAGE_SIZE = 500;

/** Below 20 Gwei an Arc transaction can sit pending forever. Protocol floor. */
const ARC_MIN_MAX_FEE_WEI = 20000000000n;
/** A small tip improves inclusion during high utilisation. Docs suggest 1 Gwei. */
const ARC_PRIORITY_FEE_WEI = 1000000000n;

/* --------------------------------------------------- the registry's shape */

const ARC_WORLD_COLS = 50;
const ARC_WORLD_ROWS = 42;
const ARC_TILE_COUNT = 2100;
/**
 * Frozen in the contract. The top 100 hold 3,087,162 BTC = 308.7162 tiles, so
 * under the tile-centre rule the last whale tile is 308 and the first free one
 * is 309. tests.html re-derives this from whales.js and fails if it drifts.
 */
const ARC_FIRST_CLAIMABLE = 309;
const ARC_MAX_LABEL_BYTES = 32;

/** Precomputed with `cast sig`, so no keccak implementation is needed here. */
const ARC_SEL = {
  claimedCount: '0xc08fa1a4', //  claimedCount()
  claimedPacked: '0x7690bb99', // claimedPacked(uint256,uint256)
  labelOf: '0xa68dc013', //       labelOf(uint16)
  tileOwner: '0xf1136f6c', //     tileOwner(uint16)
  tileInfo: '0x56c7de20', //      tileInfo(uint16)
  isClaimable: '0x91e0cea7', //   isClaimable(uint16)
  remainingCount: '0xd8753aa5', //remainingCount()
  price: '0xa035b1fe', //         price()
  claim: '0xadf72a70', //         claim(uint16,string)
  setLabel: '0x8fdcda20', //      setLabel(uint16,string)
  transferTile: '0x39a9c5e7', //  transferTile(uint16,address)
};

/* ============================================================================
 * ABI codec — hand-rolled, because there is no build step and no npm here.
 * Every function below is pure and asserted in tests.html.
 * ==========================================================================*/

/** Left-pad a hex string to one 32-byte ABI word. */
function arcPadWord(hex) {
  const h = String(hex).replace(/^0x/i, '').toLowerCase();
  if (h.length > 64) throw new Error('arc: value wider than one word');
  return h.padStart(64, '0');
}

/** A non-negative integer as one ABI word. Accepts Number, BigInt or string. */
function arcEncodeUint(v) {
  const n = BigInt(v);
  if (n < 0n) throw new Error('arc: negative uint');
  return arcPadWord(n.toString(16));
}

/** A 20-byte address as one ABI word. */
function arcEncodeAddress(a) {
  const h = String(a).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('arc: bad address');
  return arcPadWord(h);
}

/**
 * UTF-8 bytes of a string, hand-rolled rather than via TextEncoder so the same
 * code runs in a browser and under the system JavaScriptCore used for headless
 * test runs.
 */
function arcUtf8Bytes(str) {
  const out = [];
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    let c = s.codePointAt(i);
    if (c > 0xffff) i++; // a surrogate pair was consumed
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

/** Inverse of arcUtf8Bytes. Malformed sequences are skipped, never thrown. */
function arcUtf8Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c, n;
    if (b < 0x80) { c = b; n = 1; }
    else if ((b & 0xe0) === 0xc0) { c = b & 0x1f; n = 2; }
    else if ((b & 0xf0) === 0xe0) { c = b & 0x0f; n = 3; }
    else if ((b & 0xf8) === 0xf0) { c = b & 0x07; n = 4; }
    else { i++; continue; }
    if (i + n > bytes.length) break;
    for (let k = 1; k < n; k++) c = (c << 6) | (bytes[i + k] & 63);
    out += String.fromCodePoint(c);
    i += n;
  }
  return out;
}

/** Bytes to a lowercase hex string, no 0x. */
function arcBytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** Hex (no 0x) to a byte array. */
function arcHexToBytes(hex) {
  const h = String(hex).replace(/^0x/i, '');
  const out = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}

/** Calldata for a function whose arguments are all single static words. */
function arcEncodeCall(selector, words) {
  return selector + (words || []).join('');
}

/**
 * Calldata for `claim(uint16 tileId, string label)`.
 * Head is [tileId, offset]; the offset is 0x40 because two head words precede
 * the tail. Tail is [length, padded bytes].
 */
function arcEncodeClaim(tileId, label) {
  const bytes = arcUtf8Bytes(label);
  if (bytes.length > ARC_MAX_LABEL_BYTES) {
    throw new Error('arc: label is ' + bytes.length + ' bytes, limit is ' + ARC_MAX_LABEL_BYTES);
  }
  const head = arcEncodeUint(tileId) + arcEncodeUint(64);
  let body = arcBytesToHex(bytes);
  const remainder = body.length % 64;
  if (remainder) body += '0'.repeat(64 - remainder);
  return ARC_SEL.claim + head + arcEncodeUint(bytes.length) + body;
}

/** One ABI word from return data, as a BigInt. */
function arcDecodeUint(hex, wordIndex) {
  const h = String(hex).replace(/^0x/i, '');
  const at = (wordIndex || 0) * 64;
  if (h.length < at + 64) return null;
  return BigInt('0x' + h.slice(at, at + 64));
}

/** A returned `uint256[]`, as an array of BigInt. */
function arcDecodeUintArray(hex) {
  const h = String(hex).replace(/^0x/i, '');
  if (h.length < 128) return [];
  const offset = Number(BigInt('0x' + h.slice(0, 64)));
  const base = offset * 2;
  if (h.length < base + 64) return [];
  const len = Number(BigInt('0x' + h.slice(base, base + 64)));
  const out = [];
  for (let i = 0; i < len; i++) {
    const at = base + 64 + i * 64;
    if (h.length < at + 64) break;
    out.push(BigInt('0x' + h.slice(at, at + 64)));
  }
  return out;
}

/**
 * Unpack one word of `claimedPacked`:
 * `uint256(uint160(owner)) | (uint256(tileId) << 160)`.
 */
function arcDecodePackedWord(word) {
  const w = BigInt(word);
  const owner = '0x' + (w & ((1n << 160n) - 1n)).toString(16).padStart(40, '0');
  return { tileId: Number(w >> 160n), owner: owner };
}

/** The whole page at once. */
function arcDecodeClaimedPacked(hex) {
  return arcDecodeUintArray(hex).map(arcDecodePackedWord);
}

/** A returned `string`. */
function arcDecodeString(hex) {
  const h = String(hex).replace(/^0x/i, '');
  if (h.length < 128) return '';
  const offset = Number(BigInt('0x' + h.slice(0, 64)));
  const base = offset * 2;
  if (h.length < base + 64) return '';
  const len = Number(BigInt('0x' + h.slice(base, base + 64)));
  const body = h.slice(base + 64, base + 64 + len * 2);
  return arcUtf8Decode(arcHexToBytes(body));
}

/** A returned `address`. */
function arcDecodeAddress(hex) {
  const w = arcDecodeUint(hex, 0);
  if (w == null) return null;
  return '0x' + (w & ((1n << 160n) - 1n)).toString(16).padStart(40, '0');
}

/** Return data for `tileInfo(uint16)` -> (address, uint64, string). */
function arcDecodeTileInfo(hex) {
  const h = String(hex).replace(/^0x/i, '');
  if (h.length < 192) return null;
  const ownerWord = BigInt('0x' + h.slice(0, 64));
  const owner = '0x' + (ownerWord & ((1n << 160n) - 1n)).toString(16).padStart(40, '0');
  const claimedAt = Number(BigInt('0x' + h.slice(64, 128)));
  // The string's offset is measured from the start of the return data.
  const offset = Number(BigInt('0x' + h.slice(128, 192)));
  const base = offset * 2;
  let label = '';
  if (h.length >= base + 64) {
    const len = Number(BigInt('0x' + h.slice(base, base + 64)));
    label = arcUtf8Decode(arcHexToBytes(h.slice(base + 64, base + 64 + len * 2)));
  }
  return { owner: owner, claimedAt: claimedAt, label: label };
}

/* ------------------------------------------------------- units and display */

/**
 * 18-decimal native wei to a USDC number.
 * Split rather than `Number(wei)/1e18`, because a whole-dollar figure in wei
 * passes 2^53 and would lose precision before the division.
 */
function arcWeiToUsdc(wei) {
  const w = BigInt(wei);
  const whole = w / 1000000000000000000n;
  const frac = w % 1000000000000000000n;
  return Number(whole) + Number(frac) / 1e18;
}

/** A USDC number back to 18-decimal native wei. */
function arcUsdcToWei(usdc) {
  const n = Number(usdc);
  if (!isFinite(n) || n < 0) throw new Error('arc: bad usdc amount');
  // Round through the 6-decimal view first: that is the precision USDC has.
  const micro = BigInt(Math.round(n * 1e6));
  return micro * 1000000000000n;
}

/** The 6-decimal ERC-20 view of an 18-decimal native amount. Truncates. */
function arcWeiToErc20Units(wei) {
  return BigInt(wei) / 1000000000000n;
}

/**
 * What a transaction will cost, in USDC.
 * Arc denominates gas in USDC, and the docs ask for fees to be surfaced in
 * dollar terms rather than raw Gwei.
 */
function arcGasCostUsdc(gasLimit, maxFeePerGasWei) {
  return arcWeiToUsdc(BigInt(gasLimit) * BigInt(maxFeePerGasWei));
}

/**
 * Choose maxFeePerGas. Never below Arc's 20 Gwei floor, or the transaction can
 * sit pending forever; otherwise twice the suggested price for headroom.
 */
function arcMaxFeePerGas(suggestedWei) {
  let s;
  try { s = BigInt(suggestedWei || 0); } catch (e) { s = 0n; }
  if (s < 0n) s = 0n;
  const doubled = s * 2n;
  return doubled > ARC_MIN_MAX_FEE_WEI ? doubled : ARC_MIN_MAX_FEE_WEI;
}

/* ------------------------------------------------------------ tile helpers */

/** Column of a tile id. Mirrors `isoWorldIndex` in iso.js, inverted. */
function arcTileCol(tileId) { return tileId % ARC_WORLD_COLS; }

/** Row of a tile id. */
function arcTileRow(tileId) { return Math.floor(tileId / ARC_WORLD_COLS); }

/** `row * WORLD_COLS + col`, the same formula the renderer and contract use. */
function arcTileId(col, row) { return row * ARC_WORLD_COLS + col; }

/** In range and not reserved for the top 100. Says nothing about ownership. */
function arcTileIsClaimable(tileId) {
  return Number.isInteger(tileId) && tileId >= ARC_FIRST_CLAIMABLE && tileId < ARC_TILE_COUNT;
}

/** '0x1234…cdef' — an address is too long to show whole in a hover card. */
function arcShortAddress(a) {
  const s = String(a || '');
  return s.length <= 12 ? s : s.slice(0, 6) + '…' + s.slice(-4);
}

/** True when two addresses are the same, ignoring case. */
function arcSameAddress(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * 'YYYY-MM-DD' in WIB from a unix seconds stamp.
 *
 * Same fixed +7 rule as every other date on the site, and for the same reason:
 * formatting a locally-parsed date through toISOString() at UTC+7 silently
 * subtracts a day. Note that Arc block timestamps are non-decreasing rather
 * than strictly increasing, so this is for display only — ordering comes from
 * the registry's own insertion order.
 */
function arcWibDate(unixSeconds) {
  const n = Number(unixSeconds);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date((n + 7 * 60 * 60) * 1000);
  const p = (v) => String(v).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** Explorer links. */
function arcTxUrl(hash) { return ARC_EXPLORER + '/tx/' + hash; }
function arcAddressUrl(addr) { return ARC_EXPLORER + '/address/' + addr; }

/* ------------------------------------------------- wallet discovery (pure) */

/**
 * Validate one EIP-6963 `announceProvider` record.
 *
 * Any page script can fire this event, so a record is untrusted input: it is
 * only usable if it carries a real provider object and the identifying fields
 * the picker will display. An icon must be a data: URI — a remote URL would
 * both leak a request on page load and let a hostile announcement point at
 * anything.
 */
function arcIsValidWalletRecord(detail) {
  if (!detail || typeof detail !== 'object') return false;
  const info = detail.info;
  const provider = detail.provider;
  if (!info || typeof info !== 'object') return false;
  if (!provider || typeof provider.request !== 'function') return false;
  if (typeof info.uuid !== 'string' || !info.uuid) return false;
  if (typeof info.rdns !== 'string' || !info.rdns) return false;
  if (typeof info.name !== 'string' || !info.name) return false;
  if (info.icon != null && !/^data:image\//i.test(String(info.icon))) return false;
  return true;
}

/**
 * Merge an announcement into the known list, keyed by rdns.
 *
 * Wallets re-announce whenever the page asks, so the same wallet arrives many
 * times and must not stack up in the picker. rdns is the stable identity;
 * uuid is regenerated per page load and is useless for dedupe.
 */
function arcMergeWallet(list, detail) {
  if (!arcIsValidWalletRecord(detail)) return list;
  const out = list.slice();
  const at = out.findIndex((w) => w.info.rdns === detail.info.rdns);
  if (at >= 0) out[at] = detail; else out.push(detail);
  return out;
}

/** What the connect button should say, given the current state. */
function arcConnectLabel(state) {
  const s = state || {};
  if (!s.account) return 'Connect wallet';
  if (!s.chainOk) return 'Wrong network';
  return arcShortAddress(s.account);
}

/** Which visual state that button is in: 'idle' | 'warn' | 'on'. */
function arcConnectState(state) {
  const s = state || {};
  if (!s.account) return 'idle';
  if (!s.chainOk) return 'warn';
  return 'on';
}

/** '$1.00' style balance for the connected wallet, from 18-decimal wei. */
function arcBalanceLabel(wei) {
  if (wei == null) return '—';
  return formatUsd(arcWeiToUsdc(wei));
}

/* ============================================================================
 * Network layer — not covered by tests.html
 * ==========================================================================*/

if (typeof window !== 'undefined' && !window.__LANDBANK_TEST_ONLY__) {

const A = {
  tiles: {},        // tileId -> { owner, index }
  count: 0,
  remaining: ARC_TILE_COUNT - ARC_FIRST_CLAIMABLE,
  priceWei: 0n,
  at: null,
  failing: false,
  deployed: !!ARC_CONTRACT,
  account: null,
  chainOk: false,
  wallets: [],      // EIP-6963 announcements, deduped by rdns
  selected: null,   // the announcement the user picked
  balanceWei: null, // native USDC of the connected account
  timer: 0,
};

/** Remembers which wallet was used, so a return visit skips the picker. */
const ARC_WALLET_KEY = 'arcland.wallet';
const listeners = [];

function announce() { listeners.forEach((fn) => { try { fn(snapshot()); } catch (e) {} }); }

function snapshot() {
  return {
    tiles: A.tiles,
    count: A.count,
    remaining: A.remaining,
    priceWei: A.priceWei,
    priceUsdc: A.priceWei ? arcWeiToUsdc(A.priceWei) : 0,
    at: A.at,
    failing: A.failing,
    deployed: A.deployed,
    account: A.account,
    chainOk: A.chainOk,
    wallets: A.wallets.map((w) => ({ name: w.info.name, rdns: w.info.rdns, icon: w.info.icon })),
    selected: A.selected ? A.selected.info.rdns : null,
    balanceWei: A.balanceWei,
    balanceLabel: arcBalanceLabel(A.balanceWei),
  };
}

/**
 * One JSON-RPC call against the first endpoint that answers.
 * Returns null rather than throwing — a third-party RPC failing is an ordinary
 * outcome, and Arc's own docs warn testnet may have unplanned downtime.
 */
async function rpc(method, params) {
  for (const url of ARC_RPCS) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ARC_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params || [] }),
        signal: ac.signal,
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.error) continue;
      if (json && typeof json.result !== 'undefined') return json.result;
    } catch (e) {
      // try the next endpoint
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

/** A read-only contract call. */
async function ethCall(data) {
  if (!ARC_CONTRACT) return null;
  return rpc('eth_call', [{ to: ARC_CONTRACT, data: data }, 'latest']);
}

async function refresh() {
  if (!ARC_CONTRACT) { A.deployed = false; announce(); return; }

  const countHex = await ethCall(ARC_SEL.claimedCount);
  if (countHex == null) {
    A.failing = true;
    announce();
    return;
  }

  const count = Number(arcDecodeUint(countHex, 0) || 0n);
  const tiles = {};
  for (let from = 0; from < count; from += ARC_PAGE_SIZE) {
    const data = arcEncodeCall(ARC_SEL.claimedPacked, [arcEncodeUint(from), arcEncodeUint(ARC_PAGE_SIZE)]);
    const pageHex = await ethCall(data);
    if (pageHex == null) { A.failing = true; announce(); return; }
    arcDecodeClaimedPacked(pageHex).forEach((row, i) => {
      tiles[row.tileId] = { owner: row.owner, index: from + i };
    });
  }

  const priceHex = await ethCall(ARC_SEL.price);
  if (priceHex != null) A.priceWei = arcDecodeUint(priceHex, 0) || 0n;

  A.tiles = tiles;
  A.count = count;
  A.remaining = (ARC_TILE_COUNT - ARC_FIRST_CLAIMABLE) - count;
  A.at = Date.now();
  A.failing = false;
  A.deployed = true;
  announce();
}

/** Full detail for one tile, fetched on demand for a hover card. */
async function tileDetail(tileId) {
  const hex = await ethCall(arcEncodeCall(ARC_SEL.tileInfo, [arcEncodeUint(tileId)]));
  if (hex == null) return null;
  return arcDecodeTileInfo(hex);
}

/* ------------------------------------------------------------ wallet layer */

/**
 * EIP-6963 wallet discovery.
 *
 * The legacy way to find a wallet is `window.ethereum`, but that is a single
 * slot: with both Rabby and MetaMask installed they race for it and the user
 * gets whichever won, with no say. EIP-6963 fixes that — the page asks, and
 * every installed wallet announces itself with a name, an icon and its own
 * provider object, so the user can pick.
 *
 * Discovery is not a one-shot: extensions can announce late (or after being
 * enabled), so the listener stays attached and the page re-asks on load.
 */
function discoverWallets() {
  if (typeof window === 'undefined') return;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const before = A.wallets.length;
    A.wallets = arcMergeWallet(A.wallets, event.detail);
    if (A.wallets.length !== before) announce();
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/**
 * The provider to talk to: whichever wallet the user picked, else the legacy
 * injected one so wallets that never adopted EIP-6963 still work.
 */
function provider() {
  if (A.selected && A.selected.provider) return A.selected.provider;
  return typeof window !== 'undefined' ? window.ethereum : null;
}

const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPCS[0]],
  blockExplorerUrls: [ARC_EXPLORER],
};

/**
 * Put the wallet on Arc. Arc is not in the WalletConnect registry, so a
 * switch may legitimately fail with "unrecognised chain" and need an add.
 */
async function ensureChain() {
  const eth = provider();
  if (!eth) return false;
  const current = await eth.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === ARC_CHAIN_ID_HEX) return true;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] });
  } catch (e) {
    if (e && (e.code === 4902 || e.code === -32603)) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] });
    } else {
      throw e;
    }
  }
  const after = await eth.request({ method: 'eth_chainId' });
  return String(after).toLowerCase() === ARC_CHAIN_ID_HEX;
}

/**
 * Connect a wallet.
 *
 * `rdns` picks a specific announced wallet; without it, a single announced
 * wallet is used directly and several means the caller should show the picker
 * rather than choosing for the user.
 */
async function connect(rdns) {
  if (rdns) {
    const found = A.wallets.find((w) => w.info.rdns === rdns);
    if (!found) return { ok: false, reason: 'unknown-wallet' };
    A.selected = found;
  } else if (!A.selected) {
    if (A.wallets.length === 1) A.selected = A.wallets[0];
    else if (A.wallets.length > 1) return { ok: false, reason: 'choose-wallet', wallets: A.wallets };
  }

  const eth = provider();
  if (!eth) return { ok: false, reason: 'no-wallet' };
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    A.account = (accounts && accounts[0]) || null;
    A.chainOk = await ensureChain();
    bindProviderEvents(eth);
    await refreshBalance();
    if (A.selected) {
      try { localStorage.setItem(ARC_WALLET_KEY, A.selected.info.rdns); } catch (e) {}
    }
    announce();
    return { ok: !!A.account && A.chainOk, account: A.account, chainOk: A.chainOk };
  } catch (e) {
    return { ok: false, reason: e && e.code === 4001 ? 'rejected' : 'error', error: e };
  }
}

/**
 * Forget the wallet locally.
 *
 * There is no way to revoke a connection from the page — EIP-1193 has no
 * disconnect — so this clears our own state and the user revokes in the wallet
 * itself if they want to. Saying "disconnected" while the wallet still holds
 * the grant would be a lie, so the UI says what actually happened.
 */
function disconnect() {
  A.account = null;
  A.chainOk = false;
  A.balanceWei = null;
  A.selected = null;
  try { localStorage.removeItem(ARC_WALLET_KEY); } catch (e) {}
  announce();
}

/** Native USDC balance of the connected account, 18-decimal wei. */
async function refreshBalance() {
  if (!A.account) { A.balanceWei = null; return; }
  const hex = await rpc('eth_getBalance', [A.account, 'latest']);
  A.balanceWei = hex == null ? null : BigInt(hex);
}

let boundProvider = null;
function bindProviderEvents(eth) {
  if (!eth || !eth.on || boundProvider === eth) return;
  boundProvider = eth;
  eth.on('accountsChanged', async (accounts) => {
    A.account = (accounts && accounts[0]) || null;
    if (!A.account) { A.chainOk = false; A.balanceWei = null; }
    else await refreshBalance();
    announce();
  });
  eth.on('chainChanged', async (id) => {
    A.chainOk = String(id).toLowerCase() === ARC_CHAIN_ID_HEX;
    await refreshBalance();
    announce();
  });
}

/** What a claim will cost right now, in USDC, for showing before signing. */
async function quote(tileId, label) {
  const gasPriceHex = await rpc('eth_gasPrice', []);
  const maxFee = arcMaxFeePerGas(gasPriceHex ? BigInt(gasPriceHex) : 0n);
  let gas = 150000n;
  if (ARC_CONTRACT && A.account) {
    const est = await rpc('eth_estimateGas', [{
      from: A.account,
      to: ARC_CONTRACT,
      data: arcEncodeClaim(tileId, label || ''),
      value: '0x' + A.priceWei.toString(16),
    }]);
    if (est != null) gas = (BigInt(est) * 12n) / 10n; // 20% headroom
  }
  return {
    gasLimit: gas,
    maxFeePerGas: maxFee,
    feeUsdc: arcGasCostUsdc(gas, maxFee),
    priceUsdc: arcWeiToUsdc(A.priceWei),
    totalUsdc: arcGasCostUsdc(gas, maxFee) + arcWeiToUsdc(A.priceWei),
  };
}

/**
 * Claim a tile. Verifies the chain before sending (Circle's own skill rule),
 * and sets maxFeePerGas explicitly so the transaction cannot land below Arc's
 * 20 Gwei floor and hang.
 */
async function claim(tileId, label) {
  const eth = provider();
  if (!eth) return { ok: false, reason: 'no-wallet' };
  if (!ARC_CONTRACT) return { ok: false, reason: 'not-deployed' };
  if (!arcTileIsClaimable(tileId)) return { ok: false, reason: 'not-claimable' };

  if (!A.account) {
    const c = await connect();
    if (!c.ok) return { ok: false, reason: c.reason };
  }
  if (!(await ensureChain())) return { ok: false, reason: 'wrong-chain' };

  let data;
  try {
    data = arcEncodeClaim(tileId, label || '');
  } catch (e) {
    return { ok: false, reason: 'label-too-long', error: e };
  }

  const q = await quote(tileId, label);
  const tx = {
    from: A.account,
    to: ARC_CONTRACT,
    data: data,
    value: '0x' + A.priceWei.toString(16),
    gas: '0x' + q.gasLimit.toString(16),
    maxFeePerGas: '0x' + q.maxFeePerGas.toString(16),
    maxPriorityFeePerGas: '0x' + ARC_PRIORITY_FEE_WEI.toString(16),
  };

  let hash;
  try {
    hash = await eth.request({ method: 'eth_sendTransaction', params: [tx] });
  } catch (e) {
    return { ok: false, reason: e && e.code === 4001 ? 'rejected' : 'send-failed', error: e };
  }

  // Finality is deterministic and sub-second: one receipt is final, so this
  // polls briefly rather than counting confirmations.
  for (let i = 0; i < 20; i++) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      const ok = receipt.status === '0x1';
      if (ok) await refresh();
      return { ok: ok, hash: hash, url: arcTxUrl(hash), reason: ok ? null : 'reverted' };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: true, hash: hash, url: arcTxUrl(hash), reason: 'pending' };
}

/* ------------------------------------------------------------------ export */

window.Arc = {
  get: snapshot,
  onUpdate: (fn) => { listeners.push(fn); },
  refresh: refresh,
  connect: connect,
  disconnect: disconnect,
  ensureChain: ensureChain,
  claim: claim,
  quote: quote,
  tileDetail: tileDetail,
  ownerOf: (tileId) => (A.tiles[tileId] ? A.tiles[tileId].owner : null),
  isMine: (tileId) => !!A.tiles[tileId] && arcSameAddress(A.tiles[tileId].owner, A.account),
  contract: ARC_CONTRACT,
  explorer: ARC_EXPLORER,
  chainId: ARC_CHAIN_ID,

  /**
   * Shared so other files (stables.js) reuse the four-endpoint fallback rather
   * than keeping a second copy of the endpoint list, which would drift.
   * `call` is the generic form of ethCall(), which is pinned to the registry.
   */
  rpc: rpc,
  call: (to, data) => rpc('eth_call', [{ to: to, data: data }, 'latest']),
};

discoverWallets();

/**
 * Silently restore a previous session.
 *
 * `eth_accounts` never prompts — it returns an account only where the user has
 * already granted this origin, so a returning visitor is reconnected without a
 * popup, and a first-time visitor sees nothing at all.
 *
 * Announcements can arrive after this runs, so it retries briefly rather than
 * assuming the wallet list is complete on the first tick.
 */
(function restoreSession() {
  let tries = 0;
  const attempt = async () => {
    tries++;
    let remembered = null;
    try { remembered = localStorage.getItem(ARC_WALLET_KEY); } catch (e) {}
    if (remembered && !A.selected) {
      const found = A.wallets.find((w) => w.info.rdns === remembered);
      if (found) A.selected = found;
    }
    const eth = provider();
    if (!eth || !eth.request) {
      if (tries < 6) setTimeout(attempt, 300);
      return;
    }
    try {
      const accounts = await eth.request({ method: 'eth_accounts' });
      if (accounts && accounts.length) {
        A.account = accounts[0];
        const id = await eth.request({ method: 'eth_chainId' });
        A.chainOk = String(id).toLowerCase() === ARC_CHAIN_ID_HEX;
        bindProviderEvents(eth);
        await refreshBalance();
        announce();
        return;
      }
    } catch (e) { /* not authorised yet — that is the normal first visit */ }
    if (tries < 6) setTimeout(attempt, 300);
  };
  attempt();
})();

refresh();
A.timer = setInterval(refresh, ARC_REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (A.at == null || Date.now() - A.at > ARC_REFRESH_MS)) refresh();
});

}
