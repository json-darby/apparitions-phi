// The guided day: step order per day, done states, the next step, and the
// per-day marks behind the steps that have no signal of their own.

import { describe, expect, it } from 'vitest';
import { addMark, dayGuide, guideLine, markForRoute, marksOn, type GuideInput } from './guide';

const block = (spent = 0, minutes = 6, done = false) => ({ done, minutes, spent });

function input(over: Partial<GuideInput> = {}): GuideInput {
  return {
    day: 1, primerDone: false, reviews: 0, fresh: 15, patterns: false,
    tone: block(), writing: block(), street: { left: 1, today: 1, next: 'Say hello at the hotel desk' },
    culture: 'The wai', checkpoint: null, marks: [],
    ...over,
  };
}

describe('day 1', () => {
  it('runs primer, new words, tone lab, the street, writing, review, culture note', () => {
    const g = dayGuide(input());
    expect(g.steps.map((s) => s.id)).toEqual(['primer', 'new', 'listen', 'tonelab', 'street', 'writing', 'review', 'culture']);
    expect(g.next?.id).toBe('primer');
    expect(guideLine(g)).toBe('Step 1 of 8 · How Thai works · Five minutes: tones, romanisation, polite endings');
  });

  it('moves to new words once the primer is done', () => {
    const g = dayGuide(input({ primerDone: true }));
    expect(guideLine(g)).toBe('Step 2 of 8 · New words · 15 new');
    expect(g.steps[0].done).toBe(true);
  });

  it('does not call review done before the new words are in', () => {
    // nothing is due yet, but nothing has been met either
    const g = dayGuide(input({ primerDone: true, reviews: 0, fresh: 15 }));
    expect(g.steps.find((s) => s.id === 'review')?.done).toBe(false);
    const later = dayGuide(input({ primerDone: true, reviews: 0, fresh: 0 }));
    expect(later.steps.find((s) => s.id === 'review')?.done).toBe(true);
  });

  it('shows the street task and the block minutes in the notes', () => {
    const g = dayGuide(input({ primerDone: true, fresh: 0, tone: block(2, 6), marks: ['listen'] }));
    expect(guideLine(g)).toBe('Step 4 of 8 · Tone lab · 2 of 6 min');
    const h = dayGuide(input({ primerDone: true, fresh: 0, tone: block(5, 6, true), marks: ['listen'] }));
    expect(guideLine(h)).toBe('Step 5 of 8 · The street conversation · Say hello at the hotel desk');
  });

  it('ends on a done day with every step done', () => {
    const g = dayGuide(input({
      primerDone: true, fresh: 0, reviews: 0, tone: block(5, 6, true), writing: block(5, 6, true),
      street: { left: 0, today: 1, next: null }, marks: ['culture', 'listen'],
    }));
    expect(g.next).toBeNull();
    expect(g.at).toBe(8);
    expect(g.steps.every((s) => s.done)).toBe(true);
    expect(guideLine(g)).toBe('Today is done');
  });

  it('leaves out the culture note and the street when there is nothing there', () => {
    const g = dayGuide(input({ culture: null, street: { left: 0, today: 0, next: null } }));
    expect(g.steps.map((s) => s.id)).toEqual(['primer', 'new', 'listen', 'tonelab', 'writing', 'review']);
  });
});

