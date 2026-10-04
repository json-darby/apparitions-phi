// Pure helpers for the dot renderer: no DOM, no GL. Everything here is unit
// tested in src/anim/core.test.ts.

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Deterministic 0..1 from a number. */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Deterministic 0..1 from a string (FNV-1a). */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "#2E9BFF" / "#fff" / "rgb(1,2,3)" to 0..1 floats. Unknown strings give the default blue. */
export function hexToRgb(c: string | undefined | null): [number, number, number] {
  const blue: [number, number, number] = [0.18, 0.61, 1];
  if (!c) return blue;
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16) / 255) as [number, number, number];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const h = m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (r) return [+r[1] / 255, +r[2] / 255, +r[3] / 255];
  return blue;
}

// ---- voice tear ----

/** Linear sample of a 0..1 pitch curve at u in 0..1. Empty curve gives 0.5. */
export function samplePitch(pitch: readonly number[] | null | undefined, u: number): number {
  if (!pitch || pitch.length === 0) return 0.5;
  if (pitch.length === 1) return clamp(pitch[0]);
  const x = clamp(u) * (pitch.length - 1);
  const i = Math.floor(x);
  const j = Math.min(pitch.length - 1, i + 1);
  return clamp(lerp(pitch[i], pitch[j], x - i));
}

/** Seconds a pitch curve takes to sweep: 16 samples per syllable, ~0.42 s each. */
export function voiceDuration(pitch: readonly number[] | null | undefined): number {
  const n = pitch?.length ?? 16;
  return Math.max(0.6, (n / 16) * 0.42 + 0.2);
}

/**
 * Where the voice band sits at time t (s) of a sweep: y in face units (-1 bottom
 * .. 1 top) and amplitude. A rising tone sweeps upward through the face.
 */
export function voiceBand(pitch: readonly number[] | null | undefined, t: number): { y: number; amp: number } {
  const dur = voiceDuration(pitch);
  if (t < 0 || t > dur + 0.25) return { y: 0, amp: 0 };
  const u = clamp(t / dur);
  const p = samplePitch(pitch, u);
  const env = smooth(0, 0.08, t) * (1 - smooth(dur, dur + 0.25, t));
  return { y: lerp(-0.75, 0.75, p), amp: env };
}

// ---- density and budgets ----

export interface DensityOpts {
  /** CSS px between dots */
  pitch: number;
  nMin: number;
  nMax: number;
  /** total points per frame across all live canvases */
  budget: number;
}

export const DENSITY_DESKTOP: DensityOpts = { pitch: 3.3, nMin: 48, nMax: 230, budget: 230_000 };
export const DENSITY_PHONE: DensityOpts = { pitch: 4.3, nMin: 40, nMax: 140, budget: 70_000 };

/** Dots along the short side for a canvas this many CSS px across. */
export function gridSize(cssSide: number, o: DensityOpts, scale = 1): number {
  const n = Math.round((cssSide / o.pitch) * scale);
  return Math.max(o.nMin, Math.min(Math.round(o.nMax * Math.min(1, scale + 0.15)), n));
}

/**
 * Grid sizes per canvas that fit the shared point budget. Each entry is the
 * short-side CSS size and the aspect (long/short) of a canvas; returns N for
 * the short side. Shrinks everyone evenly when over budget.
 */
export function allocateGrids(canvases: { side: number; aspect: number }[], o: DensityOpts, scale = 1): number[] {
  const ns = canvases.map((c) => gridSize(c.side, o, scale));
  const total = ns.reduce((s, n, i) => s + n * n * canvases[i].aspect, 0);
  if (total <= o.budget) return ns;
  const k = Math.sqrt(o.budget / total);
  return ns.map((n) => Math.max(24, Math.floor(n * k)));
}

/**
 * Screen scale (sx, sy) so content with aspect `content` (width/height) sits in
 * a view with aspect `view`. Content spans x in [-content, content], y in [-1, 1].
 */
export function fitScale(view: number, content: number, mode: 'contain' | 'cover'): [number, number] {
  let sx = 1 / view;
  let sy = 1;
  const widthFrac = content / view; // fraction of view width the content takes at sy = 1
  if (mode === 'contain' && widthFrac > 1) {
    sx /= widthFrac;
    sy /= widthFrac;
  } else if (mode === 'cover' && widthFrac < 1) {
    sx /= widthFrac;
    sy /= widthFrac;
  }
  return [sx, sy];
}

// ---- quality monitor (weak device detection) ----

export type QualityLevel = 0 | 1 | 2; // 0 still, 1 light, 2 full

