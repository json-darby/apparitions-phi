// Custom lessons: you describe a situation, the server writes a section for it
// in the same format as the built-in ones (lines, likely replies, your answers,
// one or two frames), checks it, and you review it before it is saved on this
// device. Saved sections appear on the map under "Mine".
//
// The server sends a draft: every Thai form as a list of words, each with its
// romanisation. Here the draft becomes a SchoolSection: tones come from the
// romanisation's tone marks, and every word that is a course word takes the
// course's own spelling, romanisation and tones (and its item id, so a missed
// line sends that word to the normal reviews). Words the course does not have
// are counted as new. Everything generated stays marked unverified: no course
// recipe built it.
//
// Stored in the kv table under a new key of its own (KEYS.custom); nothing
// existing is renamed. Ids are prefixed "mine.<section>." so they can never
// meet a built-in id.

import type { Item, Tone } from '../content/types';
import type { Ending, Form, GroupId, Part, SchoolFile, SchoolFrame, SchoolLine, SchoolReply, SchoolSection, SectionFrame, Sex } from './content';
import { KEYS } from './prefs';

// ---------- the draft, as the server sends it ----------

export interface DraftWord {
  thai: string;
  roman: string;
}

export interface DraftReply {
  id: string;
  en: string;
  /** said by a man, by a woman */
  m: DraftWord[];
  f: DraftWord[];
  /** the line you answer with */
  answer: string;
}

export interface DraftLine {
  id: string;
  en: string;
  /** your forms: a male speaker, a female speaker */
  m: DraftWord[];
  f: DraftWord[];
  replies: DraftReply[];
  /** the checker's blind back-translation of the Thai */
  back?: string;
}

export interface DraftSlotWord {
  id: string;
  en: string;
  word: DraftWord[];
  m: DraftWord[];
  f: DraftWord[];
}

export interface DraftFrame {
  id: string;
  /** "I'd like ___" */
  en: string;
  m: { thai: string; roman: string };
  f: { thai: string; roman: string };
  words: DraftSlotWord[];
}

export interface CustomDraft {
  title: string;
  scenario: string;
  /** the scenario is nightlife or dating: the section is 18+ */
  adult: boolean;
  /** the line that opens the section by voice */
  door: string | null;
  lines: DraftLine[];
  frames: DraftFrame[];
  /** lines the checks dropped */
  dropped: number;
  mock: boolean;
}

// ---------- tones from romanisation ----------

const MARK_TONE: Record<string, Tone> = { '̀': 'low', '́': 'high', '̂': 'falling', '̌': 'rising' };

/** The tone of one romanised syllable, from its mark (no mark is mid). */
export function syllableTone(syl: string): Tone {
  for (const ch of syl.normalize('NFD')) if (MARK_TONE[ch]) return MARK_TONE[ch];
  return 'mid';
}

/** Tones of a romanisation, one per syllable (hyphens and spaces split them). */
export function romanTones(roman: string): Tone[] {
  return roman.split(/[- ]+/).filter(Boolean).map(syllableTone);
}

// ---------- course words ----------

const ENDING_IDS: Record<string, string> = { ครับ: 'khrap', ค่ะ: 'kha-statement', คะ: 'kha-question' };
const PRONOUN_IDS: Record<string, string> = { ผม: 'i-male', ฉัน: 'i-female' };

export interface CourseWord {
  id: string;
  thai: string;
  roman: string;
  tones: Tone[];
}

/** Course words by their Thai (an item with male and female forms is found by either). */
export function courseLexicon(items: readonly Item[]): Map<string, CourseWord> {
  const out = new Map<string, CourseWord>();
  for (const it of items) {
    const add = (thai: string, roman: string, tones: Tone[]) => {
      if (thai && !out.has(thai)) out.set(thai, { id: it.id, thai, roman, tones });
    };
    add(it.thai, it.roman, [...it.tones]);
    // a male or female wording: its tones from its own romanisation (ครับ and ค่ะ differ)
    if (it.forms) {
      add(it.forms.m.thai, it.forms.m.roman, romanTones(it.forms.m.roman));
      add(it.forms.f.thai, it.forms.f.roman, romanTones(it.forms.f.roman));
    }
  }
  return out;
}

/** The words the course does not have (endings and "I" are never new). */
export function newWordsIn(words: DraftWord[], lex: ReadonlyMap<string, CourseWord>): string[] {
  return words.map((w) => w.thai.trim()).filter((t) => t && !lex.has(t) && !ENDING_IDS[t] && !PRONOUN_IDS[t]);
}

