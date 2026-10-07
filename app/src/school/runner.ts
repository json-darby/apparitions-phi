// The lesson runner: pure logic, no React, no audio. It turns the chosen lines
// into a queue of steps and decides what comes next; the live model is only
// the voice and the ear.
//
//  teach   the tutor says one of your lines and you repeat it. A long line is
//          built from the end backwards, one chunk at a time (back-chaining).
//  branch  the tutor plays the other person and says one of the likely
//          replies, picked at random; you answer with your line. If you miss
//          it, you say the escape line ("say that again") and hear it again.
//  slot    the frame stays and the word changes: "I'd like ___" with water, a
//          beer, the bill, each on a short timer.
//  recall  an earlier line comes back after about 5 s, 25 s, 2 min and 10 min.
//
// Training wheels: each line has a support level that drops as you get it
// right and rises again when you miss it.
//  1  new: the English instruction and the meaning are shown (and may be read aloud)
//  2  right twice in a row: the instruction is on screen only, the meaning hidden until tapped
//  3  right four times in a row: nothing in English
// A turn counts as a review only at level 3 with nothing revealed, and never
// for a teach step (repeating after the tutor needs no recall).
// At level 3 a recall is cued in Thai by a reply that leads to the line when
// the lesson has one; a line with no such reply keeps its "Say: ..." cue,
// since nothing else can tell you which line to say.

import type { Tone } from '../content/types';
import { core, MATCH_AT, similarity, type Verdict } from '../live/tools';
import { lineIndex, escapeLines, frameById, type LineRef, type SchoolFile, type SchoolLine, type SchoolReply, type FrameWord, type SchoolFrame, type Sex } from './content';

// ---------- training wheels ----------

export type Level = 1 | 2 | 3;
export interface Wheel {
  /** rights in a row */
  streak: number;
  level: Level;
  /** turns that changed the wheel, and misses among them */
  turns: number;
  misses: number;
  /** last turn, epoch ms */
  at: number;
}
export type Wheels = Record<string, Wheel>;

/** Rights in a row needed for each level. */
export const LEVEL_AT: Record<Level, number> = { 1: 0, 2: 2, 3: 4 };

export function levelFor(streak: number): Level {
  return streak >= LEVEL_AT[3] ? 3 : streak >= LEVEL_AT[2] ? 2 : 1;
}

export function newWheel(): Wheel {
  return { streak: 0, level: 1, turns: 0, misses: 0, at: 0 };
}

export function wheelOf(w: Wheels, key: string): Wheel {
  return w[key] ?? newWheel();
}

/** One right: the streak grows and the level may drop. */
export function wheelRight(w: Wheel, at = 0): Wheel {
  const streak = w.streak + 1;
  return { ...w, streak, level: levelFor(streak), turns: w.turns + 1, at };
}

/** One miss: the level rises one step, and the streak goes back to that level's start. */
export function wheelMiss(w: Wheel, at = 0): Wheel {
  const level = Math.max(1, w.level - 1) as Level;
  return { ...w, streak: LEVEL_AT[level], level, turns: w.turns + 1, misses: w.misses + 1, at };
}

/** What a step shows in English at a support level. */
export interface Shown {
  /** the instruction pinned above the mic, or null */
  instruction: string | null;
  /** read the instruction aloud (when the read-aloud toggle is on): level 1 only */
  speak: boolean;
  /** the English row on the bubbles: shown, behind a tap, or not there */
  meaning: 'shown' | 'tap' | 'hidden';
}

// ---------- steps ----------

export type StepKind = 'teach' | 'chunk' | 'branch' | 'escape' | 'slot' | 'recall';

export interface Spoken {
  thai: string;
  roman: string;
  en: string;
  tones: Tone[];
}

