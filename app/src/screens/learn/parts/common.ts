// Helpers shared by the Learn screens: what a ref looks like on a card, which
// form to play or say, voices, small formatting.

import { bothForms, sayForm, type Content, type Identity } from '../../../content/repo';
import type { Item, Letter, Pattern, Tone, VoiceId } from '../../../content/types';
import type { PlayRequest, RecordTarget } from '../../../audio/sound';

/** The four voices, each lent to a cast member for the caption label. */
export const VOICE_WHO: Record<VoiceId, string> = { f1: 'ploy', f2: 'nok', m1: 'ton', m2: 'lek' };
export const VOICE_NAME: Record<VoiceId, string> = { f1: 'Voice 1 · female', f2: 'Voice 2 · female', m1: 'Voice 3 · male', m2: 'Voice 4 · male' };
export const VOICE_ORDER: VoiceId[] = ['f1', 'f2', 'm1', 'm2'];
export const isFemale = (v: VoiceId) => v.startsWith('f');

export function shuffle<T>(a: T[], rand = Math.random): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pick<T>(a: T[], rand = Math.random): T {
  return a[Math.floor(rand() * a.length)];
}

/** Tone of the polite ending added by sayForm. */
function politeTone(it: Item, identity: Identity): Tone | null {
  if (!it.polite) return null;
  if (identity === 'm') return 'high';
  return it.polite === 'question' ? 'high' : 'falling';
}

/** What the learner says, with tones for the pitch line. */
export function sayTarget(it: Item, identity: Identity): RecordTarget & { tones: Tone[] } {
  const f = sayForm(it, identity);
  const pt = politeTone(it, identity);
  return { ref: `item:${it.id}`, thai: f.thai, roman: f.roman, en: it.en, tones: pt ? [...it.tones, pt] : it.tones };
}

/** What a voice says when it plays an item. Listening always includes both forms. */
export function listenForm(it: Item, asked: VoiceId, hideRoman = false): PlayRequest {
  const voice = voiceFor(it, asked);
  const g = isFemale(voice) ? 'f' : 'm';
  const f = it.polite || it.forms ? bothForms(it)[g] : { thai: it.thai, roman: it.roman };
  const pt = politeTone(it, g);
  return {
    ref: `item:${it.id}`, thai: f.thai, roman: f.roman, en: it.en,
    tones: pt ? [...it.tones, pt] : it.tones, voice, hideRoman, speaker: VOICE_WHO[voice][0].toUpperCase() + VOICE_WHO[voice].slice(1),
  };
}

/**
 * Words only one sex says (ครับ, ค่ะ, ผม, ฉัน) are voiced by a matching voice.
 * The course marks them with `speaker`; older seed items only in the English gloss.
 */
export function speakerOf(it: Item): 'm' | 'f' | null {
  if (it.speaker) return it.speaker;
  if (/\(male speaker/.test(it.en)) return 'm';
  if (/\(female speaker/.test(it.en)) return 'f';
  return null;
}
export function voiceFor(it: Item, asked: VoiceId): VoiceId {
  const s = speakerOf(it);
  if (!s || isFemale(asked) === (s === 'f')) return asked;
  return (s === 'f' ? (asked === 'm2' ? 'f2' : 'f1') : asked === 'f2' ? 'm2' : 'm1') as VoiceId;
}

/**
 * The voices with a clean normal-speed clip of this item (a failed clip is
 * null), kept to the speaker's sex for a word only one sex says.
 */
export function clipVoices(it: Item): VoiceId[] {
  const s = speakerOf(it);
  return VOICE_ORDER.filter((v) => (!s || isFemale(v) === (s === 'f')) && !!it.media?.audio?.[`${v}.normal`]);
}

/** True when the male and female forms differ in the words themselves or the ending. */
export function formsDiffer(it: Item): boolean {
  const b = bothForms(it);
  return b.m.thai !== b.f.thai;
}

export function patternThai(p: Pattern, ex = 0): { thai: string; roman: string; en: string } {
  const tiles = p.examples[ex] ?? p.examples[0] ?? [];
  return { thai: tiles.map((t) => t.thai).join(''), roman: tiles.map((t) => t.roman).join(' '), en: tiles.map((t) => t.en).join(' · ') };
}

export function letterPlay(l: Letter): PlayRequest {
  return { ref: `letter:${l.id}`, thai: l.char, roman: l.name, en: l.keyword };
}

/** Everything a card might need about a ref. */
export interface Shown {
  ref: string;
  kind: 'item' | 'letter' | 'pattern';
  item?: Item;
  letter?: Letter;
  pattern?: Pattern;
  thai: string;
  roman: string;
  en: string;
  tones: Tone[];
  label: string;
}

export function describe(content: Content, ref: string): Shown | null {
  const kind = ref.split(':')[0];
  if (kind === 'item') {
    const it = content.item(ref);
    if (!it) return null;
    return { ref, kind, item: it, thai: it.thai, roman: it.roman, en: it.en, tones: it.tones, label: it.en };
  }
  if (kind === 'letter') {
    const l = content.letter(ref);
    if (!l) return null;
    return { ref, kind, letter: l, thai: l.char, roman: l.name, en: `${l.keyword} · sounds ${l.initial}`, tones: [], label: `${l.char} ${l.name}` };
  }
  if (kind === 'pattern') {
    const p = content.pattern(ref);
    if (!p) return null;
    const ex = patternThai(p);
    return { ref, kind, pattern: p, thai: ex.thai, roman: ex.roman, en: p.en, tones: [], label: p.en };
  }
  return null;
}

/** Split a romanisation into syllables, to sit under tone shapes. */
export function syllables(roman: string): string[] {
  return roman.split(/[- ]+/).filter(Boolean);
}

export function fmtAgo(ms: number | null, now = Date.now()): string {
  if (ms == null) return 'New';
  const d = now - ms;
  const m = d / 60_000;
  if (m < 1) return 'Just now';
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function fmtSecs(ms: number | null): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(1)} s`;
}

/** How a tone moves, in a few words, for notes beside pairs. */
export const TONE_VERB: Record<Tone, string> = {
  mid: 'stays level',
  low: 'sits low and flat',
  falling: 'rises then falls',
  high: 'starts high and lifts',
  rising: 'dips then rises',
};

export const SKILL_LABEL: Record<string, string> = {
  hear: 'Hear it', say: 'Say it', read: 'Read it', write: 'Write it', tone: 'Name the tone',
};
