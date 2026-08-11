/*
 * Arc Land Registry — every number on the page is derived here.
 *
 * Everything above the "DOM layer" divider is a pure function: no globals, no DOM,
 * no network. That is what lets tests.html check the math in a browser without a
 * test runner (there is no Node on this machine, by design).
 *
 * Circulating supply is COMPUTED from Bitcoin's own issuance schedule rather
 * than fetched, so there is no API key, no CORS surface and no rate limit for
 * any figure on this page.
 *
 * The page is not offline-only any more: price.js reaches two public tickers and
 * arc.js reads the Arc registry. Neither sends the ledger, and neither is needed
 * for the board or the maths — see the privacy note in index.html.
 */

'use strict';

/* ---------------------------------------------------------------- constants */

const SATS_PER_BTC = 100000000;
const MAX_SUPPLY_SATS = 2100000000000000;      // 21,000,000 BTC, exact in sats
const MAX_SUPPLY_BTC = 21000000;

// One "parcel" is the unit the site is built around: the 0.01 BTC buy the owner
// makes. 21M BTC = 2.1 billion parcels, which is the number that does the work.
const PARCEL_BTC = 0.01;

// UN World Population Prospects, medium variant, mid-2026 ≈ 8.2 billion.
// Only used for the fair-share framing; precision beyond 2 s.f. is theatre.
const WORLD_POPULATION = 8200000000;

const BLOCKS_PER_HALVING = 210000;
const INITIAL_SUBSIDY_SATS = 50 * SATS_PER_BTC;
const TARGET_BLOCK_SECONDS = 600;

// Anchor verified against mempool.space on 2026-08-04 03:47:36 UTC (10:47 WIB).
// Extrapolating from here at 600 s/block drifts a few hundred BTC per year on a
// 20,000,000 BTC figure — invisible at the precision this page displays.
const ANCHOR_HEIGHT = 960958;
const ANCHOR_UNIX_MS = Date.UTC(2026, 7, 4, 3, 47, 36);

/* ------------------------------------------------------------ supply schedule */

/** Block subsidy in sats at a given height. Integer math, no floats. */
function subsidySats(height) {
  const era = Math.floor(height / BLOCKS_PER_HALVING);
  if (era >= 33) return 0;                     // subsidy shifts to nothing by era 33
  return Math.floor(INITIAL_SUBSIDY_SATS / Math.pow(2, era));
}

/** Estimated block height at a given instant, from the anchor. */
function blockHeightAt(nowMs) {
  const elapsed = (nowMs - ANCHOR_UNIX_MS) / 1000;
  return Math.max(0, ANCHOR_HEIGHT + Math.floor(elapsed / TARGET_BLOCK_SECONDS));
}

/**
 * Total sats ever issued up to and including `height`.
 * Height 0 is the genesis block, so a tip of H means H+1 blocks have been mined.
 */
function issuedSatsAt(height) {
  const blocks = height + 1;
  let total = 0;
  for (let era = 0; era < 33; era++) {
    const eraStart = era * BLOCKS_PER_HALVING;
    if (blocks <= eraStart) break;
    const inEra = Math.min(blocks - eraStart, BLOCKS_PER_HALVING);
    total += inEra * subsidySats(eraStart);
  }
  return Math.min(total, MAX_SUPPLY_SATS);
}

/** Circulating supply in BTC right now (or at a supplied instant). */
function circulatingSupplyBtc(nowMs) {
  return issuedSatsAt(blockHeightAt(nowMs == null ? Date.now() : nowMs)) / SATS_PER_BTC;
}

/* ------------------------------------------------------------- the framings */

/**
 * The headline number. 21M BTC split evenly across everyone alive is ~0.00256 BTC
 * each; this says how many of those shares you hold. A 0.01 BTC stack is ~3.9x.
 */
function fairShareBtc() {
  return MAX_SUPPLY_BTC / WORLD_POPULATION;
}

function fairShareMultiple(btc) {
  return btc / fairShareBtc();
}

/**
 * The punch. If everyone owned exactly what you own, this many people could hold
 * a stack before Bitcoin ran out — and it is capped at the world population,
 * because "3 billion people could own 0.007 BTC" is only interesting while the
 * number stays below the number of people who exist.
 */
function maxOwners(btc) {
  if (btc <= 0) return Infinity;
  return MAX_SUPPLY_BTC / btc;
}

/** Share of humanity that could match your stack, 0..1. */
function shareOfHumanity(btc) {
  return Math.min(1, maxOwners(btc) / WORLD_POPULATION);
}

function parcels(btc) {
  return btc / PARCEL_BTC;
}

