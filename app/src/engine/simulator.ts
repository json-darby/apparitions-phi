// Runs synthetic days of reviews through the real engine and store, to prove
// the daily load stays inside the time budget. Used by the Phase 1 exit test
// and by the "simulate" view in Settings.

import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Content } from '../content/repo';
import { emptyMedia, type Item, type Letter, type Pattern, type Skill, type Theme } from '../content/types';
import { openStore, type Store } from '../db/store';
import { ManualClock } from '../core/clock';
import { DAY_MS, addDays, localDate, startOfDate } from '../core/dates';
import { defaultSettings, type Settings } from '../core/settings';
import { dayBlocks } from '../path/pathway';
import { Engine, REVIEW_SECONDS, NEW_SECONDS } from './engine';
import { Six } from './grade';

export interface SimOptions {
  days: number;
  track: 30 | 60;
  /** days (1-based) the learner skips entirely */
  missed?: number[];
  /** fraction of items that are very hard for this learner */
  hardShare?: number;
  seed?: number;
  /** trip this many days after day 1 */
  tripAfterDays?: number;
  /** course length (content is generated to match) */
  courseDays?: 30 | 60;
  /** this learner forgets faster (>1) or slower (<1) than FSRS assumes */
  forgetting?: number;
  /** chance of skipping any given day */
  skipRate?: number;
  /** minutes the learner actually spends, as a share of the track */
  effort?: number;
}

export interface SimDay {
  day: number;
  date: string;
  skipped: boolean;
  due: number;
  reviewed: number;
  deferred: number;
  introduced: number;
  newCut: number;
  plannedReviewMin: number;
  capacityMin: number;
  actualMin: number;
  budgetMin: number;
  accuracy: number;
  leechesHandled: number;
}

export interface SimResult {
  days: SimDay[];
  introducedTotal: number;
  introducedByKind: Record<string, number>;
  cardsTotal: number;
  leechesTotal: number;
  survivalRecallAtTrip: number;
  maxDueAfterTrip: number;
  tripLimit: number | null;
  store: Store;
  engine: Engine;
  /** the hidden learner: real recall of a card is R ^ trueExponent(ref) */
  trueExponent: (ref: string) => number;
}

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

const SYN_THEMES: Theme[] = ['greetings', 'food', 'numbers', 'directions', 'shopping', 'hotel', 'health', 'ordering', 'questions', 'signs', 'classifiers', 'nightlife', 'time', 'people'];

/**
 * A full-size synthetic course: about 360 items, 44 letters, 45 patterns over
 * 30 days; the 60-day course adds about 300 items, 32 vowel and tone-mark forms
 * and 30 patterns.
 */
export function syntheticContent(courseDays: 30 | 60 = 30): Content {
  const items: Item[] = [];
  for (let d = 1; d <= courseDays; d++) {
    for (let k = 0; k < (d > 30 ? 10 : 12); k++) {
      const n = items.length;
      const phrase = k % 3 === 2;
      items.push({
        id: `s${n}`, kind: phrase ? 'phrase' : 'word', thai: `ท${n}`, roman: `syn ${n}`, tones: ['mid'], en: `synthetic ${n}`,
        theme: SYN_THEMES[n % SYN_THEMES.length], day: d, survival: n % 4 === 0, adult: d >= 21 && k === 11,
        skills: (phrase ? ['hear', 'say', 'read'] : ['hear', 'say', 'read', 'tone']) as Skill[],
        tags: [], status: 'placeholder', media: emptyMedia(),
      });
    }
  }
  const letters: Letter[] = Array.from({ length: 44 }, (_, i) => ({
    id: `sl${i}`, char: 'ก', name: `letter ${i}`, keyword: '', initial: 'g', final: 'k', cls: 'mid' as const,
    day: Math.min(28, 1 + Math.floor(i / 1.6)), strokes: null, lookalikes: [], skills: ['read', 'write', 'hear'] as Skill[],
    status: 'placeholder' as const, media: emptyMedia(),
  }));
  const patterns: Pattern[] = Array.from({ length: 45 }, (_, i) => ({
    id: `sp${i}`, frame: 'X', en: `pattern ${i}`, note: '', day: Math.min(30, 1 + Math.floor(i / 1.5)), examples: [],
    skills: ['read', 'say'] as Skill[], status: 'placeholder' as const, media: emptyMedia(),
  }));
  if (courseDays === 60) {
    for (let i = 0; i < 32; i++)
      letters.push({
        id: `sv${i}`, char: 'า', name: `vowel ${i}`, keyword: '', initial: 'aa', final: null, cls: 'vowel', day: 31 + Math.floor(i / 1.1),
        strokes: null, lookalikes: [], skills: ['read', 'write', 'hear'], status: 'placeholder', media: emptyMedia(),
      });
    for (let i = 0; i < 30; i++)
      patterns.push({
        id: `sq${i}`, frame: 'X', en: `pattern ${45 + i}`, note: '', day: 31 + i, examples: [],
        skills: ['read', 'say'], status: 'placeholder', media: emptyMedia(),
      });
  }
  return new Content({ items, letters, patterns, culture: [] });
}

