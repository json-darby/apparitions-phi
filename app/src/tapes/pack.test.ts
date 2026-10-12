import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackError, mergeMelody, mergePitch, parsePack, plainMeaning, searchPack, unitTitle, unnamed } from './pack';
import { defaultState } from './db';
import { deckOf, dueCount, grade, nextCard } from './review';
import { WrongPassword, dataUrlBytes, packBody, seal, unseal } from './sealed';

const syl = (th: string, ro: string, t: number) => ({ th, ro, t, cls: 'low', why: 'x', irr: false });
const UNITS = {
  units: {
    '1': [
      { variants: [[[syl('ครับ', 'kráp', 3)]]], mean: 'polite ending (man); yes', words: [['ครับ', 'kráp', 'polite ending (man)']], note: '', who: 'm', clip: 'data:audio/mpeg;base64,SUQz', t: 1 },
      { variants: [[[syl('ไม่', 'mâi', 2)], [syl('ค่ะ', 'kâ', 2)]]], mean: 'No. (woman)', words: [['ไม่', 'mâi', 'not'], ['ค่ะ', 'kâ', 'polite ending']], note: '', who: 'f' },
    ],
  },
  notes: { '1': ['Polite endings: men end sentences with <b>ครับ</b>.'] },
};
const READING = [{ n: 1, items: [{ variants: [[[syl('ตา', 'dtaa', 0)]]], mean: 'eye' }] }];
const page = `<html><script>\nconst READING = ${JSON.stringify(READING)};\nconst UNITS = ${JSON.stringify(UNITS)};\nconst TN=["mid"];\n</script></html>`;

describe('the study file', () => {
  it('reads units, notes and reading, and lifts the clips out', () => {
    const { pack, clips } = parsePack(page, 5);
    expect(pack.units['1']).toHaveLength(2);
    expect(pack.units['1'][0].clip).toBe(true);
    expect(pack.units['1'][1].clip).toBe(false);
    expect(JSON.stringify(pack)).not.toContain('base64');
    expect(clips).toEqual([{ key: '1.0', dataUrl: 'data:audio/mpeg;base64,SUQz' }]);
    expect(pack.reading[0].items[0].mean).toBe('eye');
    expect(unitTitle(pack, 1)).toBe('Polite endings');
  });

  it('refuses a page that is not the study file', () => {
    expect(() => parsePack('<html>hello</html>')).toThrow(PackError);
  });

  it('finds phrases by Thai, by sound without tone marks, and by English', () => {
    const { pack } = parsePack(page);
    expect(searchPack(pack, 'ไม่')).toHaveLength(1);
    expect(searchPack(pack, 'mai')).toHaveLength(1);
    expect(searchPack(pack, 'polite')).toHaveLength(1);
  });

  it('never names the course', () => {
    const name = ['P', 'i', 'm', 's', 'l', 'e', 'u', 'r'].join('');
    expect(unnamed(`"${name} teaches it first. Then ${name}'s build-up."`)).toBe(`"The course teaches it first. Then the course's build-up."`);
    expect(unnamed(`ok. ${name} drills it`)).toBe('ok. The course drills it');
  });

  it('drops the speaker tag from a meaning', () => {
    expect(plainMeaning('Do you understand? (woman, question)')).toBe('Do you understand?');
    expect(plainMeaning('Excuse me. (man)')).toBe('Excuse me.');
  });
});

describe('the Tapes review', () => {
  it('takes cards only from heard units and spaces them out', () => {
    const { pack } = parsePack(page);
    const s = defaultState();
    expect(deckOf(pack, [])).toHaveLength(0);
    expect(dueCount(pack, s, [1], 100)).toEqual({ due: 0, fresh: 2, started: 0 });
    const first = nextCard(pack, s, [1], null, 100);
    expect(first?.isNew).toBe(true);
    const good = grade(undefined, 1, 100);
    expect(good.due).toBe(101);
    const again = grade(good, 0, 101);
    expect(again.due).toBe(101);
    expect(grade(good, 2, 101).due).toBeGreaterThan(grade(good, 1, 101).due);
  });
});

