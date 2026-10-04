// F0 (pitch) tracking on raw PCM, entirely on the device. YIN (de Cheveigné &
// Kawahara 2002): squared-difference function, cumulative-mean normalisation,
// absolute threshold, parabolic interpolation. Then voicing by periodicity and
// energy, octave-jump repair against the local median, a 5-frame median
// smoother, and removal of voiced islands too short to be speech.
//
// Pure functions, no DOM: runs in the browser after a recording and in vitest
// on synthetic signals.

export interface PitchTrack {
  /** sample rate the track was computed at */
  sampleRate: number;
  /** seconds between frames */
  hop: number;
  /** F0 per frame in Hz; 0 = unvoiced */
  f0: Float32Array;
  /** periodicity per frame, 0..1 (1 - YIN aperiodicity) */
  conf: Float32Array;
  /** RMS energy per frame (linear) */
  rms: Float32Array;
}

export interface PitchOptions {
  minHz?: number;
  maxHz?: number;
  hopMs?: number;
  /** YIN absolute threshold */
  threshold?: number;
  /** frames with aperiodicity above this are unvoiced */
  maxAperiodicity?: number;
  /** analysis rate; input is resampled to it (16 kHz keeps YIN cheap) */
  analysisRate?: number;
}

const DEFAULTS: Required<PitchOptions> = {
  minHz: 60,
  maxHz: 520,
  hopMs: 10,
  threshold: 0.15,
  maxAperiodicity: 0.35,
  analysisRate: 16000,
};

/** Band-limited resampling with a Hann-windowed sinc kernel. */
export function resample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm;
  const ratio = from / to;
  const outLen = Math.floor(pcm.length / ratio);
  const out = new Float32Array(outLen);
  const fc = Math.min(1, to / from) * 0.92; // cutoff, relative to the input Nyquist
  const H = 16; // half-width in input samples (scaled when downsampling)
  const half = Math.ceil(H / Math.min(1, fc));
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio;
    const c = Math.floor(p);
    let acc = 0;
    let norm = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= pcm.length) continue;
      const t = p - k;
      const x = fc * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / half);
      const h = fc * sinc * w;
      acc += pcm[k] * h;
      norm += h;
    }
    out[i] = norm ? acc / norm : 0;
  }
  return out;
}

/** Root-mean-square of a slice. */
export function rmsOf(x: Float32Array, start = 0, end = x.length): number {
  let s = 0;
  const a = Math.max(0, start);
  const b = Math.min(x.length, end);
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return b > a ? Math.sqrt(s / (b - a)) : 0;
}

/**
 * Track F0. Input any sample rate, mono. Returns one frame per hop.
 */
