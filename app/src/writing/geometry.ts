// Pure geometry for handwriting: SVG path sampling, resampling, normalising,
// simplifying, smoothing and a distance-transform skeleton. No DOM, so the
// recogniser and its tests run anywhere.

export interface Pt {
  x: number;
  y: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- SVG path data to polylines ----------

/**
 * Sample SVG path data into polylines, one per subpath. Supports M L H V C S Q
 * T Z in absolute and relative forms; arcs (A) are taken as straight lines to
 * their end point, which is enough for centre-line strokes.
 */
export function samplePath(d: string, segments = 12): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cx = 0; // last control point, for S and T
  let cy = 0;
  let prev = '';
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const push = (p: Pt) => {
    const last = cur[cur.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) cur.push(p);
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const x0 = x;
    const y0 = y;
    for (let k = 1; k <= segments; k++) {
      const t = k / segments;
      const u = 1 - t;
      push({
        x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      });
    }
    cx = x2;
    cy = y2;
    x = x3;
    y = y3;
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    const x0 = x;
    const y0 = y;
    for (let k = 1; k <= segments; k++) {
      const t = k / segments;
      const u = 1 - t;
      push({ x: u * u * x0 + 2 * u * t * x1 + t * t * x2, y: u * u * y0 + 2 * u * t * y1 + t * t * y2 });
    }
    cx = x1;
    cy = y1;
    x = x2;
    y = y2;
  };
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };

  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case 'M': {
        flush();
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        push({ x, y });
        // further pairs after M are line-tos
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L':
        x = ox + num();
        y = oy + num();
        push({ x, y });
        break;
      case 'H':
        x = (rel ? x : 0) + num();
        push({ x, y });
        break;
      case 'V':
        y = (rel ? y : 0) + num();
        push({ x, y });
        break;
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
        cubic(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 'S': {
        const r = /[CcSs]/.test(prev);
        const x1 = r ? 2 * x - cx : x;
        const y1 = r ? 2 * y - cy : y;
        const x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
        cubic(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 'Q': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
        quad(x1, y1, x2, y2);
        break;
      }
      case 'T': {
        const r = /[QqTt]/.test(prev);
        const x1 = r ? 2 * x - cx : x;
        const y1 = r ? 2 * y - cy : y;
        quad(x1, y1, ox + num(), oy + num());
        break;
      }
      case 'A': {
        num(); num(); num(); num(); num();
        x = ox + num();
        y = oy + num();
        push({ x, y });
        break;
      }
      case 'Z':
        x = sx;
        y = sy;
        push({ x, y });
        break;
      default:
        i++;
    }
    prev = cmd;
  }
  flush();
  return out;
}

/** One stroke's path data as a single polyline (subpaths joined in order). */
export function strokePoints(d: string, segments = 12): Pt[] {
  return samplePath(d, segments).flat();
}

// ---------- lengths and resampling ----------