function toSats(btc) {
  return Math.round(btc * SATS_PER_BTC);
}

function pctOfMaxSupply(btc) {
  return (btc / MAX_SUPPLY_BTC) * 100;
}

function pctOfCirculating(btc, nowMs) {
  return (btc / circulatingSupplyBtc(nowMs)) * 100;
}

/* ------------------------------------------------------------------- tiers */

// Ascending. `min` is inclusive: exactly 0.1 BTC is a Crab, exactly 1 is an Octopus.
const TIERS = [
  { min: 0,     name: 'Plankton', icon: '🦠', blurb: 'Not on the map yet. One buy changes that.' },
  { min: 0.01,  name: 'Shrimp',   icon: '🦐', blurb: 'You own land. Small, but it is yours.' },
  { min: 0.1,   name: 'Crab',     icon: '🦀', blurb: 'A tenth of a coin. Most people never get here.' },
  { min: 1,     name: 'Octopus',  icon: '🐙', blurb: 'Whole coiner. There will never be 21 million of you.' },
  { min: 5,     name: 'Fish',     icon: '🐟', blurb: 'Five coins. Rarefied air.' },
  { min: 10,    name: 'Dolphin',  icon: '🐬', blurb: 'Ten coins. Fewer than 200,000 addresses hold this.' },
  { min: 50,    name: 'Shark',    icon: '🦈', blurb: 'At most 420,000 people can ever match you.' },
  { min: 100,   name: 'Whale',    icon: '🐋', blurb: 'A rounding error of humanity holds this much.' },
  { min: 1000,  name: 'Humpback', icon: '🐳', blurb: 'At most 21,000 of these can ever exist.' },
];

function tierFor(btc) {
  let found = TIERS[0];
  for (const t of TIERS) if (btc >= t.min) found = t;
  return found;
}

function nextTierFor(btc) {
  for (const t of TIERS) if (btc < t.min) return t;
  return null;                                  // Humpback is the ceiling
}

/** Progress 0..1 from the current tier's floor to the next tier's floor. */
function tierProgress(btc) {
  const cur = tierFor(btc);
  const next = nextTierFor(btc);
  if (!next) return 1;
  const span = next.min - cur.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (btc - cur.min) / span));
}

const MILESTONES = [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1];

/* -------------------------------------------------------------- the zoom map */

// Nested 10x10 grids: each level is 100x finer than the one above it. Five levels
// is what it takes for a 0.01 BTC stack to become a visible area rather than a
// sub-pixel — which is the entire point of the animation.
const MAP_GRID = 10;
const MAP_LEVELS = 5;

/** BTC represented by one cell at a zoom level (0 = whole supply). */
function cellValueAtLevel(level) {
  return MAX_SUPPLY_BTC / Math.pow(MAP_GRID * MAP_GRID, level + 1);
}

/** How many of the 100 cells at a level your stack covers. Can be < 1 or > 100. */
function cellsCovered(btc, level) {
  return btc / cellValueAtLevel(level);
}

/**
 * The deepest level whose cells are still too small to swallow the whole stack —
 * i.e. where the stack finally reads as an area. Used to caption the last frame.
 */
function levelWhereVisible(btc) {
  for (let l = 0; l <= MAP_LEVELS - 1; l++) {
    if (cellsCovered(btc, l) >= 0.5) return l;
  }
  return MAP_LEVELS - 1;
}

/* ---------------------------------------------------------------- WIB dates */

