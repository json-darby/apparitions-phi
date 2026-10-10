// Phase 1 exit test, part one: a simulated 30 days of reviews runs correctly.

import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { formatSim, simulate, syntheticContent } from './simulator';
import { openStore } from '../db/store';

describe('30-day simulation, 60-minute track', async () => {
  const r = await simulate({ days: 30, track: 60, seed: 11 });
  console.log('\n60-minute track\n' + formatSim(r));

  it('keeps every day\'s planned reviews inside the review capacity', () => {
    for (const d of r.days) expect(d.plannedReviewMin).toBeLessThanOrEqual(d.capacityMin + 1e-9);
  });
  it('keeps the actual session inside the daily budget (10% tolerance for slow answers)', () => {
    for (const d of r.days) expect(d.actualMin).toBeLessThanOrEqual(d.budgetMin * 1.1);
  });
  it('meets about 360 words and phrases, the letters and the patterns', () => {
    expect(r.introducedByKind.item).toBeGreaterThan(320);
    expect(r.introducedByKind.letter).toBeGreaterThanOrEqual(40);
    expect(r.introducedByKind.pattern).toBeGreaterThanOrEqual(40);
  });
  it('never schedules a review past the trip', () => {
    expect(r.maxDueAfterTrip).toBeLessThanOrEqual(0);
  });
  it('holds survival items high at the trip date', () => {
    expect(r.survivalRecallAtTrip).toBeGreaterThan(0.85);
  });
  it('finds leeches and gives them a new hook', () => {
    expect(r.leechesTotal).toBeGreaterThan(0);
    expect(r.engine.leeches().length).toBe(0);
  });
  it('keeps the answer log append-only', () => {
    expect(r.store.logCount()).toBeGreaterThan(1000);
    expect(() => r.store.run('UPDATE log SET counted = 0 WHERE seq = 1')).toThrow(/append-only/);
    expect(() => r.store.run('DELETE FROM log WHERE seq = 1')).toThrow(/append-only/);
  });
});

describe('30-day simulation, 30-minute track', async () => {
  const r = await simulate({ days: 30, track: 30, seed: 5 });
  console.log('\n30-minute track\n' + formatSim(r));
  it('keeps every day inside budget', () => {
    for (const d of r.days) {
      expect(d.plannedReviewMin).toBeLessThanOrEqual(d.capacityMin + 1e-9);
      expect(d.actualMin).toBeLessThanOrEqual(d.budgetMin * 1.1);
    }
  });
  // Half an hour teaches each day's lesson first: its letters and pattern, then as many of its words
  // as the time holds. This synthetic course has a letter or two and a pattern every day, so all of
  // them are met and the words take what is left. What the real course teaches on each plan (the
  // numbers onboarding shows) is held in plans.test.ts.
  it('meets every letter and pattern of the lessons, and the words the time holds', () => {
    expect(r.introducedByKind.letter).toBe(syntheticContent(30).letters.length);
    expect(r.introducedByKind.pattern).toBeGreaterThanOrEqual(30);
    expect(r.introducedByKind.item).toBeGreaterThanOrEqual(115);
  });
});

describe('missed days: the load balancer cuts new items first', async () => {
  const r = await simulate({ days: 30, track: 60, seed: 3, missed: [9, 10, 11, 12, 13] });
  console.log('\nMissed days 9 to 13\n' + formatSim(r));
  const back = r.days.find((d) => d.day === 14)!;
  it('cuts new items on the day back', () => {
    expect(back.newCut).toBeGreaterThan(0);
  });
  it('still keeps reviews inside capacity, deferring the least urgent', () => {
    for (const d of r.days) expect(d.plannedReviewMin).toBeLessThanOrEqual(d.capacityMin + 1e-9);
  });
  it('recovers: new items flow again before the end', () => {
    expect(r.days.slice(-5).some((d) => d.introduced > 0)).toBe(true);
  });
});

describe('game contract', async () => {
  const r = await simulate({ days: 5, track: 60, seed: 2 });
  it('games only ever get items already met', () => {
    const met = r.engine.introducedRefs();
    const got = r.engine.forGame({ skills: ['hear', 'read', 'tone', 'say', 'write'], count: 500 });
    expect(got.length).toBeGreaterThan(0);
    for (const g of got) expect(met.has(g.ref)).toBe(true);
  });
  it('an answer that did not need the Thai is logged but does not move the schedule', () => {
    const g = r.engine.forGame({ skills: ['hear'], count: 1 })[0];
    const before = r.engine.card(g.ref, 'hear')!;
    const res = r.engine.report({ ref: g.ref, skill: 'hear', source: 'drill:test', correct: true, ms: 1000, counts: false });
    expect(res.counted).toBe(false);
    expect(r.engine.card(g.ref, 'hear')!.state).toBe(before.state);
  });
});

describe('store persists through export and reload', () => {
  it('round-trips the database file', async () => {
    const SQL = await initSqlJs();
    let saved: Uint8Array | null = null;
    const s1 = await openStore(SQL, { load: async () => null, save: async (b) => { saved = b; } });
    s1.set('settings', { a: 1 });
    await s1.flush();
    const s2 = await openStore(SQL, { load: async () => saved, save: async () => {} });
    expect(s2.get('settings', null)).toEqual({ a: 1 });
  });
});
