// School of the Night: the content model, the loader and the content checks.
//
// content/school.json holds 18 sections in four groups. A section holds lines
// (what you say), each with the replies you are likely to hear back and the
// line you answer each one with, plus sentence frames with slot words. Every
// line, reply and slot sentence stores both speaker forms (m: ครับ / ผม,
// f: ค่ะ / คะ / ฉัน) and the recipe it was composed from: course item ids, '_'
// for a space between phrases, 'I' for the speaker's pronoun, and the polite
// ending ('s' statement, 'q' question). The checks compose every recipe again
// from the course's own items, so the Thai, romanisation and tones are the
// course's, word for word. A few words the course does not teach live in the
// file's own `words` list (ids start "sw."); a line that uses one is composed
// the same way but marked unverified, since no course check has passed it.
//
// Imports are types only, so the content scripts can run this file in Node.

import type { Item, Tone } from '../content/types';

export type Sex = 'm' | 'f';
export type Ending = 's' | 'q' | null;
export type GroupId = 'foundations' | 'everyday' | 'plans' | 'night';

/** One item's worth of a line: the unit back-chaining builds from. */
export interface Part {
  thai: string;
  roman: string;
  tones: Tone[];
}

/** One speaker's form of a line. */
export interface Form {
  thai: string;
  roman: string;
  tones: Tone[];
  /** course item ids, in order, including the pronoun and the polite ending */
  items: string[];
  parts: Part[];
}

/** 'course': the whole sentence is in the course already. 'composed': built here from course items. */
export type Source = 'course' | 'composed';

interface Composed {
  /** the recipe: item ids, '_' for a space, 'I' for the speaker's pronoun */
  say: string[];
  end: Ending;
  m: Form;
  f: Form;
  source: Source;
  /** uses Thai that is not in the course: nobody has checked it */
  unverified?: boolean;
}

/** Something the other person says back. m and f are their forms (a man says it, a woman says it). */
export interface SchoolReply extends Composed {
  id: string;
  en: string;
  /** the line you answer it with */
  answer: string;
}

export type EscapeKind = 'again' | 'slower' | 'lost';

/** A line you say. m and f are your forms. */
export interface SchoolLine extends Composed {
  id: string;
  /** what you would say, in your English */
  en: string;
  /** one of the three lines for when you do not catch something */
  escape?: EscapeKind;
  replies: SchoolReply[];
}

/** A word for a frame's slot, with the whole filled sentence in both forms. */
export interface FrameWord extends Composed {
  id: string;
  /** the word in English, as it reads in the frame ("a beer") */
  en: string;
  /** the word on its own, for the tutor's cue (no ending) */
  word: { thai: string; roman: string; tones: Tone[]; items: string[] };
}

/** A sentence frame. 'X' in the recipe is the slot. */
export interface SchoolFrame {
  id: string;
  /** "I'd like ___" */
  en: string;
  say: string[];
  end: Ending;
  /** the frame with ___ for the slot, in both forms */
  m: { thai: string; roman: string };
  f: { thai: string; roman: string };
}

export interface SectionFrame {
  frame: string;
  words: FrameWord[];
  /** words still to come from the owner (e.g. "your city") */
  todo?: string;
}

export interface SchoolSection {
  id: string;
  n: number;
  title: string;
  group: GroupId;
  /** the line that opens the section by voice */
  door?: string;
  note?: string;
  lines: SchoolLine[];
  frames: SectionFrame[];
}

export interface SchoolGroup {
  id: GroupId;
  title: string;
  /** shown only with the 18+ setting on */
  adult?: boolean;
}

/**
 * A school-only word: Thai the course does not teach, kept to the few lines
 * that need it. Ids start "sw." so they never collide with course item ids.
 */
export interface SchoolWord {
  id: string;
  thai: string;
  roman: string;
  tones: Tone[];
  en: string;
}

export interface SchoolFile {
  version: string;
  groups: SchoolGroup[];
  frames: SchoolFrame[];
  sections: SchoolSection[];
  /** school-only words (optional: older files have none) */
  words?: SchoolWord[];
}

/** What composing needs from an item: course items and school words both fit. */
export type Composable = Pick<Item, 'thai' | 'roman' | 'tones'> & Partial<Pick<Item, 'forms'>>;

