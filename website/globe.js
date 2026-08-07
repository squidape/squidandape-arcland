/*
 * Bitcoin Landbank — the 3D globe.
 *
 * The whole supply as land on a sphere:
 *
 *     5,000 x 4,200  = 21,000,000 blocks       one block  = 1 BTC   (a 1x1 tile)
 *    50,000 x 42,000 =  2,100,000,000 parcels  one parcel = 0.01 BTC
 *
 * Both products are exact — 5000*4200 is 21,000,000 on the nose, and each 1 BTC
 * block subdivides into exactly 10x10 = 100 parcels. The parcel count matches the
 * "2.1 billion parcels" figure the rest of the site already quotes, so the globe
 * and the stat panel can never disagree.
 *
 * The sphere is RAY-TRACED in the fragment shader, not built as a mesh. Zooming
 * from the whole globe down to one parcel is a ~900x change in scale; a triangle
 * mesh would either show faceting at the bottom of that range or need a dynamic
 * LOD scheme, and it would also need a depth buffer. Intersecting the sphere
 * analytically per pixel is exact at every zoom, costs one draw call of one
 * triangle, and needs no depth buffer at all.
 *
 * Everything above the "WebGL layer" divider is pure and is covered by tests.html.
 * Depends on app.js for MAX_SUPPLY_BTC and PARCEL_BTC — load app.js first.
 */

'use strict';

/* ---------------------------------------------------------------- the field */

const GLOBE_BLOCK_COLS = 5000;                          // longitude divisions
const GLOBE_BLOCK_ROWS = 4200;                          // latitude divisions
const GLOBE_SUB = 10;                                   // parcels per block edge
const GLOBE_PARCEL_COLS = GLOBE_BLOCK_COLS * GLOBE_SUB; // 50,000
const GLOBE_PARCEL_ROWS = GLOBE_BLOCK_ROWS * GLOBE_SUB; // 42,000

// Your land starts at the centre of the field, which sits on the equator. Poles
// are where an equirectangular grid distorts worst, so the one place we get to
// choose is the one place with no distortion at all.
const GLOBE_HOME_COL = GLOBE_PARCEL_COLS / 2;           // 25,000
const GLOBE_HOME_ROW = GLOBE_PARCEL_ROWS / 2;           // 21,000

const GLOBE_FOV_Y = 45 * Math.PI / 180;
const GLOBE_TAN_HALF = Math.tan(GLOBE_FOV_Y / 2);

// Far end: the whole globe framed with margin. Near end: one 1 BTC block filling
// ~40% of the viewport height, which is as deep as float32 stays clean and is
// also where the view reads best — a block plus its 100 parcels, not one parcel
// smeared across the screen.
const GLOBE_D_MAX = 3.2;
const GLOBE_D_MIN = (2 * Math.PI / GLOBE_BLOCK_COLS) / (0.4 * 2 * GLOBE_TAN_HALF);

const GLOBE_LAT_LIMIT = 1.45;   // keep the camera off the poles

/* ------------------------------------------------------------- field geometry */

/** Longitude (radians, -PI..PI) at the centre of a parcel column. */
function globeLonForCol(col) {
  return ((col + 0.5) / GLOBE_PARCEL_COLS) * 2 * Math.PI - Math.PI;
}

/** Latitude (radians, +PI/2 at the north pole) at the centre of a parcel row. */
function globeLatForRow(row) {
  return Math.PI / 2 - ((row + 0.5) / GLOBE_PARCEL_ROWS) * Math.PI;
}

/** Unit vector for a lon/lat. Y is up, so latitude maps straight onto Y. */
function globeDir(lon, lat) {
  const c = Math.cos(lat);
  return [c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon)];
}

/* ------------------------------------------------------------- your holdings */

/**
 * Parcels owned, as a float — 0.01 BTC each, so a stack of 0.037 owns 3.7.
 *
 * Routed through sats rather than `btc / PARCEL_BTC` because 0.01 is not exact in
 * binary: the direct division can land a hair above a whole number, and one ulp
 * over is enough to push `ceil(sqrt(n))` in globeBlockShape to the next integer
 * and draw the claim a whole row too wide. Sats are exact integers.
 */
function globeOwnedParcels(btc) {
  return toSats(btc) / (PARCEL_BTC * SATS_PER_BTC);   // 1,000,000 sats per parcel
}