// Global rule: every date in every project is Asia/Jakarta, UTC+7, no DST.
// Dates are stored and compared as plain 'YYYY-MM-DD' strings. Never call
// toISOString() on a locally-parsed date — at UTC+7 that silently subtracts a
// day and mis-dates the buy.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function wibDateString(nowMs) {
  const d = new Date((nowMs == null ? Date.now() : nowMs) + WIB_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' -> '4 Aug 2026'. Formats the string; never re-parses to a Date. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

/* ------------------------------------------------------------- formatting */

function formatBtc(btc) {
  if (btc === 0) return '0';
  if (btc >= 1) return btc.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return btc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function formatInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** 2,100,000,000 -> "2.1 billion". Big counts are felt in words, not commas. */
function formatBigCount(n) {
  if (!isFinite(n)) return '∞';
  // toFixed pads: 2.1 becomes "2.10". Strip that, or the headline reads wrong.
  const trim = (x, dp) => x.toFixed(dp).replace(/\.?0+$/, '');
  if (n >= 1e9) return `${trim(n / 1e9, n >= 1e10 ? 0 : 2)} billion`;
  if (n >= 1e6) return `${trim(n / 1e6, n >= 1e7 ? 0 : 2)} million`;
  return formatInt(n);
}

/** Percentages here span 0.00000005% to 100%, so fixed decimals will not do. */
function formatPct(p) {
  if (p === 0) return '0%';
  if (p >= 1) return `${p.toFixed(2)}%`;
  if (p >= 0.0001) return `${p.toFixed(6).replace(/0+$/, '')}%`;
  return `${p.toExponential(2)}%`;
}

function formatMultiple(x) {
  if (!isFinite(x)) return '∞';
  if (x >= 100) return formatInt(x);
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}

/* ============================================================================
 * DOM layer — nothing below here is tested by tests.html
 * ==========================================================================*/

if (typeof window !== 'undefined' && !window.__LANDBANK_TEST_ONLY__) {

const STORAGE_KEY = 'landbank.v1';
const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ storage */

// The sample ledger exists so a first-time visitor sees a working page instead of
// an empty box. It is flagged `sample: true` so it can never silently blend into
// real entries — the first real buy wipes it (see addBuy).
const SAMPLE_BUYS = [
  { id: 's1', date: '2026-05-12', btc: 0.01, note: 'first parcel' },
  { id: 's2', date: '2026-06-09', btc: 0.01, note: '' },
  { id: 's3', date: '2026-07-14', btc: 0.005, note: 'dip' },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { buys: SAMPLE_BUYS.slice(), sample: true };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.buys)) throw new Error('bad shape');
    return { buys: parsed.buys, sample: !!parsed.sample };
  } catch (e) {
    // A corrupt or foreign value must not brick the page.
    console.warn('landbank: unreadable saved data, starting fresh', e);
    return { buys: [], sample: false };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Private-browsing mode and full quotas both land here. The page still works
    // for this session; the user just loses persistence, so say so once.
    console.warn('landbank: could not save', e);
    $('#storage-warning').hidden = false;
  }
}

let state = loadState();

function totalBtc() {
  return state.buys.reduce((sum, b) => sum + (Number(b.btc) || 0), 0);
}

/* -------------------------------------------------------------- ledger ops */

function addBuy(date, btc, note) {
  if (state.sample) {                 // real data never mixes with the demo
    state.buys = [];
    state.sample = false;
  }
  state.buys.push({
    id: `b${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    date, btc, note: note || '',
  });
  state.buys.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  saveState();
  render();
}

function removeBuy(id) {
  state.buys = state.buys.filter((b) => b.id !== id);
  saveState();
  render();
}

function startFresh() {
  state = { buys: [], sample: false };
  saveState();
  render();
}

function backup() {
  const blob = new Blob([JSON.stringify({ buys: state.buys, sample: false }, null, 2)],
                        { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arcland-${wibDateString()}.json`;   // WIB, per the date rule
  a.click();
  URL.revokeObjectURL(a.href);
}

function restore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.buys)) throw new Error('not a landbank backup');
      // Trust nothing in the file: rebuild each row from validated fields only.
      const clean = parsed.buys
        .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number(b.btc) > 0)
        .map((b, i) => ({
          id: `r${Date.now()}${i}`,
          date: b.date,
          btc: Number(b.btc),
          note: typeof b.note === 'string' ? b.note.slice(0, 120) : '',
        }));
      if (!clean.length) throw new Error('no valid entries');
      state = { buys: clean, sample: false };
      saveState();
      render();
      flash(`Restored ${clean.length} ${clean.length === 1 ? 'entry' : 'entries'}.`);
    } catch (e) {
      flash(`Could not read that file: ${e.message}`, true);
    }
  };
  reader.readAsText(file);
}

