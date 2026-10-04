// Trip readiness forecast. Replays the days from now to the trip many times
// (Monte Carlo) with this learner's own measured habits: how often they study,
// for how long, how fast they answer, and how fast they really forget
// (calibration k, sampled within its uncertainty). Each run uses FSRS's own
// memory model and the same planner rules as the engine. The result is what
// they will be able to handle on the trip date, place by place, with a range,
// how many days ahead or behind that is, and the cheapest change that fixes it.
//
// Pure functions over a serialisable snapshot, so it can run in a worker.

import { fsrs, forgetting_curve, type FSRS } from 'ts-fsrs';
import type { ContentKind, Skill, Theme } from '../content/types';
import { dayBlocks, newQuota } from '../path/pathway';
import { personalRetention } from './calibrate';
import { CORE_THEMES, READY, SITUATIONS, type SituationId } from './situations';

// the engine's planning estimates (kept in step with engine.ts)
const NEW_SECONDS: Record<ContentKind, number> = { item: 45, letter: 90, pattern: 120 };
const REVIEW_SECONDS: Record<Skill, number> = { hear: 8, say: 11, read: 8, write: 20, tone: 6 };
const RETEST_OVERHEAD = 1.12;
const STAGE_ONE: Skill[] = ['hear', 'read'];

// ---------- snapshot ----------

export interface SnapCard {
  ref: string;
  skill: Skill;
  /** stability and difficulty; s = 0 means never reviewed */
  s: number;
  d: number;
  /** day index of the last review (0 = today, negative = past) */
  last: number;
  /** day index when due */
  due: number;
}

export interface SnapEntry {
  ref: string;
  kind: ContentKind;
  day: number;
  skills: Skill[];
  survival: boolean;
  adult: boolean;
  theme: Theme | null;
}

export interface Profile {
  /** calibration: real recall = R^k */
  k: number;
  kLo: number;
  kHi: number;
  calibrationN: number;
  predictedRecall: number;
  actualRecall: number;
  /** share of each day's plan done, on days they study */
  completion: number;
  completionSd: number;
  /** minutes they have per session when the plan is bigger than their time; null if they always finish */
  availableMinutes: number | null;
  availableSd: number;
  /** chance of studying on a given day */
  studyP: number;
  daysObserved: number;
  daysStudied: number;
  minutesMean: number;
  minutesSd: number;
  /** seconds per review by skill, including overhead */
  secs: Record<Skill, number>;
}

export interface Snapshot {
  todayDate: string;
  courseDayToday: number;
  courseDays: 30 | 60;
  track: 30 | 60;
  adult: boolean;
  /** today's session is already mostly done */
  todayDone: boolean;
  /** days from today to the horizon morning (the trip day, or the day after the course ends) */
  horizon: number;
  horizonKind: 'trip' | 'course';
  horizonDate: string;
  cards: SnapCard[];
  entries: SnapEntry[];
  profile: Profile;
  /** FSRS weights in use */
  w: number[];
}

// ---------- levers ----------

export interface Lever {
  id: string;
  label: string;
  studyP?: number;
  /** finish each day's plan */
  finish?: boolean;
  /** move to the 60-minute track */
  track?: 30 | 60;
  /** new items limited to survival and core words until the trip */
  focus?: boolean;
}

/** Changes the forecast can try, cheapest first. */
export function leversFor(snap: Snapshot): Lever[] {
  const out: Lever[] = [
    { id: 'daily', label: 'Study every day', studyP: 1 },
    { id: 'finish', label: "Finish each day's plan before you stop", finish: true },
    { id: 'focus', label: 'Survival words first: hold the rest back until the trip', focus: true },
    { id: 'daily-finish', label: "Every day, and finish each day's plan", studyP: 1, finish: true },
  ];
  if (snap.track === 30) {
    out.push({ id: 'track60', label: 'Move to the 60-minute track', track: 60 });
    out.push({ id: 'track60-daily', label: 'Every day on the 60-minute track', track: 60, studyP: 1, finish: true });
  }
  out.push({ id: 'all', label: "Every day, finish each plan, survival words first", studyP: 1, finish: true, focus: true });
  return out;
}

// ---------- random ----------

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

// ---------- readiness scoring ----------

interface Scope {
  /** per situation: [entry index, weight] */
  bySituation: Map<SituationId, [number, number][]>;
}

function stageOf(e: SnapEntry): Skill[] {
  const first = e.skills.filter((k) => STAGE_ONE.includes(k));
  return first.length ? first : e.skills.slice(0, 1);
}

function isCore(t: Theme | null) {
  return !!t && CORE_THEMES.includes(t);
}

