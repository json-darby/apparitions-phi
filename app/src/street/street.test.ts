// The Street: scripts are well formed and built only from seed items, the branch
// runner applies effects and reports answers by the counting rule, and with a
// course loaded only the course's own scripts are offered.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { SEED_ITEMS, SEED_LETTERS, SEED_PATTERNS, SEED_CULTURE } from '../content/seed';
import { Content } from '../content/repo';
import { ENDING_IDS, METERS_PARTS, DOOR_TO_DOOR, STREET_TASKS, STREET_SIGNS, setCourseTasks, taskById, tasksFor, personForSource, type StreetTaskBuilt } from '../content/street-seed';
import type { Answer, AnswerResult } from '../engine/engine';
import { Engine } from '../engine/engine';
import { Six } from '../engine/grade';
import { openStore } from '../db/store';
import { ManualClock } from '../core/clock';
import { defaultSettings } from '../core/settings';
import { DialogueRun, distinctive, isTest } from './dialogue';
import { afterHoursParts, applyRun, chapterList, chapterReady, clarityFor, doneTasks, doorStops, loadStreet, meterItem, meterPartReady, saveStreet, streetProgress } from './state';

const IDS = new Set(SEED_ITEMS.map((i) => i.id));

class FakeEngine {
  log: Answer[] = [];
  known = new Set<string>();
  answer(a: Answer): AnswerResult {
    this.log.push(a);
    const counted = a.counts !== false && this.known.has(`${a.ref}:${a.skill}`);
    return { counted, six: null, due: null, retestAt: null, becameLeech: false };
  }
}

function knowAll(f: FakeEngine) {
  for (const it of SEED_ITEMS) for (const k of it.skills) f.known.add(`item:${it.id}:${k}`);
}

function rightIndex(t: StreetTaskBuilt, node: string) {
  return t.nodes[node].options.findIndex((o) => o.correct !== false);
}

describe('street scripts', () => {
  for (const identity of ['m', 'f'] as const) {
    const tasks = tasksFor(identity);
    it(`builds every task for identity ${identity}, from seed items only`, () => {
      expect(tasks.length).toBeGreaterThanOrEqual(8);
      for (const t of tasks) {
        expect(t.nodes[t.start]).toBeTruthy();
        for (const n of Object.values(t.nodes)) {
          for (const id of n.items) expect(IDS.has(id), `${t.id}/${n.id} npc item ${id}`).toBe(true);
          expect(n.options.length, `${t.id}/${n.id} options`).toBeGreaterThanOrEqual(2);
          expect(n.options.length).toBeLessThanOrEqual(5);
          expect(n.step).toBeLessThan(t.steps.length);
          for (const o of n.options) {
            expect(o.items.length).toBeGreaterThan(0);
            for (const id of o.items) expect(IDS.has(id), `${t.id}/${n.id} option item ${id}`).toBe(true);
            if (o.next) expect(t.nodes[o.next], `${t.id}/${n.id} -> ${o.next}`).toBeTruthy();
            expect(o.en.length).toBeGreaterThan(0);
          }
        }
      }
    });
    it(`ends learner lines with the ${identity === 'm' ? 'male' : 'female'} polite ending`, () => {
      for (const t of tasks)
        for (const n of Object.values(t.nodes))
          for (const o of n.options) {
            const end = o.items[o.items.length - 1];
            if (identity === 'm') {
              expect(end).toBe('khrap');
              expect(o.thai.endsWith('ครับ')).toBe(true);
            } else {
              expect(['kha-statement', 'kha-question']).toContain(end);
              expect(o.thai.endsWith('ค่ะ') || o.thai.endsWith('คะ')).toBe(true);
            }
          }
    });
  }

  it('gives most steps 3 to 5 replies, and every task a way to finish', () => {
    let nodes = 0;
    let ok = 0;
    for (const t of tasksFor('m')) {
      for (const n of Object.values(t.nodes)) {
        nodes++;
        if (n.options.length >= 3) ok++;
      }
      // walk right answers from the start: it must reach an end
      const run = new DialogueRun(t, new FakeEngine(), { patience: Infinity });
      let guard = 0;
      while (!run.ended && guard++ < 30) run.choose(rightIndex(t, run.node!));
      expect(run.outcome, t.id).toBe('done');
    }
    expect(ok / nodes).toBeGreaterThan(0.85);
  });

  it('has at least one street task per place, and keeps flirting behind 18+', () => {
    const street = STREET_TASKS.filter((t) => !t.chapter);
    for (const p of ['food', 'taxi', 'hotel', 'market', 'bar', 'pharmacy']) expect(street.some((t) => t.place === p), p).toBe(true);
    for (const t of STREET_TASKS) if (t.adult) expect(t.chapter).toBe('after-hours');
    expect(STREET_TASKS.filter((t) => t.chapter === 'after-hours').every((t) => t.adult)).toBe(true);
  });

  it('wires the chapters, small talk, signs and log sources', () => {
    for (const p of METERS_PARTS) expect(taskById(p.task, 'm')).toBeTruthy();
    for (const s of DOOR_TO_DOOR) expect(taskById(s.task, 'f')?.chapter).toBe('door-to-door');
    expect(taskById('smalltalk-bar', 'm')?.person).toBe('fah');
    expect(personForSource('street:food-water')).toBe('nok');
    expect(personForSource('street:smalltalk-taxi')).toBe('ton');
    for (const s of Object.values(STREET_SIGNS)) expect(IDS.has(s.item)).toBe(true);
  });
});

