// Function tools for Live, and how their calls move the task along.
//
//  slotFilled(slot, value, learnerThai)  a step of the task is done
//  questComplete(summary)                every step is done
//  flagUnsafe(category, note)            the learner asked for something off limits
//
// LiveRun is the live counterpart of DialogueRun: it walks the same task nodes,
// applies the same effects (baht, reputation, comfort), and reports to the
// engine. What counts (the same rule as every game: only if it could not have
// been done without the Thai):
//  - 'say': every learner utterance is logged under source live:<taskId>. It
//    counts only when it matched the expected items for the current step, by
//    transcript match or confirmed by slotFilled, and only when spoken (typed
//    text is logged, never counted). Items with no card are logged, not added.
//  - 'hear': when slotFilled confirms a step whose right reply depended on the
//    character's line (node.heard), those items count, unless the English of
//    that line was shown first.
// Live never judges tones. Its transcript is checked for consonants and vowels
// only (tone marks removed), the same way as the /stt check.

import type { Item } from '../content/types';
import { ENDING_IDS, type StreetNode, type StreetOption, type StreetTaskBuilt } from '../content/street-seed';
import type { Answer, AnswerResult } from '../engine/engine';
import type { FunctionDeclaration, TaskScript } from './client';

export interface Answerer {
  answer(a: Answer): AnswerResult;
}

export const TOOL_NAMES = ['slotFilled', 'questComplete', 'flagUnsafe'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const UNSAFE_CATEGORIES = ['sexual', 'drugs', 'real_person', 'minor', 'harm', 'other'] as const;

/** Declarations in the Gemini function-calling schema. */
export function liveTools(steps: string[]): FunctionDeclaration[] {
  return [
    {
      name: 'slotFilled',
      description: 'Call as soon as the learner has said, in Thai, something that completes one step of the task. Do not call it for a wrong or unclear answer.',
      parameters: {
        type: 'OBJECT',
        properties: {
          slot: { type: 'STRING', enum: steps, description: 'The step name, exactly as listed.' },
          value: { type: 'STRING', description: 'A short English gloss of what the learner said.' },
          learnerThai: { type: 'STRING', description: 'The Thai the learner said, as you heard it.' },
        },
        required: ['slot', 'value'],
      },
    },
    {
      name: 'questComplete',
      description: 'Call once, when every step of the task is done. Then say a short goodbye in Thai.',
      parameters: { type: 'OBJECT', properties: { summary: { type: 'STRING', description: 'One short English sentence.' } } },
    },
    {
      name: 'flagUnsafe',
      description: 'Call when the learner asks for sexual content, help obtaining drugs, anything about real identifiable people, anything involving minors, or anything harmful. Then redirect politely in Thai.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: [...UNSAFE_CATEGORIES] },
          note: { type: 'STRING', description: 'A few English words, no quotes from the learner.' },
        },
        required: ['category'],
      },
    },
  ];
}

// ---------- School of the Night's tutor ----------
//
//  lineHeard(lineId, verdict, heardThai)  what the tutor heard the learner say
//  repeatAsked(slower)                    the learner asked to hear it again
//  flagUnsafe(category, note)             as above
//
// The app runs the lesson: these only report. The verdict is backed by the
// app's own transcript match (school/runner.ts combineVerdict) before it counts.

export const TUTOR_TOOL_NAMES = ['lineHeard', 'repeatAsked', 'flagUnsafe'] as const;
export const VERDICTS = ['right', 'close', 'wrong', 'none'] as const;
export type Verdict = (typeof VERDICTS)[number];

export function tutorTools(): FunctionDeclaration[] {
  const unsafe = liveTools([]).find((t) => t.name === 'flagUnsafe')!;
  return [
    {
      name: 'lineHeard',
      description: 'Call once after every learner turn: which line they were asked for, whether they said it, and the Thai you heard. Then say nothing and wait for the next instruction.',
      parameters: {
        type: 'OBJECT',
        properties: {
          lineId: { type: 'STRING', description: 'The line id given in the instruction.' },
          verdict: { type: 'STRING', enum: [...VERDICTS], description: 'right: they said the line (a different polite ending is fine). close: most of it. wrong: something else. none: silence or nothing you could make out.' },
          heardThai: { type: 'STRING', description: 'The Thai you heard, in Thai script.' },
        },
        required: ['lineId', 'verdict'],
      },
    },
    {
      name: 'repeatAsked',
      description: 'Call when the learner asks you to say it again, to slow down, or says they do not understand. Then say your last line again (slowly if asked) and wait.',
      parameters: { type: 'OBJECT', properties: { slower: { type: 'BOOLEAN', description: 'They asked you to speak more slowly.' } } },
    },
    unsafe,
  ];
}