export function buildScope(snap: Snapshot, scopeDay: number): Scope {
  const bySituation = new Map<SituationId, [number, number][]>();
  for (const sit of SITUATIONS) {
    if (sit.adult && !snap.adult) continue;
    const list: [number, number][] = [];
    snap.entries.forEach((e, i) => {
      if (e.day > scopeDay || (e.adult && !snap.adult)) return;
      const base = e.survival ? 3 : 1;
      if (e.kind === 'letter') {
        if (sit.letters) list.push([i, 1]);
        return;
      }
      if (e.kind !== 'item') return;
      if (e.theme && sit.themes.includes(e.theme)) list.push([i, base]);
      else if (sit.id !== 'signs' && isCore(e.theme)) list.push([i, base * 0.5]);
    });
    if (list.length) bySituation.set(sit.id, list);
  }
  return { bySituation };
}

type RecallFn = (entry: number, skill: Skill) => number;

function itemValue(e: SnapEntry, i: number, recall: RecallFn, reading: boolean): number {
  if (e.kind === 'letter' || reading) return recall(i, 'read');
  const u = e.skills.includes('hear') ? recall(i, 'hear') : recall(i, 'read');
  const p = e.skills.includes('say') ? recall(i, 'say') : u;
  return 0.5 * u + 0.5 * p;
}

export function scoreReadiness(snap: Snapshot, scope: Scope, recall: RecallFn): { overall: number; by: Partial<Record<SituationId, number>> } {
  const by: Partial<Record<SituationId, number>> = {};
  let sum = 0;
  let n = 0;
  for (const [sid, list] of scope.bySituation) {
    let num = 0;
    let den = 0;
    for (const [i, w] of list) {
      num += w * itemValue(snap.entries[i], i, recall, sid === 'signs');
      den += w;
    }
    by[sid] = den ? num / den : 0;
    sum += by[sid]!;
    n++;
  }
  return { overall: n ? sum / n : 0, by };
}

// ---------- one simulated future ----------

interface SimCard {
  e: number;
  skill: Skill;
  s: number;
  d: number;
  last: number;
  due: number;
}

interface RunResult {
  /** readiness at the horizon */
  overall: number;
  by: Partial<Record<SituationId, number>>;
  /** overall readiness at the end of each day, against the horizon scope; index = day */
  curve: number[];
  met: number;
  sayable: number;
}

