// Building a session from the map: from the top of a section, from ticks, from
// a preset, or the weakest lines. The session is the chosen lines that fit
// the session length, in map order.

import { navigate } from '../app/router';
import type { Store } from '../db/store';
import { lineIndex, visibleSections, type SchoolFile, type SchoolLine, type SchoolSection, type Sex } from './content';
import { loadWheels, saveSession, type Minutes, type SessionPlan } from './prefs';
import { weakestLines } from './reviews';
import { fitToMinutes, matchScore, SLOT_SECONDS, SLOT_WORDS, type Wheels } from './runner';
import { MATCH_AT } from '../live/tools';

/** Every line the learner can see, in map order. */
export function mapLines(file: SchoolFile, adult: boolean): SchoolLine[] {
  return visibleSections(file, adult).flatMap((s) => s.lines);
}

/** The chosen lines that fit, in map order. */
export function planSession(file: SchoolFile, o: { adult: boolean; identity: Sex; minutes: Minutes; title: string; lineIds: string[]; slots?: boolean; wheels: Wheels; keepOrder?: boolean }): SessionPlan & { dropped: number } {
  const want = new Set(o.lineIds);
  const all = mapLines(file, o.adult);
  const chosen = o.keepOrder ? o.lineIds.map((id) => all.find((l) => l.id === id)).filter((l): l is SchoolLine => !!l) : all.filter((l) => want.has(l.id));
  const slots = o.slots ?? true;
  const sections = new Set(chosen.map((l) => file.sections.find((s) => s.lines.includes(l))?.id));
  const slotWords = file.sections.filter((s) => sections.has(s.id)).reduce((n, s) => n + Math.min(2, s.frames.filter((f) => f.words.length).length) * SLOT_WORDS, 0);
  const fitted = fitToMinutes(chosen, o.wheels, o.minutes, o.identity, slots ? slotWords * SLOT_SECONDS : 0);
  return { title: o.title, lineIds: fitted.map((l) => l.id), minutes: o.minutes, slots, dropped: chosen.length - fitted.length };
}

/** Save the session and open the lesson. */
export function startSession(store: Store, plan: SessionPlan) {
  if (!plan.lineIds.length) return;
  saveSession(store, { title: plan.title, lineIds: plan.lineIds, minutes: plan.minutes, slots: plan.slots, ...(plan.startAt ? { startAt: plan.startAt } : {}) });
  navigate('/school/lesson');
}

/** "Pick for me": the weakest lines, as many as fit. */
export function pickForMe(file: SchoolFile, store: Store, o: { adult: boolean; identity: Sex; minutes: Minutes }): SessionPlan & { dropped: number } {
  const wheels = loadWheels(store);
  const order = weakestLines(mapLines(file, o.adult), wheels, store).map((l) => l.id);
  // the weakest first, in that order; no slots, so the time goes on the lines
  return { ...planSession(file, { ...o, title: 'Picked for you', lineIds: order, wheels, keepOrder: true, slots: false }), dropped: 0 };
}

// ---------- skipping by voice ----------

/** A door phrase heard this well opens its section (the same bar as a line in a lesson). */
export const DOOR_AT = MATCH_AT;
/** ...and it must beat the next door by this much, so a near tie opens nothing. */
export const DOOR_MARGIN = 0.08;

export interface DoorHit {
  section: SchoolSection;
  score: number;
}

/** The sections with a door phrase you can see, and the phrase in your form. */
export function doors(file: SchoolFile, adult: boolean, identity: Sex): { section: SchoolSection; thai: string }[] {
  const index = lineIndex(file);
  return visibleSections(file, adult)
    .filter((s) => s.door && s.lines.length)
    .map((s) => ({ section: s, thai: index.get(s.door!)?.line[identity].thai ?? '' }))
    .filter((d) => d.thai);
}

/** Which section's door phrase the transcript is, or null (then nothing happens and you tap as usual). */
export function matchDoor(heard: string, list: { section: SchoolSection; thai: string }[]): DoorHit | null {
  if (!heard.trim() || !list.length) return null;
  const scored = list.map((d) => ({ section: d.section, score: matchScore(heard, d.thai) })).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best.score < DOOR_AT) return null;
  if (next && best.score - next.score < DOOR_MARGIN) return null;
  return best;
}

/** A section opened by its door phrase: its lines, at Branches, with Teach marked done. */
export function doorPlan(file: SchoolFile, section: SchoolSection, o: { adult: boolean; identity: Sex; minutes: Minutes; wheels: Wheels }): SessionPlan & { dropped: number } {
  return { ...planSession(file, { ...o, title: section.title, lineIds: section.lines.map((l) => l.id) }), startAt: 'branch' };
}
