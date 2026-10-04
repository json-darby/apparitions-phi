// The guided day: today's steps in order, which are done, and the one to do
// next. Today's "Next up" card is drawn from this. Pure: Today passes in what
// it already computes (the plan, block minutes, street progress, settings).
//
// Day 1 goes primer, today's lesson, new words, listen and repeat, tone lab, the street, writing,
// review, then the culture note. Later days start with review (and a checkpoint on
// checkpoint days) and add the sentence builder once a pattern is met. A step
// with nothing to do today is left out.

export type GuideStepId = 'primer' | 'checkpoint' | 'review' | 'lesson' | 'new' | 'listen' | 'tonelab' | 'sentence' | 'street' | 'writing' | 'culture';

export interface GuideStep {
  id: GuideStepId;
  title: string;
  /** the route that opens it */
  to: string;
  /** what there is to do, e.g. "12 new" */
  note: string;
  done: boolean;
}

/** A timed block: Today's done test (80% of the block's minutes) and the minutes behind it. */
export interface BlockState {
  done: boolean;
  minutes: number;
  spent: number;
}

export interface GuideInput {
  day: number;
  primerDone: boolean;
  /** reviews due today (plan.reviews.length) */
  reviews: number;
  /** words, letters and patterns still to meet today (plan.newRefs.length) */
  fresh: number;
  /** a pattern is met, or is in today's new set: the sentence builder has something to build */
  patterns: boolean;
  tone: BlockState;
  writing: BlockState;
  /** street tasks still open, how many first open today, and the next one's title */
  street: { left: number; today: number; next: string | null };
  /** today's culture note title, or null when there is none for this day */
  culture: string | null;
  /** a checkpoint day, and whether a score is in today */
  checkpoint: { done: boolean } | null;
  /** today's lesson title (the day's explanation), or null when there is none */
  lesson?: string | null;
  /** today's marks: steps opened ('sentence', 'culture') or skipped ('skip:tonelab') */
  marks: string[];
}

export interface Guide {
  steps: GuideStep[];
  /** the first step not done; null when the day is done */
  next: GuideStep | null;
  /** 1-based position of `next`, or the step count when the day is done */
  at: number;
}

function blockNote(b: BlockState): string {
  return b.spent > 0 ? `${Math.floor(b.spent)} of ${b.minutes} min` : `${b.minutes} min`;
}

export function dayGuide(g: GuideInput): Guide {
  const skipped = (id: GuideStepId) => g.marks.includes(`skip:${id}`);
  const step = (id: GuideStepId, title: string, to: string, note: string, done: boolean): GuideStep => ({ id, title, to, note, done: done || skipped(id) });

  const review = step('review', 'Review', '/review', `${g.reviews} due`, g.reviews === 0 && (g.day !== 1 || g.fresh === 0));
  const fresh = step('new', 'New words', '/new', `${g.fresh} new`, g.fresh === 0);
  const lesson = g.lesson ? step('lesson', "Today's lesson", '/lesson', g.lesson, g.marks.includes('lesson')) : null;
  // hearing each new word and saying it aloud straight away is what makes it stick
  const listen = step('listen', 'Listen and repeat', '/listen', 'Hear each new word, then say it aloud', g.marks.includes('listen'));
  const tone = step('tonelab', 'Tone lab', '/tone-pairs', blockNote(g.tone), g.tone.done);
  const writing = step('writing', 'Writing', '/writing', blockNote(g.writing), g.writing.done);
  const streetOn = g.street.left > 0 || g.street.today > 0;
  const street = step('street', g.day === 1 ? 'The street conversation' : 'The street', '/street', g.street.next ?? 'Done for today', g.street.left === 0);
  const culture = g.culture ? step('culture', 'Culture note', '/culture', g.culture, g.marks.includes('culture')) : null;

  const primer = step('primer', 'How Thai works', '/primer', 'Five minutes: tones, romanisation, polite endings', g.primerDone);
  let steps: (GuideStep | null)[];
  if (g.day === 1) {
    steps = [primer, lesson, fresh, listen, tone, streetOn ? street : null, writing, review, culture];
  } else {
    steps = [
      // a learner who set up before the primer existed (or skipped it) meets it first, on any day
      g.primerDone ? null : primer,
      g.checkpoint ? step('checkpoint', 'Checkpoint', '/checkpoint', `Day ${g.day}`, g.checkpoint.done) : null,
      review,
      lesson,
      fresh,
      listen,
      tone,
      g.patterns ? step('sentence', 'Sentence builder', '/sentence', 'Patterns', g.marks.includes('sentence')) : null,
      streetOn ? street : null,
      writing,
      culture,
    ];
  }
  const list = steps.filter((s): s is GuideStep => !!s);
  const i = list.findIndex((s) => !s.done);
  return { steps: list, next: i < 0 ? null : list[i], at: i < 0 ? list.length : i + 1 };
}

/** "Step 2 of 7 · New words · 12 new", or "Today is done". */
export function guideLine(g: Guide): string {
  return g.next ? `Step ${g.at} of ${g.steps.length} · ${g.next.title} · ${g.next.note}` : 'Today is done';
}

// ---------- today's marks ----------
// The sentence builder and the culture note have no signal of their own, so
// the app shell notes when their route opens. A skipped step is noted the same
// way. One day's marks are kept; a new date starts clean.

interface Marks {
  date: string;
  marks: string[];
}

const KEY = 'guide_marks';

type MarkStore = { get<T>(key: string, fallback: T): T; set<T>(key: string, value: T): void };

export function marksOn(store: MarkStore, date: string): string[] {
  const m = store.get<Marks | null>(KEY, null);
  return m && m.date === date ? m.marks : [];
}

/** Add a mark for the date. No write when it is already there. */
export function addMark(store: MarkStore, date: string, mark: string) {
  const marks = marksOn(store, date);
  if (marks.includes(mark)) return;
  store.set<Marks>(KEY, { date, marks: [...marks, mark] });
}

/** The step a route counts towards when it opens: the sentence builder, and today's culture note (not an earlier one from the Library). */
export function markForRoute(path: string, query: URLSearchParams): string | null {
  if (path === '/sentence') return 'sentence';
  if (path === '/listen') return 'listen';
  if (path === '/lesson' && !query.get('day')) return 'lesson';
  if (path === '/culture' && !query.get('id') && !query.get('day')) return 'culture';
  return null;
}
