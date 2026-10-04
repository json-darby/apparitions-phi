// Today's lesson: the 60 lessons hold to their content rules, and every Thai
// example is a real course item the learner can have met by that day.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CourseFile } from './repo';
import type { Item } from './types';
import { LESSONS, lessonDay, lessonExamples, lessonFor, lessonsUpTo, lessonWords, ownFirst, thaiRuns } from './lessons';

const CHECKPOINTS = [7, 14, 21, 30, 37, 44, 51, 58, 59, 60];

/** Every piece of English prose in a lesson. */
function prose(l: (typeof LESSONS)[number]): string[] {
  return [l.title, l.goal, ...l.sections.flatMap((s) => [s.heading, ...s.body])];
}

describe('the lessons', () => {
  it('has one lesson for each day from 1 to 60, in order', () => {
    expect(LESSONS.map((l) => l.day)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('has unique, short titles', () => {
    const titles = LESSONS.map((l) => l.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(48);
  });

  it('gives every lesson a one-line goal and two to four sections', () => {
    for (const l of LESSONS) {
      expect(l.goal.startsWith('By the end of today you can '), `day ${l.day}`).toBe(true);
      expect(l.goal).not.toMatch(/\n/);
      expect(l.sections.length, `day ${l.day}`).toBeGreaterThanOrEqual(2);
      expect(l.sections.length, `day ${l.day}`).toBeLessThanOrEqual(4);
      for (const s of l.sections) {
        expect(s.heading.trim(), `day ${l.day}`).not.toBe('');
        expect(s.body.length, `day ${l.day}: ${s.heading}`).toBeGreaterThan(0);
        for (const p of s.body) expect(p.trim(), `day ${l.day}: ${s.heading}`).not.toBe('');
      }
    }
  });

  it('keeps each lesson to about 150 to 250 words of English', () => {
    for (const l of LESSONS) {
      const n = lessonWords(l);
      expect(n, `day ${l.day}: ${n} words`).toBeGreaterThanOrEqual(150);
      expect(n, `day ${l.day}: ${n} words`).toBeLessThanOrEqual(250);
    }
  });

  it('marks the checkpoint days', () => {
    for (const l of LESSONS) expect(l.title.startsWith('Checkpoint'), `day ${l.day}`).toBe(CHECKPOINTS.includes(l.day));
  });

  it('keeps Thai out of the prose, except one example word in a section body', () => {
    for (const l of LESSONS) {
      for (const t of [l.title, l.goal, ...l.sections.map((s) => s.heading)]) expect(thaiRuns(t), `day ${l.day}: ${t}`).toEqual([]);
      for (const s of l.sections) {
        for (const p of s.body) {
          const runs = new Set(thaiRuns(p));
          expect(runs.size, `day ${l.day}: ${p}`).toBeLessThanOrEqual(1);
          for (const r of runs) expect(s.examples ?? [], `day ${l.day}: ${r} needs its item in this section`).not.toHaveLength(0);
        }
      }
    }
  });

  it('keeps romanisation, exclamation marks, emoji and American spellings out of the prose', () => {
    for (const l of LESSONS) {
      for (const p of prose(l)) {
        expect(p, `day ${l.day}`).not.toMatch(/[àáâǎèéêěìíîǐòóôǒùúûǔʉə]/i);
        expect(p, `day ${l.day}`).not.toMatch(/!/);
        expect(p, `day ${l.day}`).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(p, `day ${l.day}`).not.toMatch(/\b(color\w*|favorite|recogniz\w*|practic(ing|ed)|center|traveling|neighbor\w*|realiz\w*|gray|program)\b/i);
      }
    }
  });

  it('finds lessons by day', () => {
    expect(lessonFor(1)?.day).toBe(1);
    expect(lessonFor(60)?.day).toBe(60);
    expect(lessonFor(0)).toBeNull();
    expect(lessonFor(61)).toBeNull();
    expect(lessonFor(2.5)).toBeNull();
    expect(lessonsUpTo(7).map((l) => l.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(lessonsUpTo(0)).toEqual([]);
  });

  it('opens the asked day, or today capped to the course', () => {
    expect(lessonDay('5', 12, 30)).toBe(5);
    expect(lessonDay('45', 12, 30)).toBe(45);
    expect(lessonDay(null, 12, 30)).toBe(12);
    expect(lessonDay('0', 12, 30)).toBe(12);
    expect(lessonDay('61', 12, 30)).toBe(12);
    expect(lessonDay('abc', 3, 30)).toBe(3);
    expect(lessonDay('2.5', 3, 30)).toBe(3);
    expect(lessonDay(null, 34, 30)).toBe(30);
    expect(lessonDay(null, 70, 60)).toBe(60);
    expect(lessonDay(null, 0, 30)).toBe(1);
  });

  it('puts the learner’s own forms first', () => {
    type X = { id: string; speaker?: 'm' | 'f' };
    const xs: X[] = [{ id: 'i-male', speaker: 'm' }, { id: 'i-female', speaker: 'f' }, { id: 'you' }];
    expect(ownFirst(xs, 'm').map((x) => x.id)).toEqual(['i-male', 'you', 'i-female']);
    expect(ownFirst(xs, 'f').map((x) => x.id)).toEqual(['i-female', 'you', 'i-male']);
    expect(ownFirst<X>([{ id: 'a' }, { id: 'b' }], 'f').map((x) => x.id)).toEqual(['a', 'b']);
  });
});

const COURSE_FILE = resolve(__dirname, '../../public/content/course.json');
describe.skipIf(!existsSync(COURSE_FILE))('the lessons on the bundled course', () => {
  const items = new Map<string, Item>(
    (JSON.parse(readFileSync(COURSE_FILE, 'utf8')) as CourseFile).items.filter((it) => it.status !== 'draft').map((it) => [it.id, it]),
  );

  it('uses only course items the learner can have met by that day', () => {
    for (const l of LESSONS) {
      for (const id of lessonExamples(l)) {
        const it = items.get(id);
        expect(it, `day ${l.day}: ${id} is not in the course`).toBeTruthy();
        expect(it!.day, `day ${l.day}: ${id} opens on day ${it!.day}`).toBeLessThanOrEqual(l.day);
      }
    }
  });

  it('uses only examples everyone may see, each with a clip', () => {
    for (const l of LESSONS) {
      for (const id of lessonExamples(l)) {
        const it = items.get(id)!;
        expect(!!it.adult, `day ${l.day}: ${id} is 18+`).toBe(false);
        expect(Object.values(it.media?.audio ?? {}).some(Boolean), `day ${l.day}: ${id} has no clip`).toBe(true);
      }
    }
  });

  it('names Thai in a body only as the exact Thai of an example in the same section', () => {
    for (const l of LESSONS) {
      for (const s of l.sections) {
        const allowed = new Set((s.examples ?? []).map((id) => items.get(id)?.thai));
        for (const p of s.body) for (const r of thaiRuns(p)) expect(allowed.has(r), `day ${l.day}: ${r}`).toBe(true);
      }
    }
  });
});