export interface Step {
  /** unique within the lesson */
  id: string;
  kind: StepKind;
  /** the training-wheels key: the line id, or "frame:word" for a slot */
  key: string;
  /** the line you say (null for a slot sentence) */
  lineId: string | null;
  sectionId: string;
  /** what the tutor says first, from the lesson data; null when the tutor stays quiet */
  cue: (Spoken & { who: 'tutor' | 'other' }) | null;
  /** what you should say */
  target: Spoken;
  /** course item ids in what you say */
  items: string[];
  /** the full English instruction, at level 1 */
  instruction: string;
  /** the shorter one used at level 3, which gives nothing away */
  bare: string;
  /** can be a review: never a teach or chunk step */
  canCount: boolean;
  /** branch and its repeat: the reply */
  replyId?: string;
  /** slot */
  frameId?: string;
  wordId?: string;
  /** slot: seconds to answer */
  timerMs?: number;
  /** recall: which of the four gaps */
  recall?: number;
  /** said slowly (after an escape, or the learner asked) */
  slower?: boolean;
}

export type Result = 'right' | 'wrong' | 'none' | 'skip';

/** In-lesson recall: about 5 s, 25 s, 2 min and 10 min after a line is taught. */
export const RECALL_GAPS_MS = [5_000, 25_000, 120_000, 600_000];
export const SLOT_TIMER_MS = 6_000;
/** A line longer than this many syllables is taught from the end backwards. */
export const BACKCHAIN_OVER = 4;
/** Slot words per frame, and frames per section, in one lesson. */
export const SLOT_WORDS = 3;
export const SLOT_FRAMES = 2;

export type They = Sex | 'mixed';

// ---------- what a line costs in time ----------

/** Rough seconds a line takes in a lesson at a support level, for fitting the session length. */
export function lineSeconds(line: SchoolLine, level: Level, form: Sex = 'm'): number {
  const syl = line[form].tones.length;
  const chunks = syl > BACKCHAIN_OVER ? Math.max(0, chunkGroups(line[form].parts).length - 1) : 0;
  const teach = level < 3 ? 22 + chunks * 12 : 0;
  const branch = line.replies.length ? 24 : 0;
  const recalls = (level < 3 ? RECALL_GAPS_MS.length : 2) * 11;
  return teach + branch + recalls;
}

/** Seconds of slot practice a set of sections adds. */
export const SLOT_SECONDS = 11;

/** The lines that fit the session length, in order (at least one). */
export function fitToMinutes(lines: SchoolLine[], wheels: Wheels, minutes: number, form: Sex = 'm', slotSeconds = 0): SchoolLine[] {
  const budget = minutes * 60 - slotSeconds;
  const out: SchoolLine[] = [];
  let used = 0;
  for (const l of lines) {
    const s = lineSeconds(l, wheelOf(wheels, l.id).level, form);
    if (out.length && used + s > budget) continue;
    out.push(l);
    used += s;
  }
  return out;
}

// ---------- back-chaining ----------

/**
 * The parts of a line grouped for back-chaining: the polite ending rides with
 * the part before it, and a group grows to at most three syllables.
 */
export function chunkGroups(parts: { thai: string; roman: string; tones: Tone[] }[]): { thai: string; roman: string; tones: Tone[] }[] {
  const units = parts.slice();
  if (units.length > 1 && /^(ครับ|ค่ะ|คะ)$/.test(units[units.length - 1].thai)) {
    const end = units.pop()!;
    const last = units.pop()!;
    units.push({ thai: last.thai + end.thai, roman: `${last.roman} ${end.roman}`, tones: [...last.tones, ...end.tones] });
  }
  // from the end: merge small units until a group would pass three syllables
  const groups: { thai: string; roman: string; tones: Tone[] }[] = [];
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    const g = groups[0];
    if (g && g.tones.length + u.tones.length <= 3) groups[0] = { thai: u.thai + g.thai, roman: `${u.roman} ${g.roman}`, tones: [...u.tones, ...g.tones] };
    else groups.unshift({ ...u, tones: [...u.tones] });
  }
  return groups;
}

/** The back-chaining steps' Thai: the last group, then the last two, and so on, ending before the whole line. */
export function backChain(parts: { thai: string; roman: string; tones: Tone[] }[]): { thai: string; roman: string; tones: Tone[] }[] {
  const g = chunkGroups(parts);
  const out: { thai: string; roman: string; tones: Tone[] }[] = [];
  for (let k = 1; k < g.length; k++) {
    const tail = g.slice(g.length - k);
    out.push({ thai: tail.map((x) => x.thai).join(''), roman: tail.map((x) => x.roman).join(' '), tones: tail.flatMap((x) => x.tones) });
  }
  return out;
}

// ---------- the verdict ----------