/** One speaker's form from draft words: course words take the course's romanisation and tones. */
export function draftForm(words: DraftWord[], lex: ReadonlyMap<string, CourseWord>): Form {
  const parts: Part[] = [];
  const items: string[] = [];
  for (const w of words) {
    const thai = w.thai.trim();
    if (!thai) continue;
    const c = lex.get(thai);
    const id = ENDING_IDS[thai] ?? PRONOUN_IDS[thai] ?? c?.id;
    if (id) items.push(id);
    if (c) parts.push({ thai, roman: c.roman, tones: [...c.tones] });
    else {
      const roman = w.roman.trim();
      parts.push({ thai, roman, tones: romanTones(roman) });
    }
  }
  return { thai: parts.map((p) => p.thai).join(''), roman: parts.map((p) => p.roman).join(' '), tones: parts.flatMap((p) => p.tones), items, parts };
}

function endingOf(f: Form): Ending {
  const last = f.parts[f.parts.length - 1]?.thai;
  return last === 'คะ' ? 'q' : last === 'ครับ' || last === 'ค่ะ' ? 's' : null;
}

// ---------- the section ----------

export const MINE: GroupId = 'mine' as GroupId;
export const MINE_TITLE = 'Mine';

export interface CustomRecord {
  /** the section id, "mine-<time>" */
  id: string;
  title: string;
  scenario: string;
  adult: boolean;
  createdAt: number;
  section: SchoolSection;
  /** the section's own frames (ids "mine.<section>.<frame>") */
  frames: SchoolFrame[];
  /** Thai words the course does not have */
  newWords: string[];
  /** blind back-translations by line id, for the review */
  back: Record<string, string>;
}

/** A new section id. */
export function customId(now = Date.now()): string {
  return `mine-${now.toString(36)}`;
}

/** Turn a checked draft into a saved section. Lines whose answers are gone lose those replies. */
export function draftToRecord(draft: CustomDraft, lex: ReadonlyMap<string, CourseWord>, o: { id?: string; now?: number; n?: number } = {}): CustomRecord {
  const now = o.now ?? Date.now();
  const sid = o.id ?? customId(now);
  const pre = (x: string) => `mine.${sid}.${x}`;
  const lineIds = new Set(draft.lines.map((l) => l.id));
  const newWords = new Set<string>();
  const form = (words: DraftWord[]) => {
    for (const w of newWordsIn(words, lex)) newWords.add(w);
    return draftForm(words, lex);
  };
  const both = (m: DraftWord[], f: DraftWord[]) => {
    const fm = form(m);
    const ff = form(f);
    return { m: fm, f: ff, end: endingOf(fm), say: [] as string[], source: 'composed' as const, unverified: true };
  };
  const lines: SchoolLine[] = draft.lines.map((l) => ({
    id: pre(l.id),
    en: l.en,
    ...both(l.m, l.f),
    replies: l.replies
      .filter((r) => lineIds.has(r.answer))
      .map((r): SchoolReply => ({ id: pre(r.id), en: r.en, answer: pre(r.answer), ...both(r.m, r.f) })),
  }));
  const frames: SchoolFrame[] = [];
  const sectionFrames: SectionFrame[] = [];
  for (const fr of draft.frames) {
    if (!fr.words.length || !fr.m.thai.includes('___') || !fr.f.thai.includes('___')) continue;
    const id = pre(fr.id);
    frames.push({ id, en: fr.en, say: ['X'], end: null, m: { ...fr.m }, f: { ...fr.f } });
    sectionFrames.push({
      frame: id,
      words: fr.words.map((w) => {
        const word = form(w.word);
        return { id: w.id, en: w.en, ...both(w.m, w.f), word: { thai: word.thai, roman: word.roman, tones: word.tones, items: word.items } };
      }),
    });
  }
  const door = draft.door && lineIds.has(draft.door) ? pre(draft.door) : lines[0]?.id;
  const section: SchoolSection = {
    id: sid,
    n: o.n ?? 0,
    title: draft.title.trim().slice(0, 60) || 'My lesson',
    group: MINE,
    door,
    note: draft.scenario,
    lines,
    frames: sectionFrames,
  };
  const back: Record<string, string> = {};
  for (const l of draft.lines) if (l.back) back[pre(l.id)] = l.back;
  return { id: sid, title: section.title, scenario: draft.scenario, adult: draft.adult, createdAt: now, section, frames, newWords: [...newWords], back };
}

