import { describe, expect, it } from 'vitest';
import { trackPitch } from './pitch';
import { analyseTones, classifyTone, combineScores, dtwDistance, dtwSimilarity, fillContour, rangeFromMid, referenceContours, segmentSyllables, type SpeakerRange } from './score';
import { mulberry32, synthUtterance, thaiToneContour, type SynthSyllable } from './synth';
import { TONES, type Tone } from '../content/types';
import { toneShape } from './sound';

/** A synthetic speaker: true range, plus the range the app believes (calibration error up to ±1 st). */
function speaker(rng: () => number, female: boolean): { truth: SpeakerRange; believed: SpeakerRange } {
  const mid = female ? 190 + rng() * 50 : 105 + rng() * 30;
  const span = 9 + rng() * 3;
  const truth = rangeFromMid(mid, span);
  const err = (rng() * 2 - 1) * 1; // semitones
  return { truth, believed: rangeFromMid(mid * Math.pow(2, err / 12)) };
}

function utter(sylls: SynthSyllable[], sp: SpeakerRange, rng: () => number, sr = 16000, snr = 25) {
  const res = synthUtterance(sylls, { ...sp, rng, sampleRate: sr, snrDb: snr });
  return { res, track: trackPitch(res.pcm, sr) };
}

describe('tone classification on synthetic speech', () => {
  it('classifies all five tones at 95% or better (single syllables, calibrated speakers)', () => {
    const rng = mulberry32(2026);
    const confusion: Record<string, number> = {};
    let right = 0;
    let total = 0;
    const perTone: Record<Tone, [number, number]> = { mid: [0, 0], low: [0, 0], falling: [0, 0], high: [0, 0], rising: [0, 0] };
    for (let k = 0; k < 60; k++) {
      const sp = speaker(rng, k % 2 === 1);
      for (const tone of TONES) {
        const { track } = utter([{ tone, dur: 0.28 + rng() * 0.25 }], sp.truth, rng, k % 5 === 0 ? 48000 : 16000);
        const a = analyseTones(track, [tone], { range: sp.believed });
        const heard = a?.syllables[0].heard ?? null;
        total++;
        perTone[tone][1]++;
        if (heard === tone) { right++; perTone[tone][0]++; } else confusion[`${tone}->${heard}`] = (confusion[`${tone}->${heard}`] ?? 0) + 1;
      }
    }
    const acc = right / total;
    console.log(`single-syllable tone accuracy ${(acc * 100).toFixed(1)}% (${right}/${total})`, Object.fromEntries(TONES.map((t) => [t, `${perTone[t][0]}/${perTone[t][1]}`])), confusion);
    expect(acc).toBeGreaterThanOrEqual(0.95);
    for (const t of TONES) expect(perTone[t][0] / perTone[t][1]).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies tones inside 2 to 4 syllable words, including joined syllables, at 95% or better', () => {
    const rng = mulberry32(99);
    let right = 0;
    let total = 0;
    let segOk = 0;
    let words = 0;
    for (let k = 0; k < 80; k++) {
      const sp = speaker(rng, k % 2 === 0);
      const n = 2 + (k % 3);
      const sylls: SynthSyllable[] = [];
      for (let i = 0; i < n; i++) sylls.push({ tone: TONES[Math.floor(rng() * 5)], dur: 0.2 + rng() * 0.2, joined: i > 0 && rng() < 0.3 });
      const { track } = utter(sylls, sp.truth, rng);
      const a = analyseTones(track, sylls.map((s) => s.tone), { range: sp.believed });
      words++;
      if (a && a.syllables.every((s) => s.seg)) segOk++;
      a?.syllables.forEach((s, i) => { total++; if (s.heard === sylls[i].tone) right++; });
    }
    const acc = right / total;
    console.log(`word tone accuracy ${(acc * 100).toFixed(1)}% (${right}/${total}); segmentation complete in ${segOk}/${words} words`);
    expect(segOk / words).toBeGreaterThanOrEqual(0.95);
    expect(acc).toBeGreaterThanOrEqual(0.95);
  });

  it('classifies uncalibrated speakers (identity default only) reasonably', () => {
    const rng = mulberry32(5);
    let right = 0;
    let total = 0;
    for (let k = 0; k < 40; k++) {
      const female = k % 2 === 0;
      const mid = female ? 195 + rng() * 30 : 110 + rng() * 20;
      const sp = rangeFromMid(mid, 9 + rng() * 3);
      const n = 3;
      const sylls: SynthSyllable[] = [];
      for (let i = 0; i < n; i++) sylls.push({ tone: TONES[Math.floor(rng() * 5)], dur: 0.25 + rng() * 0.2 });
      const { track } = utter(sylls, sp, rng);
      const a = analyseTones(track, sylls.map((s) => s.tone), { identity: female ? 'f' : 'm' });
      a?.syllables.forEach((s, i) => { total++; if (s.heard === sylls[i].tone) right++; });
    }
    console.log(`uncalibrated 3-syllable accuracy ${((right / total) * 100).toFixed(1)}%`);
    expect(right / total).toBeGreaterThan(0.85);
  });

  it('classifies the textbook shapes themselves', () => {
    for (const t of TONES) expect(classifyTone(toneShape(t)).tone).toBe(t);
  });
});

