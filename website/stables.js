/*
 * Arc Land Registry — the stablecoin tracker.
 *
 * Arc is Circle's chain and USDC is its native gas token, so the supply of USDC
 * and EURC is the other half of this site's one idea: how much of a fixed thing
 * (21,000,000 BTC) is yours, against how much of an elastic one exists.
 *
 * WHERE EACH NUMBER COMES FROM, AND WHY
 * -------------------------------------
 * Supply comes from Circle's own public endpoint, never from the chain.
 *
 *   On Arc Testnet the token contracts report a totalSupply of ~212 BILLION USDC
 *   and ~2 TRILLION EURC, because the faucet mints on demand. Those figures are
 *   real reads of a real contract and completely meaningless as supply. Printing
 *   them would be stating a confident lie, so this file never asks the chain how
 *   much exists.
 *
 * The chain IS authoritative about two things, and is used for exactly those:
 * the connected wallet's own balance, and actual mint/burn activity.
 *
 *   1. api.circle.com/v1/stablecoins — Circle's official per-chain supply, and
 *      it lists ARC. Public, no key, CORS-clean; verified from Jakarta
 *      2026-08-11. Amounts arrive as STRINGS with up to 20 significant digits,
 *      which is more precision than a float64 carries — fine for a figure shown
 *      to 2dp, but it is why every amount goes through stableNum() rather than
 *      being trusted as a number.
 *   2. CoinGecko — price only, for peg health and the EUR→USD conversion.
 *      Already this project's price fallback, so it is a known quantity.
 *   3. The Arc RPC, reached through window.Arc.rpc so the four-endpoint fallback
 *      is shared rather than duplicated here.
 *
 * NO API KEYS ANYWHERE, and no source is used that would need one. This is a
 * static site with no backend: a key placed in this file would be published to
 * everyone who loads the page.
 *
 * eth_getLogs IS CAPPED. Measured against the live RPC: 10,000 blocks answers,
 * 50,000 returns "requested range too large", 200,000 returns "rate limit
 * exceeded". Every log query is bounded by STABLE_LOG_MAX_BLOCKS, a constant —
 * never by anything a visitor can influence.
 *
 * Everything above the divider is pure and covered by tests.html.
 */

'use strict';

/* ------------------------------------------------------------- the tokens */