/** Drop a line from a record under review, and the replies that lead to it. */
export function dropLine(r: CustomRecord, lineId: string): CustomRecord {
  const lines = r.section.lines.filter((l) => l.id !== lineId).map((l) => ({ ...l, replies: l.replies.filter((x) => x.answer !== lineId) }));
  const door = r.section.door === lineId ? lines[0]?.id : r.section.door;
  const back = { ...r.back };
  delete back[lineId];
  return { ...r, section: { ...r.section, lines, door }, back };
}

/**
 * Put a reworded line in place of one under review. It keeps its id (and its
 * place, and the door if it was the door) but loses the replies on both sides:
 * they were written for the old words and may not fit the new ones.
 */
export function replaceLine(r: CustomRecord, lineId: string, draftLine: DraftLine, lex: ReadonlyMap<string, CourseWord>): CustomRecord {
  const one = draftToRecord({ title: r.title, scenario: r.scenario, adult: r.adult, door: null, lines: [{ ...draftLine, replies: [] }], frames: [], dropped: 0, mock: false }, lex, { id: r.id });
  const fresh = one.section.lines[0];
  if (!fresh) return r;
  const lines = r.section.lines.map((l) => (l.id === lineId ? { ...fresh, id: lineId, replies: [] } : { ...l, replies: l.replies.filter((x) => x.answer !== lineId) }));
  const back = { ...r.back };
  if (draftLine.back) back[lineId] = draftLine.back;
  else delete back[lineId];
  return { ...r, section: { ...r.section, lines }, back, newWords: [...new Set([...r.newWords, ...one.newWords])] };
}

/** New words still in use by a record's lines. */
export function recordNewWords(r: CustomRecord, lex: ReadonlyMap<string, CourseWord>): string[] {
  const out = new Set<string>();
  const forms = [
    ...r.section.lines.flatMap((l) => [l.m, l.f, ...l.replies.flatMap((x) => [x.m, x.f])]),
    ...r.section.frames.flatMap((f) => f.words.flatMap((w) => [w.m, w.f])),
  ];
  for (const f of forms) for (const p of f.parts) if (!lex.has(p.thai) && !ENDING_IDS[p.thai] && !PRONOUN_IDS[p.thai]) out.add(p.thai);
  return [...out];
}

// ---------- the map's file ----------

/** The school file with the custom sections added under "Mine" (18+ ones only with 18+ on). */
export function withCustom(file: SchoolFile, records: readonly CustomRecord[], adult: boolean): SchoolFile {
  const mine = records.filter((r) => adult || !r.adult);
  const base = file.sections.length;
  return {
    ...file,
    groups: [...file.groups.filter((g) => g.id !== MINE), { id: MINE, title: MINE_TITLE }],
    frames: [...file.frames, ...mine.flatMap((r) => r.frames)],
    sections: [...file.sections, ...mine.map((r, i) => ({ ...r.section, group: MINE, n: base + i + 1 }))],
  };
}

export function isCustomSection(s: Pick<SchoolSection, 'group'>): boolean {
  return s.group === MINE;
}

// ---------- storage ----------

/** The part of the Store this needs. */
interface Kv {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

export function loadCustom(store: Kv): CustomRecord[] {
  const v = store.get<CustomRecord[]>(KEYS.custom, []);
  return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string' && r.section && Array.isArray(r.section.lines)) : [];
}

export function saveCustom(store: Kv, r: CustomRecord) {
  store.set(KEYS.custom, [...loadCustom(store).filter((x) => x.id !== r.id), r]);
}

export function deleteCustom(store: Kv, id: string) {
  store.set(KEYS.custom, loadCustom(store).filter((x) => x.id !== id));
}

// ---------- the request ----------

export interface CustomRequest {
  scenario: string;
  /** lines in your own words, optional */
  mine?: string;
  identity: Sex;
  adult: boolean;
  /** course words to prefer: Thai, romanisation, English */
  known: [string, string, string][];
  /** reword one line instead of writing a section */
  reword?: { en: string; context: string };
}

/** The course words sent as "prefer these" (the met ones first, then the rest), capped to keep the prompt small. */
export function knownWords(items: readonly Item[], met: (id: string) => boolean, adult: boolean, max = 450): [string, string, string][] {
  const pick = (it: Item): [string, string, string] => [it.thai, it.roman, it.en];
  const good = items.filter((it) => it.thai && it.en && it.thai.length <= 24 && (adult || !it.adult));
  const first = good.filter((it) => met(it.id));
  const rest = good.filter((it) => !met(it.id));
  return [...first, ...rest].slice(0, max).map(pick);
}