export const SCHOOL_WORD_PREFIX = 'sw.';
export const isSchoolWord = (id: string) => id.startsWith(SCHOOL_WORD_PREFIX);

/** The course's items plus the file's school-only words, for composing. */
export function schoolItems(file: Pick<SchoolFile, 'words'>, items: ReadonlyMap<string, Composable>): Map<string, Composable> {
  const out = new Map<string, Composable>(items);
  for (const w of file.words ?? []) if (!out.has(w.id)) out.set(w.id, w);
  return out;
}

export const SCHOOL_URL = 'content/school.json';
export const ENDINGS = ['khrap', 'kha-statement', 'kha-question'];
export const PRONOUNS = ['i-male', 'i-female'];
export const SECTION_COUNT = 18;

// ---------- composing ----------

/**
 * One speaker's form of a recipe, from the course's items: the same rule as the
 * street scripts (street-seed compose) and sayForm. A phrase item that carries
 * its own "I" (ผมชอบเมืองไทย) uses its form for the speaker.
 */
export function composeForm(say: string[], end: Ending, sex: Sex, items: ReadonlyMap<string, Composable>): Form {
  const parts: Part[] = [];
  const ids: string[] = [];
  let thai = '';
  let space = false;
  for (const t of say) {
    if (t === '_') {
      space = true;
      continue;
    }
    const id = t === 'I' ? (sex === 'm' ? 'i-male' : 'i-female') : t;
    const it = items.get(id);
    if (!it) throw new Error(`school: unknown item ${id}`);
    const own = it.forms && it.forms.m.thai === it.thai ? it.forms[sex] : { thai: it.thai, roman: it.roman };
    thai += (space && thai ? ' ' : '') + own.thai;
    parts.push({ thai: own.thai, roman: own.roman, tones: [...it.tones] });
    ids.push(id);
    space = false;
  }
  if (end) {
    // a woman says คะ for a question and after นะ, ค่ะ otherwise
    const endId = sex === 'm' ? 'khrap' : end === 'q' || thai.endsWith('นะ') ? 'kha-question' : 'kha-statement';
    const e = items.get(endId);
    if (!e) throw new Error(`school: unknown item ${endId}`);
    thai += e.thai;
    parts.push({ thai: e.thai, roman: e.roman, tones: [...e.tones] });
    ids.push(endId);
  }
  return { thai, roman: parts.map((p) => p.roman).join(' '), tones: parts.flatMap((p) => p.tones), items: ids, parts };
}

/** A frame's recipe with the slot filled. */
export function fillFrame(frame: Pick<SchoolFrame, 'say'>, word: string[]): string[] {
  return frame.say.flatMap((t) => (t === 'X' ? word : [t]));
}

/** Syllables in a romanisation (hyphens and spaces split them). */
export function syllableCount(roman: string): number {
  return roman.split(/[- ]+/).filter(Boolean).length;
}

const stripSpaces = (s: string) => s.replace(/\s+/g, '');

// ---------- reading ----------

export interface LineRef {
  line: SchoolLine;
  section: SchoolSection;
}

/** Every line by id, with its section. */
export function lineIndex(file: SchoolFile): Map<string, LineRef> {
  const out = new Map<string, LineRef>();
  for (const section of file.sections) for (const line of section.lines) out.set(line.id, { line, section });
  return out;
}

/** Sections the learner can see: the Night group only with 18+ on. */
export function visibleSections(file: SchoolFile, adult: boolean): SchoolSection[] {
  const hidden = new Set(file.groups.filter((g) => g.adult && !adult).map((g) => g.id));
  return file.sections.filter((s) => !hidden.has(s.group));
}

export function visibleGroups(file: SchoolFile, adult: boolean): SchoolGroup[] {
  return file.groups.filter((g) => adult || !g.adult);
}

export function frameById(file: SchoolFile, id: string): SchoolFrame | undefined {
  return file.frames.find((f) => f.id === id);
}

/** The escape lines (say that again, slower, I don't understand) by kind. */
export function escapeLines(file: SchoolFile): Partial<Record<EscapeKind, SchoolLine>> {
  const out: Partial<Record<EscapeKind, SchoolLine>> = {};
  for (const s of file.sections) for (const l of s.lines) if (l.escape) out[l.escape] = l;
  return out;
}

// ---------- the checks ----------