/**
 * Owned parcels are laid out as a compact rectangle rather than a long strip, so
 * the claim reads as a plot of land at every size. Width is the ceiling of the
 * square root; height is whatever holds the rest.
 */
function globeBlockShape(btc) {
  const n = globeOwnedParcels(btc);
  if (!(n > 0)) return { w: 0, h: 0, n: 0 };
  const w = Math.ceil(Math.sqrt(n));
  return { w, h: Math.ceil(n / w), n };
}

/** Top-left parcel of the owned rectangle, centred on the home point. */
function globeBlockOrigin(btc) {
  const { w, h } = globeBlockShape(btc);
  return {
    col: GLOBE_HOME_COL - Math.floor(w / 2),
    row: GLOBE_HOME_ROW - Math.floor(h / 2),
  };
}

/**
 * Centre of the claim, in lon/lat.
 *
 * globeLonForCol returns the centre of the parcel at that index, so a claim
 * spanning indices [col, col+w-1] is centred on col + (w-1)/2 — not col + w/2,
 * which lands half a parcel off and leaves a single-parcel claim visibly beside
 * the crosshair instead of under it. Both the camera and the shader's halo read
 * from here so they cannot drift apart.
 */
function globeClaimCentre(btc) {
  const { w, h } = globeBlockShape(btc);
  const o = globeBlockOrigin(btc);
  if (!w) return { lon: globeLonForCol(GLOBE_HOME_COL), lat: globeLatForRow(GLOBE_HOME_ROW) };
  return {
    lon: globeLonForCol(o.col + (w - 1) / 2),
    lat: globeLatForRow(o.row + (h - 1) / 2),
  };
}

/** Angular radius (radians) of the owned rectangle on the unit sphere. */
function globeBlockAngularRadius(btc) {
  const { w, h } = globeBlockShape(btc);
  if (!w) return 0;
  const perParcel = 2 * Math.PI / GLOBE_PARCEL_COLS;
  return 0.5 * Math.max(w, h) * perParcel;
}

/* ---------------------------------------------------------------- the camera */

/**
 * Tilt is derived from zoom rather than exposed as a control: straight down when
 * the whole globe is in frame (where a tilt would just clip it), leaning over as
 * you descend so the parcels are read in perspective instead of flat-on.
 */
function globeAutoPitch(d) {
  const span = Math.log(GLOBE_D_MAX / GLOBE_D_MIN);
  const t = Math.min(1, Math.max(0, Math.log(GLOBE_D_MAX / d) / span));
  return t * t * 0.8;
}

const globeV = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1],
                    a[2] * b[0] - a[0] * b[2],
                    a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

/**
 * Full camera state for a target lon/lat and distance.
 *
 * `c` is |camPos|^2 - 1, the constant term of the ray-sphere quadratic. It is
 * returned separately because computing it in the shader means subtracting 1
 * from a number barely above 1 — at the bottom of the zoom range that
 * cancellation eats most of the mantissa. Here it is built from the altitude
 * directly, in doubles, and never loses a digit.
 */
function globeCamera(lon, lat, d) {
  const T = globeDir(lon, lat);                    // target, on the unit sphere
  const east = globeV.norm(globeV.cross([0, 1, 0], T));
  const north = globeV.cross(T, east);
  const pitch = globeAutoPitch(d);
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

  // Offset direction: straight up at pitch 0, leaning south as pitch grows.
  const dir = globeV.add(globeV.scale(T, cosP), globeV.scale(north, -sinP));
  const pos = globeV.add(T, globeV.scale(dir, d));

  // alt = |pos| - 1, in the form that avoids sqrt(1+x)-1 cancellation.
  const q = 2 * d * cosP + d * d;                  // = |pos|^2 - 1
  const alt = q / (Math.sqrt(1 + q) + 1);

  const fwd = globeV.scale(dir, -1);               // looking back at the target
  const right = east;                              // always perpendicular to fwd
  const up = globeV.norm(globeV.cross(right, fwd));

  return { pos, fwd, right, up, alt, c: alt * (2 + alt), pitch, target: T };
}

/** Radians subtended by one screen pixel, for sizing the find-me halo. */
function globeRadiansPerPixel(d, viewportHeightPx) {
  return (2 * d * GLOBE_TAN_HALF) / Math.max(1, viewportHeightPx);
}