export function trackPitch(input: Float32Array, inputRate: number, opts: PitchOptions = {}): PitchTrack {
  const o = { ...DEFAULTS, ...opts };
  const sr = Math.min(o.analysisRate, inputRate);
  const x = resample(input, inputRate, sr);
  const hop = Math.max(1, Math.round((o.hopMs / 1000) * sr));
  const tauMin = Math.max(2, Math.floor(sr / o.maxHz));
  const tauMax = Math.ceil(sr / o.minHz);
  const W = tauMax; // integration window: one period of the lowest F0
  const span = W + tauMax + 2;
  const nFrames = Math.max(0, Math.floor((x.length - span) / hop) + 1);
  const f0 = new Float32Array(nFrames);
  const conf = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);
  const d = new Float32Array(tauMax + 2);

  for (let fi = 0; fi < nFrames; fi++) {
    const s = fi * hop;
    // energy over the centre 25 ms of the frame
    const mid = s + Math.floor(span / 2);
    const rh = Math.round(0.0125 * sr);
    rms[fi] = rmsOf(x, mid - rh, mid + rh);
    // difference function
    d[0] = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let acc = 0;
      for (let j = 0; j < W; j++) {
        const df = x[s + j] - x[s + j + tau];
        acc += df * df;
      }
      d[tau] = acc;
    }
    // cumulative mean normalised difference
    let run = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      run += d[tau];
      d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    // absolute threshold: first dip under it, then walk down to its minimum
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < o.threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // no dip under the threshold: global minimum, voicing decided by its depth
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      tau = best;
    }
    const ap = d[tau];
    // parabolic interpolation
    let betterTau = tau;
    if (tau > 1 && tau < tauMax + 1) {
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) betterTau = tau + (0.5 * (a - c)) / den;
    }
    conf[fi] = Math.max(0, Math.min(1, 1 - ap));
    f0[fi] = ap <= o.maxAperiodicity ? sr / betterTau : 0;
  }

  // energy gate: frames far below the loudest are silence or breath
  let peak = 0;
  for (let i = 0; i < nFrames; i++) peak = Math.max(peak, rms[i]);
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 0;
  const gate = Math.max(peak * 0.04, Math.min(floor * 2.2, peak * 0.3), 1e-4);
  for (let i = 0; i < nFrames; i++) if (rms[i] < gate) f0[i] = 0;

  repairOctaves(f0);
  medianSmooth(f0, 5);
  dropShortIslands(f0, 3);

  return { sampleRate: sr, hop: hop / sr, f0, conf, rms };
}

/** Fold single-frame octave jumps (YIN's classic error) back towards the local median. */
function repairOctaves(f0: Float32Array) {
  const n = f0.length;
  const R = 7;
  const copy = Float32Array.from(f0);
  for (let i = 0; i < n; i++) {
    if (!copy[i]) continue;
    // neighbours within the same voiced run only (a gap is a syllable edge)
    const win: number[] = [];
    for (let k = i - 1; k >= Math.max(0, i - R) && copy[k]; k--) win.push(copy[k]);
    for (let k = i + 1; k <= Math.min(n - 1, i + R) && copy[k]; k++) win.push(copy[k]);
    if (win.length < 4) continue;
    win.sort((a, b) => a - b);
    const med = win[Math.floor(win.length / 2)];
    const r = copy[i] / med;
    if (r > 1.75 && r < 2.3) f0[i] = copy[i] / 2;
    else if (r < 0.57 && r > 0.43) f0[i] = copy[i] * 2;
    else if (r > 1.4 || r < 0.7) {
      // a wild frame inside a voiced run: replace by the median
      f0[i] = med;
    }
  }
}

/** Median filter over voiced frames only; unvoiced frames stay unvoiced. */
function medianSmooth(f0: Float32Array, k: number) {
  const h = Math.floor(k / 2);
  const copy = Float32Array.from(f0);
  for (let i = 0; i < f0.length; i++) {
    if (!copy[i]) continue;
    const win: number[] = [];
    for (let j = i - h; j <= i + h; j++) if (j >= 0 && j < f0.length && copy[j]) win.push(copy[j]);
    win.sort((a, b) => a - b);
    f0[i] = win[Math.floor(win.length / 2)];
  }
}

function dropShortIslands(f0: Float32Array, minLen: number) {
  let i = 0;
  while (i < f0.length) {
    if (!f0[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < f0.length && f0[j]) j++;
    if (j - i < minLen) for (let k = i; k < j; k++) f0[k] = 0;
    i = j;
  }
}

/** Semitones of `hz` above `refHz`. */
export function hzToSt(hz: number, refHz: number): number {
  return 12 * Math.log2(hz / refHz);
}

/** Median of voiced F0 in a track, or 0. */
export function medianF0(track: PitchTrack, start = 0, end = track.f0.length): number {
  const v: number[] = [];
  for (let i = start; i < end; i++) if (track.f0[i]) v.push(track.f0[i]);
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

export function voicedCount(track: PitchTrack): number {
  let c = 0;
  for (const v of track.f0) if (v) c++;
  return c;
}
