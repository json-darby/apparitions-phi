// Scoring the learner's speech on the device. No AI model judges tones; this
// is measurement:
//
//   1. segment the recording into the target number of syllables, by voicing
//      gaps first and energy dips second;
//   2. per syllable, take the voiced F0, convert to semitones on the learner's
//      range (floor 0, ceiling 1) and resample to 16 points (the same shape as
//      the pipeline's media.pitch);
//   3. compare with the reference contour (media.pitch, else the textbook
//      toneShape) by dynamic time warping, and run a five-way tone classifier
//      against the canonical shapes;
//   4. syllable score = 0.5 DTW similarity + 0.5 classifier probability of the
//      target tone; the tone score is the mean over syllables.
//
// The online consonant/vowel check (if any) is combined later as
// 0.6 tone + 0.4 segmental by the sound service.

import { TONES, type Tone } from '../content/types';
import { toneShape } from './sound';
import { hzToSt, medianF0, type PitchTrack } from './pitch';

export const POINTS = 16;

// ---------------------------------------------------------------- range

/** A speaker's pitch range: the floor maps to 0 and the ceiling to 1. */
export interface SpeakerRange {
  floorHz: number;
  ceilHz: number;
}

/** Semitone span of a speaking range used when only a mid level is known. */
export const DEFAULT_SPAN_ST = 10;

/** Typical mid-tone level by speaking identity, before any calibration. */
export const DEFAULT_MID_HZ: Record<'m' | 'f', number> = { m: 120, f: 210 };

/** A range centred (0.5) on the speaker's mid-tone level. */
export function rangeFromMid(midHz: number, spanSt = DEFAULT_SPAN_ST): SpeakerRange {
  return { floorHz: midHz * Math.pow(2, -spanSt / 24), ceilHz: midHz * Math.pow(2, spanSt / 24) };
}

export function midOf(r: SpeakerRange): number {
  return Math.sqrt(r.floorHz * r.ceilHz);
}

function spanOf(r: SpeakerRange): number {
  return 12 * Math.log2(r.ceilHz / r.floorHz);
}

function norm(hz: number, r: SpeakerRange): number {
  return hzToSt(hz, r.floorHz) / spanOf(r);
}

// ---------------------------------------------------------------- segmentation

export interface Seg {
  /** first frame */
  start: number;
  /** one past the last frame */
  end: number;
}

function smooth(a: ArrayLike<number>, k: number): number[] {
  const h = Math.floor(k / 2);
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let c = 0;
    for (let j = i - h; j <= i + h; j++) if (j >= 0 && j < a.length) { s += a[j]; c++; }
    out.push(s / c);
  }
  return out;
}

/**
 * Split a recording into `n` syllables. Voiced runs (gaps of up to 30 ms are
 * bridged) are the first guess, since Thai onsets and stop finals cut voicing.
 * Too many runs: weak specks are dropped, then the closest neighbours merge.
 * Too few: the run with the deepest energy dip is split there (nasal and
 * vowel onsets keep voicing on), else the longest run is halved.
 */
