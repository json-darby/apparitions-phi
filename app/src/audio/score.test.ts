import { describe, expect, it } from 'vitest';
import { hzToSt, medianF0, trackPitch, type PitchTrack } from './pitch';
import { analyseTones, classifyTone, fillContour as fill48, melodyMatch, melodySimilarity, voicedSpan, combineScores, dtwDistance, dtwSimilarity, fillContour, rangeFromMid, referenceContours, segmentSyllables, speakerContours, type SpeakerRange } from './score';
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

describe("the course speaker's own clip as the reference", () => {
  it('measures a recorded speaker into per-syllable contours that keep their tones', () => {
    const rng = mulberry32(77);
    const tones: Tone[] = ['falling', 'high', 'rising'];
    const sylls: SynthSyllable[] = tones.map((t) => ({ tone: t, dur: 0.24, contour: thaiToneContour(t, rng) }));
    const { track } = utter(sylls, rangeFromMid(200, 10), rng);
    const ref = speakerContours(track, 3);
    expect(ref).not.toBeNull();
    ref!.forEach((c, i) => expect(classifyTone(c as number[]).tone).toBe(tones[i]));
  });

  it("scores a learner who copies the speaker high, and wrong tones low, against that reference", () => {
    const rng = mulberry32(78);
    const tones: Tone[] = ['low', 'falling', 'mid'];
    const mk = (ts: Tone[], mid: number) => utter(ts.map((t) => ({ tone: t, dur: 0.24, contour: thaiToneContour(t, rng) })), rangeFromMid(mid, 10), rng).track;
    const reference = speakerContours(mk(tones, 210), 3);
    expect(reference).not.toBeNull();
    const learner = rangeFromMid(118, 10);
    const right = analyseTones(mk(tones, 118), tones, { reference, range: learner, identity: 'm' });
    const wrong = analyseTones(mk(['high', 'rising', 'low'], 118), tones, { reference, range: learner, identity: 'm' });
    expect(right!.tone).toBeGreaterThan(0.6);
    expect(right!.tone).toBeGreaterThan(wrong!.tone + 0.25);
  });

  it('gives up (textbook shapes instead) when a clip will not split into the syllables', () => {
    const rng = mulberry32(79);
    const { track } = utter([{ tone: 'mid', dur: 0.3, contour: thaiToneContour('mid', rng) }], rangeFromMid(200, 10), rng);
    expect(speakerContours(track, 0)).toBeNull();
    expect(speakerContours({ ...track, f0: new Float32Array(track.f0.length) }, 2)).toBeNull();
  });

  it("keeps the speaker's shape only where it is plainly the syllable's own tone", () => {
    const rng = mulberry32(80);
    const said: Tone[] = ['falling', 'high', 'low'];
    const { track } = utter(said.map((t) => ({ tone: t, dur: 0.24, contour: thaiToneContour(t, rng) })), rangeFromMid(200, 10), rng);
    // the text says the last one is rising: that syllable falls back, the rest are kept
    const ref = speakerContours(track, 3, ['falling', 'high', 'rising']);
    expect(ref![0].length).toBe(16);
    expect(ref![1].length).toBe(16);
    expect(ref![2]).toEqual([]);
    // mostly wrong: the whole clip is set aside
    expect(speakerContours(track, 3, ['rising', 'low', 'rising'])).toBeNull();
  });
});

