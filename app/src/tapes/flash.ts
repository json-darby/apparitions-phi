// Flashcards for one unit (or every card that is due): a session you can
// finish in one sitting, with the spacing worked out inside it.
//
// Each answer (1 ? (don't know) … 5 Easy) sets how many more clean recalls the card
// needs today and how far away its next showing is. The gap is counted in
// cards AND in seconds, whichever is later, and widens with every recall, so
// the card has to come back out of memory rather than from the last few
// seconds. New cards come in a few at a time. When nothing is ready yet, the
// session brings in a new card, re-checks a cleared one, or, with nothing
// else left, shows the same card the other way round after a short wait.
// Near the end, a card that still needs several goes needs only one more
// now; the rest carry to tomorrow, when it will do more good.

import type { Card } from './db';
import { dayNumber } from './review';

export type FlashGrade = 1 | 2 | 3 | 4 | 5;
export type Side = 'en' | 'th' | 'audio';

export const GRADES: { g: FlashGrade; label: string; key: string; say?: string }[] = [
  { g: 1, label: '?', key: '1', say: "Don't know" },
  { g: 2, label: 'Hard', key: '2' },
  { g: 3, label: 'OK', key: '3' },
  { g: 4, label: 'Good', key: '4' },
  { g: 5, label: 'Easy', key: '5' },
];

/** recalls still needed today after each answer */
export const NEED: Record<FlashGrade, number> = { 1: 4, 2: 3, 3: 2, 4: 1, 5: 0 };
/** cards in between before it comes back */
const GAP_CARDS: Record<FlashGrade, number> = { 1: 2, 2: 4, 3: 7, 4: 12, 5: 0 };
/** and at least this many seconds */
const GAP_SECS: Record<FlashGrade, number> = { 1: 12, 2: 25, 3: 45, 4: 90, 5: 0 };
/** cards in one sitting: about 10-15 minutes */
export const SITTING = 20;
/** new cards in play at once */
export const BATCH = 5;
/** a cleared card can be re-checked once this long after it was last seen */
const CHECK_SECS = 40;
/** the most goes one card gets in a session */
export const MAX_GOES = 8;
/** the wait before the same card is shown again, the other way round */
export const FLIP_WAIT_SECS = 8;

export interface Entry {
  id: string;
  /** recalls still needed this session */
  need: number;
  /** comes back once this many cards have been shown in the session… */
  atStep: number;
  /** …and this time (ms) has passed */
  atTime: number;
  /** clean recalls in a row this session: each one widens the gap */
  streak: number;
  /** the first answer this session: the honest measure of how well it was known */
  first: FlashGrade | null;
  answers: number;
  lastSeen: number;
  /** some of today's goes moved to tomorrow */
  carried: boolean;
  /** re-checked after it was cleared */
  checked: boolean;
}

export interface Session {
  ids: string[];
  entries: Record<string, Entry>;
  /** cards not yet brought in, in order */
  waiting: string[];
  step: number;
  lastId: string | null;
}

export type FlashPick =
  | { kind: 'card'; id: string; fresh: boolean }
  | { kind: 'check'; id: string }
  | { kind: 'flip'; id: string; waitMs: number }
  | { kind: 'done' };

const entry = (id: string): Entry => ({ id, need: 1, atStep: 0, atTime: 0, streak: 0, first: null, answers: 0, lastSeen: 0, carried: false, checked: false });

export function startSession(ids: string[]): Session {
  return { ids: [...ids], entries: {}, waiting: [...ids], step: 0, lastId: null };
}

const active = (s: Session) => Object.values(s.entries).filter((e) => e.need > 0);
const ready = (e: Entry, s: Session, now: number) => s.step >= e.atStep && now >= e.atTime;

/** What to show next. Pure: the session only moves on through answer(). */
export function nextPick(s: Session, now: number): FlashPick {
  const live = active(s);
  if (live.length === 0 && s.waiting.length === 0) return { kind: 'done' };

  // 1. a card whose gap is up, the longest-waiting first, never the one just seen if another will do
  const due = live.filter((e) => ready(e, s, now)).sort((a, b) => a.atStep - b.atStep || a.atTime - b.atTime);
  const d = due.find((e) => e.id !== s.lastId) ?? (live.length === 1 && s.waiting.length === 0 ? due[0] : undefined);
  if (d) return { kind: 'card', id: d.id, fresh: false };

  // 2. room for a new card
  if (s.waiting.length && live.length < BATCH) return { kind: 'card', id: s.waiting[0], fresh: true };

  // 3. a cleared card, not seen for a while, for a quick check
  const cleared = Object.values(s.entries).filter((e) => e.need === 0 && !e.checked && e.id !== s.lastId && now - e.lastSeen >= CHECK_SECS * 1000);
  if (cleared.length) return { kind: 'check', id: cleared.sort((a, b) => a.lastSeen - b.lastSeen)[0].id };

  // 4. a new card even past the batch, rather than repeat one too soon
  if (s.waiting.length) return { kind: 'card', id: s.waiting[0], fresh: true };

  // 5. nothing else: the nearest card, the other way round, after a short wait
  const soonest = [...live].sort((a, b) => a.atTime - b.atTime)[0];
  const others = live.filter((e) => e.id !== s.lastId);
  const pick = others.length ? [...others].sort((a, b) => a.atTime - b.atTime)[0] : soonest;
  const waitMs = Math.max(0, Math.min(FLIP_WAIT_SECS * 1000, pick.atTime - now, pick.lastSeen + FLIP_WAIT_SECS * 1000 - now));
  return { kind: 'flip', id: pick.id, waitMs };
}