/** How well a transcript matches a target, consonants and vowels only, ending ignored. */
export function matchScore(heard: string, target: string): number {
  if (!heard.trim()) return 0;
  return Math.max(similarity(heard, target), similarity(core(heard), core(target)));
}

/** A transcript this close is right even without the tutor's word for it. */
export const SURE_AT = 0.9;

/**
 * Did you say the right line? The tutor's lineHeard verdict, backed by the
 * transcript match: the model can report a wrong line as right, so a "right"
 * needs the transcript to agree, and a near-exact transcript wins over "wrong".
 */
export function combineVerdict(model: Verdict | null, heard: string | null, target: string): Exclude<Result, 'skip'> {
  const said = (heard ?? '').trim();
  const score = said ? matchScore(said, target) : 0;
  if (!said) return model === 'right' || model === 'close' ? 'wrong' : 'none';
  if (model === 'right' || model === 'close') return score >= MATCH_AT ? 'right' : 'wrong';
  if (model === 'wrong' || model === 'none') return score >= SURE_AT ? 'right' : 'wrong';
  return score >= SURE_AT ? 'right' : 'wrong';
}

// ---------- the runner ----------

export interface LessonInput {
  file: SchoolFile;
  /** the chosen lines, in order */
  lineIds: string[];
  identity: Sex;
  they: They;
  wheels: Wheels;
  /** session length; the lesson stops teaching new lines after it */
  minutes: number;
  /** slot steps for the sections' frames (default on) */
  slots?: boolean;
  /**
   * 'branch': Teach is marked done (the section was opened by its door phrase):
   * no teach steps; the lesson opens at Branches and each line comes back by
   * recall from the second gap on.
   */
  startAt?: 'teach' | 'branch';
  /** the tutor's name, for the instructions */
  tutor?: string;
  rng?: () => number;
  now?: () => number;
}

export interface LineResult {
  lineId: string;
  sectionId: string;
  right: number;
  misses: number;
  /** turns that counted as reviews */
  counted: number;
  /** counted misses: these went to reviews */
  countedMisses: number;
  taught: boolean;
  /** the last time you repeated it after the tutor, you said it */
  taughtRight: boolean;
}

export interface ReportOutcome {
  before: Level;
  level: Level;
  counted: boolean;
  /** the wheel after the turn, already stored in runner.wheels */
  wheel: Wheel | null;
}

interface Recall {
  lineId: string;
  at: number;
  n: number;
}

let stepSeq = 0;

export class LessonRunner {
  readonly lines: SchoolLine[];
  readonly identity: Sex;
  wheels: Wheels;
  readonly startedAt: number;
  readonly deadline: number;
  /** every step handed out, in order */
  readonly history: { step: Step; result: Result | null; counted: boolean }[] = [];
  private queue: Step[] = [];
  private recalls: Recall[] = [];
  private results = new Map<string, LineResult>();
  private taught = new Set<string>();
  private escaped = new Set<string>();
  private current: Step | null = null;
  private in: LessonInput;
  private rng: () => number;
  private now: () => number;
  private lineSection = new Map<string, string>();
  private index: Map<string, LineRef>;
  private replyOf = new Map<string, { reply: SchoolReply; line: SchoolLine }[]>();

  constructor(input: LessonInput) {
    this.in = input;
    this.rng = input.rng ?? Math.random;
    this.now = input.now ?? Date.now;
    this.identity = input.identity;
    this.wheels = { ...input.wheels };
    this.startedAt = this.now();
    this.deadline = this.startedAt + input.minutes * 60_000;
    const index = lineIndex(input.file);
    this.index = index;
    this.lines = input.lineIds.map((id) => index.get(id)?.line).filter((l): l is SchoolLine => !!l);
    for (const id of input.lineIds) {
      const r = index.get(id);
      if (r) this.lineSection.set(id, r.section.id);
    }
    // which replies lead to each line in this lesson (for recall cues)
    const inLesson = new Set(this.lines.map((l) => l.id));
    for (const l of this.lines) {
      for (const reply of l.replies) {
        if (!inLesson.has(reply.answer)) continue;
        const list = this.replyOf.get(reply.answer) ?? [];
        list.push({ reply, line: l });
        this.replyOf.set(reply.answer, list);
      }
    }
    for (const l of this.lines) this.results.set(l.id, { lineId: l.id, sectionId: this.lineSection.get(l.id) ?? '', right: 0, misses: 0, counted: 0, countedMisses: 0, taught: false, taughtRight: false });
    this.plan();
  }

