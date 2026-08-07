/*
 * Arc Land Registry — the isometric board.
 *
 * A tactics-RPG map of the supply. Every tile is one 1 BTC block; a block's top
 * face divides into 10 x 10 = 100 parcels of 0.01 BTC. Tiles you own are lit in
 * Bitcoin orange and stand proud of the board; everything else is locked, grey
 * and flat. Own 0.01 BTC and exactly one parcel on one tile lights up.
 *
 * The board is a window onto 21,000,000 blocks, not all of them — drawing 21
 * million tiles is neither possible nor meaningful. The HUD always states how
 * many are in view against the full 21,000,000 so the framing is never implied
 * to be the whole thing.
 *
 * Canvas 2D rather than WebGL: this is flat shaded geometry with crisp edges and
 * no perspective, which 2D draws exactly and every browser supports. The globe
 * is still available behind the view toggle and still needs WebGL2.
 *
 * Everything above the divider is pure and covered by tests.html.
 * Depends on app.js (toSats, PARCEL_BTC, tierFor) and price.js.
 */

'use strict';

const ISO_PARCELS_PER_BLOCK = 100;      // 10 x 10 on the top face
const ISO_SUB = 10;

// Tile width in px per zoom step, widest first. The widest steps exist so a
// sub-1-BTC holding can still be seen: at 220px a parcel is 22px across, at
// 40px it is 4px and effectively a dot.
const ISO_ZOOM_STEPS = [240, 160, 108, 72, 48, 34];
const ISO_MAX_RADIUS = 12;              // caps the board at 25x25 = 625 tiles

/* ------------------------------------------------------------ the holdings */

/** Parcels owned, exact via sats. 1 BTC = 100 parcels. */
function isoTotalParcels(btc) {
  return toSats(btc) / (PARCEL_BTC * SATS_PER_BTC);
}

/** Tiles lit end to end. */
function isoFullBlocks(btc) {
  return Math.floor(isoTotalParcels(btc) / ISO_PARCELS_PER_BLOCK);
}

/** Parcels lit on the one partially-owned tile, 0..100 (may be fractional). */
function isoRemainderParcels(btc) {
  const p = isoTotalParcels(btc);
  return p - Math.floor(p / ISO_PARCELS_PER_BLOCK) * ISO_PARCELS_PER_BLOCK;
}

/**
 * Spiral index of a tile, measured in ring-then-perimeter order from the centre.
 * Land is claimed outward from home, so a growing stack reads as a spreading
 * territory rather than a line.
 *
 * Ring r starts at index (2r-1)^2 and holds 8r tiles, walked as:
 * right edge up, top edge left, left edge down, bottom edge right.
 */
function isoSpiralIndex(x, y) {
  const r = Math.max(Math.abs(x), Math.abs(y));
  if (r === 0) return 0;
  const start = (2 * r - 1) * (2 * r - 1);
  if (x === r && y > -r) return start + (y + r - 1);
  if (y === r && x < r) return start + 2 * r + (r - 1 - x);
  if (x === -r && y < r) return start + 4 * r + (r - 1 - y);
  return start + 6 * r + (x + r - 1);            // y === -r
}

/** Isometric projection. z raises a tile off the board. */
function isoProject(x, y, z, tileW) {
  const tileH = tileW / 2;
  return {
    sx: (x - y) * (tileW / 2),
    sy: (x + y) * (tileH / 2) - z * (tileW * 0.18),
  };
}

/** How far out to draw so the board fills the canvas without wasted tiles. */
function isoBoardRadius(canvasW, canvasH, tileW) {
  const byW = Math.ceil(canvasW / tileW);
  const byH = Math.ceil(canvasH / (tileW / 2));
  return Math.max(1, Math.min(ISO_MAX_RADIUS, Math.max(byW, byH)));
}

function isoTilesInView(radius) {
  return (2 * radius + 1) * (2 * radius + 1);
}

/**
 * Default zoom for a holding: close enough that the claim is legible. Under one
 * block the parcels themselves must be visible, so the widest steps are used;
 * larger claims want a wider board to show their spread.
 */
function isoDefaultZoom(btc) {
  const blocks = isoFullBlocks(btc);
  if (blocks < 1) return 0;
  if (blocks < 9) return 1;
  if (blocks < 49) return 2;
  if (blocks < 169) return 3;
  if (blocks < 625) return 4;
  return 5;
}

/** Level = milestones cleared, so the persona plate has something to count. */
function isoLevel(btc) {
  return MILESTONES.reduce((n, m) => n + (btc >= m ? 1 : 0), 0) + 1;
}

/**
 * Inverse isometric projection: which tile is under a point, given the point is
 * measured from the board origin. `lift` says whether to solve against the
 * raised plane (owned tiles stand proud) or the flat one.
 *
 * Derived from isoProject: sx = (x-y)*tw/2 and sy = (x+y)*tw/4 - z*tw*0.18,
 * with the tile's centre half a tile-height below its top vertex.
 */