/** On-screen width of one 0.01 BTC parcel, in pixels. */
function globeParcelPixels(d, viewportHeightPx) {
  const perParcel = 2 * Math.PI / GLOBE_PARCEL_COLS;
  return perParcel / globeRadiansPerPixel(d, viewportHeightPx);
}

/**
 * The halo that makes your land findable. At full zoom-out a single parcel is
 * ~1/50,000th of the globe and would be invisible, so the halo has a floor of a
 * few pixels; once you are close enough that the real thing is bigger, it hugs
 * the actual claim instead of inflating it.
 */
function globeHaloAngle(btc, d, viewportHeightPx) {
  const real = globeBlockAngularRadius(btc);
  const floorAng = 9 * globeRadiansPerPixel(d, viewportHeightPx);
  return Math.max(real, floorAng);
}

/**
 * What one grid square means at the current zoom — drives the HUD caption.
 *
 * The multipliers are the four grids the shader actually draws, a clean x100
 * ladder: parcels (0.01), blocks (1), 10x10 blocks (100), 100x100 blocks
 * (10,000). Each entry's multiplier is that grid's size in parcels, so the
 * caption can never claim a scale the shader is not drawing.
 */
function globeScaleLabel(d, viewportHeightPx) {
  const px = globeParcelPixels(d, viewportHeightPx);
  if (px >= 6) return { unit: PARCEL_BTC, label: 'one square = 0.01 BTC' };
  if (px * 10 >= 6) return { unit: 1, label: 'one square = 1 BTC' };
  if (px * 100 >= 6) return { unit: 100, label: 'one square = 100 BTC' };
  return { unit: 10000, label: 'one square = 10,000 BTC' };
}

function globeEaseInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Zoom must interpolate in log space; linear would spend the whole flight in orbit. */
function globeLerpDistance(d0, d1, t) {
  return Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * t);
}