let flashTimer = null;
function flash(msg, isError) {
  const el = $('#flash');
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

/* -------------------------------------------------------------- the map SVG */

const NS = 'http://www.w3.org/2000/svg';
let mapTimer = null;

/**
 * Draws one 10x10 level. `litCells` cells are highlighted, and the cell holding
 * the next zoom target is outlined so the eye has somewhere to travel to.
 */
function drawLevel(level, btc) {
  const svg = $('#map-svg');
  svg.innerHTML = '';
  const covered = cellsCovered(btc, level);
  const litWhole = Math.floor(covered);
  const partial = covered - litWhole;
  const size = 100 / MAP_GRID;

  for (let i = 0; i < MAP_GRID * MAP_GRID; i++) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', (i % MAP_GRID) * size + 0.4);
    r.setAttribute('y', Math.floor(i / MAP_GRID) * size + 0.4);
    r.setAttribute('width', size - 0.8);
    r.setAttribute('height', size - 0.8);
    r.setAttribute('rx', 0.6);
    if (i < litWhole) r.setAttribute('class', 'cell cell--mine');
    else if (i === litWhole && partial > 0.02) r.setAttribute('class', 'cell cell--partial');
    else if (i === 0 && covered < 0.02) r.setAttribute('class', 'cell cell--target');
    else r.setAttribute('class', 'cell');
    svg.appendChild(r);
  }

  const cell = cellValueAtLevel(level);
  $('#map-caption').innerHTML = covered >= 0.5
    ? `Zoom ${level + 1} of ${MAP_LEVELS} · one square = <strong>${formatBtc(cell)} BTC</strong> ·
       your land covers <strong>${covered < 1 ? formatMultiple(covered) : formatInt(covered)}</strong>
       of these ${covered >= 1 ? 'squares' : 'of one square'}`
    : `Zoom ${level + 1} of ${MAP_LEVELS} · one square = <strong>${formatBtc(cell)} BTC</strong> ·
       your land is still <strong>too small to draw</strong> — keep going`;
}

function runZoom(btc) {
  if (btc <= 0) { flash('Record a buy first — there is no land to find yet.'); return; }
  clearInterval(mapTimer);
  const stop = levelWhereVisible(btc);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = $('#map-stage');
  let level = 0;

  const step = () => {
    drawLevel(level, btc);
    if (!reduced) {
      stage.classList.remove('is-zooming');
      void stage.offsetWidth;              // restart the CSS animation
      stage.classList.add('is-zooming');
    }
    if (level >= stop) {
      clearInterval(mapTimer);
      $('#map-run').textContent = 'Zoom again';
      $('#map-found').hidden = false;
      return;
    }
    level++;
  };

  $('#map-found').hidden = true;
  $('#map-run').textContent = 'Zooming…';
  step();
  mapTimer = setInterval(step, reduced ? 400 : 1400);
}

/* ------------------------------------------------------------------ render */

function render() {
  const btc = totalBtc();
  const tier = tierFor(btc);
  const next = nextTierFor(btc);

  $('#sample-banner').hidden = !state.sample;
  $('#stat-btc').textContent = formatBtc(btc);
  $('#stat-sats').textContent = `${formatInt(toSats(btc))} sats`;

  $('#stat-fairshare').textContent = btc > 0 ? `${formatMultiple(fairShareMultiple(btc))}×` : '—';
  $('#stat-fairshare-sub').textContent = btc > 0
    ? `Split 21M evenly and everyone gets ${formatBtc(fairShareBtc())} BTC. You hold ${formatMultiple(fairShareMultiple(btc))} of those shares.`
    : 'Everyone alive would get 0.00256 BTC if we split it evenly.';

  const owners = maxOwners(btc);
  $('#stat-owners').textContent = btc > 0 ? formatBigCount(owners) : '—';
  $('#stat-owners-sub').textContent = btc > 0
    ? `That is the ceiling. Only ${formatPct(shareOfHumanity(btc) * 100)} of humanity can ever hold what you hold — the other ${formatPct((1 - shareOfHumanity(btc)) * 100)} cannot, at any price.`
    : 'Bitcoin runs out. That is the whole idea.';

  $('#stat-parcels').textContent = btc > 0 ? formatMultiple(parcels(btc)) : '—';
  $('#stat-parcels-sub').textContent =
    `One parcel = 0.01 BTC. There are only ${formatBigCount(MAX_SUPPLY_BTC / PARCEL_BTC)} parcels, ever.`;

  $('#stat-supply').textContent = btc > 0 ? formatPct(pctOfMaxSupply(btc)) : '—';
  $('#stat-supply-sub').textContent = btc > 0
    ? `Of all 21,000,000. Against the ${formatInt(circulatingSupplyBtc())} BTC actually mined so far it is ${formatPct(pctOfCirculating(btc))}.`
    : `${formatInt(circulatingSupplyBtc())} BTC has been mined so far.`;

  $('#tier-icon').textContent = tier.icon;
  $('#tier-name').textContent = tier.name;
  $('#tier-blurb').textContent = tier.blurb;
  $('#tier-bar').style.width = `${(tierProgress(btc) * 100).toFixed(1)}%`;
  $('#tier-next').textContent = next
    ? `${formatBtc(next.min - btc)} BTC to ${next.name} ${next.icon}`
    : 'Top tier. There is nothing above this.';

  const badges = MILESTONES.map((m) => {
    const hit = btc >= m;
    return `<li class="badge ${hit ? 'is-hit' : ''}">
              <span class="badge__dot"></span>${formatBtc(m)} BTC
            </li>`;
  }).join('');
  $('#badges').innerHTML = badges;

  const rows = state.buys.slice().reverse().map((b) => `
    <tr>
      <td>${formatDate(b.date)}</td>
      <td class="num">${formatBtc(b.btc)}</td>
      <td class="num muted">${formatInt(toSats(b.btc))}</td>
      <td class="note">${escapeHtml(b.note)}</td>
      <td><button class="link-btn" data-remove="${b.id}" aria-label="Delete entry">remove</button></td>
    </tr>`).join('');
  $('#ledger-body').innerHTML = rows ||
    `<tr><td colspan="5" class="empty">No land yet. Record your first buy above.</td></tr>`;
  $('#ledger-count').textContent = state.buys.length
    ? `${state.buys.length} ${state.buys.length === 1 ? 'entry' : 'entries'}`
    : '';

  // The board is the primary view. The globe and the flat map are both kept in
  // sync regardless, so whichever one is revealed is never stale.
  if (window.Iso) {
    window.Iso.setHoldings(btc);
    window.Iso.setLedger(state.buys);      // feeds the persona's track record
  }
  if (window.Globe) window.Globe.setHoldings(btc);
  drawLevel(Math.min(levelWhereVisible(btc), MAP_LEVELS - 1), btc);
  $('#map-run').textContent = 'Locate my land';
  $('#map-found').hidden = true;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------------- theme */

/*
 * The theme is chosen and applied in the <head> boot script, before first paint.
 * Everything here is what happens AFTER that: keeping the two canvases in step
 * with the page, since they paint their own pixels and CSS variables cannot
 * reach them.
 */
const THEME_KEY = document.documentElement.dataset.themeKey || 'arcland-theme';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Push the active theme into the two renderers that paint their own pixels. */
function syncThemeToCanvases() {
  const t = currentTheme();
  if (window.Iso && window.Iso.setTheme) window.Iso.setTheme(t);
  if (window.Globe && window.Globe.setTheme) window.Globe.setTheme(t);
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀ LIGHT' : '☾ DARK';
}

function applyTheme(theme, persist) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}   // private mode throws
  }
  syncThemeToCanvases();
}

