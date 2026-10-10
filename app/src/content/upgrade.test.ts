// An installed app moving to a new course version keeps the learner's progress: the content is
// reseeded, every card and log row stays, and the female forms reach a learner who speaks as a woman.

import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { existsSync, readFileSync } from 'node:fs';
import { openStore } from '../db/store';
import { applyCourse, forIdentity, loadContent, type CourseFile } from './repo';
import { Engine } from '../engine/engine';
import { ManualClock } from '../core/clock';
import { defaultSettings } from '../core/settings';
import { startOfDate } from '../core/dates';

const NEW = 'public/content/course.json';

/** The course as installs had it before the female forms: same ids, no forms, an older version. */
function olderCourse(course: CourseFile): CourseFile {
  const old = structuredClone(course);
  old.version = `${course.version}-older`;
  for (const it of old.items) if (it.example) delete it.example.forms;
  for (const p of old.patterns ?? []) for (const tiles of p.examples) for (const t of tiles) delete t.forms;
  for (const l of Object.values(old.lines ?? {})) delete (l as { forms?: unknown }).forms;
  return old;
}

describe.skipIf(!existsSync(NEW))('upgrading an installed app to the new course', () => {
  it('keeps every card and gives the new content', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    const newCourse = JSON.parse(readFileSync(NEW, 'utf-8')) as CourseFile;
    const oldCourse = olderCourse(newCourse);
    expect(oldCourse.version).not.toBe(newCourse.version);

    expect(applyCourse(store, oldCourse)).toBe(true);
    const settings = { ...defaultSettings('2026-10-08'), onboarded: true, startDate: '2026-10-08' };
    const clock = new ManualClock(startOfDate('2026-10-09') + 10 * 3600_000);
    const engine = new Engine(store, loadContent(store), clock, () => settings);
    // two days in: meet the day's material
    for (const ref of engine.planDay().newRefs) engine.introduce(ref);
    const cards = store.allCards().length;
    const logs = store.logSince(0).length;
    expect(cards).toBeGreaterThan(20);

    expect(applyCourse(store, newCourse)).toBe(true);
    expect(store.allCards().length).toBe(cards);
    expect(store.logSince(0).length).toBe(logs);
    const content = loadContent(store);
    expect(content.item('item:chicken')?.example?.forms?.f.thai).toBe('ฉันกินไก่');
    expect(forIdentity(content, 'f').item('item:chicken')?.example?.thai).toBe('ฉันกินไก่');
    // every card still points at content that exists
    for (const c of store.allCards()) expect(content.entry(c.ref) ?? c.ref.startsWith('school:')).toBeTruthy();
    // and the engine plans the next day on it
    const after = new Engine(store, content, clock, () => settings);
    expect(after.planDay({ keep: false }).reviews.length + after.planDay({ keep: false }).newRefs.length).toBeGreaterThan(0);
  });
});