/** Shortest way round the sphere, so a flight never takes the long way. */
function globeShortestLonDelta(from, to) {
  let delta = (to - from) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/* ============================================================================
 * WebGL layer — nothing below here is covered by tests.html
 * ==========================================================================*/

if (typeof window !== 'undefined' && !window.__LANDBANK_TEST_ONLY__) {

const VERT = `#version 300 es
// One oversized triangle covers the viewport with no vertex buffer at all.
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform vec3  uCamPos;
uniform vec3  uFwd;
uniform vec3  uRight;
uniform vec3  uUp;
uniform float uC;            // |camPos|^2 - 1, built stably on the CPU
uniform vec3  uSun;
uniform vec2  uHomeParcel;   // top-left parcel of the owned rectangle
uniform vec2  uBlockWH;      // owned rectangle, in parcels
uniform float uOwned;        // owned parcel count, may be fractional
uniform float uHalo;         // halo angular radius, radians
uniform vec3  uHomeDir;      // unit vector to the centre of the claim
uniform float uLight;        // 0 = dark theme (night side of space), 1 = light

out vec4 outColor;

const float PI = 3.14159265358979;
const vec2 PARCELS = vec2(50000.0, 42000.0);
const vec2 BLOCKS  = vec2(5000.0, 4200.0);
const vec3 GOLD    = vec3(0.969, 0.576, 0.102);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/*
 * The backdrop. Dark theme is space as it is — near-black with a star field.
 * Light theme cannot be "space, but white": stars are points of light, and on a
 * pale ground they invert into dirt. So the stars are faded out entirely and
 * replaced by a soft vertical wash, which reads as a printed chart of the globe
 * rather than a photograph of it. Same geometry, different medium — exactly the
 * relationship the two page themes have.
 */
vec3 space(vec3 rd) {
  vec2 s = vec2(atan(rd.z, rd.x), asin(clamp(rd.y, -1.0, 1.0)));
  vec3 col = vec3(0.014, 0.020, 0.030);
  for (int i = 0; i < 2; i++) {
    float sc = 190.0 + float(i) * 310.0;
    vec2 cell = floor(s * sc);
    float h = hash21(cell + float(i) * 17.0);
    float star = smoothstep(0.9972, 0.9998, h);
    col += vec3(star) * (0.75 - float(i) * 0.32);
  }
  vec3 paper = mix(vec3(0.760, 0.816, 0.874), vec3(0.879, 0.910, 0.945),
                   clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  return mix(col, paper, uLight);
}

/*
 * Antialiased grid. "n" is the number of divisions, needed for the seam guard:
 * longitude wraps at the antimeridian and collapses at the poles, and at those
 * pixels the screen-space derivative jumps to the full range of the coordinate.
 * Left alone that draws a bright false line, so the axis is dropped instead.
 */
float gridMask(vec2 uv, vec2 n, out float cellPx) {
  vec2 coord = uv * n;
  vec2 w = fwidth(coord);
  cellPx = 1.0 / max(max(w.x, w.y), 1e-8);
  vec2 a = abs(fract(coord - 0.5) - 0.5) / max(w, vec2(1e-8));
  if (w.x > n.x * 0.1) a.x = 1e9;
  if (w.y > n.y * 0.1) a.y = 1e9;
  return 1.0 - clamp(min(a.x, a.y), 0.0, 1.0);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uFwd + uRight * (ndc.x * aspect * ${GLOBE_TAN_HALF.toFixed(8)})
                           + uUp    * (ndc.y * ${GLOBE_TAN_HALF.toFixed(8)}));

  float b = dot(rd, uCamPos);
  float disc = b * b - uC;
  vec3 col;

  if (b < 0.0 && disc > 0.0) {
    // Stable near root: the -b-sqrt(disc) form cancels catastrophically once the
    // camera is close to the surface, which is exactly where we spend the zoom.
    float t = uC / (-b + sqrt(disc));
    vec3 P = uCamPos + rd * t;
    vec3 N = normalize(P);

    float lat = asin(clamp(N.y, -1.0, 1.0));
    float lon = atan(N.z, N.x);
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);

    float cpxP, cpxB, cpxM, cpxR;
    float gP = gridMask(uv, PARCELS, cpxP);         // 0.01 BTC
    float gB = gridMask(uv, BLOCKS, cpxB);          // 1 BTC
    float gM = gridMask(uv, BLOCKS / 10.0, cpxM);   // 100 BTC
    float gR = gridMask(uv, BLOCKS / 100.0, cpxR);  // 10,000 BTC regions

    float ndl = max(dot(N, uSun), 0.0);
    float shade = 0.12 + 0.88 * ndl;
    col = mix(mix(vec3(0.031, 0.043, 0.059), vec3(0.086, 0.121, 0.157), ndl),
              mix(vec3(0.360, 0.436, 0.516), vec3(0.588, 0.665, 0.739), ndl),
              uLight);

    // Finer grids fade out as their cells approach pixel size, so the sphere
    // never dissolves into moire.
    //
    // The grid is drawn as ADDED light on slate and as REMOVED light on paper.
    // Adding a pale blue to an already-pale sphere yields nothing visible, so
    // the same mask has to be signed by the theme: gridSign flips it, and
    // gridInk keeps the ruled lines a touch warm so they read as ink.
    // (No backticks in here — this whole shader is a JS template literal.)
    float gridSign = mix(1.0, -1.0, uLight);
    vec3  gridInk  = mix(vec3(1.0), vec3(0.62, 0.60, 0.55), uLight);
    col += gridSign * gridInk * vec3(0.13, 0.20, 0.26) * gR * 0.85 * shade;
    col += gridSign * gridInk * vec3(0.14, 0.22, 0.29) * gM * smoothstep(2.0, 7.0, cpxM) * shade;
    col += gridSign * gridInk * vec3(0.15, 0.24, 0.31) * gB * smoothstep(2.0, 7.0, cpxB) * shade;
    col += gridSign * gridInk * vec3(0.11, 0.18, 0.24) * gP * smoothstep(2.5, 8.0, cpxP) * shade;

    // Your claim.
    vec2 d = floor(uv * PARCELS) - uHomeParcel;
    float lit = 0.0;
    if (uOwned > 0.0 && d.x >= 0.0 && d.y >= 0.0 && d.x < uBlockWH.x && d.y < uBlockWH.y) {
      float idx = d.y * uBlockWH.x + d.x;
      float whole = floor(uOwned);
      if (idx < whole)      lit = 1.0;
      else if (idx < uOwned) lit = uOwned - whole;   // the part-owned parcel
    }
    // Below ~2px a parcel cannot be drawn honestly; the halo carries it instead.
    lit *= smoothstep(1.5, 4.0, cpxP);

    // On slate the claim is lit land, so it is mixed in and then glowed on top.
    // On paper an additive glow only washes it toward white and kills the hue,
    // so there the gold is laid down as ink at close to full strength instead.
    col = mix(col, GOLD * (0.45 + 0.55 * shade), lit * 0.9);
    col += GOLD * lit * 0.35 * (1.0 - uLight);
    col = mix(col, mix(col, GOLD * (0.72 + 0.28 * shade), lit), uLight);

    // Etch the parcel divisions back into the claim, so a 1 BTC block reads as
    // the 100 parcels it is made of rather than as one flat gold slab.
    col = mix(col, col * 0.68, gP * smoothstep(2.5, 8.0, cpxP) * lit);

    // smoothstep is undefined when edge0 >= edge1, and uHalo is exactly 0 with an
    // empty ledger — which would push NaN straight into the output colour and
    // blow out the whole globe. Guard rather than rely on a driver being kind.
    if (uHalo > 0.0) {
      // Chord, NOT acos(dot). Near the claim the dot product sits at ~1.0, where
      // one float32 ulp (6e-8) turns into ~3.5e-4 rad of angle — five times wider
      // than the halo being drawn, so acos quantises into visible slabs. The
      // chord |N - home| stays accurate to ~1e-7 and equals the angle to within
      // 0.04% over every radius this halo ever takes.
      float ang = length(N - uHomeDir);
      float halo = 1.0 - smoothstep(uHalo * 0.3, uHalo, ang);
      // The halo exists to find land that is too small to see. Once the parcels
      // themselves are resolvable it has done its job, and holding it at full
      // strength would only wash out the very squares it led you to.
      float haloAmt = halo * halo * 0.75 * (1.0 - smoothstep(2.0, 8.0, cpxP));
      // Additive on slate; a darkening wash of the same hue on paper.
      col += GOLD * haloAmt * (1.0 - uLight);
      col = mix(col, mix(col, GOLD * 0.85, clamp(haloAmt, 0.0, 1.0)), uLight);
    }

    // Atmosphere. Bright against space; on paper it would only fog the edge, so
    // it fades to a thin darker-blue edge that keeps the sphere's silhouette.
    float rim = pow(1.0 - max(dot(N, -rd), 0.0), 3.0);
    col += vec3(0.16, 0.34, 0.62) * rim * 0.65 * (1.0 - uLight);
    col = mix(col, mix(col, vec3(0.20, 0.30, 0.44), clamp(rim * 1.15, 0.0, 1.0)), uLight);
  } else {
    col = space(rd);
  }

  outColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);
}
`;

const G = {
  supported: false,
  gl: null,
  canvas: null,
  prog: null,
  uni: {},
  // Start with home well onto the visible face rather than out at the limb,
  // where foreshortening squashes the mark into the edge — but off-centre, so
  // the globe still invites a spin.
  lon: globeLonForCol(GLOBE_HOME_COL) + 0.35,
  lat: 0.3,
  d: GLOBE_D_MAX,
  btc: 0,
  raf: 0,
  flight: null,
  idle: 0,
  dragging: false,
  reduced: false,
  light: 0,          // uLight: 0 dark, 1 light. Set by setTheme().
};

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`${label} shader: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function fail(msg) {
  // A failed globe must say so, but only once the user has actually asked for
  // the globe — the board is the default view and needs no apology from here.
  // Revealing the flat map is the view toggle's job, keyed off isSupported().
  G.supported = false;
  G.failMessage = msg;
  const stage = document.querySelector('#globe-stage');
  const ctr = document.querySelector('#globe-controls');
  if (stage) stage.hidden = true;
  if (ctr) ctr.hidden = true;
  console.warn('landbank globe:', msg);
}

function initGL() {
  const canvas = document.querySelector('#globe-canvas');
  if (!canvas) return;
  G.canvas = canvas;

  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: false, depth: false, powerPreference: 'low-power',
  });
  if (!gl) {
    fail('This browser has no WebGL2, so the 3D globe cannot run. Showing the flat map instead.');
    return;
  }
  G.gl = gl;

  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
    }
    G.prog = prog;
  } catch (e) {
    fail(`The 3D globe failed to build (${e.message}). Showing the flat map instead.`);
    return;
  }

  gl.useProgram(G.prog);
  ['uRes', 'uCamPos', 'uFwd', 'uRight', 'uUp', 'uC', 'uSun',
   'uHomeParcel', 'uBlockWH', 'uOwned', 'uHalo', 'uHomeDir', 'uLight']
    .forEach((n) => { G.uni[n] = gl.getUniformLocation(G.prog, n); });

  G.vao = gl.createVertexArray();          // WebGL2 requires a bound VAO to draw
  gl.bindVertexArray(G.vao);

  G.supported = true;
  G.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  resize();
  window.addEventListener('resize', resize);
  attachControls(canvas);
  loop();
}

function resize() {
  if (!G.canvas || !G.gl) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(G.canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(G.canvas.clientHeight * dpr));
  if (G.canvas.width !== w || G.canvas.height !== h) {
    G.canvas.width = w;
    G.canvas.height = h;
    G.gl.viewport(0, 0, w, h);
  }
}

function viewportHeightPx() {
  return (G.canvas && G.canvas.clientHeight) || 480;
}

function draw() {
  const gl = G.gl;
  if (!gl || !G.supported) return;

  const cam = globeCamera(G.lon, G.lat, G.d);
  const shape = globeBlockShape(G.btc);
  const origin = globeBlockOrigin(G.btc);
  const vh = viewportHeightPx();

  const centre = globeClaimCentre(G.btc);
  const homeDir = globeDir(centre.lon, centre.lat);

  gl.useProgram(G.prog);
  gl.uniform2f(G.uni.uRes, G.canvas.width, G.canvas.height);
  gl.uniform3fv(G.uni.uCamPos, cam.pos);
  gl.uniform3fv(G.uni.uFwd, cam.fwd);
  gl.uniform3fv(G.uni.uRight, cam.right);
  gl.uniform3fv(G.uni.uUp, cam.up);
  gl.uniform1f(G.uni.uC, cam.c);
  gl.uniform3fv(G.uni.uSun, globeV.norm([0.55, 0.42, 0.72]));
  gl.uniform2f(G.uni.uHomeParcel, origin.col, origin.row);
  gl.uniform2f(G.uni.uBlockWH, shape.w, shape.h);
  gl.uniform1f(G.uni.uOwned, shape.n);
  gl.uniform1f(G.uni.uHalo, shape.n ? globeHaloAngle(G.btc, G.d, vh) : 0);
  gl.uniform3fv(G.uni.uHomeDir, homeDir);
  gl.uniform1f(G.uni.uLight, G.light);

  gl.drawArrays(gl.TRIANGLES, 0, 3);
  updateHud();
}

let hudLast = '';
function updateHud() {
  const hud = document.querySelector('#globe-hud');
  if (!hud) return;
  const { label } = globeScaleLabel(G.d, viewportHeightPx());
  const near = globeParcelPixels(G.d, viewportHeightPx()) >= 6;
  const text = G.btc > 0
    ? `${label} · ${near ? 'your parcels are the lit squares'
                         : 'the gold mark is your land — keep zooming'}`
    : `${label} · 21,000,000 blocks, none of them yours yet`;
  // Writing this every frame would be 60 layout invalidations a second for text
  // that changes a handful of times per flight.
  if (text !== hudLast) { hud.textContent = text; hudLast = text; }
}

function loop() {
  G.raf = requestAnimationFrame(loop);

  if (G.flight) {
    const f = G.flight;
    const t = Math.min(1, (performance.now() - f.t0) / f.dur);
    const e = globeEaseInOut(t);
    G.lon = f.lon0 + f.dLon * e;
    G.lat = f.lat0 + (f.lat1 - f.lat0) * e;
    G.d = globeLerpDistance(f.d0, f.d1, e);
    if (t >= 1) {
      G.flight = null;
      const btn = document.querySelector('#globe-fly');
      if (btn) btn.textContent = 'Fly to my land';
      const found = document.querySelector('#globe-found');
      if (found && G.btc > 0) found.hidden = false;
    }
  } else if (!G.dragging && !G.reduced && G.d > GLOBE_D_MAX * 0.6) {
    G.lon += 0.0006;                       // idle drift, only while in orbit
  }

  // A static globe should not keep the GPU busy. Redraw only when the view or the
  // ledger actually moved, or when the canvas was resized under us.
  const sig = `${G.lon}|${G.lat}|${G.d}|${G.btc}|${G.light}|${G.canvas.width}x${G.canvas.height}`;
  if (sig !== G.sig) { G.sig = sig; draw(); }
}

/* -------------------------------------------------------------- interaction */

function attachControls(canvas) {
  let px = 0, py = 0, pid = null;
  const pointers = new Map();
  let pinchDist = 0;

  const stopFlight = () => {
    if (!G.flight) return;
    G.flight = null;
    const btn = document.querySelector('#globe-fly');
    if (btn) btn.textContent = 'Fly to my land';
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) { pid = e.pointerId; px = e.clientX; py = e.clientY; G.dragging = true; }
    stopFlight();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist) zoomBy(Math.log(pinchDist / dist) * 1.6);
      pinchDist = dist;
      return;
    }
    if (e.pointerId !== pid) return;

    // Drag maps screen fraction to arc, so the surface tracks the finger at
    // every zoom instead of flying off when you are close.
    const h = canvas.clientHeight || 1;
    const arc = 2 * G.d * GLOBE_TAN_HALF;
    const dx = (e.clientX - px) / h, dy = (e.clientY - py) / h;
    px = e.clientX; py = e.clientY;

    G.lat = Math.max(-GLOBE_LAT_LIMIT, Math.min(GLOBE_LAT_LIMIT, G.lat + dy * arc));
    G.lon -= dx * arc / Math.max(0.15, Math.cos(G.lat));
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) { G.dragging = false; pid = null; }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopFlight();
    zoomBy(e.deltaY * 0.0016);
  }, { passive: false });

  // Keyboard, so the globe is reachable without a pointer.
  canvas.addEventListener('keydown', (e) => {
    const step = 2 * G.d * GLOBE_TAN_HALF * 0.35;
    const keys = {
      ArrowLeft: () => { G.lon -= step / Math.max(0.15, Math.cos(G.lat)); },
      ArrowRight: () => { G.lon += step / Math.max(0.15, Math.cos(G.lat)); },
      ArrowUp: () => { G.lat = Math.min(GLOBE_LAT_LIMIT, G.lat + step); },
      ArrowDown: () => { G.lat = Math.max(-GLOBE_LAT_LIMIT, G.lat - step); },
      '+': () => zoomBy(-0.3), '=': () => zoomBy(-0.3), '-': () => zoomBy(0.3),
    };
    if (keys[e.key]) { e.preventDefault(); stopFlight(); keys[e.key](); }
  });
}

function zoomBy(amount) {
  G.d = Math.min(GLOBE_D_MAX, Math.max(GLOBE_D_MIN, G.d * Math.exp(amount)));
}

function flyToLand() {
  if (!G.supported) return;
  if (G.btc <= 0) {
    const found = document.querySelector('#globe-found');
    if (found) found.hidden = true;
    return false;
  }
  const { lon: lon1, lat: lat1 } = globeClaimCentre(G.btc);

  const found = document.querySelector('#globe-found');
  if (found) found.hidden = true;

  if (G.reduced) {
    G.lon = lon1; G.lat = lat1; G.d = GLOBE_D_MIN;
    if (found) found.hidden = false;
    return true;
  }

  G.flight = {
    t0: performance.now(), dur: 4200,
    lon0: G.lon, dLon: globeShortestLonDelta(G.lon, lon1),
    lat0: G.lat, lat1,
    d0: G.d, d1: GLOBE_D_MIN,
  };
  const btn = document.querySelector('#globe-fly');
  if (btn) btn.textContent = 'Flying…';
  return true;
}

function resetView() {
  G.flight = {
    t0: performance.now(), dur: 1600,
    lon0: G.lon, dLon: 0, lat0: G.lat, lat1: 0.35,
    d0: G.d, d1: GLOBE_D_MAX,
  };
  const found = document.querySelector('#globe-found');
  if (found) found.hidden = true;
}

window.Globe = {
  isSupported: () => G.supported,
  failMessage: () => G.failMessage || '',
  /**
   * The globe starts inside a hidden container, so its canvas measures 0x0 and
   * the backing store is sized to nothing. Revealing it has to re-measure, or
   * the first frame after a switch is a one-pixel smear.
   */
  onShow() {
    if (!G.supported) return;
    resize();
    G.sig = '';
  },
  /**
   * Follow the page theme. Safe to call before the GL context exists — the value
   * is stored and uploaded on the next frame like any other uniform.
   */
  setTheme(theme) {
    G.light = theme === 'light' ? 1 : 0;
    G.sig = '';                 // the frame signature must change or nothing redraws
  },
  setHoldings(btc) {
    G.btc = Number(btc) || 0;
    if (G.btc <= 0) {
      const found = document.querySelector('#globe-found');
      if (found) found.hidden = true;
    }
  },
  flyToLand,
  resetView,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGL);
} else {
  initGL();
}

}