function initTheme() {
  syncThemeToCanvases();

  const btn = $('#theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });
  }

  window.addEventListener('storage', (e) => {
    // Fired by the host terminal's toggle (or by this site open in another tab).
    if (e.key !== THEME_KEY || !e.newValue) return;
    applyTheme(e.newValue, false);           // the writer already persisted it
  });
}

/* -------------------------------------------------------------------- wiring */

function init() {
  $('#buy-date').value = wibDateString();
  $('#buy-date').max = wibDateString();

  $('#buy-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = $('#buy-date').value;
    const unit = $('#buy-unit').value;
    const raw = Number($('#buy-amount').value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return flash('Pick a date.', true);
    if (!(raw > 0)) return flash('Enter an amount greater than zero.', true);
    const btc = unit === 'sats' ? raw / SATS_PER_BTC : raw;
    if (btc > MAX_SUPPLY_BTC) return flash('That is more Bitcoin than exists.', true);
    addBuy(date, btc, $('#buy-note').value.trim());
    $('#buy-amount').value = '';
    $('#buy-note').value = '';
    flash(`Recorded ${formatBtc(btc)} BTC.`);
  });

  // Quick-add buttons: the 0.01 buy is the habit this site is built around.
  document.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#buy-unit').value = 'btc';
      $('#buy-amount').value = btn.dataset.quick;
      $('#buy-amount').focus();
    });
  });

  $('#ledger-body').addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.remove;
    if (id) removeBuy(id);
  });

  $('#map-run').addEventListener('click', () => runZoom(totalBtc()));

  // Board / globe toggle. The globe needs WebGL2 and may have failed to build,
  // in which case globe.js has already revealed the flat map instead.
  const showView = (which) => {
    const board = which === 'board';
    $('#board-view').hidden = !board;
    $('#iso-focus').closest('.board__bar').hidden = !board;
    const globeOk = !window.Globe || window.Globe.isSupported();
    $('#globe-stage').hidden = board || !globeOk;
    $('#globe-controls').hidden = board || !globeOk;
    $('#globe-found').hidden = true;
    $('#map-fallback').hidden = board || globeOk;
    const err = $('#globe-error');
    err.hidden = board || globeOk;
    if (!board && !globeOk && window.Globe) err.textContent = window.Globe.failMessage();
    if (board) { if (window.Iso) window.Iso.onShow(); }
    else if (window.Globe) window.Globe.onShow();
    $('#view-board').classList.toggle('is-on', board);
    $('#view-globe').classList.toggle('is-on', !board);
    $('#view-board').setAttribute('aria-selected', String(board));
    $('#view-globe').setAttribute('aria-selected', String(!board));
  };
  $('#view-board').addEventListener('click', () => showView('board'));
  $('#view-globe').addEventListener('click', () => showView('globe'));

  $('#globe-fly').addEventListener('click', () => {
    if (window.Globe && window.Globe.flyToLand() === false) {
      flash('Record a buy first — there is no land to fly to yet.');
    }
  });
  $('#globe-reset').addEventListener('click', () => {
    if (window.Globe) window.Globe.resetView();
  });
  $('#backup').addEventListener('click', backup);
  $('#restore').addEventListener('change', (e) => {
    if (e.target.files[0]) restore(e.target.files[0]);
    e.target.value = '';                       // allow re-picking the same file
  });
  $('#start-fresh').addEventListener('click', () => {
    if (state.buys.length && !state.sample &&
        !confirm('Delete every entry? Back up first if you want to keep them.')) return;
    startFresh();
    flash('Cleared. The land is yours to claim.');
  });

  initTheme();
  initWallet();
  initSections();
  initStables();
  render();
}

