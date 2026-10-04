// Code-made voice-like signals with known pitch contours. Used by the tests
// (to prove the tracker, segmenter and classifier) and by the dev-only audio
// fixture. Nothing here is Thai speech; it is a buzz with a tone shape.

import type { Tone } from '../content/types';

/** Small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Realistic Thai citation-tone contours, normalised 0 (speaker floor) to 1
 * (ceiling), written from published F0 descriptions rather than copied from
 * toneShape, so the classifier is tested against shapes it was not built on.
 * `rng` adds speaker and token variation.
 */
export function thaiToneContour(tone: Tone, rng?: () => number): (t: number) => number {
  const r = rng ?? (() => 0.5);
  const off = rng ? gauss(r) * 0.035 : 0; // register offset
  const exc = rng ? 0.82 + r() * 0.36 : 1; // excursion scale
  const warp = rng ? 0.85 + r() * 0.3 : 1; // time warp
  const base = (t: number): number => {
    switch (tone) {
      case 'mid':
        return 0.5 - 0.09 * t;
      case 'low':
        return 0.36 - 0.2 * (1 - Math.pow(1 - t, 1.6));
      case 'falling': {
        const tp = 0.3;
        return t < tp ? 0.7 + 0.12 * (t / tp) : 0.82 - 0.62 * Math.pow((t - tp) / (1 - tp), 1.3);
      }
      case 'high':
        return 0.56 - 0.12 * t + 0.42 * t * t;
      case 'rising':
        return 0.36 - 0.72 * t + 1.1 * t * t;
    }
  };
  const centre = base(0.5);
  return (t: number) => {
    const tw = Math.pow(Math.min(1, Math.max(0, t)), warp);
    const v = centre + (base(tw) - centre) * exc + off;
    return Math.max(-0.1, Math.min(1.1, v));
  };
}

export interface SynthSyllable {
  tone: Tone;
  /** seconds of voicing */
  dur: number;
  /** override contour, normalised 0..1 over the syllable */
  contour?: (t: number) => number;
  /** voiced straight on from the previous syllable (nasal onset): an energy dip, no gap */
  joined?: boolean;
}

export interface SynthOptions {
  sampleRate?: number;
  floorHz: number;
  ceilHz: number;
  rng?: () => number;
  /** signal-to-noise in dB (white noise floor) */
  snrDb?: number;
  /** unvoiced gap between syllables, seconds (consonant closure or aspiration) */
  gap?: number;
  lead?: number;
  tail?: number;
  amplitude?: number;
}

export interface SynthResult {
  pcm: Float32Array;
  sampleRate: number;
  /** per syllable, the voiced span in seconds and the true F0 at time t */
  truth: { start: number; end: number; tone: Tone; f0: (t: number) => number }[];
}

/** A harmonic "voice" following the contours, with gaps, dips, jitter and noise. */
export function synthUtterance(sylls: SynthSyllable[], o: SynthOptions): SynthResult {
  const sr = o.sampleRate ?? 16000;
  const rng = o.rng ?? mulberry32(1);
  const span = 12 * Math.log2(o.ceilHz / o.floorHz);
  const toHz = (v: number) => o.floorHz * Math.pow(2, (v * span) / 12);
  const lead = o.lead ?? 0.2;
  const tail = o.tail ?? 0.2;
  const amp = o.amplitude ?? 0.4;
  const gapOf = () => o.gap ?? 0.06 + rng() * 0.06;

  // lay out the syllables on a timeline
  const truth: SynthResult['truth'] = [];
  let t = lead;
  sylls.forEach((s, i) => {
    if (i > 0 && !s.joined) t += gapOf();
    const c = s.contour ?? thaiToneContour(s.tone, rng);
    const start = t;
    const end = t + s.dur;
    truth.push({ start, end, tone: s.tone, f0: (tt: number) => toHz(c((tt - start) / (end - start))) });
    t = end;
  });
  const total = t + tail;
  const N = Math.ceil(total * sr);
  const pcm = new Float32Array(N);

  let phase = 0;
  let jitter = 0;
  const vibRate = 4.5 + rng() * 2;
  for (let n = 0; n < N; n++) {
    const tt = n / sr;
    // which syllable, and envelope
    let k = -1;
    for (let i = 0; i < truth.length; i++) if (tt >= truth[i].start && tt < truth[i].end) k = i;
    if (k < 0) continue;
    const s = truth[k];
    const local = tt - s.start;
    const remain = s.end - tt;
    // joined syllables dip the energy across the boundary instead of a gap
    const rise = sylls[k].joined ? 0.12 + 0.88 * Math.min(1, local / 0.06) : Math.min(1, local / 0.025);
    const fall = sylls[k + 1]?.joined ? 0.12 + 0.88 * Math.min(1, remain / 0.06) : Math.min(1, remain / 0.04);
    const env = Math.min(rise, fall) * (1 - 0.15 * (local / Math.max(0.05, s.end - s.start)));
    jitter = jitter * 0.995 + gauss(rng) * 0.0004;
    const f = s.f0(tt) * (1 + jitter + 0.004 * Math.sin(2 * Math.PI * vibRate * tt));
    phase += (2 * Math.PI * f) / sr;
    let v = 0;
    for (let h = 1; h * f < sr * 0.45 && h <= 24; h++) v += Math.sin(h * phase) / Math.pow(h, 1.15);
    pcm[n] = amp * env * v * 0.45;
  }
  // aspiration bursts in the gaps, then a white noise floor
  for (let i = 1; i < truth.length; i++) {
    if (sylls[i].joined) continue;
    const b = Math.floor((truth[i].start - 0.04) * sr);
    for (let n = Math.max(0, b); n < Math.min(N, b + Math.floor(0.035 * sr)); n++) pcm[n] += (rng() * 2 - 1) * amp * 0.08;
  }
  const snr = o.snrDb ?? 30;
  let sig = 0;
  let cnt = 0;
  for (let n = 0; n < N; n++) if (pcm[n]) { sig += pcm[n] * pcm[n]; cnt++; }
  const noise = Math.sqrt((cnt ? sig / cnt : 1e-4) / Math.pow(10, snr / 10));
  for (let n = 0; n < N; n++) pcm[n] += gauss(rng) * noise;
  return { pcm, sampleRate: sr, truth };
}

/** 16-bit PCM WAV, mono. */
export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
