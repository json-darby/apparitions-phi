// The practice screens' pure parts: new-item teaching order and quick checks,
// the tone lab's material and sessions, and the sentence builder's exercises.

import { describe, expect, it } from 'vitest';
import { emptyMedia, TONES, type Item, type Letter, type Pattern, type Tone } from '../../../content/types';
import { SIX_TO_FSRS, SIMPLE_RATINGS, Six, ratingScale } from '../../../engine/grade';
import { Rating } from 'ts-fsrs';
import { describe as shownOf, type Shown } from './common';
import { buildCheck, landing, lessonSteps, teachingOrder, withRetry, type Step } from './lesson';
import { buildSession, isSoundPair, isTonePair, labMaterial, makePair, measuredCurve, stripTones, tallyConfusions, toneChoiceCount, toneChoices, toneDifference, usableWords } from './toneLab';
import { usableExercises } from './sentences';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A clean clip in every voice, or only the ones named. */
function media(voices: string[] = ['f1', 'f2', 'm1', 'm2']) {
  const m = emptyMedia();
  for (const v of voices) {
    m.audio[`${v}.normal`] = `audio/item/x/${v}.normal.ogg`;
    m.audio[`${v}.slow`] = `audio/item/x/${v}.slow.ogg`;
  }
  return m;
}

function item(id: string, thai: string, roman: string, tones: Tone[], en: string, more: Partial<Item> = {}): Item {
  return { id, kind: 'word', thai, roman, tones, en, theme: 'greetings', day: 1, survival: false, skills: ['hear', 'say', 'read', 'tone'], tags: [], status: 'checked', media: media(), ...more };
}

function letter(id: string, char: string, name: string): Letter {
  return { id, char, name, keyword: id, initial: id[0], final: null, cls: 'mid', day: 1, strokes: null, lookalikes: [], skills: ['read', 'write', 'hear'], status: 'checked', media: media() };
}

function pattern(id: string, examples: string[][], day = 2): Pattern {
  return { id, frame: `${examples[0][0]} X`, en: `${id} X`, note: '', day, examples: examples.map((ex) => ex.map((thai, i) => ({ thai, roman: thai, en: thai, slot: i > 0 }))), skills: ['read', 'say'], status: 'checked', media: emptyMedia() };
}

// ---- fixtures ----

const hello = item('hello', 'สวัสดี', 'sà-wàt-dii', ['low', 'low', 'mid'], 'hello', { polite: 'statement' });
const goodbye = item('goodbye', 'สวัสดี', 'sà-wàt-dii', ['low', 'low', 'mid'], 'goodbye', { polite: 'statement', contrasts: ['hello'] });
const thanks = item('thank-you', 'ขอบคุณ', 'khàwp-khun', ['low', 'mid'], 'thank you', { polite: 'statement' });
const you = item('you', 'คุณ', 'khun', ['mid'], 'you');
const be = item('be', 'เป็น', 'bpen', ['mid'], 'be');
const khrap = item('khrap', 'ครับ', 'khráp', ['high'], 'male polite ending', { speaker: 'm' });
const kha = item('kha-statement', 'ค่ะ', 'khâ', ['falling'], 'female polite ending', { speaker: 'f' });
const iMale = item('i-male', 'ผม', 'phǒm', ['rising'], 'I (male)', { speaker: 'm' });
const come = item('come', 'มา', 'maa', ['mid'], 'come');
const dog = item('dog', 'หมา', 'mǎa', ['rising'], 'dog', { contrasts: ['come'] });
const horse = item('horse', 'ม้า', 'máa', ['high'], 'horse');
const not = item('mai-not', 'ไม่', 'mâi', ['falling'], 'not');
const yes = item('yes', 'ใช่', 'châi', ['falling'], 'yes', { contrasts: ['mai-not'] });
const notYes = item('mai-chai', 'ไม่ใช่', 'mâi-châi', ['falling', 'falling'], 'no', { contrasts: ['yes'] });
const rice = item('rice', 'ข้าว', 'khâao', ['falling'], 'rice');
const white = item('white', 'ขาว', 'khǎao', ['rising'], 'white');
const chicken = item('chicken', 'ไก่', 'gài', ['low'], 'chicken');
const egg = item('egg', 'ไข่', 'khài', ['low'], 'egg', { contrasts: ['chicken'] });

