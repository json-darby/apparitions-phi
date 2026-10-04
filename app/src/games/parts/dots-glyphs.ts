// Things drawn from dots, in code. Each glyph is a list of dots in a box from
// -1 to 1 (y down). Pixi (dots-pixi.ts) and SVG (dots-svg.tsx) both draw from
// these lists, so a mango on the field and a mango on a button match.
// Used by Night Market and Heat Check; nothing here is generated or copied.

export interface DotPt {
  x: number;
  y: number;
  /** radius in box units */
  r: number;
  /** colour as 0xRRGGBB */
  c: number;
  /** alpha 0..1, default 1 */
  a?: number;
}

/** Small seeded random so a glyph looks the same every time it is drawn. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

/** Fill a region on a jittered hex grid. colour returns null outside the shape. */
function fill(out: DotPt[], rand: () => number, step: number, r: number, colour: (x: number, y: number) => number | null, box = 1) {
  const h = step * 0.866;
  let row = 0;
  for (let y = -box; y <= box; y += h, row++) {
    for (let x = -box + (row % 2 ? step / 2 : 0); x <= box; x += step) {
      const jx = x + (rand() - 0.5) * step * 0.35;
      const jy = y + (rand() - 0.5) * step * 0.35;
      const c = colour(jx, jy);
      if (c == null) continue;
      out.push({ x: jx, y: jy, r: r * (0.75 + rand() * 0.5), c, a: 0.75 + rand() * 0.25 });
    }
  }
}

/** Dots along a polyline or curve given as a function of t in 0..1. */
function trace(out: DotPt[], n: number, r: number, c: number, at: (t: number) => [number, number], a = 1) {
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i / Math.max(1, n - 1));
    out.push({ x, y, r, c, a });
  }
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, rot = 0) => {
  const dx = x - cx, dy = y - cy;
  const cs = Math.cos(-rot), sn = Math.sin(-rot);
  const u = dx * cs - dy * sn, v = dx * sn + dy * cs;
  return (u * u) / (rx * rx) + (v * v) / (ry * ry);
};

// ---------- colours ----------

export const COL = {
  amber: 0xffb03a,
  orange: 0xff8a2a,
  yellow: 0xffd84a,
  green: 0x5fd36a,
  leaf: 0x3fbf5a,
  red: 0xff4a5a,
  chili: 0xff5a3c,
  white: 0xf2f2f2,
  pale: 0xd8d2c4,
  brown: 0xb07a46,
  blue: 0x2e9bff,
  cyan: 0x2ee6e6,
  pink: 0xff3c96,
};

// ---------- fruit ----------

function orange(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    const d = Math.hypot(x, y - 0.08) / 0.8;
    if (d > 1) return null;
    return mix(0xffc070, COL.orange, Math.min(1, d * 0.6 + (x + y) * 0.25 + 0.3));
  });
  fill(out, rand, step * 0.8, r * 0.85, (x, y) => (inEllipse(x, y, 0.22, -0.82, 0.26, 0.11, -0.5) <= 1 ? COL.leaf : null));
  return out;
}

function banana(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  const cx = 0.05, cy = -0.75, R = 1.15;
  fill(out, rand, step, r, (x, y) => {
    const ang = Math.atan2(y - cy, x - cx);
    if (ang < 0.45 || ang > Math.PI - 0.45) return null;
    const t = (ang - 0.45) / (Math.PI - 0.9); // 0..1 along the fruit
    const thick = 0.08 + 0.26 * Math.sin(Math.PI * t);
    const d = Math.hypot(x - cx, y - cy);
    if (Math.abs(d - R) > thick) return null;
    if (t < 0.06 || t > 0.94) return COL.brown;
    return mix(COL.yellow, 0xfff2a0, (R - d) / thick * 0.5 + 0.2);
  });
  return out;
}

function mango(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    const e = inEllipse(x, y, 0, 0.02, 0.62, 0.86, -0.5);
    if (e > 1) return null;
    return mix(COL.amber, 0x9fd84a, (x - y) * 0.45 + 0.2);
  });
  return out;
}

function watermelon(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  const cy = -0.3, R = 0.95;
  fill(out, rand, step, r, (x, y) => {
    if (y < cy) return null;
    const d = Math.hypot(x, y - cy);
    if (d > R) return null;
    if (d > R - 0.12) return 0x2fb34a;
    if (d > R - 0.2) return 0xd9f2b0;
    return mix(0xff6070, COL.red, d);
  });
  // seeds
  const rs = seeded(7);
  for (let i = 0; i < 7; i++) {
    const ang = 0.35 + (i / 6) * (Math.PI - 0.7);
    const d = 0.38 + rs() * 0.22;
    out.push({ x: Math.cos(ang) * d, y: cy + Math.sin(ang) * d, r: r * 1.1, c: 0x2a1012, a: 1 });
  }
  return out;
}

function coconut(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    const d = Math.hypot(x, y - 0.1) / 0.82;
    if (d > 1) return null;
    if (y < -0.42) return 0xeae6d0; // cut top
    return mix(0x8fe070, 0x3f9a4a, d);
  });
  return out;
}

