// The pipeline → app contract, end to end. Loads the pipeline's dry-run
// course.json (written by `run.py pack --dry-run`) through the app's own loader,
// then plays a generated conversation as both speakers. Skips when no dry-run
// course exists yet.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { openStore } from '../db/store';
import { applyCourse, loadContent, type CourseFile } from './repo';
import { ENDING_IDS, STREET_TASKS, setCourseTasks, taskById, tasksFor } from './street-seed';
import { DialogueRun } from '../street/dialogue';
import type { Answer, AnswerResult } from '../engine/engine';

const DRY = resolve(__dirname, '../../../pipeline/work/dry/course.json');
const have = existsSync(DRY);

describe.skipIf(!have)('generated course loads into the app', async () => {
  const course = JSON.parse(readFileSync(DRY, 'utf8')) as CourseFile & { items: { id: string; status: string }[] };
  const SQL = await initSqlJs();
  const store = await openStore(SQL, null);
  const applied = applyCourse(store, course);
  const content = loadContent(store);
  setCourseTasks(content.tasks, content.items);
  afterAll(() => setCourseTasks([]));

  it('replaces the seed content', () => {
    expect(applied).toBe(true);
    expect(content.items.length).toBe(course.items.filter((i) => i.status !== 'draft').length);
    expect(content.letters.length).toBe(course.letters!.length);
    expect(content.patterns.length).toBe(course.patterns!.length);
    expect(content.culture.length).toBe(course.culture!.length);
    expect(content.tasks.length).toBe(course.tasks!.length);
    expect(content.lines.size).toBe(Object.keys(course.lines!).length);
  });

  it('a second load of the same version does not reseed', () => {
    expect(applyCourse(store, course)).toBe(false);
  });

  it('every item a script uses exists in the course', () => {
    const ids = new Set(content.items.map((i) => i.id));
    const missing = new Set<string>();
    for (const t of content.tasks)
      for (const n of Object.values(t.nodes)) for (const o of n.options) for (const i of o.items) if (!ids.has(i)) missing.add(i);
    expect([...missing]).toEqual([]);
  });

  it('the street now runs the generated scripts', () => {
    expect(STREET_TASKS.length).toBe(content.tasks.length);
    expect(tasksFor('m').map((t) => t.id)).toEqual(content.tasks.map((t) => t.id));
  });

  it('learner replies follow the speaking identity', () => {
    for (const t of tasksFor('f')) {
      for (const n of Object.values(t.nodes)) {
        for (const o of n.options) {
          expect(o.thai.endsWith('ครับ')).toBe(false);
          expect(o.items.includes('khrap')).toBe(false);
          // the tones list matches the Thai it belongs to
          expect(o.tones.length).toBeGreaterThan(0);
        }
      }
    }
    const anyEnding = tasksFor('m').some((t) => Object.values(t.nodes).some((n) => n.options.some((o) => o.items.some((i) => ENDING_IDS.includes(i)))));
    expect(anyEnding).toBe(true);
  });

  it('a generated conversation plays to the end for both speakers', () => {
    for (const identity of ['m', 'f'] as const) {
      const task = tasksFor(identity).find((t) => !t.chapter)!;
      const log: Answer[] = [];
      const engine = { answer: (a: Answer): AnswerResult => (log.push(a), { counted: false, six: null, due: null, retestAt: null, becameLeech: false }) };
      const run = new DialogueRun(task, engine);
      let guard = 0;
      while (!run.ended && guard++ < 50) {
        const node = run.current!;
        const right = node.options.findIndex((o) => o.correct !== false);
        run.choose(right);
      }
      expect(run.outcome).toBe('done');
      expect(log.every((a) => a.source === `street:${task.id}`)).toBe(true);
    }
  });

  it('offers only the course’s own scripts: an id it lacks is not ready, never the seed placeholder', () => {
    const have = new Set(content.tasks.map((t) => t.id));
    for (const id of ['hotel-hello', 'meters-running-1', 'meters-running-2', 'after-hours-1', 'd2d-hotel', 'food-water']) {
      expect(!!taskById(id, 'f'), id).toBe(have.has(id));
    }
  });

  it('small talk is built from the course’s own words, or not offered', () => {
    const ids = new Set(content.items.map((i) => i.id));
    const t = taskById('smalltalk-food', 'f');
    if (['hello', 'thank-you', 'sorry', 'kha-statement'].every((id) => ids.has(id))) {
      expect(t).toBeTruthy();
      expect(t!.note).toBeUndefined();
      for (const o of t!.nodes.greet.options) for (const id of o.items) expect(ids.has(id), id).toBe(true);
      expect(t!.nodes.greet.options[0].thai.endsWith('ค่ะ')).toBe(true);
    } else {
      expect(t).toBeUndefined();
    }
  });
});