const gor = letter('l-gor', 'ก', 'gor gài');
const jor = letter('l-jor', 'จ', 'jor jaan');
const dor = letter('l-dor', 'ด', 'dor dèk');

const content = {
  item: (ref: string) => [hello, goodbye, thanks, you, be, khrap, kha, iMale].find((i) => `item:${i.id}` === ref || i.id === ref),
  letter: (ref: string) => [gor, jor, dor].find((l) => `letter:${l.id}` === ref || l.id === ref),
  pattern: (ref: string) => (ref.endsWith('p-khaw') ? pattern('p-khaw', [['ขอ', 'ข้าว']]) : undefined),
};
const shown = (ref: string): Shown => shownOf(content as never, ref)!;

// ---- new items ----

describe('teaching order', () => {
  const set = [shown('item:hello'), shown('item:khrap'), shown('item:you'), shown('item:kha-statement'), shown('letter:l-gor'), shown('item:i-male')];
  it('puts the other sex’s words last and keeps the rest in the engine’s order', () => {
    expect(teachingOrder(set, 'm').map((s) => s.ref)).toEqual(['item:hello', 'item:khrap', 'item:you', 'letter:l-gor', 'item:i-male', 'item:kha-statement']);
    expect(teachingOrder(set, 'f').map((s) => s.ref)).toEqual(['item:hello', 'item:you', 'item:kha-statement', 'letter:l-gor', 'item:khrap', 'item:i-male']);
  });
  it('drops and adds nothing', () => {
    expect(teachingOrder(set, 'f')).toHaveLength(set.length);
    expect(teachingOrder([], 'm')).toEqual([]);
  });
});

describe('quick check', () => {
  const group = [shown('item:hello'), shown('item:thank-you'), shown('item:you'), shown('letter:l-gor')];
  it('hears every word, then shows every meaning; letters are picked by name', () => {
    const qs = buildCheck(group, [shown('letter:l-jor')], rng(1));
    expect(qs.map((q) => q.kind).sort()).toEqual(['hear', 'hear', 'hear', 'letter', 'meaning', 'meaning', 'meaning']);
    const firstMeaning = qs.findIndex((q) => q.kind === 'meaning');
    expect(qs.slice(0, firstMeaning).every((q) => q.kind !== 'meaning')).toBe(true);
    for (const q of qs) expect(q.options).toContain(q.ref);
  });
  it('offers only the group’s own kind, with the right answer among the options', () => {
    const qs = buildCheck(group, [], rng(2));
    // one letter alone cannot be told from anything: it has no question
    expect(qs.find((q) => q.kind === 'letter')).toBeUndefined();
    for (const q of qs) expect(q.options.every((r) => r.startsWith('item:'))).toBe(true);
  });
  it('never offers a second card with the same Thai or meaning', () => {
    const qs = buildCheck([shown('item:hello'), shown('item:goodbye'), shown('item:you')], [], rng(3));
    for (const q of qs) {
      const thais = q.options.map((r) => shown(r).thai);
      expect(new Set(thais).size).toBe(thais.length);
    }
  });
  it('tops a small group up from cards seen earlier in the run', () => {
    const qs = buildCheck([shown('letter:l-dor')], [shown('letter:l-gor'), shown('item:you'), shown('letter:l-jor')], rng(4));
    expect(qs).toHaveLength(1);
    expect(qs[0].options.sort()).toEqual(['letter:l-dor', 'letter:l-gor', 'letter:l-jor']);
  });
  it('leaves patterns out, and a lone card with nothing to compare has no question', () => {
    expect(buildCheck([shown('pattern:p-khaw')], [])).toEqual([]);
    expect(buildCheck([shown('item:you')], [])).toEqual([]);
    expect(buildCheck([shown('item:you'), shown('pattern:p-khaw')], [shown('item:be')]).length).toBe(2);
  });
  it('brings a missed question back once, at the end', () => {
    const qs = buildCheck(group, [], rng(5));
    const again = withRetry(qs, 0, rng(6));
    expect(again).toHaveLength(qs.length + 1);
    expect(again[again.length - 1]).toMatchObject({ ref: qs[0].ref, kind: qs[0].kind, again: true });
    expect(withRetry(again, again.length - 1)).toBe(again);
  });
});

