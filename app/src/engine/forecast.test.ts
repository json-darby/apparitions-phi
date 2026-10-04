// Backtests for the readiness forecast. A synthetic learner with hidden habits
// runs through the real engine. On day 10 we forecast the trip; then we let the
// same learner live to the trip and measure what they could really do. The
// forecast range must contain the truth, and the verdict must match the learner.

import { describe, expect, it } from 'vitest';
import { startOfDate } from '../core/dates';
import { buildScope, runForecast, scoreReadiness, type Forecast } from './forecast';
import { buildSnapshot } from './profile';
import { simulate, type SimOptions, type SimResult, formatSim } from './simulator';

const TRIP = 30; // trip on the morning of day 31

async function backtest(opts: Omit<SimOptions, 'days' | 'tripAfterDays'>, at = 10) {
  const early = await simulate({ ...opts, days: at, tripAfterDays: TRIP });
  const snap = buildSnapshot(early.engine);
  const t0 = Date.now();
  const f = runForecast(snap, { runs: 32 });
  const ms = Date.now() - t0;
  const late = await simulate({ ...opts, days: TRIP, tripAfterDays: TRIP });
  const truth = realised(late, snap.courseDayToday + snap.horizon - 1);
  return { f, truth, ms, early, late };
}

/** What the learner can really do on the trip morning, by their hidden memory. */
function realised(r: SimResult, scopeDay: number): number {
  const snap = buildSnapshot(r.engine);
  const scope = buildScope(snap, Math.min(snap.courseDays, scopeDay));
  const trip = startOfDate(r.engine.settings.tripDate!);
  const cards = new Map(r.store.allCards().map((c) => [`${c.ref}:${c.skill}`, c]));
  return scoreReadiness(snap, scope, (i, k) => {
    const ref = snap.entries[i].ref;
    const c = cards.get(`${ref}:${k}`);
    if (!c) return 0;
    const row = r.engine.fsrsCard(c);
    if (!row.last_review) return 0;
    return Math.pow(r.engine.retrievability(c, trip), r.trueExponent(ref));
  }).overall;
}

function show(name: string, b: { f: Forecast; truth: number; ms: number; late: SimResult }) {
  const f = b.f;
  const p = f.profile;
  console.log(
    `\n${name}: forecast p10 ${f.overall.p10.toFixed(3)} p50 ${f.overall.p50.toFixed(3)} p90 ${f.overall.p90.toFixed(3)} | truth ${b.truth.toFixed(3)} | ` +
      `plan ${f.plan.toFixed(3)} target ${f.target.toFixed(3)} | ${f.status} | margin ${f.daysMargin} days | ` +
      `k ${p.k.toFixed(2)} [${p.kLo.toFixed(2)}-${p.kHi.toFixed(2)}] n=${p.calibrationN} | studyP ${p.studyP.toFixed(2)} | ` +
      `done ${p.completion.toFixed(2)}+-${p.completionSd.toFixed(2)} avail ${p.availableMinutes?.toFixed(0) ?? 'free'} | met ${f.met.p50} (real ${b.late.introducedTotal}) sayable ${f.sayable.p50} | ` +
      `fix ${f.fix ? `${f.fix.lever.id} -> ${f.fix.p50.toFixed(3)}` : 'none'} | ${b.ms} ms`,
  );
  for (const s of f.by) console.log(`   ${s.name.padEnd(16)} now ${s.now.toFixed(2)}  trip ${s.band.p10.toFixed(2)} ${s.band.p50.toFixed(2)} ${s.band.p90.toFixed(2)}`);
}

// the band is a 10-90 range over futures; allow a small margin for model error
const SLACK = 0.06;

describe('readiness forecast backtests', () => {
  it('a steady learner is forecast on track, and the forecast holds', async () => {
    const b = await backtest({ track: 60, seed: 21 });
    show('steady', b);
    expect(['on-track', 'ahead']).toContain(b.f.status);
    expect(b.truth).toBeGreaterThanOrEqual(b.f.overall.p10 - SLACK);
    expect(b.truth).toBeLessThanOrEqual(b.f.overall.p90 + SLACK);
    expect(b.ms).toBeLessThan(15000);
  });

  it('a learner who skips half the days and cuts sessions short is caught, with a fix', async () => {
    const b = await backtest({ track: 60, seed: 22, skipRate: 0.5, effort: 0.45 });
    show('skipper', b);
    expect(['behind', 'at-risk']).toContain(b.f.status);
    expect(b.f.fix).not.toBeNull();
    expect(b.f.fix!.p50).toBeGreaterThan(b.f.overall.p50);
    expect(b.truth).toBeGreaterThanOrEqual(b.f.overall.p10 - SLACK);
    expect(b.truth).toBeLessThanOrEqual(b.f.overall.p90 + SLACK);
  });

  it('a learner who forgets fast is measured as such, and the forecast still holds', async () => {
    const b = await backtest({ track: 60, seed: 23, forgetting: 1.8 });
    show('fast forgetter', b);
    expect(b.f.profile.k).toBeGreaterThan(1.25);
    expect(b.truth).toBeGreaterThanOrEqual(b.f.overall.p10 - SLACK);
    expect(b.truth).toBeLessThanOrEqual(b.f.overall.p90 + SLACK);
  });

  it('the 30-minute track is judged against what 30 minutes can do', async () => {
    const b = await backtest({ track: 30, seed: 24 });
    show('30-minute steady', b);
    expect(['on-track', 'ahead', 'at-risk']).toContain(b.f.status);
    expect(b.truth).toBeGreaterThanOrEqual(b.f.overall.p10 - SLACK);
    expect(b.truth).toBeLessThanOrEqual(b.f.overall.p90 + SLACK);
  });
});

describe('60-day course', () => {
  it('runs 60 days inside budget and goes further', async () => {
    const r = await simulate({ days: 60, track: 60, seed: 31, courseDays: 60 });
    console.log('\n60-day course, 60-minute track\n' + formatSim(r));
    for (const d of r.days) {
      expect(d.plannedReviewMin).toBeLessThanOrEqual(d.capacityMin + 1e-9);
      expect(d.actualMin).toBeLessThanOrEqual(d.budgetMin * 1.1);
    }
    expect(r.introducedByKind.item).toBeGreaterThan(580);
    expect(r.maxDueAfterTrip).toBeLessThanOrEqual(0);
  });
});