// Arc Testnet. USDC is also the native gas token; this is its ERC-20 interface,
// which views the SAME balance at 6 decimals rather than 18.
const STABLE_TOKENS = [
  { key: 'usdc', symbol: 'USDC', currency: '$', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  { key: 'eurc', symbol: 'EURC', currency: '€', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
];

/**
 * Circle's API calls it EUROC; Arc's docs and the token itself say EURC.
 * Mapped on read so one name is used everywhere the visitor can see.
 */
const STABLE_CIRCLE_SYMBOLS = { USDC: 'usdc', EUROC: 'eurc', EURC: 'eurc' };

const STABLE_CIRCLE_URL = 'https://api.circle.com/v1/stablecoins';
const STABLE_CG_URL =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=usd-coin,euro-coin';

/** Precomputed with `cast sig`, so no keccak implementation is needed here. */
const STABLE_SEL = {
  totalSupply: '0x18160ddd', // totalSupply()
  decimals: '0x313ce567', //   decimals()
  balanceOf: '0x70a08231', //  balanceOf(address)
};

/** `cast keccak "Transfer(address,address,uint256)"` */
const STABLE_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const STABLE_ZERO_TOPIC = '0x' + '0'.repeat(64);

/** The measured ceiling of this RPC. 50,000 is refused outright. */
const STABLE_LOG_MAX_BLOCKS = 10000;
const STABLE_LOG_SPAN = 9000;      // a little under the ceiling, for headroom
const STABLE_REFRESH_MS = 60000;
const STABLE_TIMEOUT_MS = 12000;
const STABLE_FEED_MAX = 12;        // rows kept for the activity feed

/* ============================================================================
 * Parsing — every one of these returns null rather than throwing. A third-party
 * feed returning nonsense is an ordinary outcome, not an exception.
 * ==========================================================================*/

/**
 * A number from an untrusted feed, or null.
 *
 * Rejects non-finite and negative values at the parser rather than at the
 * render site, so a broken upstream can never reach the DOM as `NaN%` or a
 * misleading `$0.00`. Accepts the strings Circle actually sends.
 */
function stableNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Circle's /v1/stablecoins payload.
 *
 * Shape: { data: [ { name, symbol, totalAmount, chains: [ {chain, amount, updateDate} ] } ] }
 * A zero or missing total is treated as a failure, not as zero: every share and
 * percentage on the page divides by it, and a silent 0 would render the whole
 * panel as 0.00% while looking perfectly healthy.
 */
function parseCircleStablecoins(json) {
  if (!json || !Array.isArray(json.data) || !json.data.length) return null;
  const out = {};

  for (const entry of json.data) {
    if (!entry || typeof entry.symbol !== 'string') continue;
    const key = STABLE_CIRCLE_SYMBOLS[entry.symbol.toUpperCase()];
    if (!key) continue;

    const total = stableNum(entry.totalAmount);
    if (total == null || total <= 0) continue;

    const chains = [];
    if (Array.isArray(entry.chains)) {
      for (const c of entry.chains) {
        if (!c || typeof c.chain !== 'string') continue;
        const amount = stableNum(c.amount);
        if (amount == null) continue;
        chains.push({ chain: c.chain.toUpperCase(), amount: amount, updated: c.updateDate || null });
      }
    }
    chains.sort((a, b) => b.amount - a.amount);

    const arcRow = chains.find((c) => c.chain === 'ARC');
    out[key] = {
      key: key,
      total: total,
      chains: chains,
      chainCount: chains.length,
      arc: arcRow ? arcRow.amount : null,
      arcUpdated: arcRow ? arcRow.updated : null,
    };
  }

  return Object.keys(out).length ? out : null;
}

/** CoinGecko /coins/markets — price and market cap only. */
function parseCoinGeckoMarkets(json) {
  if (!Array.isArray(json) || !json.length) return null;
  const ids = { 'usd-coin': 'usdc', 'euro-coin': 'eurc' };
  const out = {};
  for (const row of json) {
    if (!row || typeof row.id !== 'string') continue;
    const key = ids[row.id];
    if (!key) continue;
    const price = stableNum(row.current_price);
    if (price == null || price <= 0) continue;   // a zero price would zero every valuation
    out[key] = { price: price, mcap: stableNum(row.market_cap) };
  }
  return Object.keys(out).length ? out : null;
}

/* -------------------------------------------------------------- unit maths */

/**
 * Raw integer token units to a decimal number.
 *
 * arcWeiToUsdc hardcodes 18 decimals; USDC and EURC are 6. The whole/fraction
 * split matters as much here as it does there: a realistic USDC total supply is
 * ~7.2e16 micro-units, comfortably past 2^53, so converting the raw value to a
 * Number before dividing would quietly lose precision.
 */
function stableUnits(raw, decimals) {
  if (raw == null) return null;
  let v;
  try { v = BigInt(raw); } catch (e) { return null; }
  if (v < 0n) return null;
  const d = Number(decimals);
  if (!isFinite(d) || d < 0 || d > 36) return null;
  const scale = 10n ** BigInt(d);
  const whole = v / scale;
  const frac = v % scale;
  return Number(whole) + Number(frac) / Number(scale);
}

/** Arc's share of a global total, as a percentage. Null-safe both ways. */
function stableShareOfTotal(part, total) {
  const p = stableNum(part);
  const t = stableNum(total);
  if (p == null || t == null || t <= 0) return null;
  return (p / t) * 100;
}

/**
 * Where a chain ranks by amount. Returns null when the chain is absent, so the
 * caller shows a dash rather than inventing a position.
 */
function stableChainRank(chains, chainName) {
  if (!Array.isArray(chains) || !chains.length || !chainName) return null;
  const want = String(chainName).toUpperCase();
  const sorted = chains.slice().sort((a, b) => b.amount - a.amount);
  const at = sorted.findIndex((c) => c.chain === want);
  if (at < 0) return null;
  return { rank: at + 1, of: sorted.length };
}

/* -------------------------------------------------------------- formatting */

/** '$72.24bn' / '€392.8m' — a headline figure, not an exact one. */
function stableFormatBig(n, currency) {
  const v = stableNum(n);
  if (v == null) return '—';
  const c = currency || '';
  const abs = Math.abs(v);
  if (abs >= 1e12) return c + (v / 1e12).toFixed(2) + 'tn';
  if (abs >= 1e9) return c + (v / 1e9).toFixed(2) + 'bn';
  if (abs >= 1e6) return c + (v / 1e6).toFixed(1) + 'm';
  if (abs >= 1e3) return c + (v / 1e3).toFixed(1) + 'k';
  return c + v.toFixed(2);
}

/** '$8,779,494.64' — the exact figure, for the number people will check. */
function stableFormatExact(n, currency) {
  const v = stableNum(n);
  if (v == null) return '—';
  return (currency || '') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** '0.0121%' — small shares need more places than a percentage usually does. */
function stableFormatPct(p) {
  const v = stableNum(p);
  if (v == null) return '—';
  if (v === 0) return '0%';
  if (v < 0.001) return '<0.001%';
  if (v < 1) return v.toFixed(4) + '%';
  return v.toFixed(2) + '%';
}

/**
 * How far a stablecoin sits from its peg, in percent. Signed: negative is below.
 * `target` is 1 for USDC; for EURC the peg is one euro, so the caller supplies
 * the live EUR/USD rate rather than assuming 1.
 */
function stablePegDelta(price, target) {
  const p = stableNum(price);
  const t = stableNum(target);
  if (p == null || t == null || t <= 0) return null;
  return ((p - t) / t) * 100;
}

/** '+0.02%' / '−0.04%', with a real minus sign. */
function stableFormatPeg(delta) {
  const d = stableNum(delta == null ? null : Math.abs(delta));
  if (delta == null || d == null) return '—';
  const sign = delta < 0 ? '−' : '+';
  return sign + d.toFixed(3) + '%';
}

/* ------------------------------------------------------------ issuance logs */

/**
 * The block window to ask for, clamped to what the RPC will actually answer.
 *
 * Measured on the live endpoint: 10,000 blocks is served, 50,000 is refused with
 * "requested range too large". The clamp is a constant so no input can widen it.
 */
function stableLogRange(tipBlock, span) {
  const tip = Number(tipBlock);
  if (!isFinite(tip) || tip < 0) return null;
  let want = Number(span);
  if (!isFinite(want) || want <= 0) want = STABLE_LOG_SPAN;
  if (want > STABLE_LOG_MAX_BLOCKS) want = STABLE_LOG_MAX_BLOCKS;
  const from = Math.max(0, Math.floor(tip - want));
  return { from: from, to: Math.floor(tip) };
}

/**
 * Turn raw Transfer logs into mint/burn rows.
 *
 * A Transfer whose sender is the zero address is a mint; one whose recipient is
 * the zero address is a burn. On Arc most burns come from CCTP's TokenMinterV2
 * — the coin is not destroyed so much as moved to another chain — which is why
 * the caller labels rather than just counts them.
 */
function parseMintBurnLogs(logs, decimals) {
  if (!Array.isArray(logs)) return [];
  const out = [];
  for (const l of logs) {
    if (!l || !Array.isArray(l.topics) || l.topics.length < 3) continue;
    if (String(l.topics[0]).toLowerCase() !== STABLE_TRANSFER_TOPIC) continue;

    const from = String(l.topics[1]).toLowerCase();
    const to = String(l.topics[2]).toLowerCase();
    const isMint = from === STABLE_ZERO_TOPIC;
    const isBurn = to === STABLE_ZERO_TOPIC;
    if (isMint === isBurn) continue;             // neither, or a nonsensical both

    const amount = stableUnits(l.data == null ? null : BigInt(l.data), decimals);
    if (amount == null) continue;

    const block = Number(l.blockNumber);
    out.push({
      kind: isMint ? 'mint' : 'burn',
      amount: amount,
      address: '0x' + (isMint ? to : from).slice(-40),
      block: isFinite(block) ? block : null,
      tx: typeof l.transactionHash === 'string' ? l.transactionHash : null,
    });
  }
  // Newest first. Block order is the only ordering available and is enough here.
  out.sort((a, b) => (b.block || 0) - (a.block || 0));
  return out;
}

/** Net issued over a window: mints less burns. */
function stableNetIssuance(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((n, r) => n + (r.kind === 'mint' ? r.amount : -r.amount), 0);
}

/* ============================================================================
 * Network layer — not covered by tests.html
 * ==========================================================================*/

if (typeof window !== 'undefined' && !window.__LANDBANK_TEST_ONLY__) {

const S = {
  circle: null,      // parsed Circle supply, by token key
  market: null,      // parsed CoinGecko price/mcap, by token key
  balances: {},      // token key -> number, for the connected wallet
  feed: [],          // recent mint/burn rows on Arc
  gasUsdc: null,     // what a claim-sized transaction costs, in USDC
  at: null,
  failing: false,
  timer: 0,
};
const listeners = [];

function announce() { listeners.forEach((fn) => { try { fn(snapshot()); } catch (e) {} }); }

function snapshot() {
  return {
    circle: S.circle,
    market: S.market,
    balances: S.balances,
    feed: S.feed,
    gasUsdc: S.gasUsdc,
    at: S.at,
    failing: S.failing,
    tokens: STABLE_TOKENS,
  };
}

/**
 * One GET against a public JSON feed.
 *
 * Same contract as price.js's fetchOnce: AbortController so a hung socket
 * cannot wedge the panel forever, and null on every failure path so the caller
 * simply keeps its last good value.
 */
async function getJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), STABLE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The connected wallet's balance of one token, via the shared RPC fallback. */
async function fetchBalance(token, account) {
  if (!account || !window.Arc || !window.Arc.call) return null;
  const data = arcEncodeCall(STABLE_SEL.balanceOf, [arcEncodeAddress(account)]);
  const hex = await window.Arc.call(token.address, data);
  if (hex == null) return null;
  const raw = arcDecodeUint(hex, 0);
  return raw == null ? null : stableUnits(raw, token.decimals);
}

/** Recent mint and burn activity for one token on Arc. */
async function fetchIssuance(token) {
  if (!window.Arc || !window.Arc.rpc) return [];
  const tipHex = await window.Arc.rpc('eth_blockNumber', []);
  if (tipHex == null) return [];
  const range = stableLogRange(Number(BigInt(tipHex)), STABLE_LOG_SPAN);
  if (!range) return [];

  const base = {
    fromBlock: '0x' + range.from.toString(16),
    toBlock: '0x' + range.to.toString(16),
    address: token.address,
  };
  // Two topic-filtered queries rather than one broad one: the server does the
  // filtering, so the payload stays small (a plain Transfer query over the same
  // window returns ~10,000 logs and would be pointless to ship to a browser).
  const [mints, burns] = await Promise.all([
    window.Arc.rpc('eth_getLogs', [Object.assign({}, base,
      { topics: [STABLE_TRANSFER_TOPIC, STABLE_ZERO_TOPIC] })]),
    window.Arc.rpc('eth_getLogs', [Object.assign({}, base,
      { topics: [STABLE_TRANSFER_TOPIC, null, STABLE_ZERO_TOPIC] })]),
  ]);

  const rows = parseMintBurnLogs([].concat(mints || [], burns || []), token.decimals);
  return rows.map((r) => Object.assign({ token: token.key, symbol: token.symbol, currency: token.currency }, r));
}

async function refresh() {
  let anyOk = false;

  const circleJson = await getJson(STABLE_CIRCLE_URL);
  const circle = parseCircleStablecoins(circleJson);
  if (circle) { S.circle = circle; anyOk = true; }

  const cgJson = await getJson(STABLE_CG_URL);
  const market = parseCoinGeckoMarkets(cgJson);
  if (market) { S.market = market; anyOk = true; }

  // Balances only mean something once a wallet is connected.
  const arc = window.Arc ? window.Arc.get() : null;
  if (arc && arc.account) {
    for (const token of STABLE_TOKENS) {
      const bal = await fetchBalance(token, arc.account);
      if (bal != null) { S.balances[token.key] = bal; anyOk = true; }
    }
  } else {
    S.balances = {};
  }

  const feeds = await Promise.all(STABLE_TOKENS.map(fetchIssuance));
  const merged = [].concat.apply([], feeds).sort((a, b) => (b.block || 0) - (a.block || 0));
  if (merged.length) { S.feed = merged.slice(0, STABLE_FEED_MAX); anyOk = true; }

  const gasHex = window.Arc && window.Arc.rpc ? await window.Arc.rpc('eth_gasPrice', []) : null;
  if (gasHex != null) {
    // A claim costs ~116,500 gas; quoting a real action beats quoting a bare
    // gas price, and Arc's own docs ask for fees in dollars rather than Gwei.
    S.gasUsdc = arcGasCostUsdc(116500n, arcMaxFeePerGas(BigInt(gasHex)));
    anyOk = true;
  }

  if (anyOk) { S.at = Date.now(); S.failing = false; }
  else { S.failing = true; }   // keep the last good numbers on screen, flagged
  announce();
}

window.Stables = {
  get: snapshot,
  onUpdate: (fn) => { listeners.push(fn); },
  refresh: refresh,
  tokens: STABLE_TOKENS,
};

refresh();
S.timer = setInterval(refresh, STABLE_REFRESH_MS);

// Connecting or switching accounts changes the balances, so re-read then too.
if (window.Arc && window.Arc.onUpdate) {
  let lastAccount = null;
  window.Arc.onUpdate((a) => {
    if (a.account !== lastAccount) { lastAccount = a.account; refresh(); }
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (S.at == null || Date.now() - S.at > STABLE_REFRESH_MS)) refresh();
});

}