describe('dialogue runner', () => {
  const t = taskById('food-fried-rice', 'm')!;

  it('finds the items that set a reply apart', () => {
    const n = t.nodes.spice;
    expect(isTest(n)).toBe(true);
    expect(distinctive(n, n.options[0])).toEqual(['not-spicy']);
    for (const o of n.options) for (const id of distinctive(n, o)) expect(ENDING_IDS).not.toContain(id);
  });

  it('runs a task to done, applies baht and counts first-try reads with English hidden', () => {
    const f = new FakeEngine();
    knowAll(f);
    const run = new DialogueRun(t, f);
    const r1 = run.choose(0);
    expect(r1.correct).toBe(true);
    expect(r1.test).toBe(true);
    expect(r1.counted).toContain('item:fried-rice');
    expect(r1.counted).not.toContain('item:khrap');
    const r2 = run.choose(rightIndex(t, 'spice'));
    expect(r2.counted).toEqual(expect.arrayContaining(['item:not-spicy', 'item:spicy']));
    expect(f.log.some((a) => a.skill === 'hear' && a.ref === 'item:spicy')).toBe(true);
    const r3 = run.choose(rightIndex(t, 'pay'));
    expect(r3.outcome).toBe('done');
    expect(run.baht).toBe(-60);
    expect(f.log.every((a) => a.source === 'street:food-fried-rice')).toBe(true);
  });

  it('logs a wrong pick against the right reply, then does not count the retry', () => {
    const f = new FakeEngine();
    knowAll(f);
    const run = new DialogueRun(t, f);
    run.choose(0);
    const wrong = t.nodes.spice.options.findIndex((o) => o.correct === false);
    const r = run.choose(wrong);
    expect(r.correct).toBe(false);
    expect(r.expression).toBe('puzzled');
    expect(run.patience).toBe(2);
    expect(run.node).toBe('spice');
    const miss = f.log.find((a) => a.ref === 'item:not-spicy' && a.skill === 'read')!;
    expect(miss.correct).toBe(false);
    expect(miss.confusedWith).toBeTruthy();
    const retry = run.choose(rightIndex(t, 'spice'));
    expect(retry.first).toBe(false);
    expect(retry.counted).toEqual([]);
  });

  it('does not count when the English was shown', () => {
    const f = new FakeEngine();
    knowAll(f);
    const run = new DialogueRun(t, f);
    const r = run.choose(0, { glossShown: true });
    expect(r.counted).toEqual([]);
    expect(f.log.length).toBeGreaterThan(0);
    expect(f.log.every((a) => a.counts === false)).toBe(true);
  });

  it('does not count free choices', () => {
    const beer = taskById('bar-beer', 'm')!;
    const f = new FakeEngine();
    knowAll(f);
    const run = new DialogueRun(beer, f);
    run.choose(0);
    expect(isTest(beer.nodes.ice)).toBe(false);
    const r = run.choose(1);
    expect(r.test).toBe(false);
    expect(r.counted).toEqual([]);
  });

  it('fails the task when patience runs out', () => {
    const run = new DialogueRun(t, new FakeEngine());
    const wrong = t.nodes.order.options.findIndex((o) => o.correct === false);
    run.choose(wrong);
    run.choose(wrong);
    const r = run.choose(wrong);
    expect(r.outcome).toBe('failed');
    expect(run.node).toBeNull();
  });

  it('logs say with the learner rating, counting only a right reply', () => {
    const f = new FakeEngine();
    knowAll(f);
    const run = new DialogueRun(t, f);
    const res = run.say(t.nodes.order.options[0], Six.Good, 2000);
    expect(res.some((x) => x.counted)).toBe(true);
    expect(f.log.every((a) => a.skill === 'say' && a.own === Six.Good)).toBe(true);
    f.log = [];
    const wrong = t.nodes.order.options.find((o) => o.correct === false)!;
    expect(run.say(wrong, Six.Good).every((x) => !x.counted)).toBe(true);
  });

  it('After Hours: respecting a no raises rapport; pushing ends with her leaving', () => {
    const ah = taskById('after-hours-1', 'm')!;
    const go = (path: [string, number][]) => {
      const run = new DialogueRun(ah, new FakeEngine(), { patience: Infinity, comfort: 6 });
      let last;
      for (const [node, i] of path) {
        expect(run.node).toBe(node);
        last = run.choose(i);
      }
      return { run, last: last! };
    };
    const respect = go([['hello', 0], ['beer', 0], ['shirt', 0], ['sit', 0], ['no', 0], ['bye', 0]]);
    expect(respect.run.outcome).toBe('done');
    const pushIdx = ah.nodes.no.options.findIndex((o) => o.en.startsWith('Can I'));
    const pushAgain = ah.nodes.push.options.findIndex((o) => o.en.startsWith('Can I'));
    const push = go([['hello', 0], ['beer', 0], ['shirt', 0], ['sit', 0], ['no', pushIdx], ['push', pushAgain]]);
    expect(push.run.outcome).toBe('left');
    expect(push.last.expression).toBe('sad');
    expect(respect.run.rep).toBeGreaterThan(push.run.rep);
  });

  it('never introduces items through the real engine', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    const content = new Content({ items: SEED_ITEMS, letters: SEED_LETTERS, patterns: SEED_PATTERNS, culture: SEED_CULTURE });
    const clock = new ManualClock(Date.UTC(2026, 9, 2, 9));
    const settings = defaultSettings('2026-10-02');
    const engine = new Engine(store, content, clock, () => settings);
    engine.introduce('item:fried-rice');
    const refs = () => new Set(store.allCards().map((c) => c.ref));
    const before = refs();
    const run = new DialogueRun(t, engine);
    const r = run.choose(0);
    expect(r.counted).toEqual(['item:fried-rice']);
    run.choose(rightIndex(t, 'spice'));
    // the engine may open production skills of a met item; it never meets a new one
    expect([...refs()]).toEqual([...before]);
    const rows = store.all<{ ref: string; counted: number }>("SELECT ref, counted FROM log WHERE source = 'street:food-fried-rice'");
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.filter((x) => x.counted).map((x) => x.ref)).toEqual(['item:fried-rice']);
  });
});

