// The primer's pickers: real words with real clips, one per tone, a contrast
// pair, one example per romanisation point, one voice, and the ear check.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyMedia, TONES, type Item, type Tone } from '../content/types';
import type { CourseFile } from '../content/repo';
import { contrastPair, earRounds, politeForms, primerVoice, romanExamples, showsPoint, syllable, toneExamples, toneless } from './pick';

function word(id: string, thai: string, roman: string, tone: Tone, day: number, extra: Partial<Item> = {}, voices: string[] = ['f1', 'm1']): Item {
  const media = emptyMedia();
  for (const v of voices) media.audio[`${v}.normal`] = `audio/item/${id}/${v}.normal.ogg`;
  return {
    id, kind: 'word', thai, roman, tones: [tone], en: id.replace(/-/g, ' '), theme: 'greetings', day,
    survival: false, skills: ['hear', 'read'], tags: [], status: 'checked', media, ...extra,
  };
}

const COURSE: Item[] = [
  word('be', 'เป็น', 'bpen', 'mid', 1),
  word('you', 'คุณ', 'khun', 'mid', 1),
  word('khrap', 'ครับ', 'khráp', 'high', 1, { speaker: 'm' }),
  word('kha-statement', 'ค่ะ', 'khâ', 'falling', 1, { speaker: 'f' }),
  word('kha-question', 'คะ', 'khá', 'high', 1, { speaker: 'f' }),
  word('i-male', 'ผม', 'phǒm', 'rising', 1, { speaker: 'm' }),
  word('i-female', 'ฉัน', 'chǎn', 'rising', 1, { speaker: 'f' }),
  word('hello', 'สวัสดี', 'sà-wàt-dii', 'low', 1, { polite: 'statement', tones: ['low', 'low', 'mid'] }),
  word('chicken', 'ไก่', 'gài', 'low', 2),
  word('mai-not', 'ไม่', 'mâi', 'falling', 2),
  word('rice', 'ข้าว', 'khâao', 'falling', 2),
  word('khaw', 'ขอ', 'khǎw', 'rising', 2),
  word('silent', 'เงียบ', 'ngîap', 'falling', 2, {}, []), // no clip: never picked
  word('baht', 'บาท', 'bàat', 'low', 3),
  word('n1', 'หนึ่ง', 'nʉ̀ng', 'low', 3),
  word('hot', 'ร้อน', 'ráawn', 'high', 4),
  word('beer', 'เบียร์', 'bia', 'mid', 4, { adult: true }),
  word('mai-q', 'ไหม', 'mǎi', 'rising', 8, {}, ['f2']),
  word('white', 'ขาว', 'khǎao', 'rising', 8),
  word('walk', 'เดิน', 'dəən', 'mid', 11),
  word('cash', 'เงินสด', 'ngən-sòt', 'mid', 11, { tones: ['mid', 'low'] }),
  word('so-then', 'งั้น', 'ngán', 'high', 34),
];

describe('tone examples', () => {
  it('picks the earliest single-syllable word anyone says, with a clip, for each tone', () => {
    const ex = toneExamples(COURSE);
    expect(Object.fromEntries(Object.entries(ex).map(([t, it]) => [t, it.id]))).toEqual({
      mid: 'be', low: 'chicken', falling: 'mai-not', high: 'hot', rising: 'khaw',
    });
  });

  it('leaves a tone out rather than use a word without a clip, a speaker-only word or an adult one', () => {
    const ex = toneExamples(COURSE.filter((it) => !['hot', 'so-then'].includes(it.id)));
    expect(ex.high).toBeUndefined();
    expect(toneExamples([]).mid).toBeUndefined();
  });

  it('finds the contrast set met earliest: the same sound in two tones', () => {
    const pair = contrastPair(COURSE)!;
    expect(pair.map((it) => it.id)).toEqual(['mai-not', 'mai-q']);
    expect(contrastPair(COURSE.filter((it) => !it.id.startsWith('mai')))!.map((it) => it.id)).toEqual(['rice', 'white']);
    expect(contrastPair(COURSE.slice(0, 9))).toBeNull();
  });

  it('strips tone marks whether they are precomposed or combining', () => {
    expect(toneless('mâi')).toBe('mai');
    expect(toneless('nʉ̀ng')).toBe('nʉng');
    expect(toneless('khǎao')).toBe('khaao');
  });
});