export function segmentSyllables(track: PitchTrack, n: number): Seg[] {
  const { f0, rms } = track;
  const N = f0.length;
  if (n <= 0 || N === 0) return [];
  // voiced runs, bridging tiny gaps
  let runs: Seg[] = [];
  let i = 0;
  while (i < N) {
    if (!f0[i]) { i++; continue; }
    let j = i;
    while (j < N) {
      if (f0[j]) { j++; continue; }
      let g = j;
      while (g < N && !f0[g]) g++;
      if (g < N && g - j <= 3) { j = g; continue; }
      break;
    }
    runs.push({ start: i, end: j });
    i = j;
  }
  if (!runs.length) return [];

  const weight = (s: Seg) => {
    let w = 0;
    for (let k = s.start; k < s.end; k++) w += rms[k];
    return w;
  };

  // too many: drop specks, then merge closest neighbours
  while (runs.length > n) {
    const ws = runs.map(weight);
    const sorted = [...ws].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let weakest = 0;
    for (let k = 1; k < runs.length; k++) if (ws[k] < ws[weakest]) weakest = k;
    if (ws[weakest] < med * 0.2 || runs[weakest].end - runs[weakest].start < 4) {
      runs.splice(weakest, 1);
      continue;
    }
    let best = 0;
    for (let k = 1; k < runs.length - 1; k++) {
      if (runs[k + 1].start - runs[k].end < runs[best + 1].start - runs[best].end) best = k;
    }
    runs.splice(best, 2, { start: runs[best].start, end: runs[best + 1].end });
  }

  // too few: split at energy dips
  const sm = smooth(rms, 5);
  const db = sm.map((v) => 20 * Math.log10(Math.max(v, 1e-7)));
  while (runs.length < n) {
    let bestRun = -1;
    let bestAt = -1;
    let bestDepth = 0;
    runs.forEach((r, ri) => {
      const len = r.end - r.start;
      if (len < 8) return;
      const lo = r.start + 4;
      const hi = r.end - 4;
      for (let k = lo; k < hi; k++) {
        if (!(db[k] <= db[k - 1] && db[k] <= db[k + 1])) continue;
        let left = -Infinity;
        for (let q = r.start; q < k; q++) left = Math.max(left, db[q]);
        let right = -Infinity;
        for (let q = k + 1; q < r.end; q++) right = Math.max(right, db[q]);
        const depth = Math.min(left, right) - db[k];
        if (depth > bestDepth) { bestDepth = depth; bestRun = ri; bestAt = k; }
      }
    });
    if (bestRun < 0 || bestDepth < 3) {
      // no dip worth trusting: halve the longest run (if it is long enough)
      let longest = 0;
      for (let k = 1; k < runs.length; k++) if (runs[k].end - runs[k].start > runs[longest].end - runs[longest].start) longest = k;
      const r = runs[longest];
      if (r.end - r.start < 8) break;
      bestRun = longest;
      bestAt = Math.floor((r.start + r.end) / 2);
    }
    const r = runs[bestRun];
    runs.splice(bestRun, 1, { start: r.start, end: bestAt }, { start: bestAt + 1, end: r.end });
  }
  runs = runs.filter((r) => r.end > r.start);
  return runs;
}

// ---------------------------------------------------------------- contours

/** Linear resample of a numeric series to `m` points. */
export function resampleSeries(v: number[], m = POINTS): number[] {
  if (v.length === 0) return [];
  if (v.length === 1) return Array(m).fill(v[0]);
  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    const p = (i / (m - 1)) * (v.length - 1);
    const a = Math.floor(p);
    const b = Math.min(v.length - 1, a + 1);
    out.push(v[a] + (v[b] - v[a]) * (p - a));
  }
  return out;
}

/**
 * Fill a contour with null points (unvoiced): leading and trailing nulls are
 * trimmed and the voiced part re-stretched over all points; inner nulls are
 * interpolated. Null when fewer than a quarter of the points are voiced.
 */
export function fillContour(c: (number | null)[], m = POINTS): number[] | null {
  const idx: number[] = [];
  c.forEach((v, i) => { if (v != null && Number.isFinite(v)) idx.push(i); });
  if (idx.length < Math.max(2, Math.ceil(c.length / 4))) return null;
  const a = idx[0];
  const b = idx[idx.length - 1];
  const inner: number[] = [];
  for (let i = a; i <= b; i++) {
    if (c[i] != null && Number.isFinite(c[i] as number)) { inner.push(c[i] as number); continue; }
    let l = i - 1;
    while (c[l] == null) l--;
    let r = i + 1;
    while (c[r] == null) r++;
    inner.push((c[l] as number) + (((c[r] as number) - (c[l] as number)) * (i - l)) / (r - l));
  }
  return resampleSeries(inner, m);
}

/** The learner's 16-point normalised contour for one syllable, or null if barely voiced. */
export function syllableContour(track: PitchTrack, seg: Seg, range: SpeakerRange, m = POINTS): number[] | null {
  const vals: number[] = [];
  for (let k = seg.start; k < seg.end; k++) if (track.f0[k]) vals.push(norm(track.f0[k], range));
  if (vals.length < 4) return null;
  // onset and offset frames carry consonant perturbation
  const trimmed = vals.length >= 9 ? vals.slice(1, -1) : vals;
  return resampleSeries(trimmed, m);
}

// ---------------------------------------------------------------- comparison

function deltas(v: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[Math.max(0, i - 1)];
    const b = v[Math.min(v.length - 1, i + 1)];
    out.push(((b - a) / (Math.min(v.length - 1, i + 1) - Math.max(0, i - 1))) * (v.length - 1));
  }
  return out;
}

/**
 * DTW distance between two contours (same scale), with a Sakoe-Chiba band.
 * Local cost mixes level and slope so a shape that is right but early or late
 * costs little, while a wrong direction costs a lot. Normalised per step.
 */