describe('street state', () => {
  it('pays a reward once and clamps reputation', () => {
    const s0 = { baht: 500, rep: {}, done: [], chapters: {} };
    const a = applyRun(s0, { taskId: 'x', person: 'nok', outcome: 'done', baht: -60, rep: 1, reward: { baht: 40, rep: 2 } });
    expect(a.state.baht).toBe(480);
    expect(a.state.rep.nok).toBe(3);
    const b = applyRun(a.state, { taskId: 'x', person: 'nok', outcome: 'done', baht: -60, rep: 2, reward: { baht: 40, rep: 2 } });
    expect(b.state.baht).toBe(480);
    expect(b.state.rep.nok).toBe(3);
    const c = applyRun(b.state, { taskId: 'y', person: 'nok', outcome: 'done', baht: 0, rep: 30, reward: { baht: 0, rep: 0 } });
    expect(c.state.rep.nok).toBe(10);
    expect(clarityFor(0)).toBeLessThan(clarityFor(10));
  });

  it('counts the street tasks open by a day', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    saveStreet(store, { baht: 500, rep: {}, done: ['hotel-hello'], chapters: {} });
    const p = streetProgress(store, 1);
    expect(p.done).toBe(1);
    expect(p.today).toBeGreaterThanOrEqual(1);
    expect(p.total).toBe(STREET_TASKS.filter((t) => !t.chapter && t.day <= 1).length);
    expect(p.next?.id).not.toBe('hotel-hello');
  });

  it('every chapter part is ready in the seed set', () => {
    const content = { item: (id: string) => SEED_ITEMS.find((i) => i.id === id) };
    expect(METERS_PARTS.every((p) => meterPartReady(p, content))).toBe(true);
    expect(afterHoursParts().map((p) => [p.part, p.task, p.ready])).toEqual([[1, 'after-hours-1', true], [2, 'after-hours-2', true]]);
    expect(doorStops().every((d) => d.ready)).toBe(true);
    expect(chapterList(content).length).toBe(METERS_PARTS.length + 2 + 1);
  });
});