describe('romanisation examples', () => {
  it('reads a syllable as onset, vowel and coda', () => {
    expect(syllable('khǎw'.normalize('NFD').replace(/[̀-̌]/g, ''))).toEqual({ onset: 'kh', vowel: 'a', coda: 'w' });
    expect(syllable('ngən')).toEqual({ onset: 'ng', vowel: 'ə', coda: 'n' });
    expect(syllable('bpaet')).toEqual({ onset: 'bp', vowel: 'ae', coda: 't' });
    expect(syllable('xyz')).toBeNull();
  });

  it('gives each point a fitting word, earliest first, without reusing one', () => {
    const ex = romanExamples(COURSE);
    expect(Object.fromEntries(Object.entries(ex).map(([k, it]) => [k, it?.id ?? null]))).toEqual({
      long: 'rice', aspirated: 'you', plain: 'be', ng: 'so-then', ue: 'n1', aw: 'khaw', er: 'walk', final: 'baht',
    });
    for (const [id, it] of Object.entries(ex)) if (it) expect(showsPoint(id as never, it)).toBe(true);
  });

  it('falls back to a word that starts with the sound, and to null when nothing fits', () => {
    const ex = romanExamples(COURSE.filter((it) => it.id !== 'so-then'));
    expect(ex.ng?.id).toBe('cash');
    expect(romanExamples(COURSE.filter((it) => !it.roman.includes('ə'))).er).toBeNull();
  });
});

describe('voices and forms', () => {
  it('picks the voice that covers the most words, first voice on a tie', () => {
    expect(primerVoice(COURSE)).toBe('f1');
    expect(primerVoice([COURSE.find((it) => it.id === 'mai-q')!])).toBe('f2');
    expect(primerVoice([])).toBe('f1');
  });

  it('finds the polite endings and I for each speaker, defensively', () => {
    const f = politeForms(COURSE);
    expect(f.m.endings.map((it) => it.id)).toEqual(['khrap']);
    expect(f.f.endings.map((it) => it.id)).toEqual(['kha-statement', 'kha-question']);
    expect(f.m.i?.id).toBe('i-male');
    expect(f.f.i?.id).toBe('i-female');
    const none = politeForms([]);
    expect(none.m.endings).toEqual([]);
    expect(none.f.i).toBeNull();
  });
});

describe('ear check', () => {
  const seq = (xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };

  it('plays every tone before any repeats, never the same tone twice running, with one other shape', () => {
    const rounds = earRounds(toneExamples(COURSE), 6, seq([0.1, 0.7, 0.3, 0.9, 0.5]));
    expect(rounds.length).toBe(6);
    expect(new Set(rounds.slice(0, 5).map((r) => r.tone)).size).toBe(5);
    for (let i = 1; i < rounds.length; i++) expect(rounds[i].tone).not.toBe(rounds[i - 1].tone);
    for (const r of rounds) {
      expect(r.item.tones[0]).toBe(r.tone);
      expect(r.shapes).toContain(r.tone);
      expect(r.shapes[0]).not.toBe(r.shapes[1]);
      for (const s of r.shapes) expect(TONES).toContain(s);
    }
  });

  it('has nothing to check with fewer than two tones', () => {
    expect(earRounds({ mid: COURSE[0] })).toEqual([]);
  });
});

// The real course, when it is bundled: every pick is a real word with a clip.
const COURSE_FILE = resolve(__dirname, '../../public/content/course.json');
describe.skipIf(!existsSync(COURSE_FILE))('on the bundled course', () => {
  const items = (JSON.parse(readFileSync(COURSE_FILE, 'utf8')) as CourseFile).items.filter((it) => it.status !== 'draft');

  it('has a word with a clip for every tone, a contrast pair and the polite forms', () => {
    const ex = toneExamples(items);
    for (const t of TONES) {
      const it = ex[t];
      expect(it, t).toBeTruthy();
      expect(it!.tones).toEqual([t]);
      expect(Object.values(it!.media.audio).some(Boolean)).toBe(true);
    }
    const pair = contrastPair(items);
    expect(pair).toBeTruthy();
    expect(toneless(pair![0].roman)).toBe(toneless(pair![1].roman));
    expect(pair![0].tones[0]).not.toBe(pair![1].tones[0]);
    const f = politeForms(items);
    expect(f.m.endings.length + f.f.endings.length).toBeGreaterThan(0);
    for (const [id, it] of Object.entries(romanExamples(items))) if (it) expect(showsPoint(id as never, it), id).toBe(true);
  });
});
