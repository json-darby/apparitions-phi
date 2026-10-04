// Six learner ratings, the measured grade, and how they blend into one FSRS grade.

import { Rating, type Grade } from 'ts-fsrs';
import type { Skill } from '../content/types';

/** The six ratings, keyed 1 to 6. */
export enum Six {
  Blank = 1,
  Wrong = 2,
  Almost = 3,
  Hard = 4,
  Good = 5,
  Easy = 6,
}

export const SIX_LABELS: Record<Six, string> = {
  [Six.Blank]: 'Blank',
  [Six.Wrong]: 'Wrong',
  [Six.Almost]: 'Almost',
  [Six.Hard]: 'Hard',
  [Six.Good]: 'Good',
  [Six.Easy]: 'Easy',
};

/**
 * How a six-point rating maps onto the four FSRS grades, plus an in-session
 * retest delay. Blank and Wrong both fail; Wrong gets a later retest so the
 * learner sees the contrast after a gap. Almost (right word, wrong tone, say)
 * passes as Hard but is retested in the same session.
 */
export const SIX_TO_FSRS: Record<Six, { grade: Grade; retestMin: number | null }> = {
  [Six.Blank]: { grade: Rating.Again, retestMin: 1 },
  [Six.Wrong]: { grade: Rating.Again, retestMin: 6 },
  [Six.Almost]: { grade: Rating.Hard, retestMin: 10 },
  [Six.Hard]: { grade: Rating.Hard, retestMin: null },
  [Six.Good]: { grade: Rating.Good, retestMin: null },
  [Six.Easy]: { grade: Rating.Easy, retestMin: null },
};

/** The setting: three plain buttons, all six, or three for the first weeks and six after. */
export type RatingMode = 'auto' | 'simple' | 'detailed';
/** 'auto' shows the simple ratings for this many course days. */
export const SIMPLE_RATING_DAYS = 14;

export function ratingScale(mode: RatingMode | undefined, day: number): 'simple' | 'detailed' {
  if (mode === 'simple' || mode === 'detailed') return mode;
  return day <= SIMPLE_RATING_DAYS ? 'simple' : 'detailed';
}

/**
 * The simple ratings, keys 1 to 3. Each is one of the six, so everything
 * downstream (blend, FSRS grade, retests, self-trust) works unchanged.
 *
 * - "Didn't know" is Blank: FSRS Again, and the card is back in a minute. With
 *   no Wrong or Almost button a half-remembered answer belongs here too, and
 *   the cost of over-using it is only an extra look.
 * - "Hard" is Hard: a pass that barely moves the date. Not Almost, which would
 *   log "expects to forget" against a card that was recalled and wear down
 *   self-trust, and would hold back the saying and tone cards.
 * - "Knew it" is Good, never Easy. Easy stretches the next gap a long way, and
 *   a beginner pressing the top button on every card would be scheduled as if
 *   each word were effortless. Only the detailed scale can claim Easy.
 */
export const SIMPLE_RATINGS: { six: Six; label: string }[] = [
  { six: Six.Blank, label: 'Didn’t know' },
  { six: Six.Hard, label: 'Hard' },
  { six: Six.Good, label: 'Knew it' },
];

/** Typical answer times by skill, used until the learner has their own history. */
export const DEFAULT_TYPICAL_MS: Record<Skill, number> = {
  hear: 3000,
  say: 4500,
  read: 3500,
  write: 9000,
  tone: 2500,
};

export interface Signals {
  correct?: boolean;
  /** no answer given at all, or answer revealed */
  blank?: boolean;
  ms?: number;
  typicalMs: number;
  hints?: number;
  replays?: number;
  /** 0..1 from the pitch and phoneme check (Phase 4); null when not measured */
  speechScore?: number | null;
  /** 0..1 from stroke matching; null when not measured */
  handwritingScore?: number | null;
}

/** A grade from what the learner actually did. Null if nothing objective was measured. */
export function measuredGrade(s: Signals): Six | null {
  const hasSpeech = s.speechScore != null;
  const hasHand = s.handwritingScore != null;
  if (s.blank) return Six.Blank;
  if (s.correct === undefined && !hasSpeech && !hasHand) return null;
  if (s.correct === false) return Six.Wrong;

  let g: Six = Six.Good;
  const hints = s.hints ?? 0;
  const replays = s.replays ?? 0;
  if (s.ms != null && s.typicalMs > 0) {
    const r = s.ms / s.typicalMs;
    if (r > 2.2) g = Six.Hard;
    else if (r < 0.6 && hints === 0 && replays === 0) g = Six.Easy;
  }
  if (hints > 0) g = Math.min(g, Six.Hard);
  if (replays > 1) g = Math.min(g, Six.Good);
  for (const score of [s.speechScore, s.handwritingScore]) {
    if (score == null) continue;
    if (score < 0.45) g = Math.min(g, Six.Almost);
    else if (score < 0.7) g = Math.min(g, Six.Hard);
    else if (score < 0.85) g = Math.min(g, Six.Good);
  }
  return g;
}

/**
 * Blend own rating and measured grade. Own rating may move the measured grade by
 * one step at most, and not at all if the learner's own ratings have proved
 * poor predictors (trust below 0.4).
 */
export function blend(own: Six | null | undefined, measured: Six | null, trust: number): Six {
  if (measured == null) return own ?? Six.Good;
  if (own == null || trust < 0.4) return measured;
  const lo = Math.max(Six.Blank, measured - 1);
  const hi = Math.min(Six.Easy, measured + 1);
  // a measured failure cannot be rated into a pass beyond "Almost"
  const capped = measured <= Six.Wrong ? Math.min(hi, Six.Almost) : hi;
  return Math.min(Math.max(own, lo), capped) as Six;
}

/** Recall predicted by an own rating, used to measure how trustworthy own ratings are. */
export function predictsRecall(own: Six): boolean {
  return own >= Six.Hard;
}
