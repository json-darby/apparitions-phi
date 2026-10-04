// Shared drill logic: tiers, adaptive pace, per-drill records, and the review
// rule. Every drill reads items from the engine and reports every answer back.

import type { Store } from '../../db/store';
import type { DrillId } from '../../path/pathway';

/**
 * Four tiers for every drill:
 * 1 known items, slow
 * 2 normal speed, several voices
 * 3 look-alike distractors added, and speaking
 * 4 noisy street audio
 */
export type Tier = 1 | 2 | 3 | 4;

export const TIER_INFO: Record<Tier, { name: string; note: string }> = {
  1: { name: 'Tier 1', note: 'Known items, slow' },
  2: { name: 'Tier 2', note: 'Normal speed, several voices' },
  3: { name: 'Tier 3', note: 'Look-alikes and speaking' },
  4: { name: 'Tier 4', note: 'Noisy street audio' },
};

/** Unlock the next tier at 85% accuracy over the last 30 answers in this tier. */
export const UNLOCK_ACCURACY = 0.85;
export const UNLOCK_WINDOW = 30;

export interface DrillRecord {
  unlocked: Tier;
  best: Partial<Record<Tier, number>>;
  /** last answers per tier, 1 = right, 0 = wrong */
  recent: Partial<Record<Tier, number[]>>;
  runs: number;
}

export function loadRecord(store: Store, id: DrillId): DrillRecord {
  return store.get<DrillRecord>(`drill:${id}`, { unlocked: 1, best: {}, recent: {}, runs: 0 });
}

export function saveRecord(store: Store, id: DrillId, r: DrillRecord) {
  store.set(`drill:${id}`, r);
}

/** Add answers from a run; returns the record with any tier unlocked. */
export function applyRun(r: DrillRecord, tier: Tier, answers: boolean[], score: number): { record: DrillRecord; unlockedNow: Tier | null } {
  const recent = [...(r.recent[tier] ?? []), ...answers.map((a) => (a ? 1 : 0))].slice(-UNLOCK_WINDOW);
  const next: DrillRecord = {
    ...r,
    runs: r.runs + 1,
    recent: { ...r.recent, [tier]: recent },
    best: { ...r.best, [tier]: Math.max(r.best[tier] ?? 0, score) },
  };
  let unlockedNow: Tier | null = null;
  const acc = recent.reduce((s, x) => s + x, 0) / recent.length;
  if (tier === r.unlocked && tier < 4 && recent.length >= UNLOCK_WINDOW && acc >= UNLOCK_ACCURACY) {
    next.unlocked = (tier + 1) as Tier;
    unlockedNow = next.unlocked;
  }
  return { record: next, unlockedNow };
}

/**
 * Adaptive pace: speed rises or falls to hold accuracy near 80 to 85%.
 * speed is a multiplier on the drill's base speed (1 = base).
 */
export class Pace {
  speed: number;
  private window: number[] = [];
  constructor(tier: Tier, readonly min = 0.5, readonly max = 2.2) {
    this.speed = tier === 1 ? 0.7 : 1;
  }
  record(correct: boolean) {
    this.window.push(correct ? 1 : 0);
    if (this.window.length > 12) this.window.shift();
    if (this.window.length < 4) return;
    const acc = this.window.reduce((s, x) => s + x, 0) / this.window.length;
    if (acc > 0.85) this.speed = Math.min(this.max, this.speed * 1.06);
    else if (acc < 0.8) this.speed = Math.max(this.min, this.speed * 0.92);
  }
  accuracy(): number {
    return this.window.length ? this.window.reduce((s, x) => s + x, 0) / this.window.length : 1;
  }
}

export function shuffle<T>(a: T[], rand = Math.random): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function pick<T>(a: T[], rand = Math.random): T {
  return a[Math.floor(rand() * a.length)];
}
