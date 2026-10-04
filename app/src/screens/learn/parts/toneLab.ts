// Tone lab, the parts that need no screen: which met words can be drilled,
// which pairs differ in tone alone, how many tones to choose from, and the
// rounds of one session. Everything is drawn from items the learner has met.

import { TONES, type Item, type Tone, type VoiceId } from '../../../content/types';
import { VOICE_ORDER, clipVoices, isFemale, pick, shuffle, speakerOf } from './common';

export const SESSION_ROUNDS = 20;
/** Below this many usable words the lab does not open. */
export const MIN_WORDS = 4;
/** Share of a mixed session given to "Which word?" rounds, when there are pairs. */
const PAIR_SHARE = 0.4;

/** Romanisation with its tone marks taken off (grave, acute, circumflex, caron). */
export function stripTones(roman: string): string {
  return roman.normalize('NFD').replace(/[̀́̂̌]/g, '').normalize('NFC');
}

/** A true tone pair: two different words whose sound differs in tone alone. */
export function isTonePair(a: Item, b: Item): boolean {
  return a.id !== b.id && a.thai !== b.thai && a.tones.length === b.tones.length
    && stripTones(a.roman) === stripTones(b.roman) && a.tones.some((t, i) => t !== b.tones[i]);
}

/** Any other contrast the ear can settle: different words, different sounds, neither inside the other. */
export function isSoundPair(a: Item, b: Item): boolean {
  return a.id !== b.id && a.thai !== b.thai && a.roman !== b.roman && !a.thai.includes(b.thai) && !b.thai.includes(a.thai);
}

/** A word for "Which tone?": one syllable, and its clip is exactly that syllable (no polite ending, no male or female wording). */
export function isToneWord(it: Item): boolean {
  return it.tones.length === 1 && !it.polite && !it.forms;
}

/**
 * The voices a word may be played in. With real audio only voices with a clean
 * clip; a word one sex says keeps to that sex either way.
 */
export function voicesFor(it: Item, needClip: boolean): VoiceId[] {
  if (needClip) return clipVoices(it);
  const s = speakerOf(it);
  return VOICE_ORDER.filter((v) => !s || isFemale(v) === (s === 'f'));
}

export interface Pair {
  cards: [Item, Item];
  /** true when the two differ in tone alone; only then is a tone explanation shown */
  tonal: boolean;
  /** voices that can say either word, so the voice never gives the answer away */
  voices: VoiceId[];
}

/** A "Which word?" pair, or null when the two cannot fairly be told apart by ear. */
export function makePair(a: Item, b: Item, needClip: boolean): Pair | null {
  const tonal = isTonePair(a, b);
  if (!tonal && !isSoundPair(a, b)) return null;
  // a polite ending on one clip only would give the answer away; male and female wordings do not match the card
  if (!!a.polite !== !!b.polite || a.forms || b.forms) return null;
  const vb = voicesFor(b, needClip);
  const voices = voicesFor(a, needClip).filter((v) => vb.includes(v));
  return voices.length ? { cards: [a, b], tonal, voices } : null;
}

export interface Material {
  /** met one-syllable words for "Which tone?" */
  words: Item[];
  /** met pairs for "Which word?", true tone pairs first */
  pairs: Pair[];
}

/**
 * What the lab can use, from met items only. True tone pairs are found by
 * sound among everything met, listed as a contrast or not. Other listed
 * contrasts are added when both words are met and the ear can tell them apart.
 */