describe('the locked pack', () => {
  it('opens with the password (any case) and keeps every clip byte', async () => {
    const { pack, clips } = parsePack(page);
    const sealed = await seal(packBody(pack, clips.map(dataUrlBytes)), 'Secret', 1000);
    const opened = await unseal(sealed.buffer as ArrayBuffer, ' secret ');
    expect(opened.pack.units['1']).toHaveLength(2);
    expect(opened.clips.map((c) => c.key)).toEqual(['1.0']);
    expect([...new Uint8Array(await opened.clips[0].blob.arrayBuffer())]).toEqual([0x49, 0x44, 0x33]);
    expect(opened.clips[0].blob.type).toBe('audio/mpeg');
  });

  it('refuses the wrong password, and the sealed bytes do not show the Thai', async () => {
    const { pack, clips } = parsePack(page);
    const sealed = await seal(packBody(pack, clips.map(dataUrlBytes)), 'secret', 1000);
    await expect(unseal(sealed.buffer as ArrayBuffer, 'nope')).rejects.toBeInstanceOf(WrongPassword);
    expect(Buffer.from(sealed).toString('utf8')).not.toContain('ครับ');
  });
});

describe('measured pitch', () => {
  const line = Array.from({ length: 16 }, (_, k) => k / 15);

  it('attaches only contours with one entry per syllable', () => {
    const { pack } = parsePack(page);
    const added = mergePitch(pack, { '1.0': [line, line], '1.1': [line, []], '9.0': [line], '1.5': [line] });
    expect(added).toBe(1);
    expect(pack.units['1'][0].pitch).toBeUndefined();
    expect(pack.units['1'][1].pitch).toEqual([line, []]);
  });

  it('skips contours of the wrong size or with non-numbers', () => {
    const { pack } = parsePack(page);
    expect(mergePitch(pack, { '1.0': [[1, 2, 3]], '1.1': [line, ['x']] })).toBe(0);
    expect(pack.units['1'].every((it) => it.pitch === undefined)).toBe(true);
  });

  it('survives sealing and opening', async () => {
    const { pack, clips } = parsePack(page);
    mergePitch(pack, { '1.0': [line] });
    const opened = await unseal((await seal(packBody(pack, clips.map(dataUrlBytes)), 'secret', 1000)).buffer as ArrayBuffer, 'secret');
    expect(opened.pack.units['1'][0].pitch).toEqual([line]);
    expect(opened.pack.units['1'][1].pitch).toBeUndefined();
  });

  it('an older pack without pitch still opens', async () => {
    const { pack, clips } = parsePack(page);
    const opened = await unseal((await seal(packBody(pack, clips.map(dataUrlBytes)), 'secret', 1000)).buffer as ArrayBuffer, 'secret');
    expect(opened.pack.units['1'].every((it) => !('pitch' in it))).toBe(true);
    expect(opened.pack.units['1'][0].clip).toBe(true);
  });
});

describe('measured melody', () => {
  const tune = Array.from({ length: 48 }, (_, k) => 0.5 + 0.2 * Math.sin(k / 6));

  it('attaches only lines of 48 finite numbers', () => {
    const { pack } = parsePack(page);
    const added = mergeMelody(pack, { '1.0': tune, '1.1': tune.slice(0, 47), '9.0': tune });
    expect(added).toBe(1);
    expect(pack.units['1'][0].melody).toEqual(tune);
    expect(pack.units['1'][1].melody).toBeUndefined();
    expect(mergeMelody(pack, { '1.1': [...tune.slice(0, 47), Number.NaN] })).toBe(0);
    expect(mergeMelody(pack, { '1.1': [...tune.slice(0, 47), 'x'] })).toBe(0);
    expect(mergeMelody(pack, { '1.1': { length: 48 } })).toBe(0);
  });

  it('survives sealing and opening', async () => {
    const { pack, clips } = parsePack(page);
    mergeMelody(pack, { '1.1': tune });
    const opened = await unseal((await seal(packBody(pack, clips.map(dataUrlBytes)), 'secret', 1000)).buffer as ArrayBuffer, 'secret');
    expect(opened.pack.units['1'][1].melody).toEqual(tune);
    expect(opened.pack.units['1'][0].melody).toBeUndefined();
  });
});

// the owner's own study file, when pointed at (never committed): TAPES_FILE=/path/index.html
const real = process.env.TAPES_FILE;
describe.skipIf(!real)('the real study file', () => {
  it('reads all of it', () => {
    const { pack, clips } = parsePack(readFileSync(real!, 'utf8'));
    const phrases = Object.values(pack.units).reduce((a, u) => a + u.length, 0);
    console.log({ units: Object.keys(pack.units).length, phrases, clips: clips.length, reading: pack.reading.length, titles: Object.keys(pack.units).map((n) => unitTitle(pack, +n)) });
    expect(Object.keys(pack.units)).toHaveLength(30);
    expect(clips.length).toBeGreaterThan(2000);
    expect(JSON.stringify(pack).toLowerCase()).not.toContain(['p', 'i', 'm', 's', 'l', 'e', 'u', 'r'].join(''));
  });
});
