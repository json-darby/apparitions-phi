// School of the Night content: the file loads, passes every content check, and
// every line not marked unverified is the course's own Thai, composed again
// from the course's items.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Item } from '../content/types';
import { composeForm, escapeLines, isSchoolWord, lineIndex, schoolItems, validateSchool, visibleSections, type SchoolFile } from './content';

const school = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/school.json'), 'utf8')) as SchoolFile;
const course = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/course.json'), 'utf8')) as { items: Item[]; tasks: { nodes: Record<string, { thai: string; options: { thai: string }[] }> }[] };
const items = new Map(course.items.map((i) => [i.id, i]));
const all = schoolItems(school, items);

const allComposed = () =>
  school.sections.flatMap((s) => [
    ...s.lines.map((l) => ({ where: l.id, x: l })),
    ...s.lines.flatMap((l) => l.replies.map((r) => ({ where: r.id, x: r }))),
    ...s.frames.flatMap((f) => f.words.map((w) => ({ where: `${s.id}/${f.frame}/${w.id}`, x: w }))),
  ]);

describe('school.json', () => {
  it('passes every content check against the course', () => {
    expect(validateSchool(school, items)).toEqual([]);
  });

  it('has 18 sections in four groups, Night (14 to 18) only with 18+ on', () => {
    expect(school.sections.map((s) => s.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(new Set(school.sections.map((s) => s.group))).toEqual(new Set(['foundations', 'everyday', 'plans', 'night']));
    expect(visibleSections(school, false).map((s) => s.n)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(visibleSections(school, true)).toHaveLength(18);
  });

  it('fills every section with 8 to 14 lines, 2 to 4 frames and a door line', () => {
    for (const s of school.sections) {
      expect(s.lines.length, s.id).toBeGreaterThanOrEqual(8);
      expect(s.lines.length, s.id).toBeLessThanOrEqual(14);
      expect(s.door, s.id).toBeTruthy();
      expect(s.lines.some((l) => l.id === s.door), s.id).toBe(true);
      if (s.n > 2) {
        expect(s.frames.length, s.id).toBeGreaterThanOrEqual(2);
        expect(s.frames.length, s.id).toBeLessThanOrEqual(4);
        for (const f of s.frames) expect(f.words.length, `${s.id}/${f.frame}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('section 16 is filled, in the Night group, and only visible with 18+ on', () => {
    const s16 = school.sections.find((s) => s.n === 16)!;
    expect(s16.group).toBe('night');
    expect(s16.lines.length).toBeGreaterThanOrEqual(8);
    expect(visibleSections(school, false).some((s) => s.n === 16)).toBe(false);
  });

  it('line ids carry their section prefix, and every line has replies or is an answer', () => {
    const answers = new Set(school.sections.flatMap((s) => s.lines.flatMap((l) => l.replies.map((r) => r.answer))));
    for (const s of school.sections.slice(2)) {
      const prefix = s.lines[0].id.split('.')[0];
      for (const l of s.lines) expect(l.id.startsWith(`${prefix}.`), l.id).toBe(true);
      // most lines in a section open a branch or close one
      const linked = s.lines.filter((l) => l.replies.length || answers.has(l.id)).length;
      expect(linked / s.lines.length, s.id).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('replies are two levels deep: an answer line is a real line, never a reply', () => {
    const replyIds = new Set(school.sections.flatMap((s) => s.lines.flatMap((l) => l.replies.map((r) => r.id))));
    for (const s of school.sections) for (const l of s.lines) for (const r of l.replies) {
      expect(replyIds.has(r.answer), r.id).toBe(false);
      expect(r.answer, r.id).not.toBe(l.id);
    }
  });

  it('every reply points at a real answer line', () => {
    const lines = lineIndex(school);
    for (const s of school.sections) for (const l of s.lines) for (const r of l.replies) expect(lines.has(r.answer), r.id).toBe(true);
  });

  it('every line, reply and slot sentence has both speaker forms', () => {
    for (const { where, x } of allComposed()) {
      expect(x.m.thai, where).toBeTruthy();
      expect(x.f.thai, where).toBeTruthy();
      expect(x.m.thai.endsWith('ครับ'), where).toBe(true);
      expect(/(ค่ะ|คะ)$/.test(x.f.thai), where).toBe(true);
      expect(x.m.items.includes('i-female'), where).toBe(false);
      expect(x.f.items.includes('i-male'), where).toBe(false);
    }
    // "I" switches with the speaker
    const fine = lineIndex(school).get('am.im-fine')!.line;
    expect(fine.m.thai).toBe('ผมสบายดีครับ');
    expect(fine.f.thai).toBe('ฉันสบายดีค่ะ');
    // a woman asks with คะ
    expect(lineIndex(school).get('mk.toilet')!.line.f.thai).toBe('ห้องน้ำอยู่ที่ไหนคะ');
  });

  it('has the three escape lines', () => {
    const e = escapeLines(school);
    expect(e.again?.m.thai).toBe('พูดอีกทีได้ไหมครับ');
    expect(e.slower?.m.thai).toBe('พูดช้าๆหน่อยนะครับ');
    expect(e.lost?.m.thai).toBe('ไม่เข้าใจครับ');
  });

  it('"course" lines are sentences the course already has', () => {
    const strip = (s: string) => s.replace(/\s+/g, '');
    const known = new Set<string>();
    for (const t of course.tasks) for (const n of Object.values(t.nodes)) {
      known.add(strip(n.thai));
      for (const o of n.options) known.add(strip(o.thai));
    }
    for (const i of course.items) for (const e of ['', 'ครับ', 'ค่ะ', 'คะ']) known.add(strip(i.thai) + e);
    for (const { where, x } of allComposed()) {
      if (x.source !== 'course') continue;
      expect(known.has(strip(x.m.thai)) || known.has(strip(x.f.thai)), where).toBe(true);
    }
  });

  it('Thai outside the course comes only from the school words, and is marked unverified', () => {
    const ids = new Set((school.words ?? []).map((w) => w.id));
    for (const w of school.words ?? []) {
      expect(isSchoolWord(w.id), w.id).toBe(true);
      expect(items.has(w.id), w.id).toBe(false);
    }
    for (const { where, x } of allComposed()) {
      const uses = x.say.filter(isSchoolWord);
      for (const id of uses) expect(ids.has(id), `${where}: ${id}`).toBe(true);
      expect(!!x.unverified, where).toBe(uses.length > 0);
      for (const t of x.say) if (t !== '_' && t !== 'I') expect(all.has(t), `${where}: ${t}`).toBe(true);
    }
    // Must-knows and About me use course words only
    for (const s of school.sections.slice(0, 2)) for (const l of s.lines) expect(l.unverified, l.id).toBeFalsy();
  });

  it('unverified lines are still composed exactly from their words', () => {
    for (const { where, x } of allComposed()) {
      if (!x.unverified) continue;
      expect(composeForm(x.say, x.end, 'm', all).thai, where).toBe(x.m.thai);
      expect(composeForm(x.say, x.end, 'f', all).thai, where).toBe(x.f.thai);
    }
  });

  it('every school word is used', () => {
    const used = new Set(allComposed().flatMap(({ x }) => x.say));
    for (const w of school.words ?? []) expect(used.has(w.id), w.id).toBe(true);
  });

  it('frame templates and slot sentences agree', () => {
    for (const f of school.frames) {
      expect(f.m.thai.includes('___'), f.id).toBe(true);
      expect(f.m.thai.endsWith('ครับ'), f.id).toBe(true);
      expect(/(ค่ะ|คะ)$/.test(f.f.thai), f.id).toBe(true);
    }
  });
});

describe('content checks catch mistakes', () => {
  const copy = () => JSON.parse(JSON.stringify(school)) as SchoolFile;

  it('a reply whose answer is not a line', () => {
    const f = copy();
    f.sections[0].lines.find((l) => l.replies.length)!.replies[0].answer = 'nope';
    expect(validateSchool(f).some((e) => e.includes('answer nope'))).toBe(true);
  });

  it('a missing female form', () => {
    const f = copy();
    delete (f.sections[0].lines[0] as Partial<(typeof f.sections)[0]['lines'][0]>).f;
    expect(validateSchool(f).some((e) => e.includes('the f form is missing'))).toBe(true);
  });

  it('a school word used without the unverified mark', () => {
    const f = copy();
    const l = f.sections.flatMap((s) => s.lines).find((x) => x.unverified)!;
    delete l.unverified;
    expect(validateSchool(f, items).some((e) => e.includes('must be marked unverified'))).toBe(true);
  });

  it('a school word that is not in the file', () => {
    const f = copy();
    f.words = (f.words ?? []).filter((w) => w.id !== 'sw.hundred');
    expect(validateSchool(f, items).some((e) => e.includes('sw.hundred'))).toBe(true);
  });

  it('an unverified line whose Thai differs from its words', () => {
    const f = copy();
    const l = f.sections.flatMap((s) => s.lines).find((x) => x.unverified)!;
    l.m.thai = l.m.thai.replace('ครับ', 'จ้ะครับ');
    expect(validateSchool(f, items).some((e) => e.includes(l.id) && e.includes("is not the course's"))).toBe(true);
  });

  it('Thai that differs from the course', () => {
    const f = copy();
    f.sections[0].lines[0].m.thai = 'สวัสดีจ้า';
    expect(validateSchool(f, items).some((e) => e.includes("is not the course's"))).toBe(true);
  });

  it('a male form with a female ending', () => {
    const f = copy();
    const l = f.sections[0].lines[0];
    l.m = { ...l.f };
    expect(validateSchool(f).some((e) => e.includes("the other speaker's form"))).toBe(true);
  });

  it('a Night section outside the Night group', () => {
    const f = copy();
    f.sections[13].group = 'plans';
    expect(validateSchool(f).some((e) => e.includes('Night group'))).toBe(true);
  });
});

describe('composeForm', () => {
  it('follows sayForm: ครับ, or ค่ะ / คะ for a question and after นะ', () => {
    expect(composeForm(['thank-you'], 's', 'm', items).thai).toBe('ขอบคุณครับ');
    expect(composeForm(['thank-you'], 's', 'f', items).roman).toBe('khàwp-khun khâ');
    expect(composeForm(['where-is-the-toilet'], 'q', 'f', items).thai).toBe('ห้องน้ำอยู่ที่ไหนคะ');
    expect(composeForm(['wait-a-moment'], 's', 'f', items).thai.endsWith('นะคะ')).toBe(true);
  });

  it('uses a phrase item’s own form when it carries the pronoun', () => {
    expect(composeForm(['i-like-thailand'], 's', 'f', items).thai).toBe('ฉันชอบเมืองไทยค่ะ');
  });

  it('keeps one part per item, for back-chaining', () => {
    const f = composeForm(['say-it-again', 'dai', 'mai-q'], 'q', 'm', items);
    expect(f.parts.map((p) => p.thai)).toEqual(['พูดอีกที', 'ได้', 'ไหม', 'ครับ']);
    expect(f.tones).toEqual(['falling', 'low', 'mid', 'falling', 'rising', 'high']);
  });
});
