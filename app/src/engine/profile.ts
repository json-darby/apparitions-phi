// Builds the forecast snapshot from the live engine: the learner's measured
// habits (how often, how long, how fast), their calibration, every schedule,
// and the content in scope.

import { State, default_w } from 'ts-fsrs';
import type { Skill } from '../content/types';
import { DAY_MS, addDays, daysBetween, startOfDay } from '../core/dates';
import type { Engine } from './engine';
import { REVIEW_SECONDS } from './engine';
import type { Profile, SnapCard, SnapEntry, Snapshot } from './forecast';

const SKILLS: Skill[] = ['hear', 'say', 'read', 'write', 'tone'];

/** How many recent days the habits are measured over. */
export const HABIT_WINDOW = 14;

export function buildProfile(engine: Engine): Profile {
  const s = engine.settings;
  const today = engine.today();
  const cal = engine.calibration();

  // study days: past days in the window since day 1, not counting today
  const elapsed = Math.max(0, daysBetween(s.startDate, today));
  const observed = Math.min(HABIT_WINDOW, elapsed);
  const activity = new Map(engine.store.activity().map((a) => [a.date, a.ms]));
  const answeredDays = new Set(
    engine.store
      .all<{ at: number }>('SELECT at FROM log WHERE counted = 1 AND at >= ?', [startOfDay(engine.clock.now()) - HABIT_WINDOW * DAY_MS])
      .map((r) => new Date(r.at).toDateString()),
  );
  const minutes: number[] = [];
  const completions: number[] = [];
  const days: { m: number; c: number }[] = [];
  let studied = 0;
  for (let i = 1; i <= observed; i++) {
    const date = addDays(today, -i);
    const ms = activity.get(date) ?? 0;
    const [y, m, d] = date.split('-').map(Number);
    const answered = answeredDays.has(new Date(y, m - 1, d).toDateString());
    if (ms >= 5 * 60_000 || answered) {
      studied++;
      if (ms > 0) minutes.push(ms / 60_000);
      const c = engine.completionOn(date);
      if (c != null) {
        completions.push(c);
        if (ms > 0) days.push({ m: ms / 60_000, c });
      }
    }
  }
  // Beta prior: assume 90% of days until there is evidence (weight of 3 days)
  const studyP = (studied + 0.9 * 3) / (observed + 3);
  // minutes per study day, shrunk towards the chosen track (weight of 3 days)
  const track = s.minutes;
  const mean = (minutes.reduce((a, b) => a + b, 0) + track * 3) / (minutes.length + 3);
  const sd = minutes.length >= 3
    ? Math.max(4, Math.sqrt(minutes.reduce((a, b) => a + (b - mean) ** 2, 0) / (minutes.length - 1)))
    : track * 0.25;

  // seconds per review: their median answer time plus reading and rating overhead
  const secs = {} as Record<Skill, number>;
  for (const k of SKILLS) {
    const rows = engine.store.all<{ ms: number }>(
      'SELECT ms FROM log WHERE skill = ? AND counted = 1 AND ms IS NOT NULL ORDER BY seq DESC LIMIT 60',
      [k],
    );
    if (rows.length >= 10) {
      const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] / 1000 + 4;
      // blend with the default until there are plenty of answers
      const w = Math.min(1, rows.length / 40);
      secs[k] = w * median + (1 - w) * REVIEW_SECONDS[k];
    } else secs[k] = REVIEW_SECONDS[k];
  }

  // share of each day's plan done on study days, shrunk towards 0.9 (weight of 2 days)
  const completion = (completions.reduce((a, b) => a + b, 0) + 0.9 * 2) / (completions.length + 2);
  const completionSd = completions.length >= 3
    ? Math.sqrt(completions.reduce((a, b) => a + (b - completion) ** 2, 0) / (completions.length - 1))
    : 0.15;

  // Time available per session. A day that finished its plan only says the
  // learner had at least that long (a censored observation); a day that stopped
  // short says how long they really had. With no short days, time never binds.
  const short = days.filter((d) => d.c < 0.95);
  let availableMinutes: number | null = null;
  let availableSd = 0;
  if (short.length) {
    const shortMean = short.reduce((a, d) => a + d.m, 0) / short.length;
    const vals = days.map((d) => (d.c < 0.95 ? d.m : Math.max(d.m, shortMean)));
    availableMinutes = vals.reduce((a, b) => a + b, 0) / vals.length;
    availableSd = vals.length >= 3 ? Math.max(3, Math.sqrt(vals.reduce((a, b) => a + (b - availableMinutes!) ** 2, 0) / (vals.length - 1))) : availableMinutes * 0.2;
  }

  return {
    availableMinutes, availableSd,
    completion, completionSd: Math.max(0.05, completionSd),
    k: cal.k, kLo: cal.lo, kHi: cal.hi, calibrationN: cal.n, predictedRecall: cal.predicted, actualRecall: cal.actual,
    studyP, daysObserved: observed, daysStudied: studied, minutesMean: mean, minutesSd: sd, secs,
  };
}

export function buildSnapshot(engine: Engine): Snapshot {
  const s = engine.settings;
  const now = engine.clock.now();
  const today = engine.today();
  const day0 = startOfDay(now);
  const courseDay = engine.day();

  let horizon: number;
  let horizonKind: 'trip' | 'course';
  let horizonDate: string;
  if (s.tripDate) {
    horizon = Math.max(1, daysBetween(today, s.tripDate));
    horizonKind = 'trip';
    horizonDate = s.tripDate;
  } else {
    horizon = Math.max(1, s.courseDays - courseDay + 1);
    horizonKind = 'course';
    horizonDate = addDays(today, horizon);
  }

  const cards: SnapCard[] = engine.store.allCards().map((row) => {
    const c = engine.fsrsCard(row);
    const reviewed = c.state !== State.New && c.last_review;
    return {
      ref: row.ref,
      skill: row.skill as Skill,
      s: reviewed ? c.stability : 0,
      d: reviewed ? c.difficulty : 5,
      last: reviewed ? Math.floor((c.last_review!.getTime() - day0) / DAY_MS) : 0,
      due: Math.max(0, Math.floor((row.due - day0) / DAY_MS)),
    };
  });

  const entries: SnapEntry[] = engine.content.allEntries().map((e) => ({
    ref: e.ref, kind: e.kind, day: e.day, skills: e.skills, survival: e.survival, adult: e.adult,
    theme: engine.content.item(e.ref)?.theme ?? null,
  }));

  const todayMs = engine.store.activity().find((a) => a.date === today)?.ms ?? 0;
  return {
    todayDate: today,
    courseDayToday: courseDay,
    courseDays: s.courseDays,
    track: s.minutes,
    adult: s.adult,
    todayDone: todayMs >= s.minutes * 0.8 * 60_000,
    horizon, horizonKind, horizonDate,
    cards, entries,
    profile: buildProfile(engine),
    w: [...default_w],
  };
}
