// The branch runner for The Street's scripted conversations. It walks a task's
// nodes, applies each reply's effects (baht, reputation, comfort), and reports
// every choice to the memory engine.
//
// What counts as a review (the rule for all games: only if you could not have
// got it right without understanding the Thai):
//  - 'read': a step is a test when its replies differ in meaning, so that some
//    are right and some wrong. The items that set the right reply apart from
//    the others are logged; they count only on the first try at that step and
//    only with the English hidden. Free choices (every reply acceptable) and
//    retries after a miss are logged but do not count.
//  - 'hear': on a test step whose right reply depends on the NPC's line
//    (node.heard), those items are logged too, under the same conditions.
//  - 'say': "Say it out loud" logs the line you said, rated by you, for a
//    reply that was right. Items with no card yet are logged, never introduced.

import type { Answer, AnswerResult } from '../engine/engine';
import { Six } from '../engine/grade';
import { ENDING_IDS, type StreetNode, type StreetOption, type StreetTaskBuilt } from '../content/street-seed';

export interface Answerer {
  answer(a: Answer): AnswerResult;
}

export type Outcome = 'done' | 'failed' | 'left';
export type Face = 'neutral' | 'smile' | 'puzzled' | 'sad';

export interface RunOptions {
  /** wrong replies allowed before they stop listening; Infinity for none */
  patience?: number;
  /** starting comfort 0..10; set only for After Hours */
  comfort?: number;
  /** log source; defaults to street:<task id> */
  source?: string;
}

export interface ChoiceInfo {
  /** English glosses were visible when choosing */
  glossShown?: boolean;
  ms?: number;
}

export interface ChoiceResult {
  index: number;
  option: StreetOption;
  correct: boolean;
  /** this step was a test of understanding */
  test: boolean;
  /** first try at this step */
  first: boolean;
  /** refs whose schedule moved */
  counted: string[];
  logged: number;
  feedback: string | null;
  expression: Face;
  outcome: Outcome | null;
  next: string | null;
}

export const COMFORT_MAX = 10;

export class DialogueRun {
  node: string | null;
  baht = 0;
  rep = 0;
  comfort: number | null;
  patience: number;
  readonly startPatience: number;
  mistakes = 0;
  firstTryRight = 0;
  tests = 0;
  hints = 0;
  outcome: Outcome | null = null;
  readonly source: string;
  readonly history: { node: string; index: number; correct: boolean }[] = [];
  private tried = new Set<string>();

  constructor(readonly task: StreetTaskBuilt, private engine: Answerer, opts: RunOptions = {}) {
    this.node = task.start;
    this.patience = this.startPatience = opts.patience ?? 3;
    this.comfort = opts.comfort ?? null;
    this.source = opts.source ?? `street:${task.id}`;
  }

  get current(): StreetNode | null {
    return this.node ? this.task.nodes[this.node] ?? null : null;
  }

  get step(): number {
    return this.current?.step ?? this.task.steps.length;
  }

  get ended(): boolean {
    return this.outcome != null;
  }

  /** The English was shown, or another hint used. Counted for Door to Door. */
  hint() {
    this.hints++;
  }

  choose(index: number, info: ChoiceInfo = {}): ChoiceResult {
    const node = this.current;
    if (!node || this.outcome) throw new Error('dialogue has ended');
    const option = node.options[index];
    if (!option) throw new Error(`no option ${index} at ${node.id}`);
    const correct = option.correct !== false;
    const test = isTest(node);
    const first = !this.tried.has(node.id);
    this.tried.add(node.id);
    const counts = test && first && !info.glossShown;

    // ---- log ----
    const counted: string[] = [];
    let logged = 0;
    const log = (a: Omit<Answer, 'source'>) => {
      const r = this.engine.answer({ ...a, source: this.source });
      logged++;
      if (r.counted) counted.push(a.ref);
    };
    const why = !test ? 'free choice' : !first ? 'retry' : info.glossShown ? 'english shown' : undefined;
    if (test) {
      const target = correct ? option : node.options.find((o) => o.correct !== false)!;
      const chosenOwn = distinctive(node, option);
      for (const id of distinctive(node, target)) {
        log({
          ref: `item:${id}`, skill: 'read', correct, ms: info.ms, counts,
          hints: info.glossShown ? 1 : 0,
          confusedWith: !correct && chosenOwn[0] ? `item:${chosenOwn[0]}` : undefined,
          data: { node: node.id, option: index, why },
        });
      }
      for (const id of node.heard ?? []) {
        log({ ref: `item:${id}`, skill: 'hear', correct, ms: info.ms, counts, hints: info.glossShown ? 1 : 0, data: { node: node.id, option: index, why } });
      }
      this.tests += first ? 1 : 0;
      if (first && correct) this.firstTryRight++;
    } else {
      for (const id of distinctive(node, option)) {
        log({ ref: `item:${id}`, skill: 'read', counts: false, data: { node: node.id, option: index, why } });
      }
    }

    // ---- effects ----
    this.baht += option.baht ?? 0;
    this.rep += option.rep ?? 0;
    if (this.comfort != null) this.comfort = Math.max(0, Math.min(COMFORT_MAX, this.comfort + (option.comfort ?? 0)));
    this.history.push({ node: node.id, index, correct });

    let next: string | null = option.next;
    if (this.comfort != null && this.comfort <= 0) {
      this.outcome = 'left';
      next = null;
    } else if (!correct) {
      this.mistakes++;
      this.patience--;
      if (this.patience <= 0 || next == null) {
        this.outcome = 'failed';
        next = null;
      }
    } else if (next == null) {
      this.outcome = 'done';
    }
    this.node = next;

    const low = (this.comfort != null && this.comfort <= 3) || (this.patience <= 1 && this.startPatience !== Infinity);
    const expression: Face = this.outcome === 'left' || (!correct && low) ? 'sad' : !correct ? 'puzzled' : (option.comfort ?? 0) < 0 ? 'sad' : 'smile';
    return { index, option, correct, test, first, counted, logged, feedback: option.feedback ?? null, expression, outcome: this.outcome, next };
  }

  /**
   * "Say it out loud": log the line said, with the learner's own rating (in
   * captions mode there is nothing to measure). Counts only for a right reply.
   */
  say(option: StreetOption, own: Six, ms?: number): AnswerResult[] {
    const out: AnswerResult[] = [];
    for (const id of option.items) {
      out.push(
        this.engine.answer({
          ref: `item:${id}`, skill: 'say', own, correct: own >= Six.Almost, ms, source: this.source,
          counts: option.correct !== false, data: { recording: 'tap' },
        }),
      );
    }
    return out;
  }

  /** Accuracy on first tries at test steps, 0..1. */
  accuracy(): number {
    return this.tests ? this.firstTryRight / this.tests : 1;
  }
}

/** A step tests understanding when some replies are right and some wrong. */
export function isTest(node: StreetNode): boolean {
  return node.options.some((o) => o.correct !== false) && node.options.some((o) => o.correct === false);
}

/**
 * The items that set this reply apart: not the polite ending, and not items
 * every reply shares (those need no understanding to pick).
 */
export function distinctive(node: StreetNode, option: StreetOption): string[] {
  const shared = node.options.reduce<Set<string>>(
    (s, o, i) => (i === 0 ? new Set(o.items) : new Set([...s].filter((x) => o.items.includes(x)))),
    new Set(),
  );
  return [...new Set(option.items)].filter((id) => !ENDING_IDS.includes(id) && !shared.has(id));
}