export function polyLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** n points evenly spaced along a polyline by arc length. */
export function resample(pts: Pt[], n: number): Pt[] {
  if (!pts.length || n <= 0) return [];
  if (pts.length === 1 || n === 1) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  const total = polyLength(pts);
  if (total === 0) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  const step = total / (n - 1);
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;
  let target = step;
  for (let i = 1; i < pts.length && out.length < n - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = dist(a, b);
    while (seg > 0 && acc + seg >= target && out.length < n - 1) {
      const t = (target - acc) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      target += step;
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  while (out.length < n) out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * Resample several strokes to n points in total, shared out by length, keeping
 * drawing order. Pen-up gaps between strokes are not counted. Each stroke gets
 * at least two points.
 */
export function resampleStrokes(strokes: Pt[][], n: number): Pt[][] {
  const live = strokes.filter((s) => s.length > 0);
  if (!live.length) return [];
  const lens = live.map((s) => Math.max(polyLength(s), 1e-6));
  const total = lens.reduce((a, b) => a + b, 0);
  const counts = lens.map((L) => Math.max(2, Math.round((L / total) * n)));
  return live.map((s, k) => resample(s, counts[k]));
}

// ---------- frames ----------

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(pts: Pt[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** A similarity frame: centre and scale. Apply with toFrame. */
export interface Frame {
  cx: number;
  cy: number;
  scale: number;
}

/** Frame that centres the bounding box and makes its larger side 1. */
export function frameOf(pts: Pt[]): Frame {
  const b = bounds(pts);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const size = Math.max(w, h);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale: size > 1e-9 ? 1 / size : 0 };
}

export function toFrame(p: Pt, f: Frame): Pt {
  return { x: (p.x - f.cx) * f.scale, y: (p.y - f.cy) * f.scale };
}

// ---------- nearest-point helpers ----------

/** Mean over a of the distance to the nearest point of b. */
export function meanNearest(a: Pt[], b: Pt[]): number {
  if (!a.length || !b.length) return Infinity;
  let s = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) {
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    s += Math.sqrt(best);
  }
  return s / a.length;
}

/** The share of a's points that lie within r of some point of b. */
export function shareWithin(a: Pt[], b: Pt[], r: number): number {
  if (!a.length || !b.length) return 0;
  const r2 = r * r;
  let n = 0;
  for (const p of a) {
    for (const q of b) {
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy <= r2) {
        n++;
        break;
      }
    }
  }
  return n / a.length;
}

// ---------- simplify and smooth (stroke authoring) ----------

/** Ramer-Douglas-Peucker simplification. */
export function simplify(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = pts[s];
    const b = pts[e];
    const L = dist(a, b);
    let best = -1;
    let bi = -1;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i];
      const d = L === 0 ? dist(p, a) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > epsilon && bi > 0) {
      keep[bi] = 1;
      stack.push([s, bi], [bi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A smooth path through the points (Catmull-Rom as cubic Beziers), rounded to 0.1. */
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${r1(pts[0].x)} ${r1(pts[0].y)}`;
  if (pts.length === 2) return `M${r1(pts[0].x)} ${r1(pts[0].y)} L${r1(pts[1].x)} ${r1(pts[1].y)}`;
  let d = `M${r1(pts[0].x)} ${r1(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(p2.x)} ${r1(p2.y)}`;
  }
  return d;
}

/** Light moving-average smoothing that keeps the end points. */
export function smoothPoints(pts: Pt[], radius = 2): Pt[] {
  if (pts.length < 3) return pts.slice();
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(pts.length - 1, i + radius); k++) {
      sx += pts[k].x;
      sy += pts[k].y;
      n++;
    }
    return { x: sx / n, y: sy / n };
  });
}

/** Points of a stroke split at fractions of its length, e.g. [0.3, 0.7] gives three pieces. */
export function splitByLength(pts: Pt[], cuts: number[]): Pt[][] {
  const total = polyLength(pts);
  const out: Pt[][] = [];
  let piece: Pt[] = [pts[0]];
  let acc = 0;
  let c = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    while (c < cuts.length && acc + seg >= cuts[c] * total && seg > 0) {
      const t = (cuts[c] * total - acc) / seg;
      const m = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      piece.push(m);
      out.push(piece);
      piece = [m];
      c++;
    }
    piece.push(pts[i]);
    acc += seg;
  }
  out.push(piece);
  return out;
}

export function polylineD(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join(' ');
}

// ---------- distance transform and skeleton (font fallback) ----------

/**
 * Two-pass chamfer distance transform. For every cell, the distance (in cells)
 * to the nearest cell where mask is `target`. Cells equal to target get 0.
 */
export function distanceTransform(mask: Uint8Array, w: number, h: number, target: 0 | 1): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : INF;
  const A = 1;
  const B = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[i - w] + A);
        if (x > 0) v = Math.min(v, d[i - w - 1] + B);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + A);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + A);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + B);
        if (x > 0) v = Math.min(v, d[i + w - 1] + B);
      }
      d[i] = v;
    }
  }
  return d;
}

/**
 * An approximate centre line of a filled shape: cells whose distance to the
 * outside is a local maximum (the ridge of the distance field). Returned in
 * mask cells; scale them to the caller's box.
 */
export function ridgePoints(mask: Uint8Array, w: number, h: number, minDepth = 1.2): Pt[] {
  const depth = distanceTransform(mask, w, h, 0);
  const out: Pt[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = depth[i];
      if (v < minDepth) continue;
      // a ridge cell is not lower than its neighbours along at least one axis pair
      const hx = v >= depth[i - 1] && v >= depth[i + 1];
      const hy = v >= depth[i - w] && v >= depth[i + w];
      const hd1 = v >= depth[i - w - 1] && v >= depth[i + w + 1];
      const hd2 = v >= depth[i - w + 1] && v >= depth[i + w - 1];
      if (hx || hy || hd1 || hd2) out.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  return out;
}

/** Thin a dense point set by keeping the first point in each grid cell of the given size. */
export function thin(pts: Pt[], cell: number): Pt[] {
  const seen = new Map<string, Pt>();
  for (const p of pts) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    if (!seen.has(k)) seen.set(k, p);
  }
  return [...seen.values()];
}