/** Record an answer. A quick check that goes wrong puts the card back in play. */
export function answer(s: Session, id: string, g: FlashGrade, now: number, check = false): Session {
  const was = s.entries[id] ?? entry(id);
  const e: Entry = { ...was, answers: was.answers + 1, lastSeen: now, first: was.first ?? g };
  const step = s.step + 1;
  if (check) {
    e.checked = true;
    if (g <= 2) {
      e.need = 2;
      e.streak = 0;
    }
  } else if (was.answers === 0) {
    e.need = NEED[g];
    e.streak = g >= 3 ? 1 : 0;
  } else {
    // a recall counts down; only "don't know" pushes the count back up
    e.need = g === 1 ? Math.max(was.need, NEED[1] - 1) : Math.max(0, Math.min(NEED[g], was.need - 1));
    e.streak = g >= 3 ? was.streak + 1 : 0;
  }
  // enough for one sitting: whatever is left goes to tomorrow
  if (e.need > 0 && e.answers >= MAX_GOES) {
    e.need = 0;
    e.carried = true;
  }
  if (e.need > 0) {
    // each clean recall in a row pushes the next one further out
    const widen = 1 + Math.max(0, e.streak - 1) * 0.6;
    const gg = check ? 2 : g;
    e.atStep = step + Math.round(GAP_CARDS[gg] * widen);
    e.atTime = now + Math.round(GAP_SECS[gg] * widen * 1000);
  }
  const waiting = s.waiting.filter((w) => w !== id);
  let next: Session = { ...s, entries: { ...s.entries, [id]: e }, waiting, step, lastId: id };
  next = endgame(next);
  return next;
}

/** Near the end, extra goes for a hard card are better spent tomorrow than back to back now. */
export function endgame(s: Session): Session {
  const live = active(s);
  if (live.length + s.waiting.length > 3) return s;
  let changed = false;
  const entries = { ...s.entries };
  for (const e of live) {
    // it has had at least one retry already today
    if (e.need > 1 && e.answers >= 2) {
      entries[e.id] = { ...e, need: 1, carried: true };
      changed = true;
    }
  }
  return changed ? { ...s, entries } : s;
}

export function progress(s: Session) {
  const total = s.ids.length;
  const cleared = Object.values(s.entries).filter((e) => e.need === 0).length;
  const goesLeft = active(s).reduce((n, e) => n + e.need, 0) + s.waiting.length * 1.6;
  return { total, cleared, left: total - cleared, mins: Math.max(1, Math.round((goesLeft * 9) / 60)) };
}

/** The cards that gave the most trouble, worst first. */
export function hardest(s: Session, n = 8): Entry[] {
  return Object.values(s.entries)
    .filter((e) => (e.first ?? 5) <= 3 || e.carried || e.answers > 2)
    .sort((a, b) => (a.first ?? 5) - (b.first ?? 5) || b.answers - a.answers)
    .slice(0, n);
}

/**
 * The long-term card after this session, from the first answer of the day
 * (the honest one). Unfinished or carried cards come back tomorrow at the latest.
 */
export function schedule(prev: Card | undefined, e: Pick<Entry, 'first' | 'need' | 'carried'>, today = dayNumber()): Card {
  const c: Card = prev ? { ...prev } : { ivl: 0, ease: 2.5, due: today };
  const g = e.first ?? 1;
  if (g === 1) {
    c.ivl = 1;
    c.ease = Math.max(1.3, c.ease - 0.2);
  } else if (g === 2) {
    c.ivl = Math.max(1, Math.round(c.ivl * 1.2));
    c.ease = Math.max(1.3, c.ease - 0.15);
  } else {
    const base = c.ivl < 1 ? (g === 3 ? 2 : g === 4 ? 3 : 5) : Math.max(c.ivl + 1, Math.round(c.ivl * c.ease * (g === 3 ? 0.85 : g === 5 ? 1.3 : 1)));
    c.ivl = base;
    if (g === 3) c.ease = Math.max(1.3, c.ease - 0.05);
    if (g === 5) c.ease += 0.15;
  }
  if (e.need > 0 || e.carried) c.ivl = Math.min(c.ivl, 1);
  c.due = today + c.ivl;
  return c;
}

/** What each button does today, for the small label under it. */
export function gradeHint(g: FlashGrade): string {
  const n = NEED[g];
  return n === 0 ? 'done today' : n === 1 ? '1 more' : `${n} more`;
}

/** Days in a row with at least one card, counting today or, if none yet today, yesterday. */
export function streak(days: Record<string, number> | undefined, today = dayNumber()): number {
  if (!days) return 0;
  let d = (days[String(today)] ?? 0) > 0 ? today : today - 1;
  let n = 0;
  while ((days[String(d)] ?? 0) > 0) {
    n++;
    d--;
  }
  return n;
}

/** When the cards of a sitting come back: tomorrow, in a few days, or later. */
export function comeBack(cards: Card[], today = dayNumber()) {
  const out = { tomorrow: 0, soon: 0, later: 0 };
  for (const c of cards) {
    if (c.due <= today + 1) out.tomorrow++;
    else if (c.due <= today + 4) out.soon++;
    else out.later++;
  }
  return out;
}