export function dtwDistance(a: number[], b: number[], band = 3, slopeWeight = 0.04): number {
  const n = a.length;
  const m = b.length;
  const da = deltas(a);
  const dbb = deltas(b);
  const INF = 1e9;
  const D: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(INF));
  const L: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  D[0][0] = 0;
  const w = Math.max(band, Math.abs(n - m));
  for (let i = 1; i <= n; i++) {
    const jc = Math.round((i * m) / n);
    for (let j = Math.max(1, jc - w); j <= Math.min(m, jc + w); j++) {
      const cost = (a[i - 1] - b[j - 1]) ** 2 + slopeWeight * (da[i - 1] - dbb[j - 1]) ** 2;
      let best = D[i - 1][j - 1];
      let len = L[i - 1][j - 1];
      if (D[i - 1][j] < best) { best = D[i - 1][j]; len = L[i - 1][j]; }
      if (D[i][j - 1] < best) { best = D[i][j - 1]; len = L[i][j - 1]; }
      D[i][j] = best + cost;
      L[i][j] = len + 1;
    }
  }
  return Math.sqrt(D[n][m] / Math.max(1, L[n][m]));
}

/** DTW distance to a similarity 0..1. */
export function dtwSimilarity(d: number): number {
  return Math.exp(-Math.pow(d / 0.17, 2));
}

const TEMPLATES: Record<Tone, number[]> = Object.fromEntries(TONES.map((t) => [t, toneShape(t, POINTS)])) as Record<Tone, number[]>;

/** Canonical 16-point shapes the classifier compares against (exported so the pipeline can mirror them). */
export function toneTemplates(): Record<Tone, number[]> {
  return TEMPLATES;
}

export interface ToneGuess {
  tone: Tone;
  /** probability per tone, sums to 1 */
  probs: Record<Tone, number>;
}

/**
 * Five-way tone classifier on a normalised 16-point contour: distance to each
 * canonical shape over level and slope, allowing a small register shift
 * (calibration error), turned into probabilities by a softmax.
 */
export interface ClassifierWeights {
  slope: number;
  maxShift: number;
  shiftPenalty: number;
  tau: number;
}
export const CLASSIFIER: ClassifierWeights = { slope: 0.4, maxShift: 0.1, shiftPenalty: 0.3, tau: 0.008 };

export function classifyTone(c: number[], w: ClassifierWeights = CLASSIFIER): ToneGuess {
  const dc = deltas(c);
  const dist: Record<Tone, number> = {} as Record<Tone, number>;
  for (const t of TONES) {
    const T = TEMPLATES[t];
    const dT = deltas(T);
    let shift = 0;
    for (let i = 0; i < POINTS; i++) shift += c[i] - T[i];
    shift = Math.max(-w.maxShift, Math.min(w.maxShift, shift / POINTS));
    let lvl = 0;
    let slope = 0;
    for (let i = 0; i < POINTS; i++) {
      lvl += (c[i] - shift - T[i]) ** 2;
      slope += (dc[i] - dT[i]) ** 2;
    }
    // the endpoint slope is where falling/high and low/rising part ways
    dist[t] = lvl / POINTS + w.slope * (slope / POINTS) + w.shiftPenalty * shift * shift;
  }
  const tau = w.tau;
  let mn = Infinity;
  for (const t of TONES) mn = Math.min(mn, dist[t]);
  let z = 0;
  const probs = {} as Record<Tone, number>;
  for (const t of TONES) { probs[t] = Math.exp(-(dist[t] - mn) / tau); z += probs[t]; }
  let best: Tone = 'mid';
  for (const t of TONES) { probs[t] /= z; if (probs[t] > probs[best]) best = t; }
  return { tone: best, probs };
}

// ---------------------------------------------------------------- scoring

export interface SyllableResult {
  seg: Seg | null;
  /** learner contour, 16 points 0..1, null if not voiced */
  contour: number[] | null;
  /** reference contour used, 16 points 0..1 */
  reference: number[];
  target: Tone;
  heard: Tone | null;
  probs: Record<Tone, number> | null;
  dtw: number | null;
  /** 0..1 */
  score: number;
}

export interface ToneAnalysis {
  syllables: SyllableResult[];
  /** mean syllable score 0..1 */
  tone: number;
  /** flat learner line (n x 16) for drawing; unvoiced syllables bridged */
  pitch: number[];
  /** the range the contours were normalised with */
  range: SpeakerRange;
  /** utterance mid level (Hz) implied by the target tones, for range adaptation */
  impliedMidHz: number | null;
  voicedFrames: number;
}