describe('lesson steps', () => {
  const nine = ['item:hello', 'item:thank-you', 'item:you', 'item:be', 'item:khrap', 'item:kha-statement', 'item:i-male', 'letter:l-gor', 'letter:l-jor'].map(shown);
  const steps = lessonSteps(nine);
  it('runs cards in fours with a check after each group, the last partial group included', () => {
    expect(steps).toEqual<Step[]>([
      { kind: 'card', at: 0 }, { kind: 'card', at: 1 }, { kind: 'card', at: 2 }, { kind: 'card', at: 3 }, { kind: 'check', group: 0 },
      { kind: 'card', at: 4 }, { kind: 'card', at: 5 }, { kind: 'card', at: 6 }, { kind: 'card', at: 7 }, { kind: 'check', group: 1 },
      { kind: 'card', at: 8 }, { kind: 'check', group: 2 },
    ]);
  });
  it('skips the check for a group with nothing to ask', () => {
    expect(lessonSteps([shown('pattern:p-khaw')])).toEqual([{ kind: 'card', at: 0 }]);
  });
  it('forward moves stop at a check not yet done, and step over one that is', () => {
    const none = new Set<number>();
    expect(landing(steps, none, 3, 4)).toBe(4);
    expect(landing(steps, none, 0, 7)).toBe(4);
    expect(landing(steps, new Set([0]), 3, 4)).toBe(5);
    expect(landing(steps, new Set([0]), 4, 5)).toBe(5);
    expect(landing(steps, none, 10, 11)).toBe(11);
    expect(landing(steps, new Set([0, 1, 2]), 10, 11)).toBe(steps.length);
  });
  it('backward moves land on a card, never a check', () => {
    expect(landing(steps, new Set([0]), 5, 4)).toBe(3);
    expect(landing(steps, new Set(), 4, 3)).toBe(3);
    expect(landing(steps, new Set(), 0, -1)).toBe(0);
    expect(landing(steps, new Set([0, 1, 2]), steps.length, steps.length - 1)).toBe(10);
  });
});

// ---- tone lab ----

