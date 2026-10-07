// School of the Night and the memory schedule. Each line becomes a card on the
// 'say' skill, keyed school:<line id> in the same cards table, scheduled by the
// same FSRS settings as every other card. A turn only moves it when it counts
// (level 3, nothing revealed: see runner.ts); every turn is logged. A counted
// turn also answers the course items the line is built from, through the
// engine, so a missed line sends its words to the normal reviews.
//
// The line cards themselves are not course content, so the main Review screen
// leaves them out; the section map shows them as due, and "Pick for me" starts
// with them.

import { createEmptyCard, fsrs, State, type Card, type FSRS } from 'ts-fsrs';
import type { Engine } from '../engine/engine';
import { measuredGrade, Six, SIX_TO_FSRS } from '../engine/grade';
import type { CardRow, Store } from '../db/store';
import { ENDINGS, isSchoolWord, PRONOUNS, type SchoolLine, type SchoolSection } from './content';
import { wheelOf, type Result, type Wheels } from './runner';

export const lineRef = (lineId: string) => `school:${lineId}`;
export const lineKey = (lineId: string) => `${lineRef(lineId)}:say`;

let scheduler: FSRS | null = null;
function fsrsFor(): FSRS {
  // the engine's settings for a normal card (retention 0.9, one ten-minute learning step)
  scheduler ??= fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: true, learning_steps: ['10m'], relearning_steps: ['10m'] });
  return scheduler;
}

function readCard(row: CardRow): Card {
  const c = JSON.parse(row.state) as Card & { due: string; last_review?: string };
  return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined };
}

/** The line's card, made on first use (due now). */
export function ensureLineCard(store: Store, lineId: string, now = Date.now()): CardRow {
  const key = lineKey(lineId);
  const have = store.getCard(key);
  if (have) return have;
  const row: CardRow = { key, ref: lineRef(lineId), skill: 'say', due: now, state: JSON.stringify(createEmptyCard(now)), lapses: 0, leech: 0, introduced: now, meta: '{}' };
  store.putCard(row);
  return row;
}

export interface Turn {
  lineId: string | null;
  /** slot sentences have no line card; their items still count */
  key: string;
  kind: string;
  result: Result;
  counted: boolean;
  level: number;
  /** course items in what was said */
  items: string[];
  /** 0..1 from the on-device tone score (and the speech check), when measured */
  speech?: number | null;
  /** from the end of the tutor's line to the start of yours */
  ms?: number | null;
  helped?: boolean;
}

/** Items worth a review: not the polite ending, not "I", not a school-only word (no card). */
export function reviewItems(items: string[]): string[] {
  return [...new Set(items.filter((id) => !ENDINGS.includes(id) && !PRONOUNS.includes(id) && !isSchoolWord(id)))];
}

/**
 * Log a turn; when it counts, move the line's card and answer its items.
 * Returns the line card's next due time when it moved.
 */
export function recordTurn(store: Store, engine: Engine | null, t: Turn, now = Date.now()): { due: number | null; items: string[] } {
  if (t.result === 'skip') return { due: null, items: [] };
  const correct = t.result === 'right';
  const six = t.result === 'none' ? Six.Blank : !correct ? Six.Wrong : measuredGrade({ correct: true, speechScore: t.speech ?? null, typicalMs: 0 }) ?? Six.Good;
  let due: number | null = null;
  let grade: number | null = null;
  if (t.lineId) {
    const row = ensureLineCard(store, t.lineId, now);
    if (t.counted) {
      const { grade: g } = SIX_TO_FSRS[six];
      grade = g;
      const rec = fsrsFor().next(readCard(row), new Date(now), g);
      due = rec.card.due.getTime();
      const lim = engine?.tripLimit() ?? null;
      if (lim != null && due > lim) due = lim + 1;
      store.putCard({ ...row, due, state: JSON.stringify(rec.card), lapses: rec.card.lapses });
    }
    store.appendLog({
      at: now, ref: lineRef(t.lineId), skill: 'say', source: 'school', rating: null, grade, correct: correct ? 1 : 0, ms: null, counted: t.counted ? 1 : 0,
      data: JSON.stringify({ kind: t.kind, level: t.level, six: t.counted ? six : null, speech: t.speech ?? null, answerMs: t.ms ?? null, helped: !!t.helped }),
    });
  }
  const items: string[] = [];
  if (t.counted && engine) {
    for (const id of reviewItems(t.items)) {
      const r = engine.answer({
        ref: `item:${id}`, skill: 'say', source: 'school', correct, blank: t.result === 'none', counts: true,
        speechScore: t.speech ?? null, data: { school: t.key, kind: t.kind },
      });
      if (r.counted) items.push(id);
    }
  }
  return { due, items };
}

/** The line's card is due (or overdue). */
export function lineDue(store: Store, lineId: string, now = Date.now()): boolean {
  const row = store.getCard(lineKey(lineId));
  return !!row && row.due <= now && readCard(row).state !== State.New;
}

/** Recall chance of the line's card now, 0 when never reviewed. */
export function lineRecall(store: Store, lineId: string, now = Date.now()): number {
  const row = store.getCard(lineKey(lineId));
  if (!row) return 0;
  const c = readCard(row);
  return c.state === State.New ? 0 : fsrsFor().get_retrievability(c, new Date(now), false);
}

/** Lines you can say without help: at support level 3. */
export function withoutHelp(section: SchoolSection, wheels: Wheels): number {
  return section.lines.filter((l) => wheelOf(wheels, l.id).level === 3).length;
}

/**
 * "Pick for me": your weakest lines first. Due line cards, then lines missed
 * most recently with the most support, then the rest you have practised by
 * recall; lines never tried come last, in course order.
 */
export function weakestLines(lines: SchoolLine[], wheels: Wheels, store: Store, now = Date.now()): SchoolLine[] {
  const score = (l: SchoolLine) => {
    const w = wheelOf(wheels, l.id);
    if (!w.turns) return 10; // never tried
    const due = lineDue(store, l.id, now) ? -2 : 0;
    const missRate = w.misses / Math.max(1, w.turns);
    return due + w.level - missRate + lineRecall(store, l.id, now) * 0.5;
  };
  return lines
    .map((l, i) => ({ l, i, s: score(l) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.l);
}

/** Line cards due now, for the School of the Night row on Today. */
export function schoolDueCount(store: Store, now = Date.now()): number {
  return store.one<{ n: number }>("SELECT COUNT(*) AS n FROM cards WHERE ref LIKE 'school:%' AND due <= ? AND json_extract(state, '$.reps') > 0", [now])?.n ?? 0;
}
