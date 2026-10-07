// Custom lessons on the device: a server draft becomes a section the runner can
// teach, course words take the course's own forms, the review edits hold the
// tree together, and saved sections join the map under "Mine" (18+ ones only
// with 18+ on). Also the door phrase match and a lesson opened at Branches.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Item } from '../content/types';
import { lineIndex, visibleSections, type SchoolFile } from './content';
import {
  courseLexicon, deleteCustom, draftForm, draftToRecord, dropLine, isCustomSection, knownWords, loadCustom, MINE, recordNewWords, replaceLine, romanTones, saveCustom, withCustom,
  type CustomDraft, type DraftWord,
} from './custom';
import { KEYS } from './prefs';
import { LessonRunner, type Step } from './runner';
import { doorPlan, doors, matchDoor } from './session';

const school = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/school.json'), 'utf8')) as SchoolFile;
const course = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/course.json'), 'utf8')) as { items: Item[] };
const lex = courseLexicon(course.items);

const W = (s: string): DraftWord[] => s.split(' ').map((p) => ({ thai: p.split('|')[0], roman: p.split('|')[1] }));
const M = (s: string) => W(`${s} ครับ|khráp`);
const F = (s: string, q = false) => W(`${s} ${q ? 'คะ|khá' : 'ค่ะ|khâ'}`);

const DRAFT: CustomDraft = {
  title: 'Renting a scooter', scenario: 'renting a scooter', adult: false, door: 'l1', dropped: 1, mock: true,
  lines: [
    { id: 'l1', en: "I'd like to rent a scooter.", m: M('อยาก|yàak เช่า|châo มอเตอร์ไซค์|maaw-dtəə-sai'), f: F('อยาก|yàak เช่า|châo มอเตอร์ไซค์|maaw-dtəə-sai'), back: 'I want to rent a motorbike', replies: [
      { id: 'l1.r1', en: 'For how many days?', m: M('กี่|gìi วัน|wan'), f: F('กี่|gìi วัน|wan', true), answer: 'l2' },
      { id: 'l1.r2', en: 'Gone', m: M('ไม่|mâi มี|mii'), f: F('ไม่|mâi มี|mii'), answer: 'nowhere' },
    ] },
    { id: 'l2', en: 'Three days.', m: M('สาม|sǎam วัน|wan'), f: F('สาม|sǎam วัน|wan'), replies: [] },
    { id: 'l3', en: 'Can I pay cash?', m: M('จ่าย|jàai เงินสด|ngən-sòt ได้|dâai ไหม|mǎi'), f: F('จ่าย|jàai เงินสด|ngən-sòt ได้|dâai ไหม|mǎi', true), replies: [
      { id: 'l3.r1', en: 'Yes.', m: M('ได้|dâai'), f: F('ได้|dâai'), answer: 'l2' },
    ] },
  ],
  frames: [
    {
      id: 'f1', en: 'Do you have ___?', m: { thai: 'มี ___ ไหมครับ', roman: 'mii ___ mǎi khráp' }, f: { thai: 'มี ___ ไหมคะ', roman: 'mii ___ mǎi khá' },
      words: [
        { id: 'w1', en: 'a helmet', word: W('หมวกกันน็อก|mùak-gan-náwk'), m: M('มี|mii หมวกกันน็อก|mùak-gan-náwk ไหม|mǎi'), f: F('มี|mii หมวกกันน็อก|mùak-gan-náwk ไหม|mǎi', true) },
        { id: 'w2', en: 'insurance', word: W('ประกัน|bprà-gan'), m: M('มี|mii ประกัน|bprà-gan ไหม|mǎi'), f: F('มี|mii ประกัน|bprà-gan ไหม|mǎi', true) },
      ],
    },
  ],
};

/** A kv store in memory. */
function kv() {
  const m = new Map<string, unknown>();
  return { get: <T,>(k: string, d: T) => (m.has(k) ? (m.get(k) as T) : d), set: <T,>(k: string, v: T) => void m.set(k, JSON.parse(JSON.stringify(v))), m };
}