describe('tone lab material', () => {
  const all = [hello, goodbye, thanks, you, be, khrap, kha, iMale, come, dog, horse, not, yes, notYes, rice, white, chicken, egg];
  it('strips tone marks only', () => {
    expect(stripTones('sà-wàt-dii')).toBe('sa-wat-dii');
    expect(stripTones('nʉ̀ng')).toBe('nʉng');
    expect(stripTones('khâao')).toBe(stripTones('khǎao'));
    expect(stripTones('maa')).toBe('maa');
  });
  it('knows a true tone pair from a same-word or a different-sound pair', () => {
    expect(isTonePair(come, horse)).toBe(true);
    expect(isTonePair(hello, goodbye)).toBe(false);
    expect(isTonePair(chicken, egg)).toBe(false);
    expect(isSoundPair(chicken, egg)).toBe(true);
    expect(isSoundPair(yes, notYes)).toBe(false);
    expect(isSoundPair(hello, goodbye)).toBe(false);
  });
  it('uses met words only', () => {
    const met = new Set(['you', 'come', 'horse', 'dog', 'egg']);
    const m = labMaterial(all, (it) => met.has(it.id), true);
    expect(m.words.map((w) => w.id).sort()).toEqual(['come', 'dog', 'egg', 'horse', 'you']);
    for (const p of m.pairs) for (const c of p.cards) expect(met.has(c.id)).toBe(true);
    expect(labMaterial(all, () => false, true)).toEqual({ words: [], pairs: [] });
  });
  it('keeps "which tone" to one-syllable words whose clip is just the word', () => {
    const m = labMaterial(all, () => true, true);
    expect(m.words.map((w) => w.id)).not.toContain('hello');
    expect(m.words.map((w) => w.id)).not.toContain('thank-you');
    expect(m.words.map((w) => w.id)).toContain('khrap');
  });
  it('finds tone pairs by sound, listed as a contrast or not, and other pairs from the list only', () => {
    const m = labMaterial(all, () => true, true);
    const key = (p: { cards: [Item, Item] }) => p.cards.map((c) => c.id).sort().join('|');
    const tonal = m.pairs.filter((p) => p.tonal).map(key);
    expect(tonal).toContain('come|horse');
    expect(tonal).toContain('dog|horse');
    expect(tonal).toContain('rice|white');
    const other = m.pairs.filter((p) => !p.tonal).map(key);
    expect(other).toEqual(['mai-not|yes', 'chicken|egg']);
    expect(m.pairs.map(key)).not.toContain('goodbye|hello');
    expect(m.pairs.map(key)).not.toContain('mai-chai|yes');
    expect(m.pairs.findIndex((p) => !p.tonal)).toBeGreaterThanOrEqual(m.pairs.filter((p) => p.tonal).length);
  });
  it('with real audio, plays only voices with a clean clip, and a word one sex says only in that sex', () => {
    const quiet = item('quiet', 'เงียบ', 'ngîap', ['falling'], 'quiet', { media: media(['m2']) });
    const silent = item('silent', 'เงี๋ยบ', 'ngǐap', ['rising'], 'silent', { media: media([]) });
    const m = labMaterial([quiet, silent, khrap, kha], () => true, true);
    expect(m.words.map((w) => w.id)).toEqual(['quiet', 'khrap', 'kha-statement']);
    expect(makePair(quiet, silent, true)).toBeNull();
    expect(makePair(quiet, silent, false)?.voices).toEqual(['f1', 'f2', 'm1', 'm2']);
    const noClip = labMaterial([quiet, silent], () => true, false);
    expect(noClip.words).toHaveLength(2);
    expect(noClip.pairs[0].tonal).toBe(true);
    const session = buildSession(labMaterial([khrap, kha, you, be], () => true, true), { needClip: true, rand: rng(7) });
    for (const r of session) {
      if (r.kind !== 'tone') continue;
      if (r.item.speaker === 'm') expect(r.voice.startsWith('m')).toBe(true);
      if (r.item.speaker === 'f') expect(r.voice.startsWith('f')).toBe(true);
    }
  });
  it('a pair keeps to voices that can say both words, so the voice gives nothing away', () => {
    const chan = item('chan', 'ชั้น', 'chán', ['high'], 'floor');
    const iFemale = item('i-female', 'ฉัน', 'chǎn', ['rising'], 'I (female)', { speaker: 'f' });
    expect(makePair(chan, iFemale, true)?.voices).toEqual(['f1', 'f2']);
    const male = item('i-male-2', 'ชั่น', 'chàn', ['low'], 'x', { speaker: 'm' });
    expect(makePair(male, iFemale, true)).toBeNull();
  });
  it('an ending on one clip only, or male and female wordings, rule a pair out', () => {
    const use = item('use', 'ใช้', 'chái', ['high'], 'use');
    const yesPolite = item('yes-2', 'ใช่', 'châi', ['falling'], 'yes', { polite: 'statement' });
    expect(isTonePair(use, yesPolite)).toBe(true);
    expect(makePair(use, yesPolite, true)).toBeNull();
    const usePolite = item('use-2', 'ใช้', 'chái', ['high'], 'use', { polite: 'statement' });
    expect(makePair(usePolite, yesPolite, true)?.tonal).toBe(true);
    const formsUse = item('use-3', 'ใช้', 'chái', ['high'], 'use', { forms: { m: { thai: 'ใช้', roman: 'chái' }, f: { thai: 'ใช้', roman: 'chái' } } });
    expect(makePair(formsUse, yes, true)).toBeNull();
  });
  it('counts distinct usable words', () => {
    const m = labMaterial(all, (it) => ['come', 'horse', 'dog'].includes(it.id), true);
    expect(usableWords(m)).toBe(3);
    expect(usableWords({ words: [], pairs: [] })).toBe(0);
  });
});