  // ---- reading ----

  level(key: string): Level {
    return wheelOf(this.wheels, key).level;
  }

  /** What the current step shows in English at its line's level. */
  shown(step: Step): Shown {
    const level = this.level(step.key);
    if (level === 1) return { instruction: step.instruction, speak: true, meaning: 'shown' };
    if (level === 2) return { instruction: step.instruction, speak: false, meaning: 'tap' };
    return { instruction: step.bare || null, speak: false, meaning: 'hidden' };
  }

  get step(): Step | null {
    return this.current;
  }

  get done(): boolean {
    return !this.current && !this.queue.length && !this.recalls.length;
  }

  /** Steps still queued (not counting recalls), for the progress rail. */
  get left(): number {
    return this.queue.length + this.recalls.length;
  }

  lineResults(): LineResult[] {
    return [...this.results.values()];
  }

  /** Lines missed at least once (or not said even after the tutor), in lesson order: the rerun. */
  missedLineIds(): string[] {
    return this.lineResults().filter(isMissed).map((r) => r.lineId);
  }

  gotLineIds(): string[] {
    return this.lineResults().filter(isGot).map((r) => r.lineId);
  }

  // ---- building the queue ----

  private they(): Sex {
    const t = this.in.they;
    return t === 'mixed' ? (this.rng() < 0.5 ? 'f' : 'm') : t;
  }

  private spokenLine(l: SchoolLine): Spoken {
    const f = l[this.identity];
    return { thai: f.thai, roman: f.roman, en: l.en, tones: f.tones };
  }

  private make(kind: StepKind, x: Omit<Step, 'id' | 'kind'>): Step {
    return { id: `${kind}-${++stepSeq}`, kind, ...x };
  }

  private tutorName(): string {
    return this.in.tutor ?? 'the tutor';
  }

  teachSteps(l: SchoolLine): Step[] {
    const target = this.spokenLine(l);
    const sectionId = this.lineSection.get(l.id) ?? '';
    const items = l[this.identity].items;
    const out: Step[] = [];
    if (target.tones.length > BACKCHAIN_OVER) {
      for (const c of backChain(l[this.identity].parts)) {
        const t: Spoken = { thai: c.thai, roman: c.roman, en: `the end of “${l.en}”`, tones: c.tones };
        out.push(this.make('chunk', {
          key: l.id, lineId: l.id, sectionId, cue: { ...t, who: 'tutor' }, target: t, items,
          instruction: `Build it from the end. Say: ${c.roman}`, bare: 'From the end', canCount: false,
        }));
      }
    }
    out.push(this.make('teach', {
      key: l.id, lineId: l.id, sectionId, cue: { ...target, who: 'tutor' }, target, items,
      instruction: `Listen to ${this.tutorName()}, then say it: ${l.en}`, bare: 'Repeat', canCount: false,
    }));
    return out;
  }

  branchStep(l: SchoolLine, reply: SchoolReply, slower = false): Step | null {
    const answer = this.index.get(reply.answer)?.line;
    if (!answer) return null;
    const who = this.they();
    const r = reply[who];
    return this.make('branch', {
      key: answer.id, lineId: answer.id, sectionId: this.lineSection.get(answer.id) ?? this.lineSection.get(l.id) ?? '',
      cue: { thai: r.thai, roman: r.roman, en: reply.en, tones: r.tones, who: 'other' },
      target: this.spokenLine(answer), items: answer[this.identity].items,
      instruction: `They say “${reply.en}” Answer: ${answer.en}`, bare: 'Answer them', canCount: true, replyId: reply.id, slower,
    });
  }