describe('a server draft on the device', () => {
  it('takes tones from the romanisation marks', () => {
    expect(romanTones('sà-wàt-dii khráp')).toEqual(['low', 'low', 'mid', 'high']);
    expect(romanTones('mǎi thâo-rài')).toEqual(['rising', 'falling', 'low']);
    expect(romanTones('rʉ̌ʉ')).toEqual(['rising']);
  });

  it('gives course words the course’s romanisation, tones and item id; counts the rest as new', () => {
    const f = draftForm(W('มี|mee ไหม|mai ครับ|krap'), lex);
    expect(f.roman).toBe('mii mǎi khráp');
    expect(f.tones).toEqual(['mid', 'rising', 'high']);
    expect(f.items).toEqual(['have-or-there-is', 'mai-q', 'khrap']);
    const r = draftToRecord(DRAFT, lex, { id: 'mine-x', now: 1 });
    expect(r.newWords).toEqual(expect.arrayContaining(['เช่า', 'มอเตอร์ไซค์']));
    expect(r.newWords).not.toContain('ครับ');
    expect(r.newWords).not.toContain('มี');
  });

  it('becomes a section the runner can teach, with prefixed ids, both forms and replies that lead somewhere', () => {
    const r = draftToRecord(DRAFT, lex, { id: 'mine-x', now: 1 });
    const s = r.section;
    expect(s.group).toBe(MINE);
    expect(s.door).toBe('mine.mine-x.l1');
    expect(s.lines.map((l) => l.id)).toEqual(['mine.mine-x.l1', 'mine.mine-x.l2', 'mine.mine-x.l3']);
    expect(s.lines.every((l) => l.unverified && l.m.thai.endsWith('ครับ') && /(ค่ะ|คะ)$/.test(l.f.thai))).toBe(true);
    expect(s.lines[0].replies.map((x) => x.answer)).toEqual(['mine.mine-x.l2']);
    expect(s.lines[2].end).toBe('s');
    expect(s.lines[0].m.tones.length).toBe(s.lines[0].m.roman.split(/[- ]+/).length);
    expect(r.back['mine.mine-x.l1']).toBe('I want to rent a motorbike');
    expect(r.frames[0]).toMatchObject({ id: 'mine.mine-x.f1', say: ['X'] });
    expect(s.frames[0].words[0].word.thai).toBe('หมวกกันน็อก');

    const file = withCustom(school, [r], false);
    const runner = new LessonRunner({ file, lineIds: s.lines.map((l) => l.id), identity: 'f', they: 'm', wheels: {}, minutes: 10, rng: () => 0, now: () => 0 });
    const kinds: Step['kind'][] = [];
    for (let i = 0; i < 40; i++) {
      const st = runner.next();
      if (!st) break;
      kinds.push(st.kind);
      runner.report('right');
    }
    expect(kinds).toContain('teach');
    expect(kinds).toContain('branch');
    expect(kinds).toContain('slot');
  });

  it('review edits: a deleted line takes the replies that lead to it; a reworded one drops the replies around it', () => {
    const r = draftToRecord(DRAFT, lex, { id: 'mine-x', now: 1 });
    const d = dropLine(r, 'mine.mine-x.l2');
    expect(d.section.lines.map((l) => l.id)).toEqual(['mine.mine-x.l1', 'mine.mine-x.l3']);
    expect(d.section.lines.flatMap((l) => l.replies)).toEqual([]);
    const door = dropLine(r, 'mine.mine-x.l1');
    expect(door.section.door).toBe('mine.mine-x.l2');

    const rw = replaceLine(r, 'mine.mine-x.l2', { id: 'x', en: 'Can I look first?', m: M('ขอ|khǎw ดู|duu ก่อน|gàawn ได้|dâai ไหม|mǎi'), f: F('ขอ|khǎw ดู|duu ก่อน|gàawn ได้|dâai ไหม|mǎi', true), replies: [] }, lex);
    const l2 = rw.section.lines[1];
    expect(l2).toMatchObject({ id: 'mine.mine-x.l2', en: 'Can I look first?', replies: [] });
    expect(l2.f.thai).toBe('ขอดูก่อนได้ไหมคะ');
    expect(rw.section.lines.flatMap((l) => l.replies).some((x) => x.answer === 'mine.mine-x.l2')).toBe(false);
    expect(recordNewWords(rw, lex)).not.toContain('ขอ');
  });
});

