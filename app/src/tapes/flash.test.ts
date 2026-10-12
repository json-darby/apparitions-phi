import { describe, expect, it } from 'vitest';
import { BATCH, answer, comeBack, nextPick, progress, schedule, startSession, streak, type FlashGrade, type Session } from './flash';

/** Play a whole session: each card's answer comes from `grader`; each card takes `secs` to answer. */
function play(n: number, grader: (id: string, seen: number, check: boolean) => FlashGrade, secs = 8) {
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  let s: Session = startSession(ids);
  let now = 1_000_000;
  const shown: { id: string; at: number; kind: string }[] = [];
  const seen: Record<string, number> = {};
  for (let guard = 0; guard < 500; guard++) {
    const p = nextPick(s, now);
    if (p.kind === 'done') return { s, shown, steps: guard };
    if (p.kind === 'flip') now += p.waitMs;
    seen[p.id] = (seen[p.id] ?? 0) + 1;
    shown.push({ id: p.id, at: now, kind: p.kind });
    now += secs * 1000;
    s = answer(s, p.id, grader(p.id, seen[p.id], p.kind === 'check'), now, p.kind === 'check');
  }
  throw new Error('session never ended');
}

describe('Tapes flashcards', () => {
  it('finishes a unit of good answers quickly, every card seen at least twice before Good clears it', () => {
    const r = play(12, () => 4);
    expect(r.s.ids.every((id) => r.s.entries[id].need === 0)).toBe(true);
    expect(r.steps).toBeLessThan(40);
  });

  it('Easy clears a card on first sight', () => {
    const r = play(6, () => 5);
    expect(r.shown.filter((x) => x.kind === 'card')).toHaveLength(6);
  });

  it('a hard unit still ends in one sitting, and repeats are spaced out in time', () => {
    // blank the first time, then a little better each go
    const r = play(15, (_id, seen, check) => (check ? 4 : (Math.min(5, seen) as FlashGrade)));
    expect(progress(r.s).left).toBe(0);
    const last: Record<string, number> = {};
    for (const x of r.shown) {
      if (last[x.id] != null && x.kind === 'card') expect(x.at - last[x.id]).toBeGreaterThanOrEqual(12_000);
      last[x.id] = x.at;
    }
    // about 10-15 minutes, not an hour
    expect((r.shown[r.shown.length - 1].at - r.shown[0].at) / 60_000).toBeLessThan(20);
  });

  it('never shows the same card twice running while another could go', () => {
    const r = play(10, (_id, seen) => (seen < 3 ? 1 : 4));
    for (let i = 1; i < r.shown.length; i++) {
      if (r.shown[i].id === r.shown[i - 1].id) expect(r.shown[i].kind).toBe('flip');
    }
  });

  it('brings new cards in a few at a time', () => {
    const s0 = startSession(Array.from({ length: 20 }, (_, i) => `c${i}`));
    let s = s0;
    let now = 0;
    for (let i = 0; i < BATCH; i++) {
      const p = nextPick(s, now);
      expect(p).toMatchObject({ kind: 'card', fresh: true });
      s = answer(s, (p as { id: string }).id, 4, (now += 5000));
    }
    expect(Object.keys(s.entries)).toHaveLength(BATCH);
  });

  it('copes as the deck runs out: one or two cards left still end, the rest carried to tomorrow', () => {
    for (const n of [1, 2, 3]) {
      const r = play(n, (_id, seen) => (seen < 4 ? 1 : 4));
      expect(progress(r.s).left).toBe(0);
      expect(Object.values(r.s.entries).some((e) => e.carried)).toBe(true);
    }
  });

  it('a quick check that fails puts the card back in play', () => {
    const r = play(8, (id, _seen, check) => (check && id === 'c0' ? 1 : 4));
    const c0 = r.s.entries.c0;
    expect(c0.checked).toBe(true);
    expect(c0.answers).toBeGreaterThan(2);
  });

  it('schedules from the first answer of the day; unfinished or carried cards come back tomorrow', () => {
    const today = 100;
    expect(schedule(undefined, { first: 1, need: 0, carried: false }, today).due).toBe(101);
    expect(schedule(undefined, { first: 4, need: 0, carried: false }, today).due).toBe(103);
    expect(schedule(undefined, { first: 5, need: 0, carried: false }, today).due).toBe(105);
    expect(schedule(undefined, { first: 5, need: 2, carried: false }, today).due).toBe(101);
    expect(schedule({ ivl: 10, ease: 2.5, due: 100 }, { first: 4, need: 0, carried: true }, today).due).toBe(101);
    const grown = schedule({ ivl: 4, ease: 2.5, due: 100 }, { first: 4, need: 0, carried: false }, today);
    expect(grown.ivl).toBe(10);
    // Easy lands later than Good, Good later than OK
    const ok = schedule({ ivl: 4, ease: 2.5, due: 100 }, { first: 3, need: 0, carried: false }, today).ivl;
    const easy = schedule({ ivl: 4, ease: 2.5, due: 100 }, { first: 5, need: 0, carried: false }, today).ivl;
    expect(ok).toBeLessThan(grown.ivl);
    expect(easy).toBeGreaterThan(grown.ivl);
  });

  it('counts the day streak and when cards come back', () => {
    expect(streak(undefined, 10)).toBe(0);
    expect(streak({ 8: 3, 9: 5, 10: 2 }, 10)).toBe(3);
    // nothing yet today still keeps yesterday's run going
    expect(streak({ 8: 3, 9: 5 }, 10)).toBe(2);
    expect(streak({ 7: 3, 9: 0 }, 10)).toBe(0);
    const c = (due: number) => ({ ivl: 1, ease: 2.5, due });
    expect(comeBack([c(11), c(11), c(13), c(20)], 10)).toEqual({ tomorrow: 2, soon: 1, later: 1 });
  });
});
