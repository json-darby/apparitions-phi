// Line cards and item reviews, through a real store and the real engine.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../core/clock';
import { defaultSettings } from '../core/settings';
import { Content } from '../content/repo';
import type { Item } from '../content/types';
import { openStore } from '../db/store';
import { Engine } from '../engine/engine';
import { lineIndex, type SchoolFile } from './content';
import { lineDue, lineKey, recordTurn, reviewItems, weakestLines, withoutHelp } from './reviews';
import { newWheel } from './runner';

const school = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/school.json'), 'utf8')) as SchoolFile;
const course = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/course.json'), 'utf8')) as { items: Item[] };
const line = (id: string) => lineIndex(school).get(id)!.line;

async function setup() {
  const SQL = await initSqlJs();
  const store = await openStore(SQL, null);
  const content = new Content({ items: course.items, letters: [], patterns: [], culture: [] });
  const clock = new ManualClock(Date.UTC(2026, 9, 7, 9));
  const settings = defaultSettings('2026-10-07');
  const engine = new Engine(store, content, clock, () => settings);
  return { store, engine, clock };
}

describe('line cards', () => {
  it('a line becomes a say card; an uncounted turn is logged and moves nothing', async () => {
    const { store, engine, clock } = await setup();
    const now = clock.now();
    const out = recordTurn(store, engine, { lineId: 'mk.thank-you', key: 'mk.thank-you', kind: 'branch', result: 'right', counted: false, level: 1, items: line('mk.thank-you').m.items }, now);
    expect(out.due).toBeNull();
    const row = store.getCard(lineKey('mk.thank-you'))!;
    expect(row).toMatchObject({ ref: 'school:mk.thank-you', skill: 'say', due: now });
    const log = store.all<{ ref: string; counted: number; source: string }>("SELECT ref, counted, source FROM log WHERE source = 'school'");
    expect(log).toEqual([{ ref: 'school:mk.thank-you', counted: 0, source: 'school' }]);
    // line cards are not course content: Review, games and progress counts leave them out
    expect(engine.introducedRefs().has('school:mk.thank-you')).toBe(false);
    expect(engine.dueNow(now + 1).some((r) => r.ref.startsWith('school:'))).toBe(false);
  });

  it('a counted miss sends the line and its words to reviews', async () => {
    const { store, engine, clock } = await setup();
    const now = clock.now();
    // the learner can already say "thank you": its say card exists
    engine.introduce('item:thank-you', ['hear', 'say']);
    const l = line('mk.thank-you');
    recordTurn(store, engine, { lineId: l.id, key: l.id, kind: 'recall', result: 'right', counted: true, level: 3, items: l.m.items }, now);
    const after = store.getCard(lineKey(l.id))!;
    expect(after.due).toBeGreaterThan(now);
    clock.advance(3 * 86_400_000);
    const out = recordTurn(store, engine, { lineId: l.id, key: l.id, kind: 'recall', result: 'wrong', counted: true, level: 3, items: l.m.items }, clock.now());
    expect(out.due! - clock.now()).toBeLessThanOrEqual(15 * 60_000);
    expect(out.items).toEqual(['thank-you']);
    expect(lineDue(store, l.id, clock.now() + 20 * 60_000)).toBe(true);
    const item = store.getCard('item:thank-you:say')!;
    expect(item.due - clock.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it('never reviews the polite ending or "I"', () => {
    expect(reviewItems(['i-male', 'come-from', 'england', 'khrap'])).toEqual(['come-from', 'england']);
  });

  it('a skip logs nothing', async () => {
    const { store, engine } = await setup();
    recordTurn(store, engine, { lineId: 'mk.yes', key: 'mk.yes', kind: 'recall', result: 'skip', counted: false, level: 1, items: [] });
    expect(store.logCount()).toBe(0);
  });
});

describe('the map', () => {
  it('counts the lines you can say without help', () => {
    const s = school.sections[0];
    expect(withoutHelp(s, {})).toBe(0);
    expect(withoutHelp(s, { 'mk.yes': { ...newWheel(), level: 3, streak: 4 }, 'mk.no': { ...newWheel(), level: 2, streak: 2 } })).toBe(1);
  });

  it('"Pick for me" starts with the weakest practised lines, untried ones last', async () => {
    const { store } = await setup();
    const lines = school.sections[0].lines;
    const wheels = {
      'mk.yes': { ...newWheel(), level: 3 as const, streak: 6, turns: 6 },
      'mk.no': { ...newWheel(), level: 1 as const, streak: 0, turns: 5, misses: 3 },
      'mk.sorry': { ...newWheel(), level: 2 as const, streak: 2, turns: 3, misses: 0 },
    };
    const order = weakestLines(lines, wheels, store).map((l) => l.id);
    expect(order.slice(0, 3)).toEqual(['mk.no', 'mk.sorry', 'mk.yes']);
    expect(order[3]).toBe('mk.hello');
  });
});
