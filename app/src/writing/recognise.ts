// Handwriting: compare the learner's strokes with letters. Offline, no model
// files, a few milliseconds per letter.
//
// How it works. Each letter has a model: its stroke paths (authored, bundled
// or draft; see strokes.ts) sampled to evenly spaced points, in writing order.
// The ink is resampled the same way. Both are put in a common frame (each
// centred on its own bounding box with its larger side scaled to 1, or, when
// tracing, both in the model's frame so position counts). Then:
//   shape     how close the two point clouds are, both ways (extra ink and
//             missing parts both cost), order-free
//   order     point-by-point distance along the two sequences, so the same
//             shape drawn in the wrong order or direction scores low
//   direction the forward sequence distance against the fully reversed one
//   start     how far the first ink point is from the model's start point
//   strokes   agreement in the number of pen lifts (a mild factor)
// A letter with no stroke paths yet falls back to the font: the glyph is
// rendered once to an offscreen canvas, its distance field gives a centre-line
// point cloud, and only the shape term is used.

import type { Letter, StrokePath } from '../content/types';
import { frameOf, meanNearest, resampleStrokes, strokePoints, toFrame, type Frame, type Pt } from './geometry';
import { glyphCentreline } from './glyph';
import { resolveStrokes } from './strokes';

export interface Point {
  x: number;
  y: number;
  /** ms since the first point of the attempt */
  t?: number;
  /** pen pressure 0..1, when the device reports it */
  p?: number;
}
/** Strokes in drawing order. The Pad emits points in its 100 x 100 box. */
export type Ink = Point[][];

export interface Match {
  id: string;
  /** 0..1 */
  score: number;
}

/** A letter's model: ordered strokes when known, and an unordered centre-line cloud. */
export interface Model {
  strokes: Pt[][] | null;
  cloud: Pt[];
}

export interface ScoreDetail {
  /** 0..1 overall */
  score: number;
  /** 0..1 shape closeness, order-free */
  shape: number;
  /** 0..1 closeness along the writing order; null without stroke paths */
  order: number | null;
  /** 0..1, 1 when written in the model's direction; null without stroke paths */
  direction: number | null;
  /** 0..1 start point closeness; null without stroke paths */
  start: number | null;
  /** 0..1 agreement in stroke count; null without stroke paths */
  strokes: number | null;
  startOk: boolean | null;
  directionOk: boolean | null;
  /** where the score came from */
  basis: 'strokes' | 'font' | 'none';
}

export interface CompareOptions {
  /** Tracing: compare where the ink is, not just its shape. Ink must be in the 100 x 100 box. */
  inPlace?: boolean;
}

const CLOUD_N = 64;
const SEQ_N = 64;

/** 1 at d = 0, 0.5 at d = h, falling fast after. */
const half = (d: number, h: number) => Math.pow(2, -((d / h) * (d / h)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function cleanInk(ink: Ink): Pt[][] {
  const out: Pt[][] = [];
  for (const s of ink) {
    const pts: Pt[] = [];
    for (const p of s) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const last = pts[pts.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) pts.push({ x: p.x, y: p.y });
    }
    if (pts.length) out.push(pts);
  }
  return out;
}

/** n points evenly spaced along the strokes in order, skipping pen-up gaps. */
export function sequence(strokes: Pt[][], n: number): Pt[] {
  const segs: { a: Pt; b: Pt; L: number }[] = [];
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) segs.push({ a: s[i - 1], b: s[i], L: Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) });
  }
  const total = segs.reduce((t, g) => t + g.L, 0);
  if (!segs.length || total === 0) {
    const p = strokes[0]?.[0] ?? { x: 0, y: 0 };
    return Array.from({ length: n }, () => ({ x: p.x, y: p.y }));
  }
  const out: Pt[] = [];
  let k = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (k < segs.length - 1 && acc + segs[k].L < target) {
      acc += segs[k].L;
      k++;
    }
    const g = segs[k];
    const t = g.L > 0 ? clamp01((target - acc) / g.L) : 0;
    out.push({ x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t });
  }
  return out;
}