/* ------------------------------------------------------- top-level sections */

const SECTIONS = [
  { id: 'land', btn: '#sec-land', view: '#view-land' },
  { id: 'stables', btn: '#sec-stables', view: '#view-stables' },
];

/**
 * Show one top-level section.
 *
 * The canvases size themselves to their container, so a board that was hidden
 * when it first drew comes back at zero size — `onShow` re-measures. Same
 * problem the Board/Globe switch already solves.
 */
function showSection(id, push) {
  const found = SECTIONS.some((s) => s.id === id) ? id : 'land';
  SECTIONS.forEach((s) => {
    const on = s.id === found;
    const view = $(s.view);
    const btn = $(s.btn);
    if (view) view.hidden = !on;
    if (btn) { btn.classList.toggle('is-on', on); btn.setAttribute('aria-pressed', String(on)); }
  });
  if (found === 'land' && window.Iso && window.Iso.onShow) window.Iso.onShow();
  if (push && location.hash !== '#/' + found) history.replaceState(null, '', '#/' + found);
}

function sectionFromHash() {
  const m = /^#\/(\w+)/.exec(location.hash || '');
  return m ? m[1] : 'land';
}

function initSections() {
  SECTIONS.forEach((s) => {
    const btn = $(s.btn);
    if (btn) btn.addEventListener('click', () => showSection(s.id, true));
  });
  // Hash routing so the stablecoin view can be linked to directly.
  window.addEventListener('hashchange', () => showSection(sectionFromHash(), false));
  showSection(sectionFromHash(), false);
}

/* ------------------------------------------------------- stablecoin tracker */

/** A short provenance + staleness line, so no figure is unattributed. */
function stablesSourceLine(s) {
  if (!s.at) return 'Loading from Circle…';
  const age = agoLabel(s.at);
  return `via Circle · updated ${age}${s.failing ? ' · retrying' : ''}`;
}