  recallStep(lineId: string, n: number): Step | null {
    const l = this.index.get(lineId)?.line;
    if (!l) return null;
    const leads = this.replyOf.get(lineId) ?? [];
    const sectionId = this.lineSection.get(lineId) ?? '';
    // a reply that leads to the line makes a cue in Thai; otherwise the English is the cue
    if (leads.length && this.rng() < 0.6) {
      const pick = leads[Math.floor(this.rng() * leads.length)];
      const s = this.branchStep(pick.line, pick.reply);
      if (s) return { ...s, id: `recall-${++stepSeq}`, kind: 'recall', recall: n };
    }
    return this.make('recall', {
      key: l.id, lineId: l.id, sectionId, cue: null, target: this.spokenLine(l), items: l[this.identity].items,
      instruction: `Say: ${l.en}`, bare: `Say: ${l.en}`, canCount: true, recall: n,
    });
  }

  escapeStep(kind: 'again' | 'slower' = 'again'): Step | null {
    const e = escapeLines(this.in.file)[kind];
    if (!e) return null;
    const sectionId = this.index.get(e.id)?.section.id ?? '';
    return this.make('escape', {
      key: e.id, lineId: e.id, sectionId, cue: null, target: this.spokenLine(e), items: e[this.identity].items,
      instruction: `Didn’t catch it? Say: ${e.en}`, bare: 'Didn’t catch it?', canCount: true,
    });
  }

  slotSteps(sectionId: string): Step[] {
    const section = this.in.file.sections.find((s) => s.id === sectionId);
    if (!section) return [];
    const out: Step[] = [];
    const frames = section.frames.filter((f) => f.words.length).slice(0, SLOT_FRAMES);
    for (const sf of frames) {
      const frame = frameById(this.in.file, sf.frame);
      if (!frame) continue;
      for (const w of shuffle(sf.words, this.rng).slice(0, SLOT_WORDS)) out.push(this.slotStep(sectionId, frame, w));
    }
    return out;
  }

  private slotStep(sectionId: string, frame: SchoolFrame, w: FrameWord): Step {
    const f = w[this.identity];
    const en = frame.en.replace('___', w.en);
    return this.make('slot', {
      key: `${frame.id}:${w.id}`, lineId: null, sectionId,
      cue: { thai: w.word.thai, roman: w.word.roman, en: w.en, tones: w.word.tones, who: 'tutor' },
      target: { thai: f.thai, roman: f.roman, en, tones: f.tones }, items: f.items,
      instruction: `Say: ${en}`, bare: frame[this.identity].thai, canCount: true, frameId: frame.id, wordId: w.id, timerMs: SLOT_TIMER_MS,
    });
  }