function meanPairDist(a: Pt[], b: Pt[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return s / a.length;
}

// ---------- models ----------

export function modelFromStrokes(strokes: StrokePath[]): Model | null {
  const pts = strokes.map((s) => strokePoints(s.d)).filter((s) => s.length > 1);
  if (!pts.length) return null;
  return { strokes: pts, cloud: resampleStrokes(pts, CLOUD_N).flat() };
}

export function modelFromCloud(cloud: Pt[]): Model | null {
  return cloud.length >= 4 ? { strokes: null, cloud } : null;
}

const modelCache = new Map<string, Model>();

/** The model for a letter: its stroke paths if any, else the font's centre line, else null. */
export function modelFor(letter: Pick<Letter, 'id' | 'char' | 'strokes'>, strokes?: StrokePath[] | null): Model | null {
  const s = strokes ?? resolveStrokes(letter);
  const key = s ? `${letter.id}|${s.map((x) => x.d).join('|')}` : `${letter.id}|font|${letter.char}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  let m: Model | null = null;
  if (s && s.length) m = modelFromStrokes(s);
  if (!m) {
    const cloud = glyphCentreline(letter.char);
    m = cloud ? modelFromCloud(cloud) : null;
  }
  if (m) {
    if (modelCache.size > 300) modelCache.clear();
    modelCache.set(key, m);
  }
  return m;
}

// ---------- the matcher ----------

const NONE: ScoreDetail = {
  score: 0, shape: 0, order: null, direction: null, start: null, strokes: null, startOk: null, directionOk: null, basis: 'none',
};

/** Compare ink with a model. Pure; works on plain point arrays. */
export function compareInk(ink: Ink, model: Model | null, opts: CompareOptions = {}): ScoreDetail {
  const strokes = cleanInk(ink);
  if (!model || !strokes.length) return { ...NONE, basis: model ? (model.strokes ? 'strokes' : 'font') : 'none' };
  const inkAll = strokes.flat();
  const modelAll = model.strokes ? model.strokes.flat() : model.cloud;
  const fm = frameOf(modelAll);
  const fi: Frame = opts.inPlace ? fm : frameOf(inkAll);
  if (fi.scale === 0 || fm.scale === 0) return { ...NONE, basis: model.strokes ? 'strokes' : 'font' };

  const inkN = strokes.map((s) => s.map((p) => toFrame(p, fi)));
  const inkCloud = resampleStrokes(inkN, CLOUD_N).flat();
  const modelCloud = model.cloud.map((p) => toFrame(p, fm));

  // tracing allows a little more slack, because the finger is also placing the letter
  const tol = opts.inPlace ? 1.25 : 1;

  const extra = meanNearest(inkCloud, modelCloud);
  const missing = meanNearest(modelCloud, inkCloud);
  const shape = half((extra + missing) / 2, 0.07 * tol) * (0.6 + 0.4 * half(Math.max(extra, missing), 0.12 * tol));

  if (!model.strokes) {
    return { score: shape, shape, order: null, direction: null, start: null, strokes: null, startOk: null, directionOk: null, basis: 'font' };
  }

  const modelN = model.strokes.map((s) => s.map((p) => toFrame(p, fm)));
  const a = sequence(inkN, SEQ_N);
  const b = sequence(modelN, SEQ_N);
  const fwd = meanPairDist(a, b);
  const rev = meanPairDist(a, [...b].reverse());
  const order = half(fwd, 0.1 * tol);
  const r = (rev - fwd) / Math.max(1e-9, rev + fwd);
  const direction = clamp01(0.5 + 1.5 * r);

  const s0 = inkN[0][0];
  const m0 = modelN[0][0];
  const startD = Math.hypot(s0.x - m0.x, s0.y - m0.y);
  const start = half(startD, 0.12 * tol);

  const diff = Math.abs(inkN.length - modelN.length);
  const strokesScore = 1 / (1 + 0.35 * diff);

  const score = clamp01((0.4 * shape + 0.2 * order + 0.2 * start + 0.2 * direction) * (0.85 + 0.15 * strokesScore));
  return {
    score, shape, order, direction, start, strokes: strokesScore,
    startOk: startD < 0.16 * tol, directionOk: fwd <= rev, basis: 'strokes',
  };
}

/**
 * How well ink matches a model for telling letters apart: shape first, plus
 * sequence closeness in whichever direction fits better (a wrong direction is
 * a writing fault, not a different letter).
 */
export function recogniseScore(ink: Ink, model: Model | null, opts: CompareOptions = {}): number {
  const d = compareInk(ink, model, opts);
  if (d.basis !== 'strokes' || d.order == null) return d.shape;
  // the order term in the better direction
  const strokes = cleanInk(ink);
  const inkAll = strokes.flat();
  const modelAll = model!.strokes!.flat();
  const fm = frameOf(modelAll);
  const fi = opts.inPlace ? fm : frameOf(inkAll);
  const a = sequence(strokes.map((s) => s.map((p) => toFrame(p, fi))), SEQ_N);
  const b = sequence(model!.strokes!.map((s) => s.map((p) => toFrame(p, fm))), SEQ_N);
  const best = Math.min(meanPairDist(a, b), meanPairDist(a, [...b].reverse()));
  return clamp01(0.65 * d.shape + 0.35 * half(best, 0.1));
}

/** Rank candidate letters by how closely the ink matches each. Best first. */
export function recognise(ink: Ink, candidates: Letter[], opts: CompareOptions = {}): Match[] {
  return candidates
    .map((l) => ({ id: l.id, score: recogniseScore(ink, modelFor(l), opts) }))
    .sort((x, y) => y.score - x.score);
}

/** 0..1 closeness of the ink to one target letter (start point, direction, shape). */
export function handwritingScore(ink: Ink, target: Letter, opts: CompareOptions & { strokes?: StrokePath[] | null } = {}): number {
  return handwritingDetail(ink, target, opts).score;
}

/** The parts of the score, for feedback ("start at the head loop"). */
export function handwritingDetail(ink: Ink, target: Letter, opts: CompareOptions & { strokes?: StrokePath[] | null } = {}): ScoreDetail {
  return compareInk(ink, modelFor(target, opts.strokes), opts);
}