/**
 * Collects frame intervals while something animates. After `window` usable
 * samples, if the median frame takes longer than `slowMs`, it asks to step
 * quality down one level. Gaps over 250 ms (tab switches, hitches) are ignored.
 */
export class QualityMonitor {
  private samples: number[] = [];
  constructor(
    private window = 75,
    private slowMs = 1000 / 24,
    private skip = 20,
  ) {}
  reset() {
    this.samples = [];
    this.skipped = 0;
  }
  private skipped = 0;
  /** Returns true when quality should drop. */
  push(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > 250) return false;
    if (this.skipped < this.skip) {
      this.skipped++;
      return false;
    }
    this.samples.push(dtMs);
    if (this.samples.length < this.window) return false;
    const m = median(this.samples);
    this.samples = [];
    return m > this.slowMs;
  }
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

// ---- blink and idle ----

/** 0 open .. 1 closed. Blinks every 2.6 to 5.4 s, seeded per person. */
export function blinkAmount(t: number, seed: number): number {
  let start = 0.8 + seed * 2;
  let k = 0;
  while (start < t - 0.3) {
    start += 2.6 + 2.8 * hash1(seed * 97 + k++);
    if (k > 10000) break;
  }
  const u = t - start;
  if (u < 0 || u > 0.24) return 0;
  return u < 0.08 ? u / 0.08 : 1 - (u - 0.08) / 0.16;
}

// ---- layouts ----

/** Spread n small faces over a view with aspect w/h. Returns centres in [-aspect..aspect] x [-1..1]. */
export function constellationLayout(n: number, aspect: number, seed = 0.37): { x: number; y: number }[] {
  if (n <= 0) return [];
  const r = rng(seed);
  const out: { x: number; y: number }[] = [];
  const ax = Math.max(0.6, aspect) * 0.78;
  const ay = 0.72;
  const minD = Math.min(0.9, 1.9 / Math.sqrt(n + 1));
  for (let i = 0; i < n; i++) {
    let best = { x: 0, y: 0 };
    let bestD = -1;
    for (let k = 0; k < 40; k++) {
      // a loose ellipse walk keeps the order readable as a path
      const a = (i / Math.max(1, n)) * Math.PI * 2 + (r() - 0.5) * 1.2;
      const rad = 0.35 + 0.65 * r();
      const c = { x: Math.cos(a) * ax * rad, y: Math.sin(a) * ay * rad };
      if (n === 1) return [{ x: 0, y: 0 }];
      let d = Infinity;
      for (const o of out) d = Math.min(d, Math.hypot(o.x - c.x, o.y - c.y));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
      if (d >= minD) break;
    }
    out.push(best);
  }
  return out;
}

/** Links for a constellation: the path in order plus a few nearest-neighbour chords. */
export function constellationLinks(pts: { x: number; y: number }[]): [number, number][] {
  const links: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) links.push([i - 1, i]);
  for (let i = 0; i < pts.length; i++) {
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (Math.abs(i - j) <= 1) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best >= 0 && bd < 0.9 && !links.some(([a, b]) => (a === best && b === i) || (a === i && b === best))) links.push([i, best]);
  }
  return links;
}

/** The whole cast in rows: one row when wide, two rows when narrow. */
export function finaleLayout(n: number, aspect: number): { x: number; y: number; s: number }[] {
  const rows = aspect >= 1.7 || n <= 3 ? 1 : aspect >= 0.75 ? 2 : 3;
  const perRow = Math.ceil(n / rows);
  const cellW = (2 * aspect) / perRow;
  const cellH = 2 / rows;
  const s = Math.min(cellW * 0.62, cellH * 0.5);
  const out: { x: number; y: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i - row * perRow;
    const x = (col - (inRow - 1) / 2) * cellW;
    const y = ((rows - 1) / 2 - row) * cellH;
    out.push({ x, y, s });
  }
  return out;
}

// ---- transport: dots from one shape to another ----

/**
 * Pairs each source dot with a destination dot so a shape can dissolve and
 * re-form as another. Both are flat arrays of [x, y, ...] with `stride`.
 * Sorting both by x (with a little y) keeps left on the left, so dots travel
 * mostly up and down. Returns, for every source dot, the index of its
 * destination, or -1 when it has none (it fades out). `spare` lists
 * destination dots no source reached (they fade in).
 */