export function labMaterial(items: Item[], isMet: (it: Item) => boolean, needClip: boolean): Material {
  const met = items.filter((it) => isMet(it) && voicesFor(it, needClip).length > 0);
  const byId = new Map(met.map((it) => [it.id, it]));
  const seen = new Set<string>();
  const tonal: Pair[] = [];
  const other: Pair[] = [];
  const add = (a: Item, b: Item, wantTonal: boolean) => {
    const k = [a.id, b.id].sort().join('|');
    if (seen.has(k)) return;
    const p = makePair(a, b, needClip);
    if (!p || p.tonal !== wantTonal) return;
    seen.add(k);
    (p.tonal ? tonal : other).push(p);
  };
  const bySound = new Map<string, Item[]>();
  for (const it of met) {
    const k = stripTones(it.roman);
    bySound.set(k, [...(bySound.get(k) ?? []), it]);
  }
  for (const group of bySound.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i], group[j], true);
  for (const a of met) {
    for (const id of a.contrasts ?? []) {
      const b = byId.get(id);
      if (b) add(a, b, false);
    }
  }
  return { words: met.filter(isToneWord), pairs: [...tonal, ...other] };
}

/** Distinct words the lab can use. */
export function usableWords(m: Material): number {
  return new Set([...m.words, ...m.pairs.flatMap((p) => p.cards)].map((it) => it.id)).size;
}

// ---- which tone? ----

/** How many tones to choose from: two while few one-syllable words are met, three for a while, then all five. */
export function toneChoiceCount(wordsMet: number): 2 | 3 | 5 {
  return wordsMet < 12 ? 2 : wordsMet <= 30 ? 3 : 5;
}

/** Tones a new ear mixes up: mid and low, high and rising, falling and high. */
const CLOSE: Record<Tone, Tone[]> = { mid: ['low'], low: ['mid'], falling: ['high'], high: ['rising', 'falling'], rising: ['high'] };

/** Tones this learner has mixed up: confused[heard][picked] = times. */
export type Confusions = Partial<Record<Tone, Partial<Record<Tone, number>>>>;

export function tallyConfusions(misses: { tone: Tone; picked: Tone }[]): Confusions {
  const out: Confusions = {};
  for (const m of misses) {
    if (!TONES.includes(m.tone) || !TONES.includes(m.picked) || m.tone === m.picked) continue;
    const row = (out[m.tone] ??= {});
    row[m.picked] = (row[m.picked] ?? 0) + 1;
  }
  return out;
}

/**
 * The tones offered for one word: always the right one, then the tones this
 * learner has mixed it up with (most often first), then the ones closest by
 * ear, then the rest. Returned in the usual tone order, so a tone keeps its
 * place on screen.
 */
export function toneChoices(target: Tone, count: number, confused: Confusions = {}, rand: () => number = Math.random): Tone[] {
  const mixed = (t: Tone) => (confused[target]?.[t] ?? 0) + (confused[t]?.[target] ?? 0);
  const rank = (t: Tone) => (mixed(t) > 0 ? 0 : CLOSE[target].includes(t) ? 1 : 2);
  // shuffled first: the sort is stable, so ties fall in random order
  const others = shuffle(TONES.filter((t) => t !== target), rand).sort((a, b) => rank(a) - rank(b) || mixed(b) - mixed(a));
  const chosen = new Set<Tone>([target, ...others.slice(0, Math.max(1, count - 1))]);
  return TONES.filter((t) => chosen.has(t));
}

// ---- the session ----

export type Round =
  | { kind: 'tone'; item: Item; voice: VoiceId; choices: Tone[] }
  | { kind: 'pair'; cards: [Item, Item]; target: 0 | 1; voice: VoiceId; tonal: boolean };

export interface SessionOptions {
  needClip: boolean;
  confused?: Confusions;
  /** rounds wanted; by default twice the usable words, up to SESSION_ROUNDS */
  rounds?: number;
  rand?: () => number;
}

const wordsIn = (r: Round): string[] => (r.kind === 'tone' ? [r.item.id] : r.cards.map((c) => c.id));
const clash = (a: Round, b: Round) => wordsIn(a).some((id) => wordsIn(b).includes(id));

/** The entries used least so far. */
function least<T>(xs: T[], uses: (x: T) => number): T[] {
  const min = Math.min(...xs.map(uses));
  return xs.filter((x) => uses(x) === min);
}

