// New items, the parts that need no screen: the order today's cards are taught
// in, where the quick checks fall, and what each check asks.

import type { Identity } from '../../../content/repo';
import { shuffle, speakerOf, type Shown } from './common';

/** Cards per group. A quick check follows each group. */
export const GROUP_SIZE = 4;
/** Answers per check question: the group's own, topped up to MIN from cards seen earlier in the run. */
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 3;

/** A word only the other sex says (ค่ะ for a male learner, ครับ for a female one). */
export function otherSpeaker(s: Pick<Shown, 'item'>, identity: Identity): boolean {
  const sp = s.item ? speakerOf(s.item) : null;
  return sp != null && sp !== identity;
}

/**
 * Teaching order for today's new set: what the learner will say comes first,
 * words only the other sex says come last. The engine's order is kept inside
 * each part, and nothing is added or dropped.
 */
export function teachingOrder<T extends Pick<Shown, 'item'>>(shown: T[], identity: Identity): T[] {
  return [...shown.filter((s) => !otherSpeaker(s, identity)), ...shown.filter((s) => otherSpeaker(s, identity))];
}

// ---- the quick check ----

/**
 * hear: the word plays, pick its meaning. meaning: the meaning shows, pick the
 * Thai. letter: the letter's name plays, pick the letter.
 */
export interface CheckQ {
  kind: 'hear' | 'meaning' | 'letter';
  ref: string;
  /** refs to choose from, the right one among them */
  options: string[];
  /** the second go at a question that was missed */
  again?: boolean;
}

/** The answers offered for one card, or null when there is nothing to tell it from. */
function optionsFor(target: Shown, group: Shown[], earlier: Shown[], rand: () => number): string[] | null {
  const out = [target];
  // same kind, and never a second card with the same Thai or the same meaning
  // (hello and goodbye are one word: both would be right)
  const fits = (o: Shown) => o.kind === target.kind && out.every((x) => x.ref !== o.ref && x.thai !== o.thai && (o.kind !== 'item' || x.en !== o.en));
  for (const o of group) if (out.length < MAX_OPTIONS && fits(o)) out.push(o);
  // a small group borrows from cards already seen in this run, latest first
  for (let i = earlier.length - 1; i >= 0 && out.length < MIN_OPTIONS; i--) if (fits(earlier[i])) out.push(earlier[i]);
  return out.length < 2 ? null : shuffle(out.map((o) => o.ref), rand);
}

/**
 * The questions for one group of cards. Every word is heard first (pick the
 * meaning), then every meaning is shown (pick the Thai). Letters are picked by
 * name. Patterns are left out: they are practised in the sentence builder.
 */
export function buildCheck(group: Shown[], earlier: Shown[] = [], rand: () => number = Math.random): CheckQ[] {
  const first: CheckQ[] = [];
  const second: CheckQ[] = [];
  for (const s of group) {
    if (s.kind === 'pattern') continue;
    const options = optionsFor(s, group, earlier, rand);
    if (!options) continue;
    if (s.kind === 'letter') first.push({ kind: 'letter', ref: s.ref, options });
    else {
      first.push({ kind: 'hear', ref: s.ref, options });
      second.push({ kind: 'meaning', ref: s.ref, options: shuffle(options, rand) });
    }
  }
  return [...shuffle(first, rand), ...shuffle(second, rand)];
}

/** A missed question comes back once more, at the end of the check. */
export function withRetry(queue: CheckQ[], at: number, rand: () => number = Math.random): CheckQ[] {
  const q = queue[at];
  if (!q || q.again) return queue;
  return [...queue, { ...q, options: shuffle(q.options, rand), again: true }];
}

// ---- the run ----

export type Step = { kind: 'card'; at: number } | { kind: 'check'; group: number };

/** The run: cards in groups of four, a check after each group that has something to ask. */
export function lessonSteps(shown: Shown[], size = GROUP_SIZE): Step[] {
  const steps: Step[] = [];
  for (let from = 0, group = 0; from < shown.length; from += size, group++) {
    const cards = shown.slice(from, from + size);
    cards.forEach((_, i) => steps.push({ kind: 'card', at: from + i }));
    if (buildCheck(cards, shown.slice(0, from)).length) steps.push({ kind: 'check', group });
  }
  return steps;
}

/**
 * Where a move really lands. Forward, it stops at the first check not yet
 * done, so a check cannot be swiped or jumped past; checks already done are
 * stepped over. Backward, it lands on a card: going back never re-runs a
 * check. `to` may be steps.length (the end of the run).
 */
export function landing(steps: Step[], done: ReadonlySet<number>, from: number, to: number): number {
  const open = (i: number) => {
    const s = steps[i];
    return s?.kind === 'check' && !done.has(s.group);
  };
  if (to === from) return from;
  if (to > from) {
    const end = Math.min(to, steps.length);
    for (let i = from + 1; i <= end && i < steps.length; i++) if (open(i)) return i;
    let i = end;
    while (i < steps.length && steps[i].kind === 'check' && !open(i)) i++;
    return i;
  }
  let i = Math.max(0, Math.min(to, steps.length - 1));
  while (i > 0 && steps[i].kind === 'check') i--;
  return steps[i]?.kind === 'card' ? i : from;
}
