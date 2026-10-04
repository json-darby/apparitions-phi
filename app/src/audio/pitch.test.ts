import { describe, expect, it } from 'vitest';
import { resample, trackPitch } from './pitch';
import { mulberry32, synthUtterance, thaiToneContour } from './synth';
import { TONES } from '../content/types';

function grossErrorRate(sr: number, res: ReturnType<typeof synthUtterance>, track: ReturnType<typeof trackPitch>) {
  let voicedTruth = 0;
  let hit = 0;
  let gross = 0;
  const span = (Math.ceil(16000 / 60) * 2 + 2) / 2 / 16000; // frame centre offset (seconds) at 16 kHz
  for (let i = 0; i < track.f0.length; i++) {
    const t = i * track.hop + span;
    const s = res.truth.find((x) => t >= x.start + 0.03 && t < x.end - 0.03);
    if (!s) continue;
    voicedTruth++;
    if (!track.f0[i]) continue;
    hit++;
    const want = s.f0(t);
    if (Math.abs(track.f0[i] - want) / want > 0.05) gross++;
  }
  void sr;
  return { voicedTruth, recall: hit / voicedTruth, gross: gross / Math.max(1, hit) };
}

describe('pitch tracker (YIN)', () => {
  it('resamples 48 kHz to 16 kHz without aliasing the fundamental', () => {
    const sr = 48000;
    const x = new Float32Array(sr / 2);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 200 * i) / sr);
    const y = resample(x, sr, 16000);
    expect(y.length).toBe(8000);
    const tr = trackPitch(y, 16000);
    const v = Array.from(tr.f0).filter(Boolean);
    expect(v.length).toBeGreaterThan(30);
    const med = v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
    expect(Math.abs(med - 200)).toBeLessThan(2);
  });

  it('tracks steady, gliding and tonal contours in male and female ranges', () => {
    const rng = mulberry32(7);
    let frames = 0;
    let recall = 0;
    let gross = 0;
    const speakers = [
      { floorHz: 85, ceilHz: 170 },
      { floorHz: 100, ceilHz: 190 },
      { floorHz: 150, ceilHz: 300 },
      { floorHz: 180, ceilHz: 340 },
    ];
    for (const sp of speakers) {
      for (const tone of TONES) {
        for (const sr of [16000, 48000]) {
          const res = synthUtterance([{ tone, dur: 0.3 + rng() * 0.2 }], { ...sp, rng, sampleRate: sr, snrDb: 25 });
          const tr = trackPitch(res.pcm, sr);
          const e = grossErrorRate(sr, res, tr);
          frames += e.voicedTruth;
          recall += e.recall * e.voicedTruth;
          gross += e.gross * e.voicedTruth;
        }
      }
    }
    const R = recall / frames;
    const G = gross / frames;
    console.log(`tracking: voiced recall ${(R * 100).toFixed(1)}%, gross error ${(G * 100).toFixed(2)}% over ${frames} frames`);
    expect(R).toBeGreaterThan(0.95);
    expect(G).toBeLessThan(0.03);
  });

  it('marks silence and noise unvoiced', () => {
    const rng = mulberry32(3);
    const x = new Float32Array(16000);
    for (let i = 0; i < x.length; i++) x[i] = (rng() * 2 - 1) * 0.01;
    const tr = trackPitch(x, 16000);
    const voiced = Array.from(tr.f0).filter(Boolean).length;
    expect(voiced / tr.f0.length).toBeLessThan(0.05);
  });

  it('follows a tone contour closely (rising tone, female)', () => {
    const c = thaiToneContour('rising');
    const res = synthUtterance([{ tone: 'rising', dur: 0.45, contour: c }], { floorHz: 160, ceilHz: 320, snrDb: 30 });
    const tr = trackPitch(res.pcm, 16000);
    const e = grossErrorRate(16000, res, tr);
    expect(e.recall).toBeGreaterThan(0.95);
    expect(e.gross).toBeLessThan(0.02);
  });
});