/**
 * One session: "Which tone?" and "Which word?" rounds mixed. Tones come up
 * evenly (not as often as they happen to occur among the met words), each
 * pair is heard from both sides, and the same word is kept from coming up
 * twice running where the material allows.
 */
export function buildSession(m: Material, o: SessionOptions): Round[] {
  const rand = o.rand ?? Math.random;
  const total = Math.max(0, o.rounds ?? Math.min(SESSION_ROUNDS, 2 * usableWords(m)));
  if (!m.words.length && !m.pairs.length) return [];
  const pairSlots = !m.pairs.length ? 0 : !m.words.length ? total : Math.min(Math.round(total * PAIR_SHARE), 2 * m.pairs.length);

  const rounds: Round[] = [];
  // pairs: tone pairs before the others, each heard once from either side before any repeats
  const tonal = shuffle(m.pairs.filter((p) => p.tonal), rand);
  const order = [...tonal, ...shuffle(m.pairs.filter((p) => !p.tonal), rand)];
  const firstSide = order.map(() => (rand() < 0.5 ? 0 : 1));
  for (let i = 0; i < pairSlots; i++) {
    const k = i % order.length;
    const p = order[k];
    const target = (Math.floor(i / order.length) % 2 === 0 ? firstSide[k] : 1 - firstSide[k]) as 0 | 1;
    rounds.push({ kind: 'pair', cards: p.cards, target, voice: pick(p.voices, rand), tonal: p.tonal });
  }

  // words: the tone heard least so far, then the word heard least so far
  const count = toneChoiceCount(m.words.length);
  const tones = TONES.filter((t) => m.words.some((w) => w.tones[0] === t));
  const toneUses = new Map<Tone, number>();
  const wordUses = new Map<string, number>();
  let last = '';
  for (let i = pairSlots; i < total; i++) {
    const tone = pick(least(tones, (t) => toneUses.get(t) ?? 0), rand);
    const pool = m.words.filter((w) => w.tones[0] === tone);
    const fresh = pool.filter((w) => w.id !== last);
    const item = pick(least(fresh.length ? fresh : pool, (w) => wordUses.get(w.id) ?? 0), rand);
    toneUses.set(tone, (toneUses.get(tone) ?? 0) + 1);
    wordUses.set(item.id, (wordUses.get(item.id) ?? 0) + 1);
    last = item.id;
    const voices = voicesFor(item, o.needClip);
    rounds.push({ kind: 'tone', item, voice: voices.length ? pick(voices, rand) : VOICE_ORDER[0], choices: toneChoices(tone, count, o.confused, rand) });
  }

  // mix the two kinds, then pull apart neighbours that share a word
  const mixed = shuffle(rounds, rand);
  for (let i = 1; i < mixed.length; i++) {
    if (!clash(mixed[i - 1], mixed[i])) continue;
    const j = mixed.findIndex((r, k) => k > i && !clash(mixed[i - 1], r));
    if (j > 0) [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }
  return mixed;
}

// ---- after the answer ----

/** Where the two words of a tone pair part ways: the first syllable whose tones differ. */
export function toneDifference(a: Item, b: Item): { syllable: number; a: Tone; b: Tone } | null {
  if (!isTonePair(a, b)) return null;
  const i = a.tones.findIndex((t, k) => t !== b.tones[k]);
  return { syllable: i, a: a.tones[i], b: b.tones[i] };
}

/**
 * A syllable's measured pitch for drawing over the textbook shape, unvoiced
 * points dropped. Null when too little was voiced to show a shape.
 */
export function measuredCurve(pitch: (number | null)[][] | null | undefined, syllable = 0): number[] | null {
  const pts = (pitch?.[syllable] ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return pts.length >= 6 ? pts.map((v) => Math.max(0, Math.min(1, v))) : null;
}