// ---------- Thai matching (consonants and vowels; tone marks removed) ----------

const TONE_MARKS = /[่-๋]/g;
const NOISE = /[\s​.,!?'"“”‘’()\-–—…:;ๆฯ]/g;

export function segmental(s: string): string {
  return s.normalize('NFC').replace(NOISE, '').replace(TONE_MARKS, '').toLowerCase();
}

export function similarity(a0: string, b0: string): number {
  const a = [...segmental(a0)];
  const b = [...segmental(b0)];
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.max(0, 1 - prev[b.length] / Math.max(a.length, b.length));
}

/** Strip the polite ending so ครับ / ค่ะ / คะ never decide a match. */
export function core(thai: string): string {
  return thai.replace(/(นะครับ|นะคะ|ครับ|ค่ะ|คะ)\s*$/u, '');
}

export const MATCH_AT = 0.75;

/** The reply in this node the learner's words match best, if any match well enough. */
export function matchOption(node: StreetNode, said: string): { index: number; option: StreetOption; score: number } | null {
  if (!said.trim()) return null;
  let best: { index: number; option: StreetOption; score: number } | null = null;
  node.options.forEach((option, index) => {
    const score = Math.max(similarity(said, option.thai), similarity(core(said), core(option.thai)));
    if (!best || score > best.score || (score === best.score && option.correct !== false && best.option.correct === false)) best = { index, option, score };
  });
  const b = best as { index: number; option: StreetOption; score: number } | null;
  return b && b.score >= MATCH_AT ? b : null;
}

// ---------- English for the bubbles ----------

/** A word-by-word English gloss from known items found in the Thai (longest first). */
export function glossFor(thai: string, items: Item[]): string {
  const pool = [...items].filter((i) => i.thai && !ENDING_IDS.includes(i.id)).sort((a, b) => b.thai.length - a.thai.length);
  let rest = thai;
  const found: { at: number; en: string }[] = [];
  for (const it of pool) {
    for (const form of [it.thai, it.forms?.m.thai, it.forms?.f.thai]) {
      if (!form) continue;
      let i = rest.indexOf(form);
      while (i >= 0) {
        found.push({ at: i, en: it.en });
        rest = rest.slice(0, i) + '\u0000'.repeat(form.length) + rest.slice(i + form.length);
        i = rest.indexOf(form);
      }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.en.replace(/[.]$/, '')).join(' · ');
}

/** Lines that talk about tones or pronunciation: shown with an "unverified" note. */
export function mentionsTones(text: string): boolean {
  return /\b(tone|tones|tonal|pronunciation|pronounce|accent|pitch)\b|เสียง|วรรณยุกต์|ออกเสียง|สำเนียง/i.test(text);
}

// ---------- the script, for mock mode and for the persona ----------

export function slotOf(task: StreetTaskBuilt, node: StreetNode): string {
  return task.steps[node.step] ?? task.steps[task.steps.length - 1] ?? 'Talk';
}

export function scriptFor(task: StreetTaskBuilt): TaskScript {
  return {
    start: task.start,
    nodes: Object.values(task.nodes).map((n) => ({
      id: n.id,
      slot: slotOf(task, n),
      thai: n.thai,
      en: n.en,
      options: n.options.map((o) => ({ thai: o.thai, en: o.en, correct: o.correct !== false, next: o.next })),
    })),
  };
}

// ---------- the run ----------

export type LiveOutcome = 'done' | 'failed' | 'left';

export interface Utterance {
  text: string;
  /** the reply it matched, if any */
  match: { index: number; option: StreetOption; score: number } | null;
  /** it matched a right reply for this step */
  right: boolean;
  typed: boolean;
  counted: string[];
  logged: number;
}

export interface ToolOutcome {
  response: Record<string, unknown>;
  kind: 'slot' | 'complete' | 'unsafe' | 'rejected';
  /** slotFilled: the reply it took */
  option?: StreetOption;
  counted: string[];
}

const COMFORT_MAX = 10;

export class LiveRun {
  node: string | null;
  baht = 0;
  rep = 0;
  comfort: number | null;
  outcome: LiveOutcome | null = null;
  flags = 0;
  mistakes = 0;
  slotsFilled = 0;
  firstTryRight = 0;
  hints = 0;
  /** stuck tries on the current step (silence, no match, wrong reply) */
  stuck = 0;
  readonly source: string;
  readonly task: StreetTaskBuilt;
  readonly history: { node: string; index: number; correct: boolean; via: 'transcript' | 'tool' }[] = [];
  private engine: Answerer;
  private sayCounted = new Set<string>();
  private heardCounted = new Set<string>();
  private glossed = new Set<string>();
  private missed = new Set<string>();
  private hintedOn = new Set<string>();
  private last: { node: string; text: string; typed: boolean } | null = null;

  constructor(task: StreetTaskBuilt, engine: Answerer, opts: { comfort?: number; source?: string } = {}) {
    this.task = task;
    this.engine = engine;
    this.node = task.start;
    this.comfort = opts.comfort ?? null;
    this.source = opts.source ?? `live:${task.id}`;
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

  /** The English of the character's current line was shown: 'hear' no longer counts for it. */
  glossShown() {
    if (this.node) this.glossed.add(this.node);
  }

  accuracy(): number {
    return this.slotsFilled ? this.firstTryRight / this.slotsFilled : 1;
  }

  private log(a: Omit<Answer, 'source'>, into: string[]): void {
    const r = this.engine.answer({ ...a, source: this.source });
    if (r.counted) into.push(a.ref);
  }

  private sayItems(node: StreetNode, option: StreetOption, opts: { counts: boolean; correct: boolean; text: string; via: string; score?: number }, into: string[]) {
    let n = 0;
    for (const id of option.items) {
      this.log({
        ref: `item:${id}`, skill: 'say', correct: opts.correct, counts: opts.counts, hints: this.hintedOn.has(node.id) ? 1 : 0,
        data: { node: node.id, live: true, via: opts.via, transcript: opts.text, match: opts.score },
      }, into);
      n++;
    }
    return n;
  }

  /** A final transcript of the learner (or text they typed). */
  learnerSaid(text: string, typed = false): Utterance {
    const node = this.current;
    const out: Utterance = { text, match: null, right: false, typed, counted: [], logged: 0 };
    if (!node || this.outcome) return out;
    if (!text.trim()) {
      this.stuck++;
      this.missed.add(node.id);
      return out;
    }
    this.last = { node: node.id, text, typed };
    const m = matchOption(node, text);
    out.match = m;
    if (m && m.option.correct !== false) {
      out.right = true;
      const counts = !typed && !this.sayCounted.has(node.id);
      out.logged = this.sayItems(node, m.option, { counts, correct: true, text, via: typed ? 'typed' : 'transcript', score: m.score }, out.counted);
      if (counts) this.sayCounted.add(node.id);
      return out;
    }
    // a wrong reply or no match: logged against the step's expected reply, never counted
    this.stuck++;
    this.missed.add(node.id);
    const target = node.options.find((o) => o.correct !== false);
    if (target) {
      const ids = distinctiveIds(node, target);
      for (const id of ids) {
        this.log({ ref: `item:${id}`, skill: 'say', correct: false, counts: false, data: { node: node.id, live: true, via: m ? 'wrong-reply' : 'no-match', transcript: text, typed } }, out.counted);
        out.logged++;
      }
    }
    if (m && m.option.correct === false) {
      this.mistakes++;
      this.rep += m.option.rep ?? 0;
      if (this.comfort != null) {
        this.comfort = Math.max(0, Math.min(COMFORT_MAX, this.comfort + (m.option.comfort ?? 0)));
        if (this.comfort <= 0) this.outcome = 'left';
      }
    }
    return out;
  }

  /**
   * Practise a line again. If the learner's last reply finished a step (and they
   * have not spoken since), the run goes back to that step; otherwise it stays
   * on the current one. Nothing is paid, counted or scored twice: the step's
   * reviews were counted the first time, and its baht, reputation and comfort
   * are undone here and applied again when it is filled again. Returns the
   * line to say again, or null when the conversation is over.
   */
  retry(): StreetNode | null {
    if (this.outcome && this.outcome !== 'done') return null;
    const lastFilled = this.history[this.history.length - 1];
    if (lastFilled && this.last?.node === lastFilled.node && this.node !== lastFilled.node) {
      const node = this.task.nodes[lastFilled.node];
      const option = node?.options[lastFilled.index];
      if (node && option) {
        this.history.pop();
        this.slotsFilled = Math.max(0, this.slotsFilled - 1);
        if (!this.missed.has(node.id)) this.firstTryRight = Math.max(0, this.firstTryRight - 1);
        this.baht -= option.baht ?? 0;
        this.rep -= option.rep ?? 0;
        if (this.comfort != null) this.comfort = Math.max(0, Math.min(COMFORT_MAX, this.comfort - (option.comfort ?? 0)));
        this.node = node.id;
        this.outcome = null;
      }
    }
    if (this.outcome) return null;
    this.stuck = 0;
    this.last = null;
    return this.current;
  }

  /** The character gave a hint (after two stuck tries). */
  hinted() {
    this.hints++;
    if (this.node) this.hintedOn.add(this.node);
    this.stuck = 0;
  }

  /** Map a tool call to task progress. The response goes back to the model. */
  onTool(name: string, args: Record<string, unknown>): ToolOutcome {
    const counted: string[] = [];
    if (name === 'flagUnsafe') {
      this.flags++;
      return { kind: 'unsafe', counted, response: { ok: true, instruction: 'Do not continue that topic. Redirect politely in Thai, within the word list.' } };
    }
    if (name === 'questComplete') {
      if (this.outcome === 'done' || !this.node) {
        this.outcome = 'done';
        return { kind: 'complete', counted, response: { ok: true } };
      }
      const left = this.task.steps.slice(this.step);
      return { kind: 'rejected', counted, response: { ok: false, remainingSteps: left, instruction: 'Not finished yet. Carry on with the next step.' } };
    }
    if (name !== 'slotFilled') return { kind: 'rejected', counted, response: { ok: false, error: 'unknown tool' } };

    const slot = String(args.slot ?? '').trim().toLowerCase();
    let node = this.current;
    if (!node) return { kind: 'rejected', counted, response: { ok: false, error: 'the task is already done' } };
    if (slotOf(this.task, node).toLowerCase() !== slot) {
      // the model moved on a step: accept a later step of this task, never an earlier one
      const later = Object.values(this.task.nodes).find((n) => slotOf(this.task, n).toLowerCase() === slot && n.step >= node!.step);
      if (!later) return { kind: 'rejected', counted, response: { ok: false, error: 'unknown or finished step', expected: slotOf(this.task, node) } };
      node = later;
      this.node = later.id;
    }
    const said = typeof args.learnerThai === 'string' && args.learnerThai.trim() ? args.learnerThai : this.last?.node === node.id ? this.last.text : '';
    const m = said ? matchOption(node, said) : null;
    let option: StreetOption | undefined = m?.option;
    if (!option || option.correct === false) {
      const value = String(args.value ?? '').toLowerCase();
      option = node.options.find((o) => o.correct !== false && value && overlap(value, o.en.toLowerCase()) >= 0.5)
        ?? (m?.option.correct === false ? undefined : node.options.find((o) => o.correct !== false));
    }
    if (!option || option.correct === false) {
      const want = node.options.find((o) => o.correct !== false);
      return { kind: 'rejected', counted, response: { ok: false, reason: 'That reply does not complete this step.', needed: want?.en } };
    }

    // 'say': confirmed by the tool, if the transcript match did not already count it
    const typed = this.last?.node === node.id && this.last.typed;
    if (!this.sayCounted.has(node.id) && said) {
      const counts = !typed;
      this.sayItems(node, option, { counts, correct: true, text: said, via: typed ? 'typed+tool' : 'tool' }, counted);
      if (counts) this.sayCounted.add(node.id);
    }
    // 'hear': understanding the character's line, confirmed
    if (node.heard?.length && !this.heardCounted.has(node.id)) {
      const counts = !this.glossed.has(node.id);
      for (const id of node.heard) {
        this.log({ ref: `item:${id}`, skill: 'hear', correct: true, counts, hints: this.glossed.has(node.id) ? 1 : 0, data: { node: node.id, live: true, via: 'tool' } }, counted);
      }
      this.heardCounted.add(node.id);
    }

    this.slotsFilled++;
    if (!this.missed.has(node.id)) this.firstTryRight++;
    this.stuck = 0;
    this.baht += option.baht ?? 0;
    this.rep += option.rep ?? 0;
    if (this.comfort != null) this.comfort = Math.max(0, Math.min(COMFORT_MAX, this.comfort + (option.comfort ?? 0)));
    this.history.push({ node: node.id, index: node.options.indexOf(option), correct: true, via: 'tool' });
    this.node = option.next && this.task.nodes[option.next] ? option.next : null;
    if (!this.node) this.outcome = 'done';
    const nextNode = this.current;
    return {
      kind: 'slot',
      option,
      counted,
      response: {
        ok: true,
        filled: slotOf(this.task, node),
        nextStep: nextNode ? slotOf(this.task, nextNode) : null,
        nextLine: nextNode ? nextNode.thai : null,
        done: !nextNode,
      },
    };
  }
}

function overlap(a: string, b: string): number {
  const wa = new Set(a.split(/\W+/).filter((w) => w.length > 2));
  const wb = new Set(b.split(/\W+/).filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n / Math.min(wa.size, wb.size);
}

/** Items that set a reply apart from the others (not the polite ending, not items every reply shares). */
export function distinctiveIds(node: StreetNode, option: StreetOption): string[] {
  const shared = node.options.reduce<Set<string>>(
    (s, o, i) => (i === 0 ? new Set(o.items) : new Set([...s].filter((x) => o.items.includes(x)))),
    new Set(),
  );
  const ids = [...new Set(option.items)].filter((id) => !ENDING_IDS.includes(id) && !shared.has(id));
  return ids.length ? ids : option.items.filter((id) => !ENDING_IDS.includes(id));
}