export async function simulate(opts: SimOptions, content = syntheticContent(opts.courseDays ?? 30), sql?: SqlJsStatic): Promise<SimResult> {
  const SQL = sql ?? (await initSqlJs());
  const store = await openStore(SQL, null);
  const rand = rng(opts.seed ?? 7);
  const start = '2026-11-02';
  const settings: Settings = {
    ...defaultSettings(start),
    onboarded: true,
    minutes: opts.track,
    courseDays: opts.courseDays ?? 30,
    startDate: start,
    tripDate: addDays(start, opts.tripAfterDays ?? opts.days),
    adult: true,
  };
  const clock = new ManualClock(startOfDate(start) + 18 * 3600_000);
  const engine = new Engine(store, content, clock, () => settings);

  // hidden learner: how hard each item is for them (1 = average)
  const hardness = new Map<string, number>();
  const hardFor = (ref: string) => {
    let h = hardness.get(ref);
    if (h == null) {
      h = (rand() < (opts.hardShare ?? 0.03) ? 6 : 0.6 + rand() * 0.8) * (opts.forgetting ?? 1);
      hardness.set(ref, h);
    }
    return h;
  };

  const budget = dayBlocks(opts.track);
  const budgetMin = budget.filter((b) => ['review', 'new', 'writing', 'drill', 'tonelab'].includes(b.id)).reduce((s, b) => s + b.minutes, 0);

  const days: SimDay[] = [];
  let leechesTotal = 0;

  for (let d = 1; d <= opts.days; d++) {
    const date = addDays(start, d - 1);
    clock.set(startOfDate(date) + 18 * 3600_000);
    if (opts.missed?.includes(d) || (opts.skipRate && rand() < opts.skipRate)) {
      days.push({ day: d, date, skipped: true, due: engine.dueNow().length, reviewed: 0, deferred: 0, introduced: 0, newCut: 0, plannedReviewMin: 0, capacityMin: engine.capacityMinutes(), actualMin: 0, budgetMin, accuracy: 0, leechesHandled: 0 });
      continue;
    }
    const plan = engine.planDay();
    let secs = 0;
    let right = 0;
    let total = 0;

    // a learner who puts in less effort stops when their own time runs out
    const own = (opts.effort ?? 1) * budgetMin * 60;
    const review = (key: { ref: string; skill: Skill }, source: string) => {
      if (opts.effort != null && secs > own) return;
      const row = engine.card(key.ref, key.skill);
      if (!row) return;
      const r = engine.retrievability(row);
      // straight after meeting an item, recall is high; afterwards it follows the memory model
      const fresh = row.state.includes('"reps":0');
      const p = Math.pow(fresh ? 0.88 : Math.max(r, 0.05), hardFor(key.ref));
      const ok = rand() < p;
      const typical = REVIEW_SECONDS[key.skill] * 1000;
      const ms = typical * (0.5 + rand() * (ok ? 1 : 2));
      const rating = !ok ? (rand() < 0.4 ? Six.Blank : Six.Wrong) : rand() < 0.15 ? Six.Hard : rand() < 0.8 ? Six.Good : Six.Easy;
      engine.answer({ ref: key.ref, skill: key.skill, source, own: rating, correct: ok, ms });
      secs += ms / 1000 + 2;
      total++;
      if (ok) right++;
    };

    for (const row of plan.reviews) review({ ref: row.ref, skill: row.skill as Skill }, 'review');

    // new material: meet it, then a first try on each skill
    for (const r of plan.newRefs) {
      if (opts.effort != null && secs > own) break;
      engine.introduce(r);
      const e = content.entry(r)!;
      secs += NEW_SECONDS[e.kind];
      for (const row of engine.store.cardsForRef(r)) review({ ref: r, skill: row.skill as Skill }, 'new');
    }

    // same-session retests and short learning steps, while time remains
    for (let pass = 0; pass < 2; pass++) {
      clock.advance(15 * 60_000);
      const capSecs = plan.capacityMinutes * 60;
      for (const row of engine.dueNow()) {
        if (secs > capSecs + plan.newMinutes * 60) break;
        review({ ref: row.ref, skill: row.skill as Skill }, 'retest');
      }
      engine.retestsDue();
    }

    // leeches get a new hook, which helps this learner
    const leeches = engine.leeches();
    const leechRefs = [...new Set(leeches.map((l) => l.ref))];
    for (const ref of leechRefs) {
      engine.renewHook(ref, 'a fresh hook');
      hardness.set(ref, 1.1);
      secs += 30;
    }
    leechesTotal += leechRefs.length;
    store.addActivity(date, Math.round(secs * 1000), 'review');

    days.push({
      day: d, date, skipped: false, due: plan.reviews.length + plan.deferred, reviewed: plan.reviews.length, deferred: plan.deferred,
      introduced: plan.newRefs.length, newCut: plan.newCut, plannedReviewMin: plan.reviewMinutes, capacityMin: plan.capacityMinutes,
      actualMin: secs / 60, budgetMin, accuracy: total ? right / total : 1, leechesHandled: leechRefs.length,
    });
  }

  const tripLimit = engine.tripLimit();
  const maxDue = Math.max(...store.allCards().map((c) => c.due));
  const tripMoment = tripLimit ?? clock.now() + DAY_MS;
  void DAY_MS;
  const survival = store.allCards().filter((c) => content.entry(c.ref)?.survival);
  const survivalRecallAtTrip = survival.length
    ? survival.reduce((s, c) => s + engine.retrievability(c, tripMoment), 0) / survival.length
    : 1;

  return {
    days,
    introducedTotal: engine.introducedRefs().size,
    introducedByKind: [...engine.introducedRefs()].reduce((m, r) => ({ ...m, [r.split(':')[0]]: (m[r.split(':')[0]] ?? 0) + 1 }), {} as Record<string, number>),
    cardsTotal: store.allCards().length,
    leechesTotal,
    survivalRecallAtTrip,
    // parked items sit at the first moment of the trip day (limit + 1), never later
    maxDueAfterTrip: tripLimit != null ? maxDue - (tripLimit + 1) : 0,
    tripLimit,
    store,
    engine,
    trueExponent: hardFor,
  };
}

