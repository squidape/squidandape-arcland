/*
 * Arc Land Registry — the price feed.
 *
 * This is the ONLY part of the site that touches the network, and it is worth
 * being explicit about the trade: before it existed the page made zero requests
 * and worked offline. It now reaches two public tickers. It sends nothing —
 * these are plain GETs with no body, no key and no identifier, and the ledger
 * never leaves localStorage. What a request does reveal is that somebody loaded
 * the page, which is true of any hosted site.
 *
 * Sources, in order, both verified reachable from Jakarta on 2026-08-04 and both
 * returning access-control-allow-origin when an Origin header is present:
 *
 *   1. okx.ac      — okx.com is blocked from Indonesia, okx.ac is not. Quotes
 *                    BTC-USDT, which is treated as USD (the peg holds to well
 *                    under 0.1%, far below the precision this page displays).
 *   2. CoinGecko   — true USD, but the free tier rate-limits per IP, so it is
 *                    the fallback rather than the primary.
 *
 * Coinbase, Kraken and Binance were all tested and are unreachable from here.
 *
 * Everything above the divider is pure and covered by tests.html.
 */

'use strict';

const PRICE_REFRESH_MS = 60000;
const PRICE_TIMEOUT_MS = 8000;

const PRICE_SOURCES = [
  {
    name: 'OKX',
    url: 'https://www.okx.ac/api/v5/market/ticker?instId=BTC-USDT',
    parse: parsePriceOkx,
  },
  {
    name: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parse: parsePriceCoinGecko,
  },
];

/**
 * Pull the last price out of an OKX ticker payload.
 * Returns null rather than throwing — a malformed response is an ordinary
 * outcome for a third-party feed, and the caller just moves to the next source.
 */
function parsePriceOkx(json) {
  if (!json || json.code !== '0' || !Array.isArray(json.data) || !json.data.length) return null;
  const n = Number(json.data[0].last);
  return isFinite(n) && n > 0 ? n : null;
}

/** Pull USD out of a CoinGecko simple/price payload. */
function parsePriceCoinGecko(json) {
  if (!json || !json.bitcoin) return null;
  const n = Number(json.bitcoin.usd);
  return isFinite(n) && n > 0 ? n : null;
}

/** Market value of a holding. Null price gives null, never NaN or 0. */
function marketValueUsd(btc, price) {
  if (price == null || !isFinite(price)) return null;
  return btc * price;
}

/** $63,876 — whole dollars above $1,000, cents below, so small stacks still read. */
function formatUsd(v) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  const dp = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** 'HH:MM:SS' in WIB. Same fixed +7 offset rule as every other date on the site. */
function wibClock(nowMs) {
  const d = new Date((nowMs == null ? Date.now() : nowMs) + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** "just now" / "42s ago" / "3m ago" — how stale the quote on screen is. */
function agoLabel(thenMs, nowMs) {
  if (thenMs == null) return 'never';
  const s = Math.max(0, Math.round(((nowMs == null ? Date.now() : nowMs) - thenMs) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ============================================================================
 * Network layer — not covered by tests.html
 * ==========================================================================*/

if (typeof window !== 'undefined' && !window.__LANDBANK_TEST_ONLY__) {

const P = { usd: null, at: null, source: null, failing: false, timer: 0 };
const listeners = [];

async function fetchOnce(src) {
  // AbortController rather than a bare fetch: a hung socket would otherwise
  // leave the quote stuck on "loading" forever with no retry.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), PRICE_TIMEOUT_MS);
  try {
    const res = await fetch(src.url, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return src.parse(await res.json());
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function refresh() {
  for (const src of PRICE_SOURCES) {
    const usd = await fetchOnce(src);
    if (usd != null) {
      P.usd = usd;
      P.at = Date.now();
      P.source = src.name;
      P.failing = false;
      listeners.forEach((fn) => fn(P));
      return;
    }
  }
  // Every source failed. Keep the last good price on screen — a stale number
  // with an honest "3m ago" beats blanking the panel — but flag it.
  P.failing = true;
  listeners.forEach((fn) => fn(P));
}

window.Price = {
  get: () => ({ usd: P.usd, at: P.at, source: P.source, failing: P.failing }),
  onUpdate: (fn) => { listeners.push(fn); },
  refresh,
};

refresh();
P.timer = setInterval(refresh, PRICE_REFRESH_MS);

// A tab that has been in the background for a while shows a stale quote the
// instant it is looked at again; refresh on return rather than waiting out the
// remainder of the interval.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (P.at == null || Date.now() - P.at > PRICE_REFRESH_MS)) refresh();
});

}