describe('which tone', () => {
  it('offers two tones at first, three for a while, then all five', () => {
    expect(toneChoiceCount(0)).toBe(2);
    expect(toneChoiceCount(11)).toBe(2);
    expect(toneChoiceCount(12)).toBe(3);
    expect(toneChoiceCount(30)).toBe(3);
    expect(toneChoiceCount(31)).toBe(5);
  });
  it('always includes the right tone, in the usual order', () => {
    for (const t of TONES) {
      for (const n of [2, 3, 5]) {
        const c = toneChoices(t, n, {}, rng(n));
        expect(c).toHaveLength(n);
        expect(c).toContain(t);
        expect(c).toEqual(TONES.filter((x) => c.includes(x)));
      }
    }
  });
  it('prefers the tones closest by ear', () => {
    expect(toneChoices('mid', 2, {}, rng(1))).toEqual(['mid', 'low']);
    expect(toneChoices('low', 2, {}, rng(1))).toEqual(['mid', 'low']);
    expect(toneChoices('rising', 2, {}, rng(1))).toEqual(['high', 'rising']);
    expect(toneChoices('falling', 2, {}, rng(1))).toEqual(['falling', 'high']);
    const forHigh = toneChoices('high', 2, {}, rng(1));
    expect(['falling', 'rising'].some((t) => forHigh.includes(t as Tone))).toBe(true);
    expect(toneChoices('mid', 3, {}, rng(2))).toContain('low');
  });
  it('prefers what this learner has mixed up, over closeness', () => {
    const confused = tallyConfusions([{ tone: 'mid', picked: 'rising' }, { tone: 'mid', picked: 'rising' }, { tone: 'high', picked: 'mid' }]);
    expect(confused).toEqual({ mid: { rising: 2 }, high: { mid: 1 } });
    expect(toneChoices('mid', 2, confused, rng(3))).toEqual(['mid', 'rising']);
    expect(toneChoices('mid', 3, confused, rng(3)).sort()).toEqual(['high', 'mid', 'rising']);
    // a mix-up counts both ways
    expect(toneChoices('rising', 2, confused, rng(3))).toEqual(['mid', 'rising']);
    expect(tallyConfusions([{ tone: 'mid', picked: 'mid' }, { tone: 'x' as Tone, picked: 'mid' }])).toEqual({});
  });
});

describe('a session', () => {
  const met = [you, be, come, dog, horse, not, yes, rice, white, chicken, egg, khrap];
  it('is built from the material only, and is shorter when little is met', () => {
    const few = ['you', 'be', 'come', 'dog'];
    const little = labMaterial(met, (it) => few.includes(it.id), true);
    const s = buildSession(little, { needClip: true, rand: rng(1) });
    expect(s).toHaveLength(8);
    for (const r of s) for (const it of r.kind === 'tone' ? [r.item] : r.cards) expect(few).toContain(it.id);
    // the one pair (dog, come) is heard from either side; the rest are tone rounds
    expect(s.filter((r) => r.kind === 'pair')).toHaveLength(2);
    expect(buildSession({ words: [], pairs: [] }, { needClip: true })).toEqual([]);
  });
  it('mixes in pairs from both sides and caps at twenty', () => {
    const m = labMaterial(met, () => true, true);
    const s = buildSession(m, { needClip: true, rand: rng(2) });
    expect(s).toHaveLength(20);
    const pairs = s.filter((r) => r.kind === 'pair');
    expect(pairs.length).toBe(8);
    const sides = new Set(pairs.map((r) => (r.kind === 'pair' ? `${r.cards.map((c) => c.id).join('|')}:${r.target}` : '')));
    expect(sides.size).toBe(pairs.length);
    // the four true tone pairs and two others are each heard once, then the tone pairs again
    expect(m.pairs.filter((p) => p.tonal)).toHaveLength(4);
    expect(pairs.filter((r) => r.kind === 'pair' && r.tonal)).toHaveLength(6);
    // twelve one-syllable words met: three tones to choose from
    for (const r of s) if (r.kind === 'tone') expect(r.choices).toHaveLength(3);
  });
  it('keeps the same word from coming up twice running when it can', () => {
    const m = labMaterial(met, () => true, true);
    const s = buildSession(m, { needClip: true, rand: rng(3) });
    const words = (r: (typeof s)[number]) => (r.kind === 'tone' ? [r.item.id] : r.cards.map((c) => c.id));
    for (let i = 1; i < s.length; i++) expect(words(s[i - 1]).some((id) => words(s[i]).includes(id))).toBe(false);
  });
  it('spreads the tones evenly rather than by how often they occur', () => {
    const m = labMaterial(met, () => true, true);
    const s = buildSession(m, { needClip: true, rand: rng(4), rounds: 40 });
    const count = new Map<Tone, number>();
    for (const r of s) if (r.kind === 'tone') count.set(r.item.tones[0], (count.get(r.item.tones[0]) ?? 0) + 1);
    const ns = [...count.values()];
    expect(Math.max(...ns) - Math.min(...ns)).toBeLessThanOrEqual(1);
  });
  it('a leech drill runs on its pairs alone, for as many rounds as asked', () => {
    const p = makePair(dog, come, true)!;
    const s = buildSession({ words: [], pairs: [p] }, { needClip: true, rand: rng(5), rounds: 10 });
    expect(s).toHaveLength(10);
    expect(s.every((r) => r.kind === 'pair')).toBe(true);
    expect(s.filter((r) => r.kind === 'pair' && r.target === 0)).toHaveLength(5);
  });
});

