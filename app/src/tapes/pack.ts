// The Tapes: a companion to an audio course. None of its material ships with
// the app: the learner loads their own study file (a page that holds the unit
// phrases, notes, reading lessons and the speakers' clips), and it is kept on
// that device only. This file reads that page into plain data.

export type ToneDigit = 0 | 1 | 2 | 3 | 4;

export interface Syl {
  th: string;
  ro: string;
  t: ToneDigit;
  cls: 'mid' | 'high' | 'low';
  why: string;
  irr: boolean;
}

/** One written phrase: words, each a run of syllables. */
export type Variant = Syl[][];

export interface UnitItem {
  variants: Variant[];
  mean: string;
  words: [string, string, string][];
  note: string;
  who: 'm' | 'f' | '-';
  /** seconds into the unit's audio */
  t?: number;
  /** true when a speaker's clip was kept for it */
  clip?: boolean;
}

export interface ReadingItem {
  variants: Variant[];
  mean: string;
}

export interface ReadingLesson {
  n: number;
  items: ReadingItem[];
}

export interface Pack {
  v: 1;
  loadedAt: number;
  units: Record<string, UnitItem[]>;
  notes: Record<string, string[]>;
  reading: ReadingLesson[];
}

/** A clip as it sits in the page (a data: URL), keyed "unit.index". */
export interface RawClip {
  key: string;
  dataUrl: string;
}

export class PackError extends Error {}

// The course is never named in the app: its name in the study notes becomes "the course".
const COURSE = new RegExp(['P', 'i', 'm', 's', 'l', 'e', 'u', 'r'].join(''), 'g');
export function unnamed(s: string): string {
  return s.replace(COURSE, 'the course').replace(/(^|"|[.!?:]\s+)the course/g, (_m, p: string) => `${p}The course`);
}

function jsonAfter(text: string, marker: string, end: string): unknown {
  const a = text.indexOf(marker);
  if (a < 0) throw new PackError('missing');
  const b = text.indexOf(end, a + marker.length);
  if (b < 0) throw new PackError('missing');
  const body = unnamed(text.slice(a + marker.length, b).trim().replace(/;$/, ''));
  try {
    return JSON.parse(body);
  } catch {
    throw new PackError('broken');
  }
}

/** Read the study page. Clips come out separately so the caller can store them as files. */
export function parsePack(html: string, now = Date.now()): { pack: Pack; clips: RawClip[] } {
  const reading = jsonAfter(html, 'const READING = ', 'const UNITS = ') as ReadingLesson[];
  const raw = jsonAfter(html, 'const UNITS = ', 'const TN=') as { units: Record<string, (Omit<UnitItem, 'clip'> & { clip?: unknown })[]>; notes: Record<string, string[]> };
  if (!Array.isArray(reading) || !raw || typeof raw.units !== 'object') throw new PackError('broken');
  const clips: RawClip[] = [];
  const units: Record<string, UnitItem[]> = {};
  for (const [n, items] of Object.entries(raw.units)) {
    units[n] = items.map((it, i) => {
      const { clip, ...rest } = it;
      const has = typeof clip === 'string' && clip.startsWith('data:audio/');
      if (has) clips.push({ key: `${n}.${i}`, dataUrl: clip as string });
      return { ...rest, who: rest.who === 'm' || rest.who === 'f' ? rest.who : '-', clip: has };
    });
  }
  if (!Object.keys(units).length) throw new PackError('empty');
  return { pack: { v: 1, loadedAt: now, units, notes: raw.notes ?? {}, reading }, clips };
}

/** A data: URL as a Blob, without a network round trip. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const type = dataUrl.slice(5, dataUrl.indexOf(';'));
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ---- reading it back ----

export const TONE_NAMES = ['mid', 'low', 'falling', 'high', 'rising'] as const;
export const TONE_COLOURS = ['var(--fg-2)', 'var(--blue)', 'var(--amber)', 'var(--pink)', 'var(--cyan)'];

export const unitNumbers = (p: Pack) => Object.keys(p.units).map(Number).sort((a, b) => a - b);

export const sylls = (v: Variant) => v.flat();
export const thaiOf = (v: Variant) => v.map((w) => w.map((s) => s.th).join('')).join(' ');
export const thaiJoined = (v: Variant) => v.map((w) => w.map((s) => s.th).join('')).join('');
export const romanOf = (v: Variant) => v.map((w) => w.map((s) => s.ro).join(' ')).join(' ');

/** The meaning without the "(man)" / "(woman)" tag, which the screens show as a label. */
export function plainMeaning(mean: string): string {
  return mean.replace(/\s*\((man|woman)(, question)?\)\s*$/i, '').trim();
}

/** Short names for the 30 units, by what each one teaches. */
const TITLES = [
  'Polite endings', 'Greetings', '“Not so well”', '“Can”', '“What about you?”', '“Too, also”', '“When?”', 'Ordering and asking',
  'Telling the time', '“What time is it?”', '“At what time?”', '“Later than that”', '“Have to”', 'Money and amounts', 'Future with จะ',
  'ได้ after a verb: “can”', '“Intend to”', '“My” and “your”', 'He and she: เขา', '“Nice to meet you”', 'Your name', 'More future with จะ',
  'Provinces', 'Getting there: “by”', '“This” and “that”', 'Visiting people', 'Evening', '“I think that…”', '“Not yet”', 'Parts of the day',
];

/** A unit's name: its short name, else the first grammar note's lead, else its first phrase's meaning. */
export function unitTitle(p: Pack, n: number): string {
  if (TITLES[n - 1]) return TITLES[n - 1];
  const note = p.notes[String(n)]?.[0];
  if (note) {
    const text = note.replace(/<[^>]+>/g, '');
    const lead = text.split(/[:.]/)[0].trim();
    if (lead.length > 2 && lead.length <= 34) return lead;
  }
  const first = p.units[String(n)]?.[0];
  return first ? plainMeaning(first.mean) : `Unit ${n}`;
}

/** Search phrases across every unit (Thai, romanisation without tone marks, or English). */
export function searchPack(p: Pack, q: string, limit = 40): { n: number; i: number; item: UnitItem }[] {
  const needle = fold(q.trim());
  if (!needle) return [];
  const out: { n: number; i: number; item: UnitItem }[] = [];
  for (const n of unitNumbers(p)) {
    p.units[String(n)].forEach((item, i) => {
      if (out.length >= limit) return;
      const v = item.variants[0];
      const hay = fold(`${thaiJoined(v)} ${thaiOf(v)} ${romanOf(v)} ${item.mean}`);
      if (hay.includes(needle)) out.push({ n, i, item });
    });
  }
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
