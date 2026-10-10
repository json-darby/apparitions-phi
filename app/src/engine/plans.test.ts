// What onboarding promises is what the planner really teaches: the real course,
// run day by day through the real engine by a learner who does every session.
// Each day stays inside its time and teaches its own lesson's words.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Content } from '../content/repo';
import { emptyMedia, type Item, type Letter, type Pattern } from '../content/types';
import { DAY_MS, startOfDate } from '../core/dates';
import { planWords } from '../path/pathway';
import { simulate } from './simulator';

const COURSE = 'public/content/course.json';
const course = existsSync(COURSE) ? JSON.parse(readFileSync(COURSE, 'utf-8')) : null;
const media = <T extends { media?: unknown }>(x: T): T => {
  const m = (x.media ?? {}) as { audio?: Record<string, string | null> };
  return { ...x, media: { ...emptyMedia(), ...m, audio: { ...emptyMedia().audio, ...(m.audio ?? {}) } } };
};
const content = () =>
  new Content({ items: (course.items as Item[]).map(media), letters: (course.letters as Letter[]).map(media), patterns: (course.patterns as Pattern[]).map(media), culture: course.culture ?? [] });

const PLANS = [
  [60, 60],
  [60, 30],
  [30, 60],
  [30, 30],
] as const;

describe.skipIf(!course)('the plans on the real course', () => {
  for (const [courseDays, minutes] of PLANS) {
    it(`${courseDays} days at ${minutes} minutes teaches what onboarding says, a day at a time`, async () => {
      const r = await simulate({ days: courseDays, track: minutes, courseDays, seed: 7 }, content());
      const words = r.introducedByKind.item ?? 0;
      // onboarding rounds to tens; one learner differs from the next by a few percent
      expect(words).toBeGreaterThanOrEqual(planWords(courseDays, minutes) * 0.95);

      if (courseDays === 60 && minutes === 60) {
        // the full plan teaches the whole alphabet and every sentence pattern
        expect(r.introducedByKind.letter).toBe(course.letters.length);
        expect(r.introducedByKind.pattern).toBe(course.patterns.length);
      }

      // no day runs long: a little over on the odd day, never a lot
      const long = r.days.filter((d) => d.actualMin > d.budgetMin * 1.05);
      expect(long.length).toBeLessThanOrEqual(4);
      for (const d of r.days) expect(d.actualMin).toBeLessThanOrEqual(d.budgetMin * 1.1);

      // a word is met on its own lesson's day
      const dayOf = new Map<string, number>(course.items.map((i: Item) => [`item:${i.id}`, i.day]));
      const start = startOfDate(r.days[0].date);
      const met = new Map<string, number>();
      for (const row of r.store.logSince(0)) if (dayOf.has(row.ref) && !met.has(row.ref)) met.set(row.ref, Math.floor((row.at - start) / DAY_MS) + 1);
      const onDay = [...met].filter(([ref, d]) => d <= (dayOf.get(ref) as number)).length;
      expect(onDay / met.size).toBeGreaterThanOrEqual(minutes === 60 && courseDays === 60 ? 0.8 : 0.9);
    }, 300000);
  }
});