function renderStables() {
  if (!window.Stables) return;
  const s = window.Stables.get();
  const c = s.circle;
  const m = s.market;

  $('#stables-src').textContent = stablesSourceLine(s);

  // --- On Arc -------------------------------------------------------------
  const usdc = c && c.usdc;
  const eurc = c && c.eurc;

  $('#st-usdc-arc').textContent = usdc ? stableFormatExact(usdc.arc, '$') : '—';
  $('#st-eurc-arc').textContent = eurc ? stableFormatExact(eurc.arc, '€') : '—';

  const usdcRank = usdc && stableChainRank(usdc.chains, 'ARC');
  const eurcRank = eurc && stableChainRank(eurc.chains, 'ARC');
  $('#st-usdc-arc-sub').textContent = usdc
    ? `${stableFormatPct(stableShareOfTotal(usdc.arc, usdc.total))} of all USDC` +
      (usdcRank ? ` · #${usdcRank.rank} of ${usdcRank.of} chains` : '')
    : '';
  $('#st-eurc-arc-sub').textContent = eurc
    ? `${stableFormatPct(stableShareOfTotal(eurc.arc, eurc.total))} of all EURC` +
      (eurcRank ? ` · #${eurcRank.rank} of ${eurcRank.of} chains` : '')
    : '';

  $('#st-gas').textContent = s.gasUsdc == null ? '—' : formatUsd(s.gasUsdc);

  // Peg. USDC is pegged to a dollar; EURC is pegged to a euro, so its target is
  // the live EUR rate rather than 1 — quoting it against $1 would show a
  // permanent 15% "depeg" that is really just the exchange rate.
  if (m && m.usdc) {
    const d = stablePegDelta(m.usdc.price, 1);
    $('#st-peg').textContent = `USDC ${stableFormatPeg(d)}`;
    $('#st-peg-sub').textContent = m.eurc
      ? `$${m.usdc.price.toFixed(4)} · EURC $${m.eurc.price.toFixed(4)} (1 EUR)`
      : `$${m.usdc.price.toFixed(4)} from its $1.00 peg`;
  } else {
    $('#st-peg').textContent = '—';
    $('#st-peg-sub').textContent = '';
  }

  // --- Your balance -------------------------------------------------------
  const arc = window.Arc ? window.Arc.get() : null;
  const connected = !!(arc && arc.account);
  $('#st-wallet-empty').hidden = connected;
  $('#st-wallet-have').hidden = !connected;
  if (connected) {
    const bu = s.balances.usdc;
    const be = s.balances.eurc;
    $('#st-bal-usdc').textContent = bu == null ? '—' : stableFormatExact(bu, '$');
    $('#st-bal-eurc').textContent = be == null ? '—' : stableFormatExact(be, '€');
    $('#st-bal-usdc-sub').textContent =
      bu != null && usdc ? `${stableFormatPct(stableShareOfTotal(bu, usdc.total))} of all USDC` : '';
    $('#st-bal-eurc-sub').textContent =
      be != null && m && m.eurc ? `≈ ${formatUsd(be * m.eurc.price)}` : '';
    $('#st-bal-foot').textContent =
      `Read from Arc for ${arcShortAddress(arc.account)}. Not stored, not uploaded.`;
  }

  // --- Live issuance ------------------------------------------------------
  const feed = $('#st-feed');
  if (!s.feed.length) {
    feed.innerHTML = `<tr><td colspan="4" class="tip__empty">${
      s.at ? 'No mints or burns in the last few thousand blocks.' : 'Loading recent activity…'}</td></tr>`;
  } else {
    // Every field here comes off the chain, so all of it is escaped even though
    // the values are numeric or hex by construction.
    feed.innerHTML = s.feed.map((r) => {
      const url = r.tx ? `${window.Arc.explorer}/tx/${encodeURIComponent(r.tx)}` : null;
      const who = escapeHtml(arcShortAddress(r.address));
      return `<tr>
        <td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${r.block}</a>` : r.block}</td>
        <td><span class="flow flow--${r.kind === 'mint' ? 'mint' : 'burn'}">${
          r.kind === 'mint' ? '+ MINT' : '− BURN'}</span></td>
        <td class="num">${escapeHtml(stableFormatExact(r.amount, r.currency))} ${escapeHtml(r.symbol)}</td>
        <td class="tip__addr">${who}</td>
      </tr>`;
    }).join('');
  }

  // --- Where Arc sits -----------------------------------------------------
  $('#st-usdc-total').textContent = usdc ? stableFormatBig(usdc.total, '$') : '—';
  $('#st-eurc-total').textContent = eurc ? stableFormatBig(eurc.total, '€') : '—';
  $('#st-usdc-total-sub').textContent = usdc ? `across ${usdc.chainCount} chains` : '';
  $('#st-eurc-total-sub').textContent = eurc ? `across ${eurc.chainCount} chains` : '';

  const chains = $('#st-chains');
  if (!usdc || !usdc.chains.length) {
    chains.innerHTML = `<tr><td colspan="4" class="tip__empty">${
      s.at ? 'No chain data.' : 'Loading…'}</td></tr>`;
  } else {
    // Top chains plus Arc wherever it actually falls, so Arc is always visible
    // without pretending it ranks higher than it does.
    const top = usdc.chains.slice(0, 8);
    const arcRow = usdc.chains.find((x) => x.chain === 'ARC');
    const rows = top.some((x) => x.chain === 'ARC') || !arcRow ? top : top.concat([arcRow]);
    chains.innerHTML = rows.map((x) => {
      const pos = usdc.chains.indexOf(x) + 1;
      const isArc = x.chain === 'ARC';
      // Chain names come from Circle's API — untrusted input into the DOM.
      return `<tr class="${isArc ? 'chain-arc' : ''}">
        <td>${pos}</td>
        <td>${escapeHtml(x.chain)}</td>
        <td class="num">${escapeHtml(stableFormatBig(x.amount, '$'))}</td>
        <td class="num">${escapeHtml(stableFormatPct(stableShareOfTotal(x.amount, usdc.total)))}</td>
      </tr>`;
    }).join('');
  }
}

function initStables() {
  if (!window.Stables) return;
  window.Stables.onUpdate(renderStables);
  // The balance panel depends on wallet state as well as feed state.
  if (window.Arc) window.Arc.onUpdate(renderStables);
  renderStables();
}

/* --------------------------------------------------------------- wallet UI */

function openModal(sel) { const m = $(sel); if (m) m.hidden = false; }
function closeModal(sel) { const m = $(sel); if (m) m.hidden = true; }

/** Paint the topbar button and, if open, the account panel. */
function renderWallet() {
  if (!window.Arc) return;
  const s = window.Arc.get();
  const btn = $('#wallet-btn');
  if (btn) {
    btn.dataset.state = arcConnectState(s);
    $('#wallet-label').textContent = arcConnectLabel(s);
    $('#wallet-balance').textContent = s.account && s.chainOk ? s.balanceLabel : '';
    btn.title = s.account
      ? `${s.account}${s.chainOk ? '' : ' — wrong network'}`
      : 'Connect a wallet to claim land on Arc';
  }

  const modal = $('#account-modal');
  if (modal && !modal.hidden && s.account) {
    $('#acct-address').textContent = arcShortAddress(s.account);
    $('#acct-network').textContent = s.chainOk ? 'Arc Testnet' : 'Wrong network';
    $('#acct-balance').textContent = s.chainOk ? s.balanceLabel : '—';
    const mine = Object.keys(s.tiles).filter((t) => arcSameAddress(s.tiles[t].owner, s.account));
    $('#acct-deeds').textContent = mine.length ? `${mine.length} (tile ${mine.join(', ')})` : 'none yet';
    $('#acct-wrongnet').hidden = s.chainOk;
    $('#acct-explorer').href = arcAddressUrl(s.account);
  }
}

/** Build the picker from whatever EIP-6963 announced. */
function renderWalletList() {
  const list = $('#wallet-list');
  const none = $('#wallet-none');
  if (!list || !window.Arc) return;
  const wallets = window.Arc.get().wallets;

  list.innerHTML = '';
  // A legacy injected provider that never announced itself still deserves a row,
  // or wallets predating EIP-6963 would look uninstalled.
  const legacyOnly = !wallets.length && typeof window.ethereum !== 'undefined';
  none.hidden = wallets.length > 0 || legacyOnly;

  const rows = wallets.length ? wallets
    : legacyOnly ? [{ name: 'Injected wallet', rdns: '', icon: null }] : [];

  rows.forEach((w) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wallet-row';
    // Wallet name/icon come from an untrusted page event, so both are escaped.
    // arcIsValidWalletRecord already refused any icon that is not a data: URI.
    b.innerHTML =
      (w.icon ? `<img src="${escapeHtml(w.icon)}" alt="">` : '<span class="wallet-dot"></span>') +
      `<span>${escapeHtml(w.name)}</span>` +
      (w.rdns ? `<span class="rdns">${escapeHtml(w.rdns)}</span>` : '');
    b.addEventListener('click', () => pickWallet(w.rdns));
    list.appendChild(b);
  });
}

async function pickWallet(rdns) {
  closeModal('#wallet-modal');
  const res = await window.Arc.connect(rdns || undefined);
  if (res.ok) {
    flash('Wallet connected.');
  } else if (res.reason === 'rejected') {
    flash('Connection cancelled.');
  } else if (res.reason === 'no-wallet') {
    flash('No wallet found in this browser.');
  } else {
    flash('Could not connect to that wallet.');
  }
  renderWallet();
}

function initWallet() {
  const btn = $('#wallet-btn');
  if (!btn || !window.Arc) return;

  btn.addEventListener('click', async () => {
    const s = window.Arc.get();
    if (s.account) { renderWallet(); openModal('#account-modal'); return; }
    // One announced wallet is not a choice worth making the user click through.
    if (s.wallets.length === 1) { await pickWallet(s.wallets[0].rdns); return; }
    renderWalletList();
    openModal('#wallet-modal');
  });

  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      closeModal('#wallet-modal'); closeModal('#account-modal');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal('#wallet-modal'); closeModal('#account-modal'); }
  });

  $('#acct-disconnect').addEventListener('click', () => {
    window.Arc.disconnect();
    closeModal('#account-modal');
    flash('Wallet forgotten on this page.');
    renderWallet();
  });
  $('#acct-switch').addEventListener('click', async () => {
    await window.Arc.ensureChain();
    renderWallet();
  });

  window.Arc.onUpdate(() => { renderWallet(); renderWalletList(); });
  renderWallet();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

}
