// The memory engine. One FSRS-6 schedule per skill per item (ts-fsrs). The
// pathway decides what is new; the engine decides what is due. Every screen and
// every game reads due items from here and reports every answer back here.

import { createEmptyCard, fsrs, State, type Card, type FSRS } from 'ts-fsrs';
import type { Content, ContentEntry } from '../content/repo';
import type { ContentKind, Skill } from '../content/types';
import type { CardRow, Store } from '../db/store';
import type { Clock } from '../core/clock';
import { DAY_MS, addDays, courseDay, localDate, startOfDate, startOfDay } from '../core/dates';
import type { Settings } from '../core/settings';
import { dayBlocks, newQuota } from '../path/pathway';
import { DEFAULT_TYPICAL_MS, SIX_TO_FSRS, Six, blend, measuredGrade, predictsRecall } from './grade';
import { calibrate, personalRetention, type Calibration } from './calibrate';

export const LEECH_LAPSES = 4;
export const RETENTION = 0.9;
export const SURVIVAL_RETENTION = 0.95;

/** Rough seconds one review takes, by skill, for budgeting. */
export const REVIEW_SECONDS: Record<Skill, number> = { hear: 8, say: 11, read: 8, write: 20, tone: 6 };
/** Rough seconds to meet one new thing (meaning, script, hook, first tries). */
export const NEW_SECONDS: Record<ContentKind, number> = { item: 45, letter: 90, pattern: 120 };

/** Allowance for same-session retests after misses. */
export const RETEST_OVERHEAD = 1.12;

/** Recognition first: these skills open when an item is met. */
export const STAGE_ONE: Skill[] = ['hear', 'read'];
export function stageOne(skills: Skill[]): Skill[] {
  const first = skills.filter((k) => STAGE_ONE.includes(k));
  return first.length ? first : skills.slice(0, 1);
}

export const cardKey = (ref: string, skill: Skill) => `${ref}:${skill}`;

export interface CardMeta {
  /** set when the item became a leech; cleared when a new hook is given */
  needsHook?: boolean;
  contrastWith?: string | null;
  leechCount?: number;
  hook?: string;
  /** own rating at the last review, to measure calibration */
  lastOwn?: number;
  /** marked hard by the learner */
  flagged?: boolean;
}

export interface Answer {
  ref: string;
  skill: Skill;
  /** "review", "new", "tone-pairs", "drill:night-market", "street:task-id" ... */
  source: string;
  /** own rating 1..6 */
  own?: Six | null;
  correct?: boolean;
  blank?: boolean;
  ms?: number;
  hints?: number;
  replays?: number;
  speechScore?: number | null;
  handwritingScore?: number | null;
  /** ref of the item the learner confused it with */
  confusedWith?: string;
  /**
   * Games set false when the answer could have been got right without
   * understanding the Thai. It is then logged but does not move the schedule.
   */
  counts?: boolean;
  data?: Record<string, unknown>;
}

export interface AnswerResult {
  counted: boolean;
  six: Six | null;
  due: number | null;
  retestAt: number | null;
  becameLeech: boolean;
}

export interface DuePlan {
  date: string;
  day: number;
  reviews: CardRow[];
  /** reviews over today's budget, pushed to later */
  deferred: number;
  newRefs: string[];
  /** new items held back because reviews filled the budget */
  newCut: number;
  reviewMinutes: number;
  newMinutes: number;
  capacityMinutes: number;
}

export interface DayPlanRecord {
  reviews: number;
  newItems: number;
  minutes: number;
}

export interface GameRequest {
  skills: Skill[];
  kinds?: ContentKind[];
  filter?: (e: ContentEntry) => boolean;
  count: number;
}

export interface GameItem {
  ref: string;
  skill: Skill;
  entry: ContentEntry;
  due: boolean;
  retrievability: number;
}

export class Engine {
  private schedulers = new Map<string, FSRS>();
  private retests: { key: string; at: number }[] = [];
  private calib: { logs: number; c: Calibration } | null = null;

  constructor(
    readonly store: Store,
    readonly content: Content,
    readonly clock: Clock,
    private getSettings: () => Settings,
  ) {}

  get settings() {
    return this.getSettings();
  }