function checkForm(where: string, f: Form | undefined, sex: Sex, errors: string[]) {
  if (!f || !f.thai || !f.roman || !Array.isArray(f.tones) || !Array.isArray(f.items) || !Array.isArray(f.parts)) {
    errors.push(`${where}: the ${sex} form is missing or incomplete`);
    return;
  }
  if (syllableCount(f.roman) !== f.tones.length) errors.push(`${where} (${sex}): ${f.tones.length} tones for ${syllableCount(f.roman)} syllables`);
  if (stripSpaces(f.parts.map((p) => p.thai).join('')) !== stripSpaces(f.thai)) errors.push(`${where} (${sex}): the parts do not make up the line`);
  const wrong = sex === 'm' ? ['i-female', 'kha-statement', 'kha-question'] : ['i-male', 'khrap'];
  for (const id of f.items) if (wrong.includes(id)) errors.push(`${where} (${sex}): uses ${id}, the other speaker's form`);
}

function checkComposed(where: string, x: Composed, items: ReadonlyMap<string, Composable> | null, errors: string[], needEnding: boolean) {
  checkForm(where, x.m, 'm', errors);
  checkForm(where, x.f, 'f', errors);
  if (!Array.isArray(x.say) || !x.say.length) errors.push(`${where}: no recipe`);
  if (x.source !== 'course' && x.source !== 'composed') errors.push(`${where}: source must be course or composed`);
  if (needEnding && x.end) {
    if (!x.m?.thai.endsWith('ครับ')) errors.push(`${where}: the male form does not end with ครับ`);
    if (!/(ค่ะ|คะ)$/.test(x.f?.thai ?? '')) errors.push(`${where}: the female form does not end with ค่ะ or คะ`);
  }
  const school = Array.isArray(x.say) && x.say.some(isSchoolWord);
  if (school && !x.unverified) errors.push(`${where}: uses a school-only word, so it must be marked unverified`);
  if (!items) return;
  // an unverified line is still composed again when every word in it is known
  if (x.unverified && !x.say.every((t) => t === '_' || t === 'I' || items.has(t))) return;
  for (const sex of ['m', 'f'] as Sex[]) {
    let want: Form;
    try {
      want = composeForm(x.say, x.end, sex, items);
    } catch (e) {
      errors.push(`${where}: ${(e as Error).message}`);
      return;
    }
    const got = x[sex];
    if (!got) continue;
    if (got.thai !== want.thai) errors.push(`${where} (${sex}): Thai ${got.thai} is not the course's ${want.thai}`);
    if (got.roman !== want.roman) errors.push(`${where} (${sex}): romanisation ${got.roman} is not the course's ${want.roman}`);
    if (got.tones.join(' ') !== want.tones.join(' ')) errors.push(`${where} (${sex}): tones differ from the course's`);
    if (got.items.join(' ') !== want.items.join(' ')) errors.push(`${where} (${sex}): item ids differ from the recipe`);
  }
}

/**
 * Every problem with a school file, or none. With the course's items, every
 * line is also composed again from them (and the file's school-only words) and
 * must match exactly.
 */