describe('saved sections on the map', () => {
  it('are stored under a new key and join the map under Mine; 18+ ones only with 18+ on', () => {
    const store = kv();
    const plain = draftToRecord(DRAFT, lex, { id: 'mine-a', now: 1 });
    const night = { ...draftToRecord({ ...DRAFT, title: 'Bar', adult: true }, lex, { id: 'mine-b', now: 2 }) };
    saveCustom(store, plain);
    saveCustom(store, night);
    expect([...store.m.keys()]).toEqual([KEYS.custom]);
    expect(KEYS.custom).toBe('school.custom');
    expect(loadCustom(store).map((r) => r.id)).toEqual(['mine-a', 'mine-b']);

    const off = withCustom(school, loadCustom(store), false);
    const on = withCustom(school, loadCustom(store), true);
    expect(off.groups.at(-1)).toEqual({ id: MINE, title: 'Mine' });
    expect(visibleSections(off, false).filter(isCustomSection).map((s) => s.id)).toEqual(['mine-a']);
    expect(visibleSections(on, true).filter(isCustomSection).map((s) => s.id)).toEqual(['mine-a', 'mine-b']);
    // the built-in sections and their numbers are untouched
    expect(off.sections.slice(0, school.sections.length)).toEqual(school.sections);
    expect(lineIndex(on).has('mine.mine-b.l1')).toBe(true);

    deleteCustom(store, 'mine-a');
    expect(loadCustom(store).map((r) => r.id)).toEqual(['mine-b']);
  });

  it('sends course words the learner has met first, and no 18+ words with 18+ off', () => {
    const met = new Set(['hello']);
    const k = knownWords(course.items, (id) => met.has(id), false, 50);
    expect(k[0][0]).toBe(course.items.find((i) => i.id === 'hello')!.thai);
    expect(k.length).toBe(50);
    const adultIds = new Set(course.items.filter((i) => i.adult).map((i) => i.thai));
    expect(knownWords(course.items, () => false, false).some(([t]) => adultIds.has(t) && !course.items.some((i) => i.thai === t && !i.adult))).toBe(false);
  });
});

describe('skipping by voice', () => {
  const list = doors(school, false, 'm');

  it('matches what was heard against every door phrase, and opens nothing on a weak or tied match', () => {
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(matchDoor(first.thai, list)?.section.id).toBe(first.section.id);
    expect(matchDoor('', list)).toBeNull();
    expect(matchDoor('กขฃคฅฆง', list)).toBeNull();
  });

  it('opens the section at Branches with Teach marked done', () => {
    const section = list[0].section;
    const plan = doorPlan(school, section, { adult: false, identity: 'm', minutes: 10, wheels: {} });
    expect(plan.startAt).toBe('branch');
    let t = 0;
    const runner = new LessonRunner({ file: school, lineIds: plan.lineIds, identity: 'm', they: 'f', wheels: {}, minutes: 10, slots: false, startAt: plan.startAt, rng: () => 0, now: () => t });
    const kinds: Step['kind'][] = [];
    for (let i = 0; i < 60; i++) {
      const st = runner.next();
      if (!st) break;
      kinds.push(st.kind);
      runner.report('right');
      t += 1000;
    }
    expect(kinds[0]).toBe('branch');
    expect(kinds).not.toContain('teach');
    expect(kinds).not.toContain('chunk');
    // the lines come back by recall instead
    expect(kinds).toContain('recall');
  });
});