describe('DTW scoring', () => {
  it('scores the right tone above every wrong tone', () => {
    const rng = mulberry32(11);
    let ordered = 0;
    let pairs = 0;
    const mean: Record<string, number[]> = {};
    for (let k = 0; k < 30; k++) {
      const sp = speaker(rng, k % 2 === 0);
      for (const said of TONES) {
        const { track } = utter([{ tone: said, dur: 0.3 + rng() * 0.2 }], sp.truth, rng);
        for (const target of TONES) {
          const a = analyseTones(track, [target], { range: sp.believed })!;
          (mean[`${target}:${said === target ? 'right' : 'wrong'}`] ??= []).push(a.tone);
        }
      }
    }
    for (const target of TONES) {
      const r = mean[`${target}:right`];
      const w = mean[`${target}:wrong`];
      const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      console.log(`${target}: right ${avg(r).toFixed(2)}, wrong ${avg(w).toFixed(2)}`);
      expect(avg(r)).toBeGreaterThan(avg(w) + 0.35);
      for (const x of r) for (const y of w) { pairs++; if (x > y) ordered++; }
    }
    console.log(`right-over-wrong ordering ${((ordered / pairs) * 100).toFixed(1)}%`);
    expect(ordered / pairs).toBeGreaterThan(0.95);
  });

  it('orders distances: identical < slightly off < different tone', () => {
    const ref = toneShape('falling');
    const near = ref.map((v, i) => v + 0.04 * Math.sin(i));
    const late = [ref[0], ref[0], ...ref.slice(0, 14)];
    const wrong = toneShape('rising');
    expect(dtwDistance(ref, ref)).toBeCloseTo(0, 6);
    expect(dtwDistance(near, ref)).toBeLessThan(dtwDistance(wrong, ref));
    expect(dtwDistance(late, ref)).toBeLessThan(dtwDistance(wrong, ref));
    expect(dtwSimilarity(dtwDistance(near, ref))).toBeGreaterThan(0.8);
    expect(dtwSimilarity(dtwDistance(wrong, ref))).toBeLessThan(0.3);
  });

  it('uses media.pitch as the reference where it fits and the textbook shape elsewhere', () => {
    const measured = Array.from({ length: 16 }, (_, i) => (i < 2 ? null : 0.3 + 0.02 * i));
    const refs = referenceContours(['low', 'high'], [measured]);
    expect(refs[0][0]).toBeCloseTo(0.34, 2);
    expect(refs[1]).toEqual(toneShape('high'));
    expect(fillContour([null, null, null, null, null, null, null, null, null, null, null, null, null, 0.5, 0.6, null])).toBeNull();
  });

  it('combines 0.6 tone + 0.4 segmental, tone only when offline', () => {
    expect(combineScores(0.8, null)).toBe(0.8);
    expect(combineScores(1, 0.5)).toBeCloseTo(0.8);
  });
});

describe('syllable segmentation', () => {
  it('finds the target syllable count with gaps, joined syllables and stray clicks', () => {
    const rng = mulberry32(42);
    let ok = 0;
    let total = 0;
    let boundaryErr = 0;
    let boundaries = 0;
    for (let k = 0; k < 120; k++) {
      const n = 1 + (k % 5);
      const sylls: SynthSyllable[] = [];
      for (let i = 0; i < n; i++) sylls.push({ tone: TONES[Math.floor(rng() * 5)], dur: 0.18 + rng() * 0.22, joined: i > 0 && rng() < 0.35 });
      const sp = rangeFromMid(110 + rng() * 120);
      const res = synthUtterance(sylls, { ...sp, rng, snrDb: 22 });
      // a stray click in the lead-in silence
      if (k % 4 === 0) for (let i = 800; i < 880; i++) res.pcm[i] += Math.sin(i) * 0.3;
      const track = trackPitch(res.pcm, 16000);
      const segs = segmentSyllables(track, n);
      total++;
      if (segs.length === n) {
        ok++;
        for (let i = 1; i < n; i++) {
          const t = segs[i].start * track.hop;
          boundaryErr += Math.abs(t - res.truth[i].start);
          boundaries++;
        }
      }
    }
    console.log(`segmentation: ${ok}/${total} exact counts, mean boundary error ${((boundaryErr / Math.max(1, boundaries)) * 1000).toFixed(0)} ms`);
    expect(ok / total).toBeGreaterThanOrEqual(0.97);
    expect(boundaryErr / boundaries).toBeLessThan(0.05);
  });

  it('returns nothing measurable for silence', () => {
    const x = new Float32Array(16000);
    const tr = trackPitch(x, 16000);
    expect(analyseTones(tr, ['mid'])).toBeNull();
  });

  it('a word said with the right shape but wrong register still scores its shape', () => {
    const rng = mulberry32(8);
    const sp = rangeFromMid(120);
    const sylls: SynthSyllable[] = (['mid', 'falling', 'high'] as Tone[]).map((t) => ({ tone: t, dur: 0.3, contour: thaiToneContour(t) }));
    const { track } = utter(sylls, rangeFromMid(150), rng); // 4 st higher than believed
    const a = analyseTones(track, ['mid', 'falling', 'high'], { range: sp })!;
    expect(a.syllables.map((s) => s.heard)).toEqual(['mid', 'falling', 'high']);
  });
});