export function formatSim(r: SimResult): string {
  const lines = ['day  date        due  done  defer  new  cut   plan/cap min   actual/budget min  acc'];
  for (const d of r.days) {
    if (d.skipped) {
      lines.push(`${String(d.day).padStart(3)}  ${d.date}  skipped (${d.due} due)`);
      continue;
    }
    lines.push(
      `${String(d.day).padStart(3)}  ${d.date}  ${String(d.due).padStart(4)}  ${String(d.reviewed).padStart(4)}  ${String(d.deferred).padStart(5)}  ${String(d.introduced).padStart(3)}  ${String(d.newCut).padStart(3)}   ${d.plannedReviewMin.toFixed(1).padStart(5)}/${d.capacityMin.toFixed(0).padStart(2)}       ${d.actualMin.toFixed(1).padStart(5)}/${d.budgetMin.toFixed(0)}          ${(d.accuracy * 100).toFixed(0)}%`,
    );
  }
  lines.push(`introduced ${r.introducedTotal} (${Object.entries(r.introducedByKind).map(([k, v]) => `${v} ${k}s`).join(', ')}), cards ${r.cardsTotal}, leeches handled ${r.leechesTotal}, survival recall at trip ${(r.survivalRecallAtTrip * 100).toFixed(1)}%`);
  lines.push(`latest due vs trip limit: ${r.maxDueAfterTrip <= 0 ? 'inside' : 'PAST by ' + r.maxDueAfterTrip + ' ms'}${r.tripLimit ? ' (' + localDate(r.tripLimit) + ')' : ''}`);
  return lines.join('\n');
}