/**
 * The reference per syllable: media.pitch where it fits (16 points, nulls
 * allowed), the textbook shape otherwise. A polite ending added on the app
 * side (one more syllable than the clip) falls back to the textbook shape.
 */
export function referenceContours(tones: Tone[], mediaPitch?: (number | null)[][] | null): number[][] {
  return tones.map((t, i) => {
    const m = mediaPitch?.[i];
    const filled = m && m.length ? fillContour(m, POINTS) : null;
    return filled ?? TEMPLATES[t];
  });
}

export interface AnalyseOptions {
  /** media.pitch of the target item, when its text matches */
  reference?: (number | null)[][] | null;
  /** the learner's calibrated or adapted range; default by identity */
  range?: SpeakerRange | null;
  identity?: 'm' | 'f';
}

/**
 * Measure an utterance against target tones. Null when nothing voiced was
 * heard (the score is then "nothing could be measured").
 */
export function analyseTones(track: PitchTrack, tones: Tone[], o: AnalyseOptions = {}): ToneAnalysis | null {
  const n = tones.length;
  if (!n) return null;
  let voiced = 0;
  for (const v of track.f0) if (v) voiced++;
  if (voiced < 5) return null;
  const segs = segmentSyllables(track, n);
  if (!segs.length) return null;
  const refs = referenceContours(tones, o.reference);
  const prior = o.range ?? rangeFromMid(DEFAULT_MID_HZ[o.identity ?? 'm']);

  // where would the speaker's mid level be if each syllable were on target?
  const implied: number[] = [];
  segs.forEach((s, i) => {
    if (i >= n) return;
    const med = medianF0(track, s.start, s.end);
    if (!med) return;
    const refMean = refs[i].reduce((a, b) => a + b, 0) / POINTS;
    implied.push(hzToSt(med, 1) - (refMean - 0.5) * DEFAULT_SPAN_ST);
  });
  implied.sort((a, b) => a - b);
  const impliedMidSt = implied.length ? implied[Math.floor(implied.length / 2)] : null;

  // blend the prior range with the utterance: single syllables trust the
  // prior (else a low tone would always look like a mid), longer utterances
  // lean on their own register; a prior far off (wrong identity, no
  // calibration) yields to the utterance.
  let range = prior;
  if (impliedMidSt != null) {
    const priorMidSt = hzToSt(midOf(prior), 1);
    const gap = Math.abs(impliedMidSt - priorMidSt);
    let w = n >= 3 ? 0.6 : n === 2 ? 0.35 : 0;
    if (gap > 6) w = Math.max(w, 0.85);
    else if (gap > 4) w = Math.max(w, 0.5);
    const midSt = priorMidSt + (impliedMidSt - priorMidSt) * w;
    range = rangeFromMid(Math.pow(2, midSt / 12), spanOf(prior));
  }

  const syllables: SyllableResult[] = tones.map((t, i) => {
    const seg = segs[i] ?? null;
    const contour = seg ? syllableContour(track, seg, range) : null;
    if (!contour) return { seg, contour: null, reference: refs[i], target: t, heard: null, probs: null, dtw: null, score: 0 };
    const g = classifyTone(contour);
    const d = dtwDistance(contour, refs[i]);
    const score = 0.5 * dtwSimilarity(d) + 0.5 * g.probs[t];
    return { seg, contour, reference: refs[i], target: t, heard: g.tone, probs: g.probs, dtw: d, score };
  });

  const pitch: number[] = [];
  syllables.forEach((s, i) => {
    if (s.contour) { pitch.push(...s.contour); return; }
    const prev = pitch.length ? pitch[pitch.length - 1] : null;
    const next = syllables.slice(i + 1).find((x) => x.contour)?.contour?.[0] ?? null;
    const a = prev ?? next ?? 0.5;
    const b = next ?? prev ?? 0.5;
    for (let k = 0; k < POINTS; k++) pitch.push(a + ((b - a) * k) / (POINTS - 1));
  });

  return {
    syllables,
    tone: syllables.reduce((a, s) => a + s.score, 0) / n,
    pitch,
    range,
    impliedMidHz: impliedMidSt == null ? null : Math.pow(2, impliedMidSt / 12),
    voicedFrames: voiced,
  };
}

/** 0.6 tone + 0.4 segmental when the online check answered, else tone only. */
export function combineScores(tone: number, segmental: number | null | undefined): number {
  if (segmental == null || !Number.isFinite(segmental)) return tone;
  return 0.6 * tone + 0.4 * Math.max(0, Math.min(1, segmental));
}