export function validateSchool(file: SchoolFile, courseItems: ReadonlyMap<string, Item> | null = null): string[] {
  const errors: string[] = [];
  if (!file || typeof file.version !== 'string') return ['no version'];
  const wordIds = new Set<string>();
  for (const w of file.words ?? []) {
    if (!isSchoolWord(w.id)) errors.push(`school word ${w.id}: ids start with ${SCHOOL_WORD_PREFIX}`);
    if (wordIds.has(w.id)) errors.push(`school word ${w.id}: duplicate`);
    wordIds.add(w.id);
    if (!w.thai || !w.roman || !w.en || !Array.isArray(w.tones)) errors.push(`school word ${w.id}: incomplete`);
    else if (syllableCount(w.roman) !== w.tones.length) errors.push(`school word ${w.id}: ${w.tones.length} tones for ${syllableCount(w.roman)} syllables`);
    if (courseItems?.has(w.id)) errors.push(`school word ${w.id}: the course already has this id`);
  }
  const items = courseItems ? schoolItems(file, courseItems) : null;
  const groups = new Map(file.groups.map((g) => [g.id, g]));
  for (const id of ['foundations', 'everyday', 'plans', 'night'] as GroupId[]) if (!groups.has(id)) errors.push(`group ${id} is missing`);
  if (!groups.get('night')?.adult) errors.push('the Night group must be 18+');
  if (file.sections.length !== SECTION_COUNT) errors.push(`${file.sections.length} sections, not ${SECTION_COUNT}`);
  file.sections.forEach((s, i) => {
    if (s.n !== i + 1) errors.push(`section ${s.id} is numbered ${s.n}, expected ${i + 1}`);
    if (!groups.has(s.group)) errors.push(`section ${s.id}: unknown group ${s.group}`);
    if (s.n >= 14 && s.group !== 'night') errors.push(`section ${s.n} must be in the Night group`);
    if (s.n < 14 && s.group === 'night') errors.push(`section ${s.n} must not be in the Night group`);
  });

  const ids = new Set<string>();
  const unique = (id: string, where: string) => {
    if (!id) errors.push(`${where}: no id`);
    else if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
    ids.add(id);
  };
  const lineIds = new Set(file.sections.flatMap((s) => s.lines.map((l) => l.id)));
  const frames = new Map(file.frames.map((f) => [f.id, f]));
  for (const f of file.frames) {
    unique(`frame:${f.id}`, `frame ${f.id}`);
    if (f.say.filter((t) => t === 'X').length !== 1) errors.push(`frame ${f.id}: needs exactly one slot`);
    if (!f.m?.thai.includes('___') || !f.f?.thai.includes('___')) errors.push(`frame ${f.id}: both forms need the ___ slot`);
  }
  const escapes = new Set<string>();
  for (const s of file.sections) {
    unique(`section:${s.id}`, `section ${s.id}`);
    if (s.door && !s.lines.some((l) => l.id === s.door)) errors.push(`section ${s.id}: the door line ${s.door} is not in it`);
    for (const l of s.lines) {
      unique(l.id, `line in ${s.id}`);
      if (!l.en) errors.push(`${l.id}: no English`);
      checkComposed(l.id, l, items, errors, true);
      if (l.escape) {
        if (escapes.has(l.escape)) errors.push(`${l.id}: a second ${l.escape} escape line`);
        escapes.add(l.escape);
      }
      for (const r of l.replies ?? []) {
        unique(r.id, `reply of ${l.id}`);
        if (!r.en) errors.push(`${r.id}: no English`);
        if (!lineIds.has(r.answer)) errors.push(`${r.id}: answer ${r.answer} is not a line`);
        checkComposed(r.id, r, items, errors, true);
      }
    }
    for (const sf of s.frames) {
      const frame = frames.get(sf.frame);
      if (!frame) {
        errors.push(`section ${s.id}: unknown frame ${sf.frame}`);
        continue;
      }
      for (const w of sf.words) {
        unique(`${s.id}:${sf.frame}:${w.id}`, `slot word in ${s.id}`);
        if (w.say.join(' ') !== fillFrame(frame, w.word.items).join(' ') && !w.unverified) errors.push(`${s.id}/${sf.frame}/${w.id}: the recipe is not the frame filled with the word`);
        checkComposed(`${s.id}/${sf.frame}/${w.id}`, w, items, errors, true);
      }
    }
  }
  for (const k of ['again', 'slower', 'lost'] as EscapeKind[]) if (!escapes.has(k)) errors.push(`no ${k} escape line`);
  if (items) {
    const used = new Set<string>();
    const all: Composed[] = file.sections.flatMap((s) => [...s.lines, ...s.lines.flatMap((l) => l.replies ?? []), ...s.frames.flatMap((f) => f.words)]);
    for (const x of all) for (const t of x.say) if (t !== '_' && t !== 'I' && t !== 'X') used.add(t);
    for (const id of used) if (!items.has(id)) errors.push(`item ${id} is not in the course${isSchoolWord(id) ? ' or the school words' : ''}`);
  }
  return errors;
}

// ---------- loading ----------

/** Fetch the school file (precached with the app, so it works offline). Null when absent or unreadable. */
export async function fetchSchool(url = SCHOOL_URL, timeoutMs = 8000): Promise<SchoolFile | null> {
  if (typeof fetch === 'undefined') return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl?.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const data = (await res.json()) as SchoolFile;
    return data && typeof data.version === 'string' && Array.isArray(data.sections) && Array.isArray(data.groups) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