describe('other days', () => {
  it('starts with review and adds the sentence builder once a pattern is met', () => {
    const g = dayGuide(input({ day: 2, primerDone: true, reviews: 26, fresh: 13, patterns: true, street: { left: 0, today: 0, next: null } }));
    expect(g.steps.map((s) => s.id)).toEqual(['review', 'new', 'listen', 'tonelab', 'sentence', 'writing', 'culture']);
    expect(guideLine(g)).toBe('Step 1 of 7 · Review · 26 due');
  });

  it('skips the sentence builder before any pattern', () => {
    const g = dayGuide(input({ day: 2, primerDone: true, patterns: false, street: { left: 0, today: 0, next: null } }));
    expect(g.steps.map((s) => s.id)).toEqual(['review', 'new', 'listen', 'tonelab', 'writing', 'culture']);
  });

  it('puts the primer first on any day for a learner who has not seen it', () => {
    const g = dayGuide(input({ day: 9, primerDone: false, patterns: false, street: { left: 0, today: 0, next: null } }));
    expect(g.steps.map((s) => s.id)).toEqual(['primer', 'review', 'new', 'listen', 'tonelab', 'writing', 'culture']);
    expect(g.next?.id).toBe('primer');
  });

  it("adds today's lesson before the new words when the day has one, done once opened", () => {
    const g = dayGuide(input({ primerDone: true, lesson: 'Hello, and the five tones' }));
    expect(g.steps.map((s) => s.id).slice(0, 4)).toEqual(['primer', 'lesson', 'new', 'listen']);
    expect(guideLine(g)).toBe("Step 2 of 9 · Today's lesson · Hello, and the five tones");
    const h = dayGuide(input({ primerDone: true, lesson: 'Hello, and the five tones', marks: ['lesson'] }));
    expect(h.next?.id).toBe('new');
    expect(markForRoute('/lesson', new URLSearchParams())).toBe('lesson');
    expect(markForRoute('/lesson', new URLSearchParams('day=3'))).toBeNull();
    expect(markForRoute('/listen', new URLSearchParams())).toBe('listen');
  });

  it('puts the checkpoint first on a checkpoint day', () => {
    const g = dayGuide(input({ day: 7, primerDone: true, checkpoint: { done: false }, reviews: 40, street: { left: 0, today: 0, next: null } }));
    expect(g.steps[0].id).toBe('checkpoint');
    expect(guideLine(g)).toBe('Step 1 of 7 · Checkpoint · Day 7');
    const h = dayGuide(input({ day: 7, primerDone: true, checkpoint: { done: true }, reviews: 40, street: { left: 0, today: 0, next: null } }));
    expect(h.next?.id).toBe('review');
  });

  it('keeps a street task that was left over from an earlier day', () => {
    const g = dayGuide(input({ day: 3, primerDone: true, street: { left: 1, today: 0, next: 'Say hello at the hotel desk' } }));
    expect(g.steps.some((s) => s.id === 'street' && s.title === 'The street')).toBe(true);
  });

  it('the sentence builder and the culture note are done once opened, and a skipped step counts as done', () => {
    const g = dayGuide(input({ day: 2, primerDone: true, reviews: 0, fresh: 0, patterns: true, street: { left: 0, today: 0, next: null }, marks: ['sentence', 'culture', 'skip:tonelab', 'listen'] }));
    expect(g.steps.filter((s) => s.done).map((s) => s.id)).toEqual(['review', 'new', 'listen', 'tonelab', 'sentence', 'culture']);
    expect(g.next?.id).toBe('writing');
  });
});

describe('marks', () => {
  function fakeStore() {
    const kv = new Map<string, unknown>();
    return { get: <T>(k: string, f: T) => (kv.has(k) ? (kv.get(k) as T) : f), set: <T>(k: string, v: T) => void kv.set(k, v), kv };
  }

  it('keeps one day and starts the next clean', () => {
    const s = fakeStore();
    addMark(s, '2026-10-04', 'sentence');
    addMark(s, '2026-10-04', 'sentence');
    addMark(s, '2026-10-04', 'culture');
    expect(marksOn(s, '2026-10-04')).toEqual(['sentence', 'culture']);
    expect(marksOn(s, '2026-10-05')).toEqual([]);
    addMark(s, '2026-10-05', 'skip:tonelab');
    expect(marksOn(s, '2026-10-05')).toEqual(['skip:tonelab']);
    expect(marksOn(s, '2026-10-04')).toEqual([]);
  });

  it('maps the sentence builder and today’s culture note to their steps', () => {
    expect(markForRoute('/sentence', new URLSearchParams())).toBe('sentence');
    expect(markForRoute('/culture', new URLSearchParams())).toBe('culture');
    expect(markForRoute('/culture', new URLSearchParams('id=c-wai'))).toBeNull();
    expect(markForRoute('/culture', new URLSearchParams('day=2'))).toBeNull();
    expect(markForRoute('/review', new URLSearchParams())).toBeNull();
  });
});