describe('melody match (whole phrase against the speaker)', () => {
  /** The speaker's melody as the sealing step measures it: 48 points on their own range, 0.5 = their median. */
  function speakerMelody(track: PitchTrack): number[] {
    const mid = medianF0(track);
    const floor = mid * Math.pow(2, -10 / 24);
    const span = voicedSpan(track)!;
    const c: (number | null)[] = [];
    for (let k = span.start; k < span.end; k++) c.push(track.f0[k] ? hzToSt(track.f0[k], floor) / 10 : null);
    return fill48(c, 48)!;
  }
  const say = (ts: Tone[], mid: number, tempo: number, rng: () => number) =>
    utter(ts.map((t) => ({ tone: t, dur: 0.24 * tempo, contour: thaiToneContour(t, rng) })), rangeFromMid(mid, 10), rng).track;

  it('scores a different speaker at a different tempo high, and wrong tones clearly lower', () => {
    const rng = mulberry32(301);
    const phrases: Tone[][] = [['low', 'falling', 'mid'], ['rising', 'high', 'falling', 'mid'], ['mid', 'low', 'high'], ['falling', 'rising'], ['high', 'mid', 'falling', 'low', 'rising'], ['mid', 'falling', 'high', 'mid']];
    const good: number[] = [];
    const bad: number[] = [];
    phrases.forEach((tones, k) => {
      // the speaker and the learner are of the other sex, each way round
      const [sp, me] = k % 2 ? [115, 225] : [210, 118];
      const melody = speakerMelody(say(tones, sp, 1, rng));
      const learner = rangeFromMid(me, 10);
      const wrongTones = tones.map((t) => (({ mid: 'rising', low: 'high', falling: 'rising', high: 'low', rising: 'falling' }) as Record<Tone, Tone>)[t]);
      for (const tempo of [0.75, 1.25]) {
        good.push(melodyMatch(say(tones, me, tempo, rng), melody, learner, tones.length)!.score);
        bad.push(melodyMatch(say(wrongTones, me, tempo, rng), melody, learner, tones.length)!.score);
      }
    });
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    console.log(`melody: good ${good.map((x) => x.toFixed(2)).join(' ')} (mean ${avg(good).toFixed(2)}); wrong ${bad.map((x) => x.toFixed(2)).join(' ')} (mean ${avg(bad).toFixed(2)})`);
    expect(avg(good)).toBeGreaterThanOrEqual(0.75);
    expect(avg(bad)).toBeLessThanOrEqual(0.25);
    expect(good.filter((x) => x >= 0.7).length).toBeGreaterThanOrEqual(good.length - 1);
    expect(bad.filter((x) => x <= 0.35).length).toBeGreaterThanOrEqual(bad.length - 1);
    // each imitation beats every wrong-tone take
    expect(Math.min(...good)).toBeGreaterThan(Math.max(...bad) + 0.25);
  });

  it('two lines: identical 1, same moves at another level 1, opposite moves low', () => {
    const up = Array.from({ length: 48 }, (_, i) => 0.3 + (0.4 * i) / 47);
    expect(melodySimilarity(up, up)).toBeCloseTo(1, 6);
    expect(melodySimilarity(up.map((v) => v + 0.3), up)).toBeCloseTo(1, 6);
    expect(melodySimilarity([...up].reverse(), up, 1)).toBeLessThan(0.35);
    // a longer phrase is given more room
    expect(melodySimilarity(up.map((v, i) => v + 0.05 * Math.sin(i / 3)), up, 6)).toBeGreaterThan(melodySimilarity(up.map((v, i) => v + 0.05 * Math.sin(i / 3)), up, 1));
  });

  it('blends into the tone score in melody mode only', () => {
    const rng = mulberry32(302);
    const tones: Tone[] = ['falling', 'high', 'low'];
    const melody = speakerMelody(say(tones, 200, 1, rng));
    const track = say(tones, 120, 1.2, rng);
    const o = { range: rangeFromMid(120, 10), identity: 'm' as const };
    const plain = analyseTones(track, tones, o)!;
    const syl = analyseTones(track, tones, { ...o, melody, mode: 'syllables' })!;
    const mel = analyseTones(track, tones, { ...o, melody })!;
    expect(syl).toEqual(plain);
    expect(syl.melody).toBeUndefined();
    expect(mel.melody!.learner).toHaveLength(48);
    expect(mel.melody!.reference).toHaveLength(48);
    expect(mel.tone).toBeCloseTo(0.65 * mel.melody!.score + 0.35 * plain.tone, 6);
  });

  it('gives up when too little was voiced', () => {
    const rng = mulberry32(303);
    const melody = Array.from({ length: 48 }, (_, i) => 0.5 + 0.2 * Math.sin(i / 8));
    const track = say(['mid'], 120, 1, rng);
    expect(melodyMatch({ ...track, f0: new Float32Array(track.f0.length) }, melody, rangeFromMid(120))).toBeNull();
    const speck = new Float32Array(track.f0.length);
    for (let k = 30; k < 36; k++) speck[k] = 120;
    expect(melodyMatch({ ...track, f0: speck }, melody, rangeFromMid(120))).toBeNull();
  });
});
