import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SchoolFile } from './content';
import { lineIndex } from './content';
import {
  backChain, chunkGroups, combineVerdict, fitToMinutes, LessonRunner, levelFor, newWheel, RECALL_GAPS_MS, wheelMiss, wheelRight,
  type LessonInput, type Step, type Wheels,
} from './runner';

const school = JSON.parse(readFileSync(resolve(__dirname, '../../public/content/school.json'), 'utf8')) as SchoolFile;
const line = (id: string) => lineIndex(school).get(id)!.line;

/** A runner on a hand-turned clock and a fixed random sequence. */
function make(over: Partial<LessonInput> = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, add: (ms: number) => (t += ms) };
  const runner = new LessonRunner({
    file: school, lineIds: ['mk.thank-you'], identity: 'm', they: 'f', wheels: {}, minutes: 10, slots: false, tutor: 'Khru Dao',
    rng: () => 0, now: clock.now, ...over,
  });
  return { runner, clock };
}

const known = (...ids: string[]): Wheels => Object.fromEntries(ids.map((id) => [id, { ...newWheel(), streak: 4, level: 3 as const }]));

describe('training wheels', () => {
  it('drop after 2 and 4 rights in a row, and rise one level on a miss', () => {
    let w = newWheel();
    expect(w.level).toBe(1);
    w = wheelRight(w);
    expect(w.level).toBe(1);
    w = wheelRight(w);
    expect(w.level).toBe(2);
    w = wheelRight(wheelRight(w));
    expect(w.level).toBe(3);
    w = wheelMiss(w);
    expect(w).toMatchObject({ level: 2, streak: 2, misses: 1 });
    w = wheelRight(wheelRight(w));
    expect(w.level).toBe(3);
    w = wheelMiss(wheelMiss(w));
    expect(w).toMatchObject({ level: 1, streak: 0 });
    expect([0, 1, 2, 3, 4, 9].map(levelFor)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('show the instruction and meaning at 1, the instruction with the meaning behind a tap at 2, nothing in English at 3', () => {
    const at = (level: 1 | 2 | 3) => {
      const { runner } = make({ wheels: { 'mk.thank-you': { ...newWheel(), level, streak: [0, 0, 2, 4][level] } } });
      return runner.shown(runner.next()!);
    };
    expect(at(1)).toEqual({ instruction: 'Listen to Khru Dao, then say it: Thank you.', speak: true, meaning: 'shown' });
    expect(at(2)).toMatchObject({ speak: false, meaning: 'tap' });
    // at 3 a known line comes back as a recall, cued in Thai by a reply that leads to it
    const { runner } = make({ lineIds: ['mk.sorry', 'mk.thank-you'], wheels: known('mk.thank-you') });
    runner.next();
    runner.report('right');
    const recall = runner.next()!;
    expect(recall).toMatchObject({ kind: 'recall', lineId: 'mk.thank-you' });
    expect(recall.cue?.thai).toBe('ไม่เป็นไรค่ะ');
    const three = runner.shown(recall);
    expect(three.meaning).toBe('hidden');
    expect(three.instruction ?? '').not.toContain('Thank you');
  });
});

describe('back-chaining', () => {
  it('builds a long line from the end, the ending riding with the last word', () => {
    const f = line('mk.say-again').m;
    expect(chunkGroups(f.parts).map((g) => g.thai)).toEqual(['พูดอีกที', 'ได้ไหมครับ']);
    expect(backChain(f.parts).map((c) => c.roman)).toEqual(['dâai mǎi khráp']);
    const { runner } = make({ lineIds: ['mk.say-again'] });
    const steps = [runner.next()!, (runner.report('right'), runner.next())!];
    expect(steps.map((s) => s.kind)).toEqual(['chunk', 'teach']);
    expect(steps[0].cue?.thai).toBe('ได้ไหมครับ');
    expect(steps[1].target.thai).toBe('พูดอีกทีได้ไหมครับ');
  });

  it('teaches a short line in one go', () => {
    const { runner } = make();
    expect(runner.next()!.kind).toBe('teach');
  });
});

describe('the lesson', () => {
  it('brings a taught line back at about 5 s, 25 s, 2 min and 10 min', () => {
    // a full section keeps the queue busy; three seconds pass per step
    const { runner, clock } = make({ lineIds: school.sections[0].lines.map((l) => l.id), minutes: 30 });
    const t0 = clock.now();
    expect(runner.next()!.lineId).toBe('mk.hello');
    runner.report('right');
    const recalls: { n: number; after: number }[] = [];
    for (let s = runner.next(); s; s = runner.next()) {
      if (s.kind === 'recall' && s.lineId === 'mk.hello') recalls.push({ n: s.recall!, after: clock.now() - t0 });
      runner.report('right');
      clock.add(3_000);
    }
    expect(recalls.map((r) => r.n)).toEqual([1, 2, 3, 4]);
    // the first two are on time (due while there was still teaching to do)
    expect(recalls[0].after).toBeGreaterThanOrEqual(RECALL_GAPS_MS[0]);
    expect(recalls[0].after).toBeLessThan(RECALL_GAPS_MS[0] + 6_000);
    expect(recalls[1].after).toBeGreaterThanOrEqual(RECALL_GAPS_MS[1]);
    expect(recalls[1].after).toBeLessThan(RECALL_GAPS_MS[1] + 6_000);
    expect(runner.done).toBe(true);
  });

  it('brings a due recall in before the next new line', () => {
    const { runner, clock } = make({ lineIds: ['mk.thank-you', 'mk.sorry'] });
    expect(runner.next()!.target.thai).toBe('ขอบคุณครับ');
    runner.report('right');
    clock.add(6_000);
    const s = runner.next()!;
    expect(s).toMatchObject({ kind: 'recall', lineId: 'mk.thank-you' });
  });

  it('branches once the answer line is taught, with the reply in the other person’s form', () => {
    const { runner } = make({ lineIds: ['mk.sorry', 'mk.thank-you'], they: 'f' });
    const kinds: Step[] = [];
    for (let s = runner.next(); s && kinds.length < 3; s = runner.next()) {
      kinds.push(s);
      runner.report('right');
    }
    const branch = kinds.find((s) => s.kind === 'branch')!;
    expect(branch.cue).toMatchObject({ thai: 'ไม่เป็นไรค่ะ', who: 'other' });
    expect(branch.target.thai).toBe('ขอบคุณครับ');
    expect(branch.lineId).toBe('mk.thank-you');
    // a man answers for them when they speak as men
    const men = make({ lineIds: ['mk.sorry', 'mk.thank-you'], they: 'm' }).runner;
    const steps: Step[] = [];
    for (let s = men.next(); s && steps.length < 3; s = men.next()) {
      steps.push(s);
      men.report('right');
    }
    expect(steps.find((s) => s.kind === 'branch')!.cue!.thai).toBe('ไม่เป็นไรครับ');
  });

  it('a missed branch brings the escape line, then the reply again, slower', () => {
    const { runner } = make({ lineIds: ['mk.sorry', 'mk.thank-you'] });
    let s = runner.next();
    while (s && s.kind !== 'branch') {
      runner.report('right');
      s = runner.next();
    }
    expect(s!.kind).toBe('branch');
    runner.report('none');
    const esc = runner.next()!;
    expect(esc).toMatchObject({ kind: 'escape', lineId: 'mk.say-again' });
    expect(esc.target.thai).toBe('พูดอีกทีได้ไหมครับ');
    runner.report('right');
    const again = runner.next()!;
    expect(again).toMatchObject({ kind: 'branch', slower: true });
    expect(again.cue!.thai).toBe(s!.cue!.thai);
    // only once per reply
    runner.report('wrong');
    expect(runner.next()?.kind).not.toBe('escape');
  });

  it('a woman learner is taught her own forms', () => {
    const { runner } = make({ identity: 'f', lineIds: ['mk.toilet'] });
    expect(runner.next()!.target.thai).toBe('ห้องน้ำอยู่ที่ไหนคะ');
  });

  it('runs slots: the frame stays, the word changes, each on a timer', () => {
    const { runner } = make({ lineIds: ['mk.hello'], slots: true });
    const steps: Step[] = [];
    for (let s = runner.next(); s; s = runner.next()) {
      steps.push(s);
      runner.report('right');
      if (steps.length > 40) break;
    }
    const slots = steps.filter((s) => s.kind === 'slot');
    expect(slots.length).toBeGreaterThanOrEqual(3);
    for (const s of slots) {
      expect(s.timerMs).toBeGreaterThan(0);
      expect(s.key).toBe(`${s.frameId}:${s.wordId}`);
      expect(s.target.thai.includes(s.cue!.thai)).toBe(true);
    }
    expect(slots.filter((s) => s.frameId === 'id-like').map((s) => s.target.thai).every((t) => t.startsWith('เอา') && t.endsWith('ครับ'))).toBe(true);
  });

  it('counts a review only at level 3 with nothing revealed, never for a teach step', () => {
    const fresh = make();
    fresh.runner.next();
    expect(fresh.runner.report('right').counted).toBe(false);

    const { runner } = make({ wheels: known('mk.thank-you') });
    const s = runner.next()!;
    expect(s.kind).toBe('recall');
    expect(runner.report('right').counted).toBe(true);

    const helped = make({ wheels: known('mk.thank-you') }).runner;
    helped.next();
    const out = helped.report('wrong', true);
    expect(out.counted).toBe(false);
    expect(helped.wheels['mk.thank-you'].level).toBe(3);
  });

  it('a miss at level 3 counts, raises the support level and marks the line missed', () => {
    const { runner } = make({ wheels: known('mk.thank-you') });
    runner.next();
    const out = runner.report('wrong');
    expect(out).toMatchObject({ before: 3, level: 2, counted: true });
    expect(runner.missedLineIds()).toEqual(['mk.thank-you']);
    expect(runner.lineResults()[0]).toMatchObject({ countedMisses: 1 });
  });

  it('stops teaching when the session time is up', () => {
    const { runner, clock } = make({ lineIds: ['mk.hello', 'mk.thank-you', 'mk.sorry'], minutes: 1 });
    runner.next();
    runner.report('right');
    clock.add(61_000);
    // recalls already due still come; nothing new is taught
    const after: Step[] = [];
    for (let s = runner.next(); s; s = runner.next()) {
      after.push(s);
      runner.report('right');
    }
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((s) => s.kind === 'recall' && s.lineId === 'mk.hello')).toBe(true);
    expect(runner.done).toBe(true);
  });

  it('a line said after the tutor is got; one not said even then is missed', () => {
    const { runner } = make({ lineIds: ['mk.hello', 'mk.yes'] });
    runner.next();
    runner.report('right');
    runner.next();
    runner.report('none');
    expect(runner.gotLineIds()).toEqual(['mk.hello']);
    expect(runner.missedLineIds()).toEqual(['mk.yes']);
  });

  it('a step can be put back after a dropped connection', () => {
    const { runner } = make();
    const s = runner.next()!;
    runner.requeue();
    expect(runner.next()!.id).toBe(s.id);
  });
});

describe('session length', () => {
  it('fits fewer lines into 5 minutes than 20', () => {
    const all = school.sections[0].lines;
    const five = fitToMinutes(all, {}, 5);
    const twenty = fitToMinutes(all, {}, 20);
    expect(five.length).toBeGreaterThanOrEqual(1);
    expect(five.length).toBeLessThan(twenty.length);
    // known lines are cheaper
    const ids = all.map((l) => l.id);
    expect(fitToMinutes(all, known(...ids), 5).length).toBeGreaterThan(five.length);
  });
});

describe('the verdict', () => {
  const target = 'ขอบคุณครับ';
  it('needs the transcript to back a "right"', () => {
    expect(combineVerdict('right', 'ขอบคุณครับ', target)).toBe('right');
    expect(combineVerdict('right', 'สวัสดีครับ', target)).toBe('wrong');
    expect(combineVerdict('close', 'ขอบคุณ', target)).toBe('right');
  });
  it('ignores the polite ending', () => {
    expect(combineVerdict('right', 'ขอบคุณค่ะ', target)).toBe('right');
  });
  it('lets a near-exact transcript win over "wrong", and silence is none', () => {
    expect(combineVerdict('wrong', 'ขอบคุณครับ', target)).toBe('right');
    expect(combineVerdict('none', '', target)).toBe('none');
    expect(combineVerdict(null, null, target)).toBe('none');
    expect(combineVerdict('right', '', target)).toBe('wrong');
    expect(combineVerdict(null, 'ขอบคุณครับ', target)).toBe('right');
  });
});