  // ---------- time and trip ----------

  today(): string {
    return localDate(this.clock.now());
  }
  /** Course day 1..n for today. */
  day(): number {
    return Math.max(1, courseDay(this.settings.startDate, this.today()));
  }
  /** Last moment a review may be scheduled: the end of the day before the trip. */
  tripLimit(): number | null {
    const t = this.settings.tripDate;
    return t ? startOfDate(t) - 1 : null;
  }
  daysToTrip(): number | null {
    const lim = this.tripLimit();
    if (lim == null) return null;
    return Math.max(0, Math.floor((lim - startOfDay(this.clock.now())) / DAY_MS));
  }

  /**
   * The retention FSRS is asked for. Personalised: if this learner forgets
   * faster than FSRS predicts (calibration k > 1), ask for more, so their real
   * recall at review time still lands on 0.9 (0.95 for survival items).
   */
  targetRetention(survival: boolean): number {
    return personalRetention(survival ? SURVIVAL_RETENTION : RETENTION, this.calibration().k);
  }

  private scheduler(survival: boolean): FSRS {
    const retention = Math.round(this.targetRetention(survival) * 200) / 200;
    const key = `${survival ? 's' : 'n'}:${retention}`;
    let f = this.schedulers.get(key);
    if (!f) {
      f = fsrs({
        request_retention: retention,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: ['10m'],
        relearning_steps: ['10m'],
      });
      this.schedulers.set(key, f);
    }
    return f;
  }

  // ---------- cards ----------

  isIntroduced(ref: string): boolean {
    return this.store.cardsForRef(ref).length > 0;
  }

  introducedRefs(): Set<string> {
    // School of the Night's line cards (school:<line>) are not course content
    return new Set(this.store.allCards().map((c) => c.ref).filter((r) => !r.startsWith('school:')));
  }

  /**
   * Meet a new item. Recognition skills (hear, read) start now; production
   * skills (say, tone, write) open once recognition has held at a review (see
   * openProduction). Pass skills to override.
   */
  introduce(ref: string, skills?: Skill[]) {
    const e = this.content.entry(ref);
    if (!e) throw new Error(`unknown content ${ref}`);
    const first = skills ?? stageOne(e.skills);
    this.addCards(ref, first, this.clock.now());
    this.store.appendLog({
      at: this.clock.now(), ref, skill: null, source: 'new', rating: null, grade: null, correct: null, ms: null, counted: 0,
      data: JSON.stringify({ skills: first }),
    });
  }

  /** Once a recognition card has held at a review, open the item's production skills, due tomorrow. */
  private openProduction(ref: string, now: number) {
    const e = this.content.entry(ref);
    if (!e) return;
    const speaker = this.content.item(ref)?.speaker;
    const otherSpeaker = speaker != null && speaker !== this.settings.identity;
    // the other speaker's words are for hearing only: no say card
    const missing = e.skills.filter((k) => !this.store.getCard(cardKey(ref, k)) && !(otherSpeaker && k === 'say'));
    if (!missing.length) return;
    let due = startOfDay(now) + DAY_MS + 9 * 3600_000;
    const lim = this.tripLimit();
    if (lim != null && due > lim) due = Math.max(now, lim);
    this.addCards(ref, missing, due);
  }

  private addCards(ref: string, skills: Skill[], due: number) {
    const now = this.clock.now();
    this.store.transaction(() => {
      for (const skill of skills) {
        const key = cardKey(ref, skill);
        if (this.store.getCard(key)) continue;
        const c = createEmptyCard(due);
        this.store.putCard({
          key, ref, skill, due, state: JSON.stringify(c), lapses: 0, leech: 0, introduced: now, meta: '{}',
        });
      }
    });
  }

  card(ref: string, skill: Skill): CardRow | null {
    return this.store.getCard(cardKey(ref, skill));
  }