// ---------- drinks ----------

export type Container = 'bottle' | 'glass' | 'plate' | 'none';

function bottle(step: number, r: number, rand: () => number, liquid: number): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    const ax = Math.abs(x);
    if (y > 0.92 || y < -0.95) return null;
    let w: number;
    if (y > -0.2) w = 0.36;
    else if (y > -0.5) w = 0.13 + (0.23 * (y + 0.5)) / 0.3;
    else w = 0.13;
    if (ax > w) return null;
    if (y < -0.82) return COL.pale; // cap
    if (ax > w - 0.07) return mix(liquid, 0xffffff, 0.45);
    return liquid;
  });
  // label band
  fill(out, rand, step * 0.9, r * 0.8, (x, y) => (Math.abs(x) < 0.3 && y > 0.12 && y < 0.42 ? COL.white : null));
  return out;
}

function glass(step: number, r: number, rand: () => number, liquid: number, foam: boolean): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    if (y < -0.7 || y > 0.88) return null;
    const t = (y + 0.7) / 1.58;
    const w = 0.52 - 0.14 * t;
    const ax = Math.abs(x);
    if (ax > w) return null;
    if (ax > w - 0.07 || y > 0.8) return 0xcfe4ef;
    if (y < -0.42) return foam ? COL.white : null;
    return liquid;
  });
  return out;
}

// ---------- dishes ----------

function plate(out: DotPt[], step: number, r: number, rand: () => number) {
  fill(out, rand, step, r * 0.9, (x, y) => {
    const e = inEllipse(x, y, 0, 0.55, 0.98, 0.3);
    if (e > 1) return null;
    return e > 0.6 ? COL.pale : null;
  });
}

function friedRice(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  plate(out, step, r, rand);
  const rs = seeded(11);
  fill(out, rand, step * 0.85, r * 0.9, (x, y) => {
    const e = inEllipse(x, y, 0, 0.32, 0.7, 0.48);
    if (e > 1 || y > 0.58) return null;
    const k = rs();
    if (k < 0.08) return COL.green;
    if (k < 0.14) return COL.pink;
    return mix(0xffe0a0, COL.amber, e);
  });
  return out;
}

function padThai(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  plate(out, step, r, rand);
  for (let k = 0; k < 6; k++) {
    const y0 = 0.05 + k * 0.08;
    trace(out, 26, r * 0.95, mix(0xffd59a, COL.amber, k / 6), (t) => [-0.62 + t * 1.24, y0 + Math.sin(t * 9 + k) * 0.07]);
  }
  const rs = seeded(5);
  for (let i = 0; i < 8; i++) out.push({ x: -0.5 + rs(), y: 0 + rs() * 0.4, r: r * 1.1, c: COL.green });
  out.push({ x: 0.55, y: 0.2, r: r * 2.4, c: 0xd8f070 }); // lime
  return out;
}

function papayaSalad(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  plate(out, step, r, rand);
  const rs = seeded(9);
  for (let k = 0; k < 9; k++) {
    const x0 = -0.55 + rs() * 0.9;
    const y0 = 0.05 + rs() * 0.4;
    const ang = (rs() - 0.5) * 1.2;
    trace(out, 9, r * 0.9, mix(0xc8f08a, 0x8fd060, rs()), (t) => [x0 + Math.cos(ang) * t * 0.45, y0 + Math.sin(ang) * t * 0.45]);
  }
  for (let i = 0; i < 4; i++) out.push({ x: -0.45 + rs() * 0.9, y: 0.1 + rs() * 0.3, r: r * 2.2, c: COL.red });
  return out;
}

function tomYum(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    // bowl: lower half of an ellipse, with a rim
    if (y < 0 || y > 0.8) return null;
    const e = inEllipse(x, y, 0, 0, 0.92, 0.8);
    if (e > 1) return null;
    if (y < 0.1) return mix(COL.chili, COL.amber, Math.abs(x)); // broth surface
    return e > 0.75 ? COL.pale : null;
  });
  const rs = seeded(13);
  for (let i = 0; i < 5; i++) out.push({ x: -0.6 + rs() * 1.2, y: 0.03 + rs() * 0.05, r: r * 1.6, c: COL.green });
  return out;
}

function rice(step: number, r: number, rand: () => number): DotPt[] {
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    if (y < 0 || y > 0.8) return null;
    const e = inEllipse(x, y, 0, 0, 0.85, 0.8);
    if (e > 1) return null;
    return e > 0.72 ? COL.blue : null;
  });
  fill(out, rand, step * 0.85, r * 0.9, (x, y) => {
    const e = inEllipse(x, y, 0, 0.02, 0.62, 0.42);
    return e <= 1 && y < 0.1 ? COL.white : null;
  });
  return out;
}

// ---------- people ----------