  /** The main queue: teach each line, with branches once their answer lines are taught, then slots. */
  private plan() {
    const inLesson = new Set(this.lines.map((l) => l.id));
    const pending: { line: SchoolLine; reply: SchoolReply }[] = [];
    const known = new Set<string>();
    for (const l of this.lines) {
      const eligible = l.replies.filter((r) => inLesson.has(r.answer));
      if (eligible.length) pending.push({ line: l, reply: eligible[Math.floor(this.rng() * eligible.length)] });
    }
    const teachDone = this.in.startAt === 'branch';
    const t0 = this.now();
    for (const l of this.lines) {
      if (teachDone && this.level(l.id) < 3) {
        // Teach is done: straight to the replies, and the line itself by recall
        this.taught.add(l.id);
        RECALL_GAPS_MS.slice(1).forEach((gap, i) => this.recalls.push({ lineId: l.id, at: t0 + gap, n: i + 2 }));
      } else if (this.level(l.id) < 3) this.queue.push(...this.teachSteps(l));
      else {
        const r = this.recallStep(l.id, 1);
        if (r) this.queue.push(r);
      }
      known.add(l.id);
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (!known.has(p.line.id) || !known.has(p.reply.answer)) continue;
        const s = this.branchStep(p.line, p.reply);
        if (s) this.queue.push(s);
        pending.splice(i--, 1);
      }
    }
    if (this.in.slots !== false) {
      const sections = [...new Set(this.lines.map((l) => this.lineSection.get(l.id) ?? ''))];
      for (const s of sections) this.queue.push(...this.slotSteps(s));
    }
  }

  // ---- running ----

  /** The next step, or null when the lesson is over. */
  next(): Step | null {
    const now = this.now();
    this.recalls.sort((a, b) => a.at - b.at);
    const due = this.recalls[0] && this.recalls[0].at <= now ? this.recalls.shift()! : null;
    let step: Step | null = null;
    if (due) step = this.recallStep(due.lineId, due.n);
    else if (now >= this.deadline) {
      // time is up: finish an escape in progress, then stop
      while (this.queue.length && !step) {
        const s = this.queue.shift()!;
        if (s.slower || s.kind === 'escape') step = s;
      }
      this.queue = [];
      this.recalls = [];
    } else if (this.queue.length) step = this.queue.shift()!;
    else if (this.recalls.length) {
      // nothing left to teach: bring the next recall forward
      const r = this.recalls.shift()!;
      step = this.recallStep(r.lineId, r.n);
    }
    this.current = step;
    if (step) this.history.push({ step, result: null, counted: false });
    return step;
  }

  /**
   * Report the current step. `helped`: the learner revealed the English or the
   * answer during the turn, so it cannot count and does not move the wheel.
   */
  report(result: Result, helped = false): ReportOutcome {
    const step = this.current;
    if (!step) return { before: 1, level: 1, counted: false, wheel: null };
    const now = this.now();
    const before = this.level(step.key);
    const h = this.history[this.history.length - 1];
    if (h?.step === step) h.result = result;
    let wheel: Wheel | null = null;
    const turn = step.canCount && result !== 'skip' && !helped;
    if (turn) {
      wheel = result === 'right' ? wheelRight(wheelOf(this.wheels, step.key), now) : wheelMiss(wheelOf(this.wheels, step.key), now);
      this.wheels = { ...this.wheels, [step.key]: wheel };
    }
    const counted = turn && before === 3;
    if (h?.step === step) h.counted = counted;

    const res = step.lineId ? this.results.get(step.lineId) : undefined;
    if (res && result !== 'skip') {
      if (step.kind === 'teach') {
        res.taught = true;
        res.taughtRight = result === 'right';
      }
      if (step.canCount) {
        if (result === 'right') res.right++;
        else res.misses++;
        if (counted) {
          res.counted++;
          if (result !== 'right') res.countedMisses++;
        }
      }
    }

    // a taught line comes back at widening gaps; a missed recall comes back soon
    if (step.kind === 'teach' && step.lineId && !this.taught.has(step.lineId)) {
      this.taught.add(step.lineId);
      RECALL_GAPS_MS.forEach((gap, i) => this.recalls.push({ lineId: step.lineId!, at: now + gap, n: i + 1 }));
    } else if (step.kind === 'recall' && step.lineId && step.recall === 1 && !this.taught.has(step.lineId) && before === 3) {
      // a known line opened with a recall: the later gaps follow
      this.taught.add(step.lineId);
      RECALL_GAPS_MS.slice(2).forEach((gap, i) => this.recalls.push({ lineId: step.lineId!, at: now + gap, n: i + 3 }));
    } else if (step.kind === 'recall' && step.lineId && (result === 'wrong' || result === 'none')) {
      this.recalls.push({ lineId: step.lineId, at: now + RECALL_GAPS_MS[1], n: step.recall ?? 1 });
    }

    // a missed reply (a branch, or a recall cued by one): say the escape line, then hear it again (once per reply)
    if (step.cue?.who === 'other' && step.replyId && (result === 'wrong' || result === 'none') && !this.escaped.has(step.replyId)) {
      this.escaped.add(step.replyId);
      const owner = this.lines.find((l) => l.replies.some((r) => r.id === step.replyId));
      const reply = owner?.replies.find((r) => r.id === step.replyId);
      const esc = this.escapeStep(result === 'none' ? 'again' : 'slower');
      const again = owner && reply ? this.branchStep(owner, reply, true) : null;
      if (again && step.cue) again.cue = { ...step.cue };
      this.queue.unshift(...[esc, again].filter((s): s is Step => !!s));
    }
    this.current = null;
    return { before, level: this.level(step.key), counted, wheel };
  }

  /** Put the current step back (the connection dropped mid-turn): it comes next. */
  requeue() {
    if (!this.current) return;
    this.queue.unshift(this.current);
    if (this.history[this.history.length - 1]?.step === this.current) this.history.pop();
    this.current = null;
  }
}

export function isMissed(r: LineResult): boolean {
  return r.misses > 0 || (r.taught && !r.taughtRight && !r.right);
}

export function isGot(r: LineResult): boolean {
  return !isMissed(r) && (r.right > 0 || r.taughtRight);
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
