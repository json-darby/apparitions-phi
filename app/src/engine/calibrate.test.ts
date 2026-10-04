import { describe, expect, it } from 'vitest';
import { calibrate, personalRetention, type Observation } from './calibrate';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function learner(k: number, n: number, seed = 1): Observation[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const pred = 0.55 + r() * 0.43;
    return { pred, recalled: r() < Math.pow(pred, k) };
  });
}

describe('calibration', () => {
  it('stays at 1 with no evidence', () => {
    expect(calibrate([]).k).toBe(1);
  });
  it('recovers a learner who forgets faster than the model', () => {
    const c = calibrate(learner(1.8, 1500, 3));
    expect(c.k).toBeGreaterThan(1.5);
    expect(c.k).toBeLessThan(2.1);
    expect(c.lo).toBeLessThan(1.8);
    expect(c.hi).toBeGreaterThan(1.8);
  });
  it('recovers a learner who remembers better than the model', () => {
    const c = calibrate(learner(0.6, 1500, 4));
    expect(c.k).toBeGreaterThan(0.45);
    expect(c.k).toBeLessThan(0.8);
  });
  it('is cautious with little evidence', () => {
    const c = calibrate(learner(2.5, 15, 5));
    expect(c.k).toBeLessThan(2.2);
    expect(c.hi - c.lo).toBeGreaterThan(0.5);
  });
  it('asks FSRS for more retention when the learner forgets faster', () => {
    expect(personalRetention(0.9, 1)).toBeCloseTo(0.9);
    expect(personalRetention(0.9, 1.5)).toBeGreaterThan(0.92);
    expect(personalRetention(0.9, 0.7)).toBeLessThan(0.9);
    expect(personalRetention(0.95, 3)).toBeLessThanOrEqual(0.97);
  });
});