export function simulateFuture(
  snap: Snapshot,
  opts: { seed: number; lever?: Lever; days?: number; scope: Scope; kOverride?: number; ideal?: boolean; curve?: boolean },
): RunResult {
  const rand = rng(opts.seed);
  const p = snap.profile;
  const lever = opts.lever ?? { id: 'none', label: '' };
  // parameter uncertainty: this run's true forgetting rate
  const kTrue = opts.kOverride ?? Math.exp(Math.log(p.k) + normal(rand) * ((Math.log(p.kHi) - Math.log(p.kLo)) / 2.56));
  const studyP = opts.ideal ? 1 : lever.studyP ?? p.studyP;
  const track = lever.track ?? snap.track;
  const capped = !opts.ideal && !lever.finish && p.availableMinutes != null;
  const blocks = dayBlocks(track);
  const capacitySec = blocks.filter((b) => b.id === 'review' || b.id === 'drill' || b.id === 'tonelab').reduce((s, b) => s + b.minutes, 0) * 60;
  const newBlockSec = blocks.filter((b) => b.id === 'new' || b.id === 'writing').reduce((s, b) => s + b.minutes, 0) * 60;
  // the engine schedules with its point estimate of k
  const fN: FSRS = fsrs({ w: snap.w, request_retention: personalRetention(0.9, opts.ideal ? 1 : p.k), enable_fuzz: false });
  const fS: FSRS = fsrs({ w: snap.w, request_retention: personalRetention(0.95, opts.ideal ? 1 : p.k), enable_fuzz: false });
  const decay = snap.w;

  const idx = new Map(snap.entries.map((e, i) => [e.ref, i]));
  const cards: SimCard[] = [];
  const have = new Set<string>();
  for (const c of snap.cards) {
    const e = idx.get(c.ref);
    if (e == null) continue;
    cards.push({ e, skill: c.skill, s: c.s, d: c.d, last: c.last, due: c.due });
    have.add(`${e}:${c.skill}`);
  }
  const introduced = new Set(cards.map((c) => c.e));
  const days = opts.days ?? snap.horizon;
  const curve: number[] = [];

  const recallAt = (c: SimCard, day: number) => (c.s <= 0 ? 0 : Math.pow(forgetting_curve(decay, Math.max(0, day - c.last), c.s), kTrue));

  const review = (c: SimCard, day: number) => {
    const e = snap.entries[c.e];
    const f = e.survival ? fS : fN;
    if (c.s <= 0) {
      // first try straight after meeting it, then the engine's second look one
      // learning step (ten minutes) later, which a miss also gets
      const first = rand() < Math.pow(0.88, kTrue);
      let st = f.next_state(null, 0, first ? 3 : 1);
      const ok = rand() < Math.pow(first ? 0.95 : 0.85, kTrue);
      st = f.next_state(st, 0, ok ? 3 : 1);
      c.s = st.stability;
      c.d = st.difficulty;
      c.last = day;
      c.due = day + (ok ? Math.max(1, f.next_interval(c.s, 0)) : 1);
      return ok;
    }
    const t = Math.max(0, day - c.last);
    const r = forgetting_curve(decay, t, c.s);
    const ok = rand() < Math.pow(r, kTrue);
    const g = ok ? (rand() < 0.12 ? 4 : rand() < 0.1 ? 2 : 3) : 1;
    const st = f.next_state({ stability: c.s, difficulty: c.d }, t, g, r);
    c.s = st.stability;
    c.d = st.difficulty;
    c.last = day;
    c.due = day + (ok ? Math.max(1, f.next_interval(c.s, t)) : 1);
    if (ok && STAGE_ONE.includes(c.skill)) {
      for (const k of e.skills) {
        if (have.has(`${c.e}:${k}`)) continue;
        have.add(`${c.e}:${k}`);
        cards.push({ e: c.e, skill: k, s: 0, d: 5, last: day, due: day + 1 });
      }
    }
    return ok;
  };

  // readiness, items met and items you can say, measured on the morning of a day
  const measure = (at: number) => {
    const byKey = new Map<string, SimCard>();
    for (const c of cards) byKey.set(`${c.e}:${c.skill}`, c);
    const recall: RecallFn = (i, k) => {
      const c = byKey.get(`${i}:${k}`);
      return c ? recallAt(c, at) : 0;
    };
    const sc = scoreReadiness(snap, opts.scope, recall);
    let sayable = 0;
    for (const i of introduced) if (snap.entries[i].kind === 'item' && recall(i, 'say') >= 0.8) sayable++;
    return { overall: sc.overall, by: sc.by, met: introduced.size, sayable };
  };
  let horizonScore: ReturnType<typeof measure> | null = null;

  for (let day = 0; day < days; day++) {
    if (day === snap.horizon) horizonScore = measure(day);
    const courseDay = snap.courseDayToday + day;
    const studies = day === 0 ? !snap.todayDone && rand() < Math.max(studyP, 0.5) : rand() < studyP;
    if (studies) {
      // the engine's plan for the day: reviews within capacity, then new material
      const due = cards.filter((c) => c.due <= day);
      due.sort((a, b) => recallAt(a, day) - (snap.entries[a.e].survival ? 0.15 : 0) - (recallAt(b, day) - (snap.entries[b.e].survival ? 0.15 : 0)));
      const planned: SimCard[] = [];
      let used = 0;
      let dueSec = 0;
      for (const c of due) {
        const sec = REVIEW_SECONDS[c.skill] * RETEST_OVERHEAD;
        dueSec += sec;
        if (used + sec > capacitySec) continue;
        planned.push(c);
        used += sec;
      }
      const plannedNew: number[] = [];
      if (courseDay <= snap.courseDays) {
        const quota = newQuota(track, courseDay);
        const left: Record<ContentKind, number> = { item: quota.items, letter: quota.letters, pattern: quota.patterns };
        let spare = Math.max(0, newBlockSec + (capacitySec - dueSec) * 0.5);
        for (let i = 0; i < snap.entries.length; i++) {
          const e = snap.entries[i];
          if (introduced.has(i) || e.day > courseDay || (e.adult && !snap.adult) || left[e.kind] <= 0) continue;
          if (lever.focus && !e.survival && !isCore(e.theme)) continue;
          left[e.kind]--;
          const cost = NEW_SECONDS[e.kind] + 2 * RETEST_OVERHEAD * stageOf(e).reduce((s, k) => s + REVIEW_SECONDS[k], 0);
          if (cost > spare) continue;
          spare -= cost;
          plannedNew.push(i);
        }
      }
      // the learner works through it, reviews first, at their own pace, until
      // the plan is done or their time for the day runs out
      let time = capped ? Math.max(5, p.availableMinutes! + normal(rand) * p.availableSd) * 60 : Infinity;
      for (const c of planned) {
        if (time <= 0) break;
        review(c, day);
        time -= p.secs[c.skill] * RETEST_OVERHEAD;
      }
      for (const i of plannedNew) {
        if (time <= 0) break;
        const e = snap.entries[i];
        time -= NEW_SECONDS[e.kind] + 2 * RETEST_OVERHEAD * stageOf(e).reduce((s, k) => s + p.secs[k], 0);
        introduced.add(i);
        for (const k of stageOf(snap.entries[i])) {
          const c: SimCard = { e: i, skill: k, s: 0, d: 5, last: day, due: day };
          cards.push(c);
          have.add(`${i}:${k}`);
          review(c, day);
        }
      }
    }
    if (opts.curve) curve.push(measure(day + 1).overall);
  }

  if (!horizonScore) horizonScore = measure(Math.min(days, snap.horizon));
  return { ...horizonScore, curve };
}