describe('after the answer', () => {
  it('names the syllable where a tone pair parts ways', () => {
    expect(toneDifference(come, horse)).toEqual({ syllable: 0, a: 'mid', b: 'high' });
    expect(toneDifference(chicken, egg)).toBeNull();
    expect(toneDifference(hello, goodbye)).toBeNull();
  });
  it('draws a measured curve without its unvoiced points, or nothing when too little was voiced', () => {
    expect(measuredCurve([[0.5, null, 0.6, 0.7, 0.8, 0.9, 1.2, 0.4]])).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.4]);
    expect(measuredCurve([[0.5, null, null, null, 0.2]])).toBeNull();
    expect(measuredCurve(null)).toBeNull();
    expect(measuredCurve([[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]], 1)).toBeNull();
  });
});

// ---- sentence builder ----

describe('sentence builder exercises', () => {
  const khaw = item('khaw', 'ขอ', 'khǎw', ['rising'], 'can I have');
  const friedRice = item('fried-rice', 'ข้าวผัด', 'khâao-phàt', ['falling', 'low'], 'fried rice');
  const padThai = item('pad-thai', 'ผัดไทย', 'phàt-thai', ['low', 'mid'], 'pad thai');
  const iAm = item('i', 'ฉัน', 'chǎn', ['rising'], 'I', { forms: { m: { thai: 'ผม', roman: 'phǒm' }, f: { thai: 'ฉัน', roman: 'chǎn' } } });
  const p1 = pattern('p-khaw', [['ขอ', 'ข้าวผัด'], ['ขอ', 'ผัดไทย']]);
  const p2 = pattern('p-i', [['ผม', 'ขอ', 'ข้าวผัด'], ['ขอ']]);
  const items = [khaw, friedRice, padThai, iAm];
  const metOf = (refs: string[]) => (ref: string) => refs.includes(ref);
  it('needs the pattern to be met', () => {
    expect(usableExercises([p1], items, metOf(['item:khaw', 'item:fried-rice', 'item:pad-thai']))).toEqual([]);
  });
  it('drops an example that uses a word not met, and a pattern left with none', () => {
    const ex = usableExercises([p1, p2], items, metOf(['pattern:p-khaw', 'pattern:p-i', 'item:khaw', 'item:fried-rice']));
    expect(ex.map((e) => `${e.pattern.id}/${e.ex}`)).toEqual(['p-khaw/0']);
  });
  it('counts a met word’s male and female wordings as met', () => {
    const ex = usableExercises([p2], items, metOf(['pattern:p-i', 'item:khaw', 'item:fried-rice', 'item:i']));
    expect(ex.map((e) => `${e.pattern.id}/${e.ex}`)).toEqual(['p-i/0']);
  });
  it('gives every usable example of every met pattern', () => {
    const ex = usableExercises([p1, p2], items, () => true);
    expect(ex.map((e) => `${e.pattern.id}/${e.ex}`)).toEqual(['p-khaw/0', 'p-khaw/1', 'p-i/0']);
    expect(ex[0].tiles).toBe(p1.examples[0]);
  });
});

// ---- the simple ratings ----

describe('simple ratings', () => {
  it('are three of the six: a fail that comes straight back, a bare pass, and a plain pass', () => {
    expect(SIMPLE_RATINGS.map((r) => r.six)).toEqual([Six.Blank, Six.Hard, Six.Good]);
    expect(SIX_TO_FSRS[Six.Blank]).toEqual({ grade: Rating.Again, retestMin: 1 });
    expect(SIX_TO_FSRS[Six.Hard]).toEqual({ grade: Rating.Hard, retestMin: null });
    expect(SIX_TO_FSRS[Six.Good]).toEqual({ grade: Rating.Good, retestMin: null });
  });
  it('are shown for the first two weeks on auto, or as set', () => {
    expect(ratingScale('auto', 1)).toBe('simple');
    expect(ratingScale('auto', 14)).toBe('simple');
    expect(ratingScale('auto', 15)).toBe('detailed');
    expect(ratingScale(undefined, 3)).toBe('simple');
    expect(ratingScale('simple', 40)).toBe('simple');
    expect(ratingScale('detailed', 1)).toBe('detailed');
  });
});
