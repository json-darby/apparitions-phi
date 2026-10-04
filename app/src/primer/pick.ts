// What the "How Thai works" primer shows, picked from the loaded course at
// runtime so every example is a real word with a real clip. Pure functions.

import { TONES, VOICES, type Item, type Tone, type VoiceId } from '../content/types';

export function hasClip(it: Item): boolean {
  return Object.values(it.media?.audio ?? {}).some(Boolean);
}

/** Words anyone says the same way, with at least one clip. */
function spoken(items: Item[]): Item[] {
  return items.filter((it) => !it.polite && !it.forms && !it.speaker && !it.adult && hasClip(it));
}

/** Single-syllable words from `spoken`, earliest day first. */
export function primerPool(items: Item[]): Item[] {
  return spoken(items).filter((it) => it.tones.length === 1).sort(byDay);
}

const byDay = (a: Item, b: Item) => a.day - b.day || a.id.localeCompare(b.id);

/** One word per tone, the earliest in the course. A tone with no fitting word is absent. */
export function toneExamples(items: Item[]): Partial<Record<Tone, Item>> {
  const out: Partial<Record<Tone, Item>> = {};
  for (const it of primerPool(items)) {
    const t = it.tones[0];
    if (!out[t]) out[t] = it;
  }
  return out;
}

/** The romanisation without its tone marks, lower case: the sound of a word. */
export function toneless(roman: string): string {
  return roman.normalize('NFD').replace(/[̀́̂̌]/g, '').normalize('NFC').toLowerCase();
}

/**
 * Two words with the same sound in different tones, e.g. ไม่ mâi "not" and
 * ไหม mǎi. The set the course meets earliest wins; among sets met on the same
 * day, the one with more tones.
 */
export function contrastPair(items: Item[]): [Item, Item] | null {
  const groups = new Map<string, Item[]>();
  for (const it of primerPool(items)) {
    const k = toneless(it.roman);
    const g = groups.get(k) ?? [];
    if (!g.some((x) => x.tones[0] === it.tones[0])) g.push(it);
    groups.set(k, g);
  }
  let best: Item[] | null = null;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (!best || g[1].day < best[1].day || (g[1].day === best[1].day && g.length > best.length)) best = g;
  }
  return best ? [best[0], best[1]] : null;
}

// ---------- reading the romanisation ----------

export type RomanPointId = 'long' | 'aspirated' | 'plain' | 'ng' | 'ue' | 'aw' | 'er' | 'final';
export const ROMAN_POINTS: RomanPointId[] = ['long', 'aspirated', 'plain', 'ng', 'ue', 'aw', 'er', 'final'];

interface Syllable {
  onset: string;
  vowel: string;
  coda: string;
}

/** Onset, vowel and coda of a toneless syllable, or null when it does not parse. */
export function syllable(s: string): Syllable | null {
  const m = /^([^aeiouʉə]*)([aeiouʉə]+)(.*)$/.exec(s);
  return m ? { onset: m[1], vowel: m[2], coda: m[3] } : null;
}

const FITS: Record<RomanPointId, (s: Syllable) => boolean> = {
  long: (s) => /(aa|ii|uu|ee|oo|ʉʉ|əə)/.test(s.vowel),
  aspirated: (s) => /^(kh|ph|th)/.test(s.onset),
  plain: (s) => /^(g|bp|dt)/.test(s.onset),
  ng: (s) => s.onset === 'ng',
  ue: (s) => s.vowel.includes('ʉ'),
  // "aw" as in law: an a-vowel closed by w (khǎw, sǎwng, ráawn)
  aw: (s) => s.vowel.endsWith('a') && s.coda.startsWith('w'),
  er: (s) => s.vowel.includes('ə'),
  final: (s) => /[ptk]$/.test(s.coda),
};

/** True when the word's first syllable shows the point. */
export function showsPoint(id: RomanPointId, it: Item): boolean {
  const s = syllable(toneless(it.roman).split(/[- ]+/)[0] ?? '');
  return !!s && FITS[id](s);
}

/**
 * One example word per point of the romanisation page: a single-syllable word
 * where one fits, else a word that starts with the sound, earliest first and
 * not already used for another point. Null when the course has none.
 */
export function romanExamples(items: Item[]): Record<RomanPointId, Item | null> {
  const singles = primerPool(items);
  const words = spoken(items).sort(byDay);
  const used = new Set<string>();
  const out = {} as Record<RomanPointId, Item | null>;
  for (const id of ROMAN_POINTS) {
    const fits = (it: Item) => showsPoint(id, it);
    const fresh = (it: Item) => fits(it) && !used.has(it.id);
    const pick = singles.find(fresh) ?? words.find(fresh) ?? singles.find(fits) ?? words.find(fits) ?? null;
    if (pick) used.add(pick.id);
    out[id] = pick;
  }
  return out;
}

// ---------- voices and forms ----------

/** The voice with normal-speed clips for the most of these words, so tones compare on one speaker. Ties go to the first voice. */
export function primerVoice(items: Item[]): VoiceId {
  let best: VoiceId = VOICES[0];
  let bestN = -1;
  for (const v of VOICES) {
    const n = items.filter((it) => !!it.media?.audio?.[`${v}.normal`]).length;
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export interface SpeakerForms {
  /** the polite endings, in the order to show them */
  endings: Item[];
  /** "I" */
  i: Item | null;
}

/** The polite endings and "I" for each speaker, where the course has them. */
export function politeForms(items: Item[]): Record<'m' | 'f', SpeakerForms> {
  const by = (id: string) => items.find((it) => it.id === id) ?? null;
  const some = (ids: string[]) => ids.map(by).filter((x): x is Item => !!x);
  return {
    m: { endings: some(['khrap']), i: by('i-male') },
    f: { endings: some(['kha-statement', 'kha-question']), i: by('i-female') },
  };
}

// ---------- the ear check ----------

export interface EarRound {
  item: Item;
  tone: Tone;
  /** the two shapes offered, in order; one is the tone */
  shapes: [Tone, Tone];
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Rounds over the tone examples: every tone before any repeats, no tone twice
 * in a row, the other shape any other tone. Empty with fewer than two tones.
 */
export function earRounds(examples: Partial<Record<Tone, Item>>, rounds = 6, rand: () => number = Math.random): EarRound[] {
  const have = TONES.filter((t) => examples[t]);
  if (have.length < 2) return [];
  const order: Tone[] = [];
  while (order.length < rounds) {
    let batch = shuffle(have, rand);
    if (order.length && batch[0] === order[order.length - 1]) batch = [...batch.slice(1), batch[0]];
    order.push(...batch);
  }
  return order.slice(0, rounds).map((tone) => {
    const others = TONES.filter((x) => x !== tone);
    const other = others[Math.floor(rand() * others.length)];
    return { item: examples[tone]!, tone, shapes: rand() < 0.5 ? [tone, other] : [other, tone] };
  });
}