// ---------- the forecast ----------

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}

export type Status = 'ahead' | 'on-track' | 'at-risk' | 'behind';

export interface Forecast {
  computedAt: number;
  horizonDate: string;
  horizonKind: 'trip' | 'course';
  daysLeft: number;
  /** readiness if the horizon were today */
  now: number;
  nowBy: Partial<Record<SituationId, number>>;
  overall: Band;
  by: { id: SituationId; name: string; canDo: string; band: Band; now: number }[];
  /** what a learner following the plan exactly would reach */
  plan: number;
  target: number;
  status: Status;
  /** + = ready this many days before the horizon; - = needs this many days more; null = not within 30 days */
  daysMargin: number | null;
  curve: { day: number; p10: number; p50: number; p90: number }[];
  met: Band;
  sayable: Band;
  fix: { lever: Lever; p50: number; reaches: boolean } | null;
  profile: Profile;
  runs: number;
}

function band(xs: number[]): Band {
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

export function runForecast(snap: Snapshot, opts: { runs?: number; leverRuns?: number; computedAt?: number } = {}): Forecast {
  const runs = opts.runs ?? 32;
  const leverRuns = opts.leverRuns ?? 12;
  const scopeDay = Math.min(snap.courseDays, snap.courseDayToday + snap.horizon - 1);
  const scope = buildScope(snap, scopeDay);
  const extra = 30;
  const days = snap.horizon + extra;

  // readiness now, from the current schedules
  const cardMap = new Map<string, SnapCard>();
  const idx = new Map(snap.entries.map((e, i) => [e.ref, i]));
  for (const c of snap.cards) cardMap.set(`${idx.get(c.ref)}:${c.skill}`, c);
  const decay = snap.w;
  const nowScore = scoreReadiness(snap, scope, (i, k) => {
    const c = cardMap.get(`${i}:${k}`);
    return c && c.s > 0 ? Math.pow(forgetting_curve(decay, Math.max(0, -c.last), c.s), snap.profile.k) : 0;
  });

  const results: RunResult[] = [];
  for (let r = 0; r < runs; r++) results.push(simulateFuture(snap, { seed: 1000 + r, days, scope, curve: true }));

  const ideal: number[] = [];
  for (let r = 0; r < 8; r++) ideal.push(simulateFuture(snap, { seed: 5000 + r, scope, ideal: true, kOverride: 1 }).overall);
  const plan = band(ideal).p50;
  const target = Math.min(READY, Math.max(0.3, plan - 0.02));

  const overall = band(results.map((r) => r.overall));
  const curve = Array.from({ length: days }, (_, d) => ({ day: d + 1, ...band(results.map((r) => r.curve[d] ?? 0)) }));
  const cross = curve.findIndex((c) => c.p50 >= target);
  const daysMargin = cross < 0 ? null : snap.horizon - (cross + 1);

  let status: Status;
  if (overall.p50 >= target + 0.05 && (daysMargin ?? 0) >= 3) status = 'ahead';
  else if (overall.p50 >= target) status = 'on-track';
  else if (overall.p50 >= target - 0.07 || overall.p90 >= target) status = 'at-risk';
  else status = 'behind';

  let fix: Forecast['fix'] = null;
  if (status === 'at-risk' || status === 'behind') {
    let best: Forecast['fix'] = null;
    for (const lever of leversFor(snap)) {
      const xs: number[] = [];
      for (let r = 0; r < leverRuns; r++) xs.push(simulateFuture(snap, { seed: 2000 + r, scope, lever }).overall);
      const p50 = band(xs).p50;
      const cand = { lever, p50, reaches: p50 >= target };
      if (cand.reaches) {
        fix = cand;
        break;
      }
      if (!best || p50 > best.p50) best = cand;
    }
    fix = fix ?? best;
  }

  return {
    computedAt: opts.computedAt ?? 0,
    horizonDate: snap.horizonDate,
    horizonKind: snap.horizonKind,
    daysLeft: snap.horizon,
    now: nowScore.overall,
    nowBy: nowScore.by,
    overall,
    by: SITUATIONS.filter((s) => scope.bySituation.has(s.id)).map((s) => ({
      id: s.id, name: s.name, canDo: s.canDo,
      band: band(results.map((r) => r.by[s.id] ?? 0)),
      now: nowScore.by[s.id] ?? 0,
    })),
    plan, target, status, daysMargin, curve,
    met: band(results.map((r) => r.met)),
    sayable: band(results.map((r) => r.sayable)),
    fix,
    profile: snap.profile,
    runs,
  };
}