describe('with a course loaded, only its own scripts are offered', () => {
  // taken from the seed builds before the course mode starts (collection runs before hooks)
  const seed = { hello: taskById('hotel-hello', 'm')!, ah2: taskById('after-hours-2', 'm')!, mr1: taskById('meters-running-1', 'm')! };
  const course = [seed.hello, seed.ah2];
  const content = { item: (id: string) => SEED_ITEMS.find((i) => i.id === id) };
  beforeAll(() => setCourseTasks(course, SEED_ITEMS));
  afterAll(() => setCourseTasks([]));

  it('offers the course tasks and resolves no other id to a seed script', () => {
    expect(tasksFor('f').map((t) => t.id)).toEqual(['hotel-hello', 'after-hours-2']);
    expect(STREET_TASKS.map((t) => t.id)).toEqual(['hotel-hello', 'after-hours-2']);
    for (const id of ['food-water', 'meters-running-1', 'after-hours-1', 'd2d-hotel']) expect(taskById(id, 'm'), id).toBeUndefined();
    // old answer logs still belong to someone
    expect(personForSource('street:food-water')).toBe('nok');
  });

  it('composes small talk from the course words, without the placeholder note', () => {
    const t = taskById('smalltalk-bar', 'f')!;
    expect(t.note).toBeUndefined();
    expect(t.nodes.greet.options[0].thai).toBe('สวัสดีค่ะ');
    expect(t.nodes.greet.options[0].items).toEqual(['hello', 'kha-statement']);
  });

  it('offers no small talk when the course lacks one of its words', () => {
    setCourseTasks(course, SEED_ITEMS.filter((i) => i.id !== 'sorry'));
    expect(taskById('smalltalk-bar', 'm')).toBeUndefined();
    setCourseTasks(course, SEED_ITEMS);
  });

  it('marks chapter parts the course lacks as not ready', () => {
    expect(METERS_PARTS.map((p) => meterPartReady(p, content))).toEqual([false, false]);
    expect(afterHoursParts().map((p) => [p.part, p.task, p.ready])).toEqual([[1, 'after-hours-1', false], [2, 'after-hours-2', true]]);
    expect(doorStops().every((d) => !d.ready)).toBe(true);
    expect(chapterReady('meters-running', content)).toBe(false);
    expect(chapterReady('after-hours', content)).toBe(true);
    expect(chapterReady('door-to-door', content)).toBe(false);
    expect(chapterList(content).map((c) => c.title)).toEqual(['After Hours, part 2']);
  });

  it('a drive is not ready without the direction words, even with its talk', () => {
    const noTurn = SEED_ITEMS.filter((i) => i.id !== 'turn-left');
    setCourseTasks([...course, seed.mr1], noTurn);
    expect(meterPartReady(METERS_PARTS[0], { item: (id) => noTurn.find((i) => i.id === id) })).toBe(false);
    setCourseTasks([...course, seed.mr1], SEED_ITEMS);
    expect(meterPartReady(METERS_PARTS[0], content)).toBe(true);
    expect(meterPartReady(METERS_PARTS[1], content)).toBe(false);
    expect(chapterReady('meters-running', content)).toBe(true);
    setCourseTasks(course, SEED_ITEMS);
  });

  it('a drive accepts the course words for left and right (ซ้าย, ขวา) in place of เลี้ยวซ้าย, เลี้ยวขวา', () => {
    const base = SEED_ITEMS.filter((i) => i.id !== 'turn-left' && i.id !== 'turn-right');
    const words = [...base,
      { ...base[0], id: 'left', thai: 'ซ้าย', roman: 'sáai', en: 'left', tones: ['high' as const] },
      { ...base[0], id: 'right', thai: 'ขวา', roman: 'khwǎa', en: 'right', tones: ['rising' as const] }];
    const lookup = { item: (id: string) => words.find((i) => i.id === id) };
    setCourseTasks([...course, seed.mr1], words);
    expect(meterItem(lookup, 'turn-left')?.thai).toBe('ซ้าย');
    expect(meterItem(lookup, 'turn-right')?.thai).toBe('ขวา');
    expect(meterItem(lookup, 'straight')?.id).toBe('straight');
    expect(meterPartReady(METERS_PARTS[0], lookup)).toBe(true);
    setCourseTasks(course, SEED_ITEMS);
  });

  it('counts progress over course tasks only and keeps earlier ids in the saved state', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    saveStreet(store, { baht: 500, rep: {}, done: ['food-water', 'hotel-hello'], chapters: {} });
    expect(streetProgress(store, 1)).toEqual({ done: 1, total: 1, today: 1, next: null });
    expect(streetProgress(store, 30).total).toBe(1);
    expect(loadStreet(store).done).toEqual(['food-water', 'hotel-hello']);
    expect(doneTasks(store).map((s) => s.id)).toEqual(['hotel-hello']);
  });

  it('a course with no tasks offers none, not the seed scripts', () => {
    setCourseTasks([], SEED_ITEMS);
    expect(tasksFor('m')).toEqual([]);
    expect(taskById('hotel-hello', 'm')).toBeUndefined();
    expect(streetProgress({ get: () => ({ baht: 0, rep: {}, done: [], chapters: {} }) } as never, 5).total).toBe(0);
    setCourseTasks(course, SEED_ITEMS);
  });
});