/** A diner as a dot apparition: head and shoulders, no face. */
export function dinerDots(step = 0.09, r = 0.03, seed = 1): DotPt[] {
  const rand = seeded(seed);
  const out: DotPt[] = [];
  fill(out, rand, step, r, (x, y) => {
    if (inEllipse(x, y, 0, -0.38, 0.34, 0.42) <= 1) return COL.white;
    if (y > 0.18 && inEllipse(x, y, 0, 0.95, 0.85, 0.75) <= 1) return COL.white;
    return null;
  });
  return out;
}

// ---------- registry ----------

/** Item ids that have a glyph, and what they look like. */
export const GLYPH_IDS = [
  'orange', 'banana', 'mango', 'watermelon', 'coconut',
  'beer', 'water', 'coffee',
  'fried-rice', 'pad-thai', 'papaya-salad', 'tom-yum', 'rice',
] as const;
export type GlyphId = (typeof GLYPH_IDS)[number];
export const isGlyphId = (id: string): id is GlyphId => (GLYPH_IDS as readonly string[]).includes(id);

/** The container an item shows in by default. */
export const DEFAULT_CONTAINER: Record<GlyphId, Container> = {
  orange: 'none', banana: 'none', mango: 'none', watermelon: 'none', coconut: 'none',
  beer: 'bottle', water: 'bottle', coffee: 'glass',
  'fried-rice': 'plate', 'pad-thai': 'plate', 'papaya-salad': 'plate', 'tom-yum': 'none', rice: 'none',
};

/** Classifier item id for a container, and back. */
export const CONTAINER_CLASSIFIER: Partial<Record<Container, string>> = { bottle: 'cl-bottle', glass: 'cl-glass', plate: 'cl-plate' };

/** Main colour of each glyph, for bursts and rings. */
export const GLYPH_COLOUR: Record<GlyphId, number> = {
  orange: COL.orange, banana: COL.yellow, mango: COL.amber, watermelon: COL.red, coconut: COL.green,
  beer: COL.amber, water: COL.cyan, coffee: COL.brown,
  'fried-rice': COL.amber, 'pad-thai': COL.amber, 'papaya-salad': COL.green, 'tom-yum': COL.chili, rice: COL.white,
};

const LIQUID: Record<string, number> = { beer: 0xffb03a, water: 0x7fe8ff, coffee: 0xc0844a };

const cache = new Map<string, DotPt[]>();

/**
 * Dots for one item in a container. density 1 is full detail; reduced motion
 * and small sizes pass less.
 */
export function glyphDots(id: GlyphId, container: Container = DEFAULT_CONTAINER[id], density = 1): DotPt[] {
  const key = `${id}|${container}|${density}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const step = 0.085 / Math.sqrt(density);
  const r = 0.034 / Math.sqrt(Math.max(0.6, density));
  const rand = seeded(hash(key));
  let out: DotPt[];
  switch (id) {
    case 'orange': out = orange(step, r, rand); break;
    case 'banana': out = banana(step, r, rand); break;
    case 'mango': out = mango(step, r, rand); break;
    case 'watermelon': out = watermelon(step, r, rand); break;
    case 'coconut': out = coconut(step, r, rand); break;
    case 'beer':
    case 'water':
    case 'coffee':
      out = container === 'glass' ? glass(step, r, rand, LIQUID[id], id === 'beer') : bottle(step, r, rand, LIQUID[id]);
      break;
    case 'fried-rice': out = friedRice(step, r, rand); break;
    case 'pad-thai': out = padThai(step, r, rand); break;
    case 'papaya-salad': out = papayaSalad(step, r, rand); break;
    case 'tom-yum': out = tomYum(step, r, rand); break;
    case 'rice': out = rice(step, r, rand); break;
  }
  cache.set(key, out);
  return out;
}

/** n copies of a glyph arranged as a small cluster, still inside -1..1. */
export function clusterDots(dots: DotPt[], n: number): DotPt[] {
  if (n <= 1) return dots;
  const layouts: Record<number, [number, number][]> = {
    2: [[-0.48, 0.05], [0.48, -0.05]],
    3: [[-0.5, 0.3], [0.5, 0.3], [0, -0.42]],
    4: [[-0.48, -0.45], [0.48, -0.45], [-0.48, 0.45], [0.48, 0.45]],
    5: [[-0.55, -0.5], [0.55, -0.5], [0, 0], [-0.55, 0.5], [0.55, 0.5]],
    6: [[-0.6, -0.45], [0, -0.45], [0.6, -0.45], [-0.6, 0.45], [0, 0.45], [0.6, 0.45]],
  };
  const pos = layouts[Math.min(6, n)];
  const s = n === 2 ? 0.5 : n <= 4 ? 0.46 : 0.36;
  const out: DotPt[] = [];
  for (const [ox, oy] of pos) for (const d of dots) out.push({ ...d, x: ox + d.x * s, y: oy + d.y * s, r: d.r * Math.max(0.7, s * 1.5) });
  return out;
}

/** Chili meter: three dots, lit by heat level 0 to 3. */
export function chiliDots(level: number): DotPt[] {
  return [0, 1, 2].map((i) => ({ x: -0.6 + i * 0.6, y: 0, r: 0.2, c: i < level ? COL.chili : 0x5e5e5e, a: i < level ? 1 : 0.6 }));
}