export function assignTransport(from: ArrayLike<number>, to: ArrayLike<number>, stride = 4): { map: Int32Array; spare: number[] } {
  const nf = Math.floor(from.length / stride);
  const nt = Math.floor(to.length / stride);
  const key = (a: ArrayLike<number>, i: number) => a[i * stride] + 0.12 * a[i * stride + 1];
  const fi = Array.from({ length: nf }, (_, i) => i).sort((a, b) => key(from, a) - key(from, b));
  const ti = Array.from({ length: nt }, (_, i) => i).sort((a, b) => key(to, a) - key(to, b));
  const map = new Int32Array(nf).fill(-1);
  const used = new Uint8Array(nt);
  if (nt === 0) return { map, spare: [] };
  // proportional rank matching; when there are more sources than targets the
  // extra sources (picked evenly) fade out instead of doubling up
  const keep = Math.min(nf, nt);
  for (let r = 0; r < keep; r++) {
    const a = fi[Math.floor((r * nf) / keep)];
    const b = ti[Math.floor((r * nt) / keep)];
    map[a] = b;
    used[b] = 1;
  }
  const spare: number[] = [];
  for (let j = 0; j < nt; j++) if (!used[j]) spare.push(j);
  return { map, spare };
}

// ---- glyph order (letter from dots, no authored strokes) ----

/**
 * Order the filled cells of a glyph mask so dots can stream along it: a
 * breadth-first walk (8-neighbour) from a start cell, so the letter fills from
 * its head along its strokes. Disconnected parts start after the previous part
 * ends, left to right. Returns per-cell order 0..1 (or -1 for empty cells).
 */
export function glyphOrder(mask: ArrayLike<number>, w: number, h: number, start?: number): Float32Array {
  const out = new Float32Array(w * h).fill(-1);
  const dist = new Int32Array(w * h).fill(-1);
  let base = 0;
  let maxD = 0;
  const firstStart = start ?? findGlyphStart(mask, w, h);
  const comps: number[] = [];
  if (firstStart >= 0) comps.push(firstStart);
  const q = new Int32Array(w * h);
  const walk = (s: number) => {
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    dist[s] = base;
    let local = base;
    while (qh < qt) {
      const c = q[qh++];
      const cx = c % w;
      const cy = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const n = y * w + x;
          if (!mask[n] || dist[n] >= 0) continue;
          dist[n] = dist[c] + 1;
          local = Math.max(local, dist[n]);
          q[qt++] = n;
        }
    }
    return local;
  };
  if (firstStart >= 0) base = walk(firstStart) + 1;
  // remaining components, left to right
  for (;;) {
    let next = -1;
    for (let x = 0; x < w && next < 0; x++)
      for (let y = 0; y < h; y++) {
        const n = y * w + x;
        if (mask[n] && dist[n] < 0) {
          next = n;
          break;
        }
      }
    if (next < 0) break;
    base = walk(next) + 1;
  }
  for (let i = 0; i < w * h; i++) if (dist[i] > maxD) maxD = dist[i];
  for (let i = 0; i < w * h; i++) if (dist[i] >= 0) out[i] = maxD > 0 ? dist[i] / maxD : 0;
  return out;
}

/**
 * Where a Thai glyph is written from: the small loop (head) if it has one,
 * otherwise the lowest-left filled cell. Holes are background regions that do
 * not touch the border; the smallest hole is taken as the head.
 */
export function findGlyphStart(mask: ArrayLike<number>, w: number, h: number): number {
  const lab = new Int32Array(w * h).fill(0);
  const q = new Int32Array(w * h);
  let id = 0;
  let best: { size: number; cx: number; cy: number } | null = null;
  for (let s = 0; s < w * h; s++) {
    if (mask[s] || lab[s]) continue;
    id++;
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    lab[s] = id;
    let border = false;
    let sx = 0;
    let sy = 0;
    while (qh < qt) {
      const c = q[qh++];
      const cx = c % w;
      const cy = (c / w) | 0;
      sx += cx;
      sy += cy;
      if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) border = true;
      const ns = [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, cy > 0 ? c - w : -1, cy < h - 1 ? c + w : -1];
      for (const n of ns) if (n >= 0 && !mask[n] && !lab[n]) {
        lab[n] = id;
        q[qt++] = n;
      }
    }
    if (!border && qt >= 2 && (!best || qt < best.size)) best = { size: qt, cx: sx / qt, cy: sy / qt };
  }
  let pick = -1;
  let pd = Infinity;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const d = best ? Math.hypot(x - best.cx, y - best.cy) : x + (h - y) * 0.6;
    if (d < pd) {
      pd = d;
      pick = i;
    }
  }
  return pick;
}

// ---- spring for touch scatter ----

/** Critically-underdamped spring step: settles with a small overshoot. */
export function springStep(s: { x: number; v: number }, target: number, dt: number, k = 60, damp = 9) {
  const a = (target - s.x) * k - s.v * damp;
  s.v += a * dt;
  s.x += s.v * dt;
  return s;
}