function isoTileFromPoint(px, py, tw, lift) {
  const z = lift ? 1 : 0;
  const a = 2 * px / tw;
  const b = 4 * (py - tw / 4 + z * tw * 0.18) / tw;
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

/** What a tile is, for the tooltip. */
function isoTileState(x, y, btc) {
  const idx = isoSpiralIndex(x, y);
  const full = isoFullBlocks(btc);
  const rem = isoRemainderParcels(btc);
  if (idx < full) return 'full';
  if (idx === full && rem > 0) return 'partial';
  return 'locked';
}

/** Ledger summary behind the persona card. Tolerates junk rows. */
function isoTrackRecord(buys) {
  const list = (buys || []).filter((b) => b && Number(b.btc) > 0);
  if (!list.length) return { count: 0, total: 0, first: null, last: null, biggest: 0, avg: 0 };
  const dates = list.map((b) => b.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const total = list.reduce((s, b) => s + Number(b.btc), 0);
  return {
    count: list.length,
    total,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null,
    biggest: list.reduce((m, b) => Math.max(m, Number(b.btc)), 0),
    avg: total / list.length,
  };
}

/* -------------------------------------------------------- world scale */

/** Tile size that fits the whole 50 x 42 world grid in the canvas. */
function isoWorldTileW(canvasW, canvasH) {
  const span = WORLD_COLS + WORLD_ROWS;                 // 92 half-widths across
  return Math.max(6, Math.min(canvasW / (span * 0.54), canvasH / (span * 0.30)));
}

/** World grid is centred on itself rather than on tile 0. */
function isoWorldOffset(col, row) {
  return { x: col - (WORLD_COLS - 1) / 2, y: row - (WORLD_ROWS - 1) / 2 };
}

/** Inverse of the above, for hit-testing. */
function isoWorldTileFromOffset(x, y) {
  return {
    col: Math.round(x + (WORLD_COLS - 1) / 2),
    row: Math.round(y + (WORLD_ROWS - 1) / 2),
  };
}

function isoWorldIndex(col, row) {
  if (col < 0 || col >= WORLD_COLS || row < 0 || row >= WORLD_ROWS) return -1;
  return row * WORLD_COLS + col;
}

/**
 * Colour for a whale tile. Hue comes from what the address IS — exchange
 * custody, fund, or seized — because that distinction matters far more than
 * rank: none of the big ones are one person's savings. Lightness steps by rank
 * so neighbouring whales stay distinguishable.
 */
function whaleColor(w) {
  const base = { custody: 205, fund: 268, seized: 355, unknown: 172 }[whaleKind(w)];
  const l = 34 + ((w.rank * 7) % 5) * 5;
  return `hsl(${base} 42% ${l}%)`;
}

/* ------------------------------------------------------------ walking */

/** Ease for the walk. Kept local so iso.js never depends on globe.js loading. */
function isoEase(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * How long a walk takes, in ms — proportional to distance so crossing the board
 * is not instantaneous and stepping one tile is not a slog. Clamped at both ends.
 */
function isoWalkDuration(fromX, fromY, toX, toY) {
  const d = Math.hypot(toX - fromX, toY - fromY);
  return Math.max(280, Math.min(1600, 260 * d));
}

/** Position along a walk at progress t (0..1), eased. */
function isoWalkPos(from, to, t) {
  const e = isoEase(Math.min(1, Math.max(0, t)));
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

/**
 * Vertical hop, in tile-widths. Two arcs per tile travelled gives a step rather
 * than one long float across the board.
 */
function isoWalkHop(from, to, t) {
  if (t <= 0 || t >= 1) return 0;
  const steps = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y)));
  return Math.abs(Math.sin(t * Math.PI * steps)) * 0.045;
}

/** A press is a tap (walk) rather than a drag (pan) only if it barely moved. */
function isoIsTap(movedPx) {
  return movedPx < 6;
}

/** "1 parcel" not "1.00 parcels" — the count is usually a whole number. */
function formatParcels(n) {
  const s = Number.isInteger(n) ? formatInt(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} parcel${n === 1 ? '' : 's'}`;
}

/**
 * The board's palette, per theme. Pure, so tests.html can assert the invariant
 * that actually matters: gold is the ONLY hue on the board, in either theme, so
 * "lit" can never be confused with "a lighter grey".
 *
 * Light is not an inversion of dark. On slate the locked blocks are lighter than
 * the backdrop; on paper they have to be DARKER than it, or the board reads as
 * a blank sheet. The gold hue itself barely moves — it is the one thing the
 * whole page exists to point at — but its edge flips from a highlight (#ffc978,
 * visible against slate) to a shadow (#8a5a10, visible against paper).
 */
function isoPalette(theme) {
  return theme === 'light' ? {
    lockedTopA: '#b7c0cc',
    lockedTopB: '#a7b2c0',
    lockedL:    '#7c8899',
    lockedR:    '#8d99aa',
    lockedEdge: '#6f7c8d',
    goldTop:    '#f7931a',
    goldL:      '#a35c05',
    goldR:      '#cf7a0c',
    goldEdge:   '#8a5a10',
    parcelLine: 'rgba(0,0,0,0.30)',
    hoverEdge:  '#16202a',
    hoverFill:  'rgba(22,32,42,0.07)',
    walkMark:   'rgba(22,32,42,.55)',
    hereText:   '#a85f06',
    worldTop:   '#aab4c1',
    worldL:     '#8592a1',
    worldR:     '#9aa5b3',
    worldYours: '#8a5a10',
    // Deeds claimed on Arc. Deliberately cool: gold means Bitcoin you own and
    // nothing else on this board is allowed to be warm, so a deed — which says
    // nothing about anybody's holdings — must never be mistaken for it. Same
    // rule as the gold edge: a shadow on paper, a highlight on slate.
    deedTop:      '#6fa8b8',
    deedL:        '#3f7280',
    deedR:        '#568e9c',
    deedEdge:     '#2a5f6b',
    deedMineTop:  '#2f93aa',
    deedMineEdge: '#0e3b46',
  } : {
    lockedTopA: '#465061',
    lockedTopB: '#333c48',
    lockedL:    '#1d232b',
    lockedR:    '#28303a',
    lockedEdge: '#4d5a69',
    goldTop:    '#f7931a',
    goldL:      '#935205',
    goldR:      '#c4740e',
    goldEdge:   '#ffc978',
    parcelLine: 'rgba(0,0,0,0.35)',
    hoverEdge:  '#ffffff',
    hoverFill:  'rgba(255,255,255,0.07)',
    walkMark:   'rgba(255,255,255,.6)',
    hereText:   '#f7931a',
    worldTop:   '#39424e',
    worldL:     '#232a33',
    worldR:     '#2c343e',
    worldYours: '#ffc978',
    deedTop:      '#2f6675',
    deedL:        '#183945',
    deedR:        '#215260',
    deedEdge:     '#7fdbe8',
    deedMineTop:  '#48b0c6',
    deedMineEdge: '#c8f4ff',
  };
}

/**
 * Which Arc deed, if any, sits on a world tile.
 *
 * Pure so tests.html can assert it: the registry state is passed in rather than
 * read from window.Arc. Returns null, 'mine' or 'theirs'.
 */
function isoDeedState(tileId, tiles, account) {
  if (!tiles) return null;
  const row = tiles[tileId];
  if (!row) return null;
  if (!account || !row.owner) return 'theirs';
  return String(row.owner).toLowerCase() === String(account).toLowerCase() ? 'mine' : 'theirs';
}

/* ============================================================================
 * Render layer — not covered by tests.html
 * ==========================================================================*/

if (typeof window !== 'undefined' && !window.__LANDBANK_TEST_ONLY__) {

// Locked land must read as a real board of blocks, not as background. The two
// greys alternate on a checkerboard so individual tiles stay countable — the
// first version used near-black and the board vanished into the backdrop.
// Tiles are drawn inset from their grid cell so each one is a separate cube with
// its own visible side faces. Flush tiles merge into one flat plane and the
// board stops reading as blocks at all.
const ISO_TILE_INSET = 0.9;

// Reassigned by setTheme(); every draw call reads through it, so a theme change
// is one assignment plus a redraw rather than a re-init of the board.
let COL = isoPalette('dark');

const S = {
  canvas: null, ctx: null,
  btc: 0, zoom: 0, raf: 0, t0: performance.now(),
  panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0,
  reduced: false, sig: '', buys: [],
  hover: null,           // {x, y} tile under the cursor
  personaBox: null,      // screen rect of the figure, for its own hover card
  overPersona: false,
  deedDetail: {},        // tileId -> {owner, claimedAt, label}, fetched on hover
  deedPending: {},       // tileId -> true while its detail call is in flight
  claiming: false,       // a claim transaction is awaiting the wallet
  toastTimer: 0,
  persona: { x: 1, y: 1 },   // fractional tile coords — the figure walks
  walk: null,                // {from, to, t0, dur}
  press: null,               // {x, y, moved} — tells a tap apart from a drag
  mouse: { x: 0, y: 0, inside: false },
  origin: { x: 0, y: 0 }, tw: 240,
  mode: 'land',                 // 'land' (1 tile = 1 BTC) or 'world' (1 tile = 10,000)
  ranges: null,                 // memoised whale tile ranges
  hoverWhale: null,
};

function whaleRangesCached() {
  if (!S.ranges) S.ranges = whaleRanges();
  return S.ranges;
}

const $$ = (s) => document.querySelector(s);

/* -------------------------------------------------------------- the tiles */

function diamond(ctx, sx, sy, tw) {
  const th = tw / 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx - tw / 2, sy + th / 2);
  ctx.closePath();
}

/** A point on the top face in parcel space, u/v each 0..1. */
function facePoint(sx, sy, tw, u, v) {
  const th = tw / 2;
  return {
    x: sx + (u - v) * (tw / 2),
    y: sy + (u + v) * (th / 2),
  };
}

function drawTile(ctx, sx, sy, tw, state, remainder, checker, hovered) {
  const th = tw / 2;
  const depth = Math.max(6, tw * 0.30);
  const lit = state === 'full';
  const top = lit ? COL.goldTop : (checker ? COL.lockedTopA : COL.lockedTopB);

  // Left and right faces give the block its thickness. Drawn first so the top
  // face sits cleanly on them.
  ctx.fillStyle = lit ? COL.goldL : COL.lockedL;
  ctx.beginPath();
  ctx.moveTo(sx - tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx, sy + th + depth);
  ctx.lineTo(sx - tw / 2, sy + th / 2 + depth);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = lit ? COL.goldR : COL.lockedR;
  ctx.beginPath();
  ctx.moveTo(sx + tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx, sy + th + depth);
  ctx.lineTo(sx + tw / 2, sy + th / 2 + depth);
  ctx.closePath();
  ctx.fill();

  diamond(ctx, sx, sy, tw);
  ctx.fillStyle = top;
  ctx.fill();

  // The partially-owned tile is the whole point of the board: it is where a
  // 0.01 BTC stack actually lives, so its 100 parcels are drawn individually.
  if (state === 'partial' && remainder > 0) {
    const whole = Math.floor(remainder);
    const frac = remainder - whole;
    // A single lit parcel is 1% of a tile. Without a glow beneath it, the thing
    // the whole board exists to show is a speck.
    const g = ctx.createRadialGradient(sx, sy + th / 2, 0, sx, sy + th / 2, tw * 0.5);
    g.addColorStop(0, 'rgba(247,147,26,0.30)');
    g.addColorStop(1, 'rgba(247,147,26,0)');
    ctx.fillStyle = g;
    diamond(ctx, sx, sy, tw);
    ctx.fill();
    for (let i = 0; i < ISO_SUB; i++) {
      for (let j = 0; j < ISO_SUB; j++) {
        const idx = j * ISO_SUB + i;
        let alpha = 0;
        if (idx < whole) alpha = 1;
        else if (idx === whole && frac > 0.02) alpha = frac;
        if (!alpha) continue;
        const a = facePoint(sx, sy, tw, i / ISO_SUB, j / ISO_SUB);
        const b = facePoint(sx, sy, tw, (i + 1) / ISO_SUB, j / ISO_SUB);
        const c = facePoint(sx, sy, tw, (i + 1) / ISO_SUB, (j + 1) / ISO_SUB);
        const d = facePoint(sx, sy, tw, i / ISO_SUB, (j + 1) / ISO_SUB);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COL.goldTop;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // Parcel gridlines, but only while they would be more than a smudge.
    if (tw >= 60) {
      ctx.strokeStyle = COL.parcelLine;
      ctx.lineWidth = 1;
      for (let k = 1; k < ISO_SUB; k++) {
        const p1 = facePoint(sx, sy, tw, k / ISO_SUB, 0);
        const p2 = facePoint(sx, sy, tw, k / ISO_SUB, 1);
        const p3 = facePoint(sx, sy, tw, 0, k / ISO_SUB);
        const p4 = facePoint(sx, sy, tw, 1, k / ISO_SUB);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
      }
    }
  }

  diamond(ctx, sx, sy, tw);
  ctx.strokeStyle = lit || state === 'partial' ? COL.goldEdge : COL.lockedEdge;
  ctx.lineWidth = lit || state === 'partial' ? 1.5 : 1;
  ctx.stroke();

  if (hovered) {
    diamond(ctx, sx, sy, tw);
    ctx.strokeStyle = COL.hoverEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COL.hoverFill;
    ctx.fill();
  }
}

/* ---------------------------------------------------------------- persona */

/**
 * A small hooded figure standing on home tile, holding a staff with an orange
 * gem. Deliberately simple geometry — it reads at 40px and does not compete
 * with the board for attention.
 *
 * Its colours are deliberately NOT themed. The figure is an object standing on
 * the board, not part of the board's surface: a navy cloak and a lit face read
 * against slate and against paper alike, and re-tinting a character per theme
 * would only make it look like a different character.
 */
function drawPersona(ctx, sx, sy, tw, bob) {
  // Parcels fill from the tile's TOP corner outward, so the figure stands at the
  // front corner instead of the centre — otherwise it plants itself squarely on
  // the one lit parcel a 0.01 BTC stack owns and hides the entire point.
  // Scale is capped so it never towers over the board at the widest zoom.
  const s = Math.min(tw, 150) / 130;
  const foot = facePoint(sx, sy, tw, 0.82, 0.82);
  const cx = foot.x;
  const cy = foot.y - 6 * s + bob;

  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, 22 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // staff
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = Math.max(1.5, 3.4 * s);
  ctx.beginPath();
  ctx.moveTo(cx + 20 * s, cy - 4 * s);
  ctx.lineTo(cx + 26 * s, cy - 62 * s);
  ctx.stroke();
  const grd = ctx.createRadialGradient(cx + 26 * s, cy - 66 * s, 0, cx + 26 * s, cy - 66 * s, 12 * s);
  grd.addColorStop(0, '#ffd08a');
  grd.addColorStop(0.45, '#f7931a');
  grd.addColorStop(1, 'rgba(247,147,26,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx + 26 * s, cy - 66 * s, 12 * s, 0, Math.PI * 2);
  ctx.fill();

  // cloak
  ctx.fillStyle = '#2f3d63';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 44 * s);
  ctx.quadraticCurveTo(cx + 21 * s, cy - 26 * s, cx + 17 * s, cy);
  ctx.lineTo(cx - 17 * s, cy);
  ctx.quadraticCurveTo(cx - 21 * s, cy - 26 * s, cx, cy - 44 * s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#3d4f80';                 // lit side
  ctx.beginPath();
  ctx.moveTo(cx, cy - 44 * s);
  ctx.quadraticCurveTo(cx + 21 * s, cy - 26 * s, cx + 17 * s, cy);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();

  // trim
  ctx.strokeStyle = '#f7931a';
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.beginPath();
  ctx.moveTo(cx - 17 * s, cy);
  ctx.lineTo(cx + 17 * s, cy);
  ctx.stroke();

  // head + hood
  ctx.fillStyle = '#e8c9a6';
  ctx.beginPath();
  ctx.arc(cx, cy - 52 * s, 11 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f3d63';
  ctx.beginPath();
  ctx.arc(cx, cy - 55 * s, 12.5 * s, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 55 * s, 12.5 * s, 6 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  ctx.fillStyle = '#1b2436';
  ctx.beginPath(); ctx.arc(cx - 4 * s, cy - 49 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4 * s, cy - 49 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

/* ------------------------------------------------------------------ board */

function draw() {
  const c = S.canvas, ctx = S.ctx;
  if (!c || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (S.mode === 'world') {
    drawWorld(ctx, w, h);
    updateHud(0);
    updateTooltip();
    return;
  }

  const tw = ISO_ZOOM_STEPS[S.zoom];
  const radius = isoBoardRadius(w, h, tw);
  const full = isoFullBlocks(S.btc);
  const rem = isoRemainderParcels(S.btc);
  const originX = w / 2 + S.panX;
  const originY = h / 2 - tw / 4 + S.panY;

  // Painter's algorithm: back to front is ascending x+y.
  const tiles = [];
  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) tiles.push([x, y]);
  }
  tiles.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  let homeScreen = null;
  const bob = S.reduced ? 0 : Math.sin((performance.now() - S.t0) / 620) * (tw * 0.018);
  const walkT = S.walk ? Math.min(1, (performance.now() - S.walk.t0) / S.walk.dur) : 0;

  for (const [x, y] of tiles) {
    const idx = isoSpiralIndex(x, y);
    let state = 'locked';
    if (idx < full) state = 'full';
    else if (idx === full && rem > 0) state = 'partial';

    const z = state === 'locked' ? 0 : 1;
    const p = isoProject(x, y, z, tw);
    const sx = originX + p.sx, sy = originY + p.sy;
    if (sx < -tw * 1.5 || sx > w + tw * 1.5 || sy < -tw * 1.5 || sy > h + tw * 1.5) continue;

    // Shrink about the tile's centre, not its top vertex, or the gap opens on
    // one side only and the grid visibly drifts.
    const k = ISO_TILE_INSET;
    const inset = (tw / 2 / 2) * (1 - k);
    const hovered = !!S.hover && S.hover.x === x && S.hover.y === y && !S.overPersona;
    drawTile(ctx, sx, sy + inset, tw * k, state, rem, (Math.abs(x + y) % 2) === 0, hovered);

    // Destination marker while the figure is in transit.
    if (S.walk && S.walk.to.x === x && S.walk.to.y === y) {
      ctx.strokeStyle = COL.walkMark;
      ctx.lineWidth = 2;
      diamond(ctx, sx, sy + inset, tw * k * 0.4);
      ctx.stroke();
    }
  }

  // The figure is drawn from its own fractional coordinates, after every tile,
  // so it is never clipped by a raised block it is walking past.
  {
    const k = ISO_TILE_INSET;
    const inset = (tw / 2 / 2) * (1 - k);
    const twk = tw * k;
    const px = S.persona.x, py = S.persona.y;
    const onOwned = isoTileState(Math.round(px), Math.round(py), S.btc) !== 'locked';
    const hop = S.walk ? isoWalkHop(S.walk.from, S.walk.to, walkT) : 0;
    const pp = isoProject(px, py, onOwned ? 1 : 0, tw);
    homeScreen = { sx: originX + pp.sx, sy: originY + pp.sy + inset - hop * tw, tw: twk };

    drawPersona(ctx, homeScreen.sx, homeScreen.sy, homeScreen.tw, S.walk ? 0 : bob);
    const s = Math.min(homeScreen.tw, 150) / 130;
    const foot = facePoint(homeScreen.sx, homeScreen.sy, homeScreen.tw, 0.82, 0.82);
    S.personaBox = { x: foot.x - 30 * s, y: foot.y - 82 * s, w: 62 * s, h: 90 * s };
    if (S.overPersona) {
      const b = S.personaBox;
      ctx.strokeStyle = 'rgba(247,147,26,.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, 6);
      else ctx.rect(b.x, b.y, b.w, b.h);
      ctx.stroke();
    }
  }

  S.origin = { x: originX, y: originY };
  S.tw = tw;
  updateHud(radius);
  updateTooltip();
}

/* ------------------------------------------------------------ world view */

function drawWorld(ctx, w, h) {
  const tw = isoWorldTileW(w, h);
  const rs = whaleRangesCached();
  const yourTile = whaleWorldTileForBtc(S.btc, rs);
  const originX = w / 2 + S.panX;
  const originY = h / 2 - tw / 4 + S.panY;
  S.origin = { x: originX, y: originY };
  S.tw = tw;

  const cells = [];
  for (let row = 0; row < WORLD_ROWS; row++) {
    for (let col = 0; col < WORLD_COLS; col++) cells.push([col, row]);
  }
  cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  const k = ISO_TILE_INSET;
  const inset = (tw / 2 / 2) * (1 - k);
  let yourScreen = null;
  const arc = window.Arc ? window.Arc.get() : null;

  for (const [col, row] of cells) {
    const idx = isoWorldIndex(col, row);
    const whale = whaleAtTile(idx, rs);
    const deed = arc ? isoDeedState(idx, arc.tiles, arc.account) : null;
    const off = isoWorldOffset(col, row);
    // Claimed land stands proud, whether the claim is a whale's or a deed's.
    const p = isoProject(off.x, off.y, whale || deed ? 1 : 0, tw);
    const sx = originX + p.sx, sy = originY + p.sy + inset;
    if (sx < -tw * 2 || sx > w + tw * 2 || sy < -tw * 2 || sy > h + tw * 2) continue;

    const isYours = idx === yourTile;
    const hovered = S.hoverWhale && S.hoverWhale.tile === idx;
    drawWorldTile(ctx, sx, sy, tw * k, whale, isYours, hovered, deed);
    if (isYours) yourScreen = { sx, sy, tw: tw * k };
  }

  if (yourScreen) {
    drawPersona(ctx, yourScreen.sx, yourScreen.sy, Math.max(yourScreen.tw, 46), 0);
    const foot = facePoint(yourScreen.sx, yourScreen.sy, yourScreen.tw, 0.82, 0.82);
    ctx.fillStyle = COL.hereText;
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('you are here', foot.x, foot.y + 20);
    ctx.textAlign = 'left';
  }
}

function drawWorldTile(ctx, sx, sy, tw, whale, isYours, hovered, deed) {
  const th = tw / 2;
  const depth = Math.max(3, tw * 0.26);
  // Precedence: your own holding marker, then a whale, then an Arc deed, then
  // empty. Your marker wins because it is where you stand on the map.
  const top = isYours ? COL.goldTop
            : whale ? whaleColor(whale)
            : deed === 'mine' ? COL.deedMineTop
            : deed ? COL.deedTop
            : COL.worldTop;
  const solid = whale || isYours || deed;

  ctx.fillStyle = solid ? 'rgba(0,0,0,.42)' : COL.worldL;
  ctx.beginPath();
  ctx.moveTo(sx - tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx, sy + th + depth);
  ctx.lineTo(sx - tw / 2, sy + th / 2 + depth);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = solid ? 'rgba(255,255,255,.10)' : COL.worldR;
  ctx.beginPath();
  ctx.moveTo(sx + tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx, sy + th + depth);
  ctx.lineTo(sx + tw / 2, sy + th / 2 + depth);
  ctx.closePath();
  ctx.fill();

  diamond(ctx, sx, sy, tw);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.strokeStyle = hovered ? COL.hoverEdge
                  : isYours ? COL.worldYours
                  : deed === 'mine' ? COL.deedMineEdge
                  : deed ? COL.deedEdge
                  : 'rgba(0,0,0,.35)';
  ctx.lineWidth = hovered || deed === 'mine' ? 2 : 1;
  ctx.stroke();
}

/* ---------------------------------------------------------------- tooltip */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function personaCardHtml() {
  const t = isoTrackRecord(S.buys);
  const tier = tierFor(S.btc);
  const next = nextTierFor(S.btc);
  const price = window.Price ? window.Price.get() : { usd: null };
  const rows = t.count
    ? `<tr><th>Buys recorded</th><td>${formatInt(t.count)}</td></tr>
       <tr><th>First claim</th><td>${esc(formatDate(t.first))}</td></tr>
       <tr><th>Latest claim</th><td>${esc(formatDate(t.last))}</td></tr>
       <tr><th>Average buy</th><td>${formatBtc(Number(t.avg.toPrecision(3)))} BTC</td></tr>
       <tr><th>Largest buy</th><td>${formatBtc(t.biggest)} BTC</td></tr>`
    : `<tr><td colspan="2" class="tip__empty">No claims recorded yet.</td></tr>`;
  return `
    <div class="tip__head"><span class="tip__icon">${tier.icon}</span>
      <span><b>${esc(tier.name.toUpperCase())}</b><br><span class="tip__sub">LANDHOLDER · Lv.${isoLevel(S.btc)}</span></span>
    </div>
    <div class="tip__big">${formatBtc(S.btc)} <span>BTC</span></div>
    <div class="tip__sub">${formatInt(toSats(S.btc))} sats${
      price.usd ? ` · ${formatUsd(marketValueUsd(S.btc, price.usd))}` : ''}</div>
    <table class="tip__tbl">${rows}
      <tr><th>Land held</th><td>${formatInt(isoFullBlocks(S.btc))} block${isoFullBlocks(S.btc) === 1 ? '' : 's'} + ${formatParcels(isoRemainderParcels(S.btc))}</td></tr>
      <tr><th>Next rank</th><td>${next ? `${esc(next.name)} at ${formatBtc(next.min)} BTC` : 'max'}</td></tr>
    </table>`;
}

function tileCardHtml(x, y) {
  const state = isoTileState(x, y, S.btc);
  const idx = isoSpiralIndex(x, y);
  const rem = isoRemainderParcels(S.btc);
  const price = window.Price ? window.Price.get() : { usd: null };
  const val = (btc) => (price.usd ? ` · ${formatUsd(marketValueUsd(btc, price.usd))}` : '');

  if (state === 'full') {
    return `<div class="tip__head tip__head--gold"><b>UNLOCKED BLOCK</b></div>
      <div class="tip__sub">Block #${formatInt(idx + 1)} of your claim</div>
      <p class="tip__p">All <b>100 parcels</b> owned — a whole Bitcoin${val(1)}.</p>`;
  }
  if (state === 'partial') {
    // This is the tile the owner asked about: gold border, dark centre.
    return `<div class="tip__head tip__head--gold"><b>IN PROGRESS</b></div>
      <div class="tip__sub">The block you are filling right now</div>
      <p class="tip__p">The gold border means this block is <b>yours to finish</b>.
        The dark centre is the part you do not own yet:
        <b>${formatParcels(rem)} of 100</b> lit${val(rem * PARCEL_BTC)}.
        Buy ${formatBtc(1 - rem * PARCEL_BTC)} BTC more and the whole tile turns gold.</p>`;
  }
  return `<div class="tip__head"><b>LOCKED</b></div>
    <div class="tip__sub">Block #${formatInt(idx + 1)} from home</div>
    <p class="tip__p">Nobody here owns this. It costs <b>1 BTC</b>${val(1)} to light it,
      and it unlocks after ${formatInt(idx)} earlier block${idx === 1 ? '' : 's'}.</p>`;
}

/**
 * A tile claimed on Arc.
 *
 * Note what is NOT here: nothing about how much Bitcoin the holder owns. A deed
 * records a tile and an address, and the registry has no field that could carry
 * a holding. The card cannot show one because the chain does not have one.
 */
function deedCardHtml(hw) {
  const detail = requestDeedDetail(hw.tile);
  const arc = window.Arc ? window.Arc.get() : null;
  const owner = (arc && arc.tiles[hw.tile]) ? arc.tiles[hw.tile].owner : null;
  const mine = hw.deed === 'mine';
  const label = detail && detail.label ? detail.label : '';
  const when = detail && detail.claimedAt ? arcWibDate(detail.claimedAt) : '';

  return `<div class="tip__head tip__head--gold"><b>${mine ? 'YOUR DEED' : 'CLAIMED ON ARC'}</b></div>
    <div class="tip__sub">Tile #${formatInt(hw.tile)} · 10,000 BTC of the map</div>
    ${label ? `<div class="tip__big">${esc(label)}</div>` : ''}
    <table class="tip__tbl">
      <tr><th>Holder</th><td class="tip__addr">${esc(owner ? arcShortAddress(owner) : '—')}</td></tr>
      <tr><th>Claimed</th><td>${esc(when || (detail ? '—' : 'loading…'))}</td></tr>
      <tr><th>Grid</th><td>col ${arcTileCol(hw.tile)}, row ${arcTileRow(hw.tile)}</td></tr>
    </table>
    <p class="tip__p">A deed is a claim on the map. It says nothing about what
      anybody holds — that stays in their own browser.</p>
    <p class="tip__click">Click to open this deed on ArcScan ↗</p>`;
}

/** An unclaimed tile outside the top 100's territory. */
function openLandCardHtml(hw) {
  const arc = window.Arc ? window.Arc.get() : null;
  if (!arc || !arc.deployed) {
    return `<div class="tip__head"><b>OPEN LAND</b></div>
      <div class="tip__sub">Tile #${formatInt(hw.tile)} · 10,000 BTC of the map</div>
      <p class="tip__p">The registry is not deployed yet. When it is, this tile
        can be claimed on <b>Arc</b>, where gas is paid in USDC.</p>`;
  }
  const price = arc.priceUsdc > 0 ? `${formatUsd(arc.priceUsdc)} plus gas` : 'only the gas';
  return `<div class="tip__head"><b>OPEN LAND</b></div>
    <div class="tip__sub">Tile #${formatInt(hw.tile)} · 10,000 BTC of the map</div>
    <table class="tip__tbl">
      <tr><th>Status</th><td>unclaimed</td></tr>
      <tr><th>Remaining</th><td>${formatInt(arc.remaining)} of 1,791</td></tr>
      <tr><th>Costs</th><td>${esc(price)}</td></tr>
      <tr><th>Grid</th><td>col ${arcTileCol(hw.tile)}, row ${arcTileRow(hw.tile)}</td></tr>
    </table>
    <p class="tip__click">${arc.account ? 'Click to claim this tile on Arc' : 'Click to connect a wallet and claim'}</p>`;
}

/** Dispatch for the world view: deed, whale, open land, or the crowd. */
function worldCardHtml(hw) {
  if (hw.deed) return deedCardHtml(hw);
  if (hw.whale) return whaleCardHtml(hw);
  if (arcTileIsClaimable(hw.tile)) return openLandCardHtml(hw);
  return whaleCardHtml(hw);
}

/**
 * Label and claim date come from a second call, so they are fetched once per
 * tile on first hover and cached. Returns null until the answer lands, and
 * clears the frame signature so the card repaints when it does.
 */
function requestDeedDetail(tileId) {
  if (S.deedDetail[tileId]) return S.deedDetail[tileId];
  if (S.deedPending[tileId] || !window.Arc) return null;
  S.deedPending[tileId] = true;
  window.Arc.tileDetail(tileId).then((d) => {
    if (d) S.deedDetail[tileId] = d;
    S.deedPending[tileId] = false;
    S.sig = '';
  }).catch(() => { S.deedPending[tileId] = false; });
  return null;
}

function whaleCardHtml(hw) {
  const price = window.Price ? window.Price.get() : { usd: null };
  if (!hw.whale) {
    return `<div class="tip__head"><b>UNCLAIMED BY THE TOP 100</b></div>
      <div class="tip__sub">10,000 BTC per tile</div>
      <p class="tip__p">This tile is spread across the millions of addresses outside the
        richest 100 — <b>${formatBtc(21000000 - WHALE_DATA.total_btc)} BTC</b>, or
        ${((21000000 - WHALE_DATA.total_btc) / 21000000 * 100).toFixed(1)}% of all Bitcoin,
        sits out here. Yours is in this crowd.</p>`;
  }
  const w = hw.whale;
  const tiles = w.to - w.from;
  return `<div class="tip__head tip__head--gold"><b>#${w.rank} · ${esc(w.label || 'UNIDENTIFIED')}</b></div>
    <div class="tip__sub">${esc(whaleKindLabel(whaleKind(w)))}</div>
    <div class="tip__big">${formatInt(w.btc)} <span>BTC</span></div>
    <div class="tip__sub">${esc(w.pct)} of all Bitcoin${
      price.usd ? ` · ${formatUsd(marketValueUsd(w.btc, price.usd))}` : ''}</div>
    <table class="tip__tbl">
      <tr><th>Address</th><td class="tip__addr">${esc(shortAddress(w.address))}</td></tr>
      <tr><th>Holding since</th><td>${esc(w.since || '—')}</td></tr>
      <tr><th>Tiles here</th><td>${tiles < 1 ? tiles.toFixed(2) : formatInt(tiles)}</td></tr>
      <tr><th>vs your stack</th><td>${S.btc > 0 ? `${formatBigCount(w.btc / S.btc)}×` : '—'}</td></tr>
    </table>
    <p class="tip__click">Click to open this address on bitinfocharts ↗</p>`;
}

function updateTooltip() {
  const tip = $$('#iso-tip');
  if (!tip) return;
  const nothing = S.mode === 'world' ? !S.hoverWhale : (!S.hover && !S.overPersona);
  if (!S.mouse.inside || S.dragging || nothing) {
    tip.hidden = true;
    return;
  }
  const html = S.mode === 'world' ? worldCardHtml(S.hoverWhale)
             : S.overPersona ? personaCardHtml() : tileCardHtml(S.hover.x, S.hover.y);
  if (tip.dataset.h !== html) { tip.innerHTML = html; tip.dataset.h = html; }
  tip.hidden = false;

  // Keep the card inside the board rather than letting it hang off an edge.
  const b = S.canvas.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = S.mouse.x + 18, top = S.mouse.y + 18;
  if (left + w > b.width - 8) left = S.mouse.x - w - 18;
  if (top + h > b.height - 8) top = Math.max(8, S.mouse.y - h - 18);
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

/* -------------------------------------------------------------------- HUD */

function updateHud(radius) {
  const btc = S.btc;
  const price = window.Price ? window.Price.get() : { usd: null, at: null };
  const tier = tierFor(btc);

  const set = (sel, val) => { const el = $$(sel); if (el && el.textContent !== val) el.textContent = val; };

  set('#hud-clock', `${wibClock()} WIB`);
  set('#hud-update', price.at
    ? `LATEST UPDATE ${wibClock(price.at)} · ${agoLabel(price.at)}${price.failing ? ' · retrying' : ''}`
    : 'LATEST UPDATE · fetching…');

  set('#hud-persona-name', tier.name.toUpperCase());
  set('#hud-persona-sub', `LANDHOLDER · Lv.${isoLevel(btc)}`);
  const icon = $$('#hud-persona-icon');
  if (icon && icon.textContent !== tier.icon) icon.textContent = tier.icon;

  set('#hud-btc', formatBtc(btc));
  set('#hud-sats', `${formatInt(toSats(btc))} sats`);

  set('#hud-price', price.usd == null ? '—' : formatUsd(price.usd));
  set('#hud-value', formatUsd(marketValueUsd(btc, price.usd)));

  if (S.mode === 'world') {
    const rest = 21000000 - WHALE_DATA.total_btc;
    set('#hud-unlocked', `Top 100 addresses hold ${formatInt(WHALE_DATA.total_btc)} BTC — ${
      (WHALE_DATA.total_btc / 21000000 * 100).toFixed(2)}% of everything`);
    set('#hud-inview', `1 tile = 10,000 BTC · 50 × 42 = 2,100 tiles = all 21,000,000`);
    set('#hud-gauge-label', 'YOUR SHARE OF THE WORLD');
    set('#hud-gauge-val', btc > 0 ? `${formatPct(pctOfMaxSupply(btc))}` : '—');
    const wbar = $$('#hud-gauge-fill');
    if (wbar) wbar.style.width = `${Math.max(0.4, btc / 21000000 * 100)}%`;
    return;
  }

  const blocks = isoFullBlocks(btc);
  const rem = isoRemainderParcels(btc);
  set('#hud-unlocked', blocks > 0
    ? `${formatInt(blocks)} block${blocks === 1 ? '' : 's'}${rem > 0 ? ` + ${formatParcels(rem)}` : ''} unlocked`
    : `${formatParcels(rem)} of 100 unlocked on this block`);
  set('#hud-inview', `${formatInt(isoTilesInView(radius))} of 21,000,000 blocks in view`);

  const next = nextTierFor(btc);
  set('#hud-gauge-label', next ? `NEXT: ${next.name.toUpperCase()}` : 'MAX RANK');
  const bar = $$('#hud-gauge-fill');
  if (bar) bar.style.width = `${(tierProgress(btc) * 100).toFixed(1)}%`;
  set('#hud-gauge-val', next ? `${formatBtc(next.min - btc)} BTC` : '—');
}

/* ------------------------------------------------------------- interaction */

function loop() {
  S.raf = requestAnimationFrame(loop);

  if (S.walk) {
    const t = Math.min(1, (performance.now() - S.walk.t0) / S.walk.dur);
    S.persona = isoWalkPos(S.walk.from, S.walk.to, t);
    if (t >= 1) { S.persona = { x: S.walk.to.x, y: S.walk.to.y }; S.walk = null; }
    S.sig = '';
  }

  const price = window.Price ? window.Price.get() : { usd: null, at: null };
  // Redraw when the view, the ledger, the clock second or the quote changes.
  // The persona's idle bob keeps it ticking, which is fine; it is a handful of
  // hundreds of paths, not a shader.
  // Arc state has to be in the signature or a newly claimed tile never repaints.
  const arc = window.Arc ? window.Arc.get() : null;
  const sig = `${S.btc}|${S.zoom}|${S.panX}|${S.panY}|${wibClock()}|${price.usd}|${price.at}` +
              `|${S.hover ? S.hover.x + ',' + S.hover.y : ''}|${S.overPersona}` +
              `|${arc ? arc.count + ',' + arc.account + ',' + arc.at : ''}` +
              `|${S.hoverWhale ? S.hoverWhale.tile : ''}|${S.claiming}`;
  if (sig !== S.sig || !S.reduced) { S.sig = sig; draw(); }
}

/** Which world tile (and whale, and Arc deed) is under a screen point. */
function worldHitTest(mx, my) {
  const px = mx - S.origin.x, py = my - S.origin.y;
  const hi = isoTileFromPoint(px, py, S.tw, true);
  const lo = isoTileFromPoint(px, py, S.tw, false);
  const arc = window.Arc ? window.Arc.get() : null;
  const deedAt = (i) => (arc ? isoDeedState(i, arc.tiles, arc.account) : null);

  for (const cand of [hi, lo]) {
    const t = isoWorldTileFromOffset(cand.x, cand.y);
    const idx = isoWorldIndex(t.col, t.row);
    if (idx < 0) continue;
    const whale = whaleAtTile(idx, whaleRangesCached());
    const deed = deedAt(idx);
    // Claimed tiles are raised, so the raised solution is the right one for them
    // and the flat solution is right for everything else. Deeds are raised too,
    // so they have to count here or hovering a claimed tile picks its neighbour.
    if ((cand === hi) === !!(whale || deed)) return { tile: idx, whale, deed };
  }
  const t = isoWorldTileFromOffset(lo.x, lo.y);
  const idx = isoWorldIndex(t.col, t.row);
  if (idx < 0) return null;
  return { tile: idx, whale: whaleAtTile(idx, whaleRangesCached()), deed: deedAt(idx) };
}

/** Short-lived status line for a claim, which is the one slow action here. */
function arcToast(msg, sticky) {
  const el = $$('#arc-toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (S.toastTimer) clearTimeout(S.toastTimer);
  if (!sticky) S.toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

/**
 * Claim a world tile on Arc.
 *
 * `label` is passed in by the click path via a prompt; call it directly with a
 * label to skip the prompt (which is also what makes this reachable from a
 * script without a blocking dialog).
 */
async function claimTile(tileId, presetLabel) {
  if (S.claiming) return { ok: false, reason: 'busy' };
  if (!window.Arc) return { ok: false, reason: 'no-arc' };

  let arc = window.Arc.get();
  if (!arc.deployed) { arcToast('The Arc land registry is not deployed yet.'); return { ok: false, reason: 'not-deployed' }; }
  if (!arcTileIsClaimable(tileId)) { arcToast(`Tile #${tileId} is reserved for the top 100.`); return { ok: false, reason: 'reserved' }; }
  if (arc.tiles[tileId]) { arcToast(`Tile #${tileId} is already claimed.`); return { ok: false, reason: 'taken' }; }

  if (!arc.account) {
    arcToast('Connect a wallet to claim…', true);
    const c = await window.Arc.connect();
    if (!c.ok) {
      arcToast(c.reason === 'no-wallet'
        ? 'No browser wallet found. Install one to claim land on Arc.'
        : 'Wallet not connected, so nothing was claimed.');
      return { ok: false, reason: c.reason };
    }
    arc = window.Arc.get();
  }

  let label = presetLabel;
  if (label == null) {
    label = window.prompt(`Name your claim on tile #${tileId} — up to 32 bytes, optional:`, '');
    if (label === null) { arcToast('Claim cancelled.'); return { ok: false, reason: 'cancelled' }; }
  }
  if (arcUtf8Bytes(label).length > ARC_MAX_LABEL_BYTES) {
    arcToast(`That label is ${arcUtf8Bytes(label).length} bytes; the limit is ${ARC_MAX_LABEL_BYTES}.`);
    return { ok: false, reason: 'label-too-long' };
  }

  S.claiming = true; S.sig = '';
  try {
    // Arc denominates gas in USDC, and its docs ask for fees to be shown in
    // dollars rather than Gwei. Quote before asking anyone to sign.
    const q = await window.Arc.quote(tileId, label);
    arcToast(`Claiming tile #${tileId} — about ${formatUsd(q.totalUsdc)} in USDC. Confirm in your wallet…`, true);

    const res = await window.Arc.claim(tileId, label);
    if (res.ok) {
      arcToast(res.reason === 'pending'
        ? `Tile #${tileId} sent — still settling. ${res.hash.slice(0, 10)}…`
        : `Tile #${tileId} is yours.`);
    } else if (res.reason === 'rejected') {
      arcToast('You declined the transaction, so nothing was claimed.');
    } else {
      arcToast(`Claim failed (${res.reason}).`);
    }
    return res;
  } catch (e) {
    arcToast('Claim failed unexpectedly.');
    return { ok: false, reason: 'error', error: e };
  } finally {
    S.claiming = false; S.sig = '';
  }
}

function walkTo(x, y) {
  if (S.persona.x === x && S.persona.y === y && !S.walk) return;
  const from = { x: S.persona.x, y: S.persona.y };
  const to = { x, y };
  if (S.reduced) { S.persona = to; S.walk = null; S.sig = ''; return; }
  S.walk = { from, to, t0: performance.now(), dur: isoWalkDuration(from.x, from.y, x, y) };
  S.sig = '';
}

function setZoom(z) {
  S.zoom = Math.max(0, Math.min(ISO_ZOOM_STEPS.length - 1, z));
  const el = $$('#iso-zoom-label');
  if (el) el.textContent = `${S.zoom + 1}/${ISO_ZOOM_STEPS.length}`;
}

function focusLand() {
  S.panX = 0;
  S.panY = 0;
  setZoom(isoDefaultZoom(S.btc));
}

function attach(c) {
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    S.dragging = true;
    S.lastX = e.clientX; S.lastY = e.clientY;
    S.press = { x: e.clientX, y: e.clientY, moved: 0 };
  });
  c.addEventListener('pointermove', (e) => {
    const b = c.getBoundingClientRect();
    S.mouse = { x: e.clientX - b.left, y: e.clientY - b.top, inside: true };

    if (S.dragging) {
      if (S.press) S.press.moved += Math.hypot(e.clientX - S.lastX, e.clientY - S.lastY);
      S.panX += e.clientX - S.lastX;
      S.panY += e.clientY - S.lastY;
      S.lastX = e.clientX; S.lastY = e.clientY;
      S.sig = '';
      return;
    }

    if (S.mode === 'world') {
      S.hoverWhale = worldHitTest(S.mouse.x, S.mouse.y);
      c.style.cursor = S.hoverWhale && S.hoverWhale.whale ? 'pointer' : 'grab';
      S.sig = '';
      return;
    }

    const pb = S.personaBox;
    S.overPersona = !!pb && S.mouse.x >= pb.x && S.mouse.x <= pb.x + pb.w &&
                            S.mouse.y >= pb.y && S.mouse.y <= pb.y + pb.h;

    // Owned tiles stand proud, so solve against the raised plane first and keep
    // that answer only if it actually landed on owned land; otherwise fall back
    // to the flat plane. Solving one plane only mis-picks along every edge.
    const px = S.mouse.x - S.origin.x, py = S.mouse.y - S.origin.y;
    const hi = isoTileFromPoint(px, py, S.tw, true);
    const lo = isoTileFromPoint(px, py, S.tw, false);
    S.hover = isoTileState(hi.x, hi.y, S.btc) !== 'locked' ? hi : lo;
    S.sig = '';
  });
  c.addEventListener('pointerleave', () => {
    S.mouse.inside = false; S.hover = null; S.overPersona = false; S.sig = '';
  });
  const up = (e) => {
    // A press that barely moved is a tap, not a pan: send the figure walking.
    // The same path serves a mouse click and a touch tap, and because touch has
    // no hover the target tile is solved from the release point rather than from
    // whatever was last hovered.
    if (S.press && isoIsTap(S.press.moved) && e && S.mode === 'world') {
      // A tap on a whale opens its address. Explicit user gesture, new tab,
      // noopener so the opened page gets no handle back on this one.
      const b = c.getBoundingClientRect();
      const hit = worldHitTest(e.clientX - b.left, e.clientY - b.top);
      S.mouse = { x: e.clientX - b.left, y: e.clientY - b.top, inside: true };
      S.hoverWhale = hit;
      if (hit && hit.deed) {
        // An existing deed: open it on the Arc explorer.
        const arc = window.Arc.get();
        const owner = arc.tiles[hit.tile] && arc.tiles[hit.tile].owner;
        if (owner) window.open(window.Arc.explorer + '/address/' + owner, '_blank', 'noopener,noreferrer');
      } else if (hit && hit.whale) {
        window.open(whaleUrl(hit.whale.address), '_blank', 'noopener,noreferrer');
      } else if (hit && arcTileIsClaimable(hit.tile)) {
        claimTile(hit.tile);
      }
      S.press = null; S.dragging = false; S.sig = '';
      return;
    }

    if (S.press && isoIsTap(S.press.moved) && e) {
      const b = c.getBoundingClientRect();
      const mx = e.clientX - b.left, my = e.clientY - b.top;
      const px = mx - S.origin.x, py = my - S.origin.y;
      const hi = isoTileFromPoint(px, py, S.tw, true);
      const lo = isoTileFromPoint(px, py, S.tw, false);
      const t = isoTileState(hi.x, hi.y, S.btc) !== 'locked' ? hi : lo;
      walkTo(t.x, t.y);
      S.mouse = { x: mx, y: my, inside: true };   // so a tap also opens the card
      S.hover = t;
    }
    S.press = null;
    S.dragging = false;
    S.sig = '';
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', () => { S.press = null; S.dragging = false; });
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(S.zoom + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  // Arrow keys walk the figure, so the board is playable without a pointer.
  c.addEventListener('keydown', (e) => {
    const zoomKeys = { '+': -1, '=': -1, '-': 1 };
    if (zoomKeys[e.key] !== undefined) { e.preventDefault(); setZoom(S.zoom + zoomKeys[e.key]); return; }
    const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (step && !S.walk) {
      e.preventDefault();
      walkTo(Math.round(S.persona.x) + step[0], Math.round(S.persona.y) + step[1]);
    }
  });
}

function init() {
  const c = $$('#iso-canvas');
  if (!c) return;
  S.canvas = c;
  S.ctx = c.getContext('2d');
  if (!S.ctx) return;
  S.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  attach(c);
  $$('#iso-zoom-in').addEventListener('click', () => setZoom(S.zoom - 1));
  $$('#iso-zoom-out').addEventListener('click', () => setZoom(S.zoom + 1));
  $$('#iso-focus').addEventListener('click', focusLand);

  $$('#scale-land').addEventListener('click', () => setMode('land'));
  $$('#scale-world').addEventListener('click', () => setMode('world'));

  if (window.Price) window.Price.onUpdate(() => { S.sig = ''; renderWhaleList(); });
  // A claim landing anywhere in the registry has to invalidate the frame
  // signature, or the board keeps painting the pre-claim state.
  if (window.Arc) window.Arc.onUpdate(() => { S.sig = ''; });

  renderWhaleList();
  setZoom(isoDefaultZoom(S.btc));
  loop();
}

function setMode(mode) {
  S.mode = mode === 'world' ? 'world' : 'land';
  S.panX = 0; S.panY = 0;
  S.hover = null; S.hoverWhale = null; S.overPersona = false;
  S.sig = '';
  const land = S.mode === 'land';
  const bl = $$('#scale-land'), bw = $$('#scale-world');
  if (bl) { bl.classList.toggle('is-on', land); bl.setAttribute('aria-pressed', String(land)); }
  if (bw) { bw.classList.toggle('is-on', !land); bw.setAttribute('aria-pressed', String(!land)); }
  const zoomer = $$('#iso-zoomer');
  if (zoomer) zoomer.hidden = !land;          // world scale is fixed by definition
  const lg = $$('#legend-land'), lw = $$('#legend-world');
  if (lg) lg.hidden = !land;
  if (lw) lw.hidden = land;
  draw();
}

/** Top-10 leaderboard under the board — the same data, readable as a list. */
function renderWhaleList() {
  const el = $$('#whale-list');
  if (!el) return;
  const price = window.Price ? window.Price.get() : { usd: null };
  el.innerHTML = WHALE_DATA.addresses.slice(0, 10).map((w) => `
    <li class="wl__row">
      <span class="wl__rank">${w.rank}</span>
      <span class="wl__sw" style="background:${whaleColor(w)}"></span>
      <a class="wl__name" href="${whaleUrl(w.address)}" target="_blank" rel="noopener noreferrer"
         title="${esc(w.address)}">${esc(w.label || shortAddress(w.address))} ↗</a>
      <span class="wl__kind">${esc(whaleKindLabel(whaleKind(w)).split(' ')[0])}</span>
      <span class="wl__btc">${formatInt(w.btc)} BTC</span>
      <span class="wl__pct">${esc(w.pct)}</span>
      <span class="wl__usd">${price.usd ? formatUsd(marketValueUsd(w.btc, price.usd)) : ''}</span>
    </li>`).join('');
}

window.Iso = {
  /** Same zero-size problem as the globe: re-measure when revealed. */
  onShow() { S.sig = ''; draw(); },
  /** Repaint the board in the page's theme. Cheap — one palette swap + redraw. */
  setTheme(theme) {
    COL = isoPalette(theme === 'light' ? 'light' : 'dark');
    S.sig = '';                 // invalidate the cached frame signature
    draw();
  },
  setMode,
  setLedger(buys) { S.buys = (buys || []).slice(); S.sig = ''; },
  setHoldings(btc) {
    const prev = S.btc;
    S.btc = Number(btc) || 0;
    S.sig = '';
    // Re-frame when the claim changes scale, but leave a deliberate zoom alone.
    if (isoDefaultZoom(prev) !== isoDefaultZoom(S.btc)) setZoom(isoDefaultZoom(S.btc));
  },
  focusLand,
  /**
   * Claim a world tile on Arc. Exposed so a claim can be driven from a script
   * with an explicit label, which skips the prompt() the click path uses.
   */
  claimTile,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

}