  fsrsCard(row: CardRow): Card {
    const c = JSON.parse(row.state) as Card & { due: string; last_review?: string };
    return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined };
  }

  meta(row: CardRow): CardMeta {
    return JSON.parse(row.meta) as CardMeta;
  }

  retrievability(row: CardRow, at = this.clock.now()): number {
    const c = this.fsrsCard(row);
    if (c.state === State.New) return 0;
    const e = this.content.entry(row.ref);
    return this.scheduler(!!e?.survival).get_retrievability(c, new Date(at), false);
  }

  /** This learner's real recall chance, from FSRS's prediction and their calibration. */
  recallChance(row: CardRow, at = this.clock.now()): number {
    return Math.pow(this.retrievability(row, at), this.calibration().k);
  }

  /** Fitted from every logged review that carried a prediction. Cached until the log grows by 20. */
  calibration(): Calibration {
    const n = this.store.logCount();
    if (this.calib && n - this.calib.logs < 20) return this.calib.c;
    const rows = this.store.all<{ p: number; r: number }>(
      `SELECT json_extract(data, '$.pred') AS p, json_extract(data, '$.recalled') AS r FROM log
       WHERE counted = 1 AND json_extract(data, '$.pred') IS NOT NULL ORDER BY seq DESC LIMIT 3000`,
    );
    const c = calibrate(rows.map((x) => ({ pred: x.p, recalled: !!x.r })));
    this.calib = { logs: n, c };
    return c;
  }

  // ---------- typical times and self-trust ----------

  typicalMs(skill: Skill): number {
    const rows = this.store.all<{ ms: number }>(
      'SELECT ms FROM log WHERE skill = ? AND correct = 1 AND ms IS NOT NULL ORDER BY seq DESC LIMIT 30',
      [skill],
    );
    if (rows.length < 8) return DEFAULT_TYPICAL_MS[skill];
    const s = rows.map((r) => r.ms).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  selfTrust(): number {
    return this.store.get<{ trust: number }>('engine.selfTrust', { trust: 0.75 }).trust;
  }

  private updateTrust(prevOwn: number | undefined, recalled: boolean) {
    if (prevOwn == null) return;
    const agree = predictsRecall(prevOwn as Six) === recalled ? 1 : 0;
    const t = this.selfTrust();
    this.store.set('engine.selfTrust', { trust: t * 0.92 + agree * 0.08 });
  }

  // ---------- answers ----------

  /** The single entry point for every answer from every screen and game. */
  answer(a: Answer): AnswerResult {
    const now = this.clock.now();
    const key = cardKey(a.ref, a.skill);
    const row = this.store.getCard(key);
    const counts = a.counts !== false && !!row;
    const measured = measuredGrade({
      correct: a.correct, blank: a.blank, ms: a.ms, typicalMs: this.typicalMs(a.skill),
      hints: a.hints, replays: a.replays, speechScore: a.speechScore, handwritingScore: a.handwritingScore,
    });
    const six = counts ? blend(a.own ?? null, measured, this.selfTrust()) : null;

    let due: number | null = null;
    let retestAt: number | null = null;
    let becameLeech = false;
    // FSRS's prediction just before this answer, for calibration (review-state cards only)
    let pred: number | null = null;

    if (counts && row && six != null) {
      const e = this.content.entry(a.ref);
      const meta = this.meta(row);
      const { grade, retestMin } = SIX_TO_FSRS[six];
      const recalled = six >= Six.Almost;
      this.updateTrust(meta.lastOwn, recalled);
      const before = this.fsrsCard(row);
      if (before.state === State.Review) pred = this.retrievability(row, now);
      const rec = this.scheduler(!!e?.survival).next(before, new Date(now), grade);
      let next = rec.card.due.getTime();
      const lim = this.tripLimit();
      if (lim != null && next > lim) next = this.parkForTrip(lim);
      due = next;
      let lapses = rec.card.lapses;
      let leech = row.leech;
      if (a.own != null) meta.lastOwn = a.own;
      if (a.confusedWith) meta.contrastWith = a.confusedWith;
      // a leech: missed four times since the last fresh hook
      const sinceHook = lapses - (meta.leechCount ?? 0) * LEECH_LAPSES;
      if (!leech && sinceHook >= LEECH_LAPSES) {
        leech = 1;
        becameLeech = true;
        meta.needsHook = true;
        meta.contrastWith = meta.contrastWith ?? this.contrastFor(a.ref);
      }
      this.store.putCard({ ...row, due: next, state: JSON.stringify(rec.card), lapses, leech, meta: JSON.stringify(meta) });
      if (STAGE_ONE.includes(a.skill) && rec.card.state === State.Review && six >= Six.Hard) this.openProduction(a.ref, now);
      if (retestMin != null) {
        retestAt = now + retestMin * 60_000;
        this.retests.push({ key, at: retestAt });
      }
    }

    this.store.appendLog({
      at: now,
      ref: a.ref,
      skill: a.skill,
      source: a.source,
      rating: a.own ?? null,
      grade: six != null ? SIX_TO_FSRS[six].grade : null,
      correct: a.correct == null ? null : a.correct ? 1 : 0,
      ms: a.ms ?? null,
      counted: counts ? 1 : 0,
      data: JSON.stringify({ six, measured, pred, recalled: six != null ? six >= Six.Almost : null, hints: a.hints, replays: a.replays, speech: a.speechScore, hand: a.handwritingScore, confusedWith: a.confusedWith, ...a.data }),
    });
    return { counted: counts, six, due, retestAt, becameLeech };
  }

  /** Preview next due date per rating, for the rating buttons. */
  preview(ref: string, skill: Skill): Record<Six, number> | null {
    const row = this.card(ref, skill);
    if (!row) return null;
    const e = this.content.entry(ref);
    const now = new Date(this.clock.now());
    const rec = this.scheduler(!!e?.survival).repeat(this.fsrsCard(row), now);
    const out = {} as Record<Six, number>;
    const lim = this.tripLimit();
    for (const six of [1, 2, 3, 4, 5, 6] as Six[]) {
      const g = SIX_TO_FSRS[six];
      let t = g.retestMin != null && six <= Six.Wrong ? now.getTime() + g.retestMin * 60_000 : rec[g.grade].card.due.getTime();
      if (lim != null && t > lim) t = this.parkForTrip(lim);
      out[six] = t;
    }
    return out;
  }

  /**
   * Trip mode. FSRS sets the next review for when recall would fall to the
   * target (0.9, or 0.95 for survival items). If that falls after the trip, the
   * item is still above target on the trip date, so it needs no last look: it
   * is parked at the start of the trip day, never later. Items that would drop
   * below target before the trip keep their earlier date.
   */
  private parkForTrip(lim: number): number {
    return lim + 1;
  }

  // ---------- leeches ----------

  private contrastFor(ref: string): string | null {
    const rows = this.store.all<{ c: string; n: number }>(
      `SELECT json_extract(data, '$.confusedWith') AS c, COUNT(*) AS n FROM log
       WHERE ref = ? AND json_extract(data, '$.confusedWith') IS NOT NULL GROUP BY c ORDER BY n DESC LIMIT 1`,
      [ref],
    );
    if (rows[0]?.c) return rows[0].c;
    const it = this.content.item(ref);
    if (it?.contrasts?.length) return `item:${it.contrasts[0]}`;
    const l = this.content.letter(ref);
    if (l?.lookalikes.length) return `letter:${l.lookalikes[0]}`;
    return null;
  }

  leeches(): CardRow[] {
    return this.store.all<CardRow>('SELECT * FROM cards WHERE leech = 1');
  }

  /** Give a leech a new memory hook; it gets a fresh run of four lapses. */
  renewHook(ref: string, hook: string) {
    for (const row of this.store.cardsForRef(ref)) {
      if (!row.leech) continue;
      const meta = this.meta(row);
      meta.needsHook = false;
      meta.hook = hook;
      meta.leechCount = (meta.leechCount ?? 0) + 1;
      this.store.putCard({ ...row, leech: 0, meta: JSON.stringify(meta) });
    }
    this.store.set(`hook:${ref}`, hook);
  }

  hookFor(ref: string): string | null {
    return this.store.get<string | null>(`hook:${ref}`, null) ?? this.content.item(ref)?.hook ?? null;
  }

  flag(ref: string, flagged: boolean) {
    for (const row of this.store.cardsForRef(ref)) {
      const meta = this.meta(row);
      meta.flagged = flagged;
      this.store.putCard({ ...row, meta: JSON.stringify(meta) });
    }
  }

  // ---------- planning: the load balancer ----------

  /** Minutes in the day that can absorb reviews: the review block, the drill and the tone lab. */
  capacityMinutes(): number {
    const b = dayBlocks(this.settings.minutes);
    return b.filter((x) => x.id === 'review' || x.id === 'drill' || x.id === 'tonelab').reduce((s, x) => s + x.minutes, 0);
  }

  private allowed(e: ContentEntry | undefined): boolean {
    return !!e && (this.settings.adult || !e.adult);
  }

  /** Due reviews, most urgent first: survival items, then lowest recall. */
  dueNow(at = this.clock.now()): CardRow[] {
    const rows = this.store.dueCards(at).filter((r) => this.allowed(this.content.entry(r.ref)));
    const score = (r: CardRow) => {
      const e = this.content.entry(r.ref);
      return this.retrievability(r, at) - (e?.survival ? 0.15 : 0) - (this.meta(r).flagged ? 0.05 : 0);
    };
    return rows.map((r) => ({ r, s: score(r) })).sort((a, b) => a.s - b.s).map((x) => x.r);
  }

  /** New content available on or before a day that has not been met yet. */
  newCandidates(day = this.day()): ContentEntry[] {
    const met = this.introducedRefs();
    return this.content
      .allEntries()
      .filter((e) => e.day <= day && !met.has(e.ref) && this.allowed(e))
      .sort((a, b) => a.day - b.day || (b.survival ? 1 : 0) - (a.survival ? 1 : 0));
  }

  /**
   * Today's plan. Reviews first. If they exceed the budget, new items are cut
   * first; if reviews alone exceed it, the least urgent are deferred.
   */
  planDay(): DuePlan {
    const now = this.clock.now();
    const endOfToday = startOfDay(now) + DAY_MS - 1;
    const due = this.dueNow(endOfToday);
    const capacity = this.capacityMinutes();
    const reviews: CardRow[] = [];
    let used = 0;
    // each review carries a share of the retests that follow misses (about 1 in 10)
    for (const r of due) {
      const s = (REVIEW_SECONDS[r.skill as Skill] / 60) * RETEST_OVERHEAD;
      if (used + s > capacity) break;
      reviews.push(r);
      used += s;
    }
    const deferred = due.length - reviews.length;

    const quota = newQuota(this.settings.minutes, this.day());
    const blocks = dayBlocks(this.settings.minutes);
    // new material has its own block plus the writing block (letters), and may
    // also use review capacity the due reviews leave free. Reviews that spill
    // past capacity eat into it first, so new items are the first thing cut.
    const newBlock = blocks.filter((b) => b.id === 'new' || b.id === 'writing').reduce((s, b) => s + b.minutes, 0);
    const dueMin = due.reduce((s, r) => s + (REVIEW_SECONDS[r.skill as Skill] / 60) * RETEST_OVERHEAD, 0);
    const spare = Math.max(0, newBlock + (capacity - dueMin) * 0.5);
    const metToday = this.metOn(this.today());
    const left = { item: quota.items - metToday.item, letter: quota.letters - metToday.letter, pattern: quota.patterns - metToday.pattern };
    const wanted = this.newCandidates().filter((e) => left[e.kind]-- > 0);
    const newRefs: string[] = [];
    let newMin = 0;
    for (const e of wanted) {
      // meeting it, a first try on each skill, and the second look one learning step later
      const m = NEW_SECONDS[e.kind] / 60 + (2 * RETEST_OVERHEAD * stageOne(e.skills).reduce((s, k) => s + REVIEW_SECONDS[k], 0)) / 60;
      if (newMin + m > spare) continue;
      newRefs.push(e.ref);
      newMin += m;
    }
    // the first plan of each day is kept, so habits can be measured as the share of the plan done
    const key = `plan:${this.today()}`;
    if (!this.store.get<DayPlanRecord | null>(key, null)) {
      this.store.set<DayPlanRecord>(key, { reviews: reviews.length, newItems: newRefs.length, minutes: used + newMin });
    }
    return {
      date: this.today(), day: this.day(), reviews, deferred, newRefs,
      newCut: wanted.length - newRefs.length, reviewMinutes: used, newMinutes: newMin, capacityMinutes: capacity,
    };
  }

  /** Share of a past day's first plan that was done: distinct cards answered plus items met, over what was planned. */
  completionOn(date: string): number | null {
    const plan = this.store.get<DayPlanRecord | null>(`plan:${date}`, null);
    if (!plan) return null;
    const planned = plan.reviews + plan.newItems;
    if (planned === 0) return 1;
    const from = startOfDate(date);
    const to = startOfDate(addDays(date, 1));
    const answered = this.store.one<{ n: number }>(
      "SELECT COUNT(DISTINCT ref || ':' || skill) AS n FROM log WHERE counted = 1 AND source <> 'new' AND source <> 'retest' AND at >= ? AND at < ?",
      [from, to],
    )?.n ?? 0;
    // items met: the introduction rows only (first tries on new cards are answers, not meetings)
    const met = this.store.one<{ n: number }>("SELECT COUNT(*) AS n FROM log WHERE source = 'new' AND skill IS NULL AND at >= ? AND at < ?", [from, to])?.n ?? 0;
    return Math.min(1, (answered + met) / planned);
  }

  /** How many new things of each kind were met on a date. */
  metOn(date: string): Record<ContentKind, number> {
    const from = startOfDate(date);
    const to = startOfDate(addDays(date, 1));
    const rows = this.store.all<{ ref: string }>("SELECT ref FROM log WHERE source = 'new' AND at >= ? AND at < ?", [from, to]);
    const out: Record<ContentKind, number> = { item: 0, letter: 0, pattern: 0 };
    for (const r of rows) out[r.ref.split(':')[0] as ContentKind]++;
    return out;
  }

  /** Same-session retests that have come due. */
  retestsDue(): string[] {
    const now = this.clock.now();
    const ready = this.retests.filter((r) => r.at <= now).map((r) => r.key);
    this.retests = this.retests.filter((r) => r.at > now);
    return ready;
  }

  // ---------- the game contract ----------

  /**
   * Games ask for items here. Only items already met are returned; games never
   * introduce new items. Due items come first, then the weakest.
   */
  forGame(req: GameRequest): GameItem[] {
    const now = this.clock.now();
    const out: GameItem[] = [];
    for (const row of this.store.allCards()) {
      if (!req.skills.includes(row.skill as Skill)) continue;
      const entry = this.content.entry(row.ref);
      if (!entry || !this.allowed(entry)) continue;
      if (req.kinds && !req.kinds.includes(entry.kind)) continue;
      if (req.filter && !req.filter(entry)) continue;
      out.push({ ref: row.ref, skill: row.skill as Skill, entry, due: row.due <= now, retrievability: this.retrievability(row, now) });
    }
    out.sort((a, b) => Number(b.due) - Number(a.due) || a.retrievability - b.retrievability);
    return out.slice(0, req.count);
  }

  /** Games report answers here. Same as answer(), named for the contract. */
  report(a: Answer): AnswerResult {
    return this.answer(a);
  }

  // ---------- progress ----------

  strengthOf(ref: string): number {
    const rows = this.store.cardsForRef(ref);
    if (!rows.length) return 0;
    return rows.reduce((s, r) => s + this.retrievability(r), 0) / rows.length;
  }

  /** Items by strength band. */
  strengthBands(): { new: number; weak: number; ok: number; strong: number } {
    const out = { new: 0, weak: 0, ok: 0, strong: 0 };
    const refs = this.introducedRefs();
    for (const r of refs) {
      const rows = this.store.cardsForRef(r);
      const stab = rows.reduce((s, x) => s + this.fsrsCard(x).stability, 0) / rows.length;
      const reps = rows.reduce((s, x) => s + this.fsrsCard(x).reps, 0);
      if (reps === 0) out.new++;
      else if (stab < 3) out.weak++;
      else if (stab < 10) out.ok++;
      else out.strong++;
    }
    return out;
  }

  /** Days in a row ending today (or yesterday) with at least one counted answer. */
  streak(): number {
    const days = new Set(
      this.store.all<{ at: number }>('SELECT at FROM log WHERE counted = 1').map((r) => localDate(r.at)),
    );
    let d = this.today();
    if (!days.has(d)) d = addDays(d, -1);
    let n = 0;
    while (days.has(d)) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }
}
