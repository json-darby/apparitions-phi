import { describe, expect, it } from 'vitest';
import { atlasKey, atlasRect, frameCap, FRAME_RATE_CAP, idleLife, mirrorFor, newCast, noticeWeight, parseBodies, springTo, stepCast, type CastSense } from './bodies';

// a tiny index in the packer's format (pipeline/pack_bodies.py)
const INDEX = {
  version: 1,
  credit: 'AI-generated',
  people: {
    nok: { image: 'bodies/nok.webp', tile: [156, 420], cols: 5, frames: 10, keys: { idle: 0, notice: 8, greet: 9 }, reform: [[8, 9]], head: 0.04, feet: 0.97, centre: 0.5, looks: 'right' },
    fah: {
      image: 'bodies/fah.webp', tile: [156, 420], cols: 5, frames: 10, keys: { idle: 0, notice: 8, greet: 9 }, reform: [[8, 9], [3, 4], [9, 10], [2, 7], 'x'], head: 0.05, feet: 0.96, centre: 0.48, looks: 'right',
      alt: { jacket: { image: 'bodies/fah-jacket.webp' } },
    },
    // malformed: each is dropped, so that person keeps the stand-in figure
    bad1: { image: '../secret.webp', tile: [240, 420], cols: 6, frames: 17, keys: { idle: 0, notice: 8, greet: 16 }, head: 0.04, feet: 0.97, centre: 0.5 },
    bad2: { image: 'bodies/b.webp', tile: [240, 420], cols: 6, frames: 17, keys: { idle: 0, notice: 8, greet: 20 }, head: 0.04, feet: 0.97, centre: 0.5 },
    bad3: { image: 'bodies/c.webp', tile: [240], cols: 6, frames: 17, keys: { idle: 0, notice: 8, greet: 16 }, head: 0.04, feet: 0.97, centre: 0.5 },
    bad4: { image: 'bodies/d.webp', tile: [240, 420], cols: 6, frames: 17, keys: { idle: 0, notice: 8, greet: 16 }, head: 0.6, feet: 0.7, centre: 0.5 },
    Bad5: { image: 'bodies/e.webp', tile: [240, 420], cols: 6, frames: 17, keys: { idle: 0, notice: 8, greet: 16 }, head: 0.04, feet: 0.97, centre: 0.5 },
  },
};

const sense = (o: Partial<CastSense>): CastSense => ({ dxM: -10, gaze: -1, atPlace: false, stopped: false, motion: true, ...o });
// the two layouts the packer makes: a RIFE head turn then a re-formed greeting, or re-forms throughout (Fah)
const NOK = { keys: { idle: 0, notice: 8, greet: 9 }, reform: [8] };
const FAH = { keys: { idle: 0, notice: 1, greet: 2 }, reform: [0, 1] };
const run = (s: ReturnType<typeof newCast>, o: Partial<CastSense>, secs: number, atlas = NOK, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(secs / dt); i++) stepCast(s, sense(o), dt, atlas);
  return s;
};

describe('street bodies index', () => {
  it('reads good entries and drops malformed ones', () => {
    const ix = parseBodies(INDEX);
    expect(Object.keys(ix.people).sort()).toEqual(['fah', 'nok']);
    expect(ix.people.fah.alt.jacket.image).toBe('bodies/fah-jacket.webp');
    expect(ix.people.nok.alt).toEqual({});
    expect(ix.people.nok.looks).toBe('right');
    expect(ix.people.nok.reform).toEqual([8]);
    // only joins between neighbouring frames that exist
    expect(ix.people.fah.reform).toEqual([8, 3]);
    // Fah's real layout: three key frames, every join a re-form
    const fah = parseBodies({ people: { fah: { image: 'bodies/fah.webp', tile: [150, 420], cols: 5, frames: 3, keys: { idle: 0, notice: 1, greet: 2 }, reform: [[0, 1], [1, 2]], head: 0.027, feet: 0.978, centre: 0.64, looks: 'right', alt: { jacket: { image: 'bodies/fah-jacket.webp' } } } } }).people.fah;
    expect(fah.keys).toEqual({ idle: 0, notice: 1, greet: 2 });
    expect(fah.reform).toEqual([0, 1]);
    expect(parseBodies(null).people).toEqual({});
    expect(parseBodies({ people: 'x' }).people).toEqual({});
  });

  it('finds each frame in the atlas grid, inset from its neighbours', () => {
    const a = parseBodies(INDEX).people.nok;
    const [u0, v0, w0, h0] = atlasRect(a, 0);
    expect(u0).toBeGreaterThan(0);
    expect(v0).toBeGreaterThan(0);
    expect(u0 + w0).toBeLessThan(1 / 5);
    expect(v0 + h0).toBeLessThan(1 / 2);
    const [u8, v8] = atlasRect(a, 8); // row 1, column 3
    expect(u8).toBeCloseTo((3 * 156 + 0.5) / 780, 6);
    expect(v8).toBeCloseTo((420 + 0.5) / 840, 6);
    const last = atlasRect(a, 99);
    expect(last).toEqual(atlasRect(a, 9));
  });

  it('draws Fah in her jacket set with 18+ off, never the 18+ photos', () => {
    const ix = parseBodies(INDEX);
    expect(atlasKey('fah', ix.people.fah, true)).toBe('photo:fah');
    expect(atlasKey('fah', ix.people.fah, false)).toBe('photo:fah-jacket');
    expect(atlasKey('fah', { alt: {} }, false)).toBeNull();
    expect(atlasKey('nok', ix.people.nok, false)).toBe('photo:nok');
    expect(atlasKey('ton', undefined, true)).toBeNull();
  });

  it('mirrors a person so their turn faces where you stop', () => {
    // most stand right of their stop: their right-turning pose is mirrored to face left
    expect(mirrorFor('right', 600, 540)).toBe(true);
    // Lek stands left of the market's middle: no mirror
    expect(mirrorFor('right', 1480, 1536)).toBe(false);
    expect(mirrorFor('left', 1480, 1536)).toBe(true);
  });
});

describe('street people behaviour', () => {
  it('notices you from about 3.5 m to 1.2 m on the side they look toward only', () => {
    expect(noticeWeight(-4, -1)).toBe(0);
    expect(noticeWeight(-1, -1)).toBe(1);
    expect(noticeWeight(-2.3, -1)).toBeGreaterThan(0.2);
    expect(noticeWeight(-2.3, -1)).toBeLessThan(0.8);
    // behind them: nothing until right beside
    expect(noticeWeight(2, -1)).toBe(0);
    expect(noticeWeight(1, -1)).toBe(0);
    expect(noticeWeight(0.5, -1)).toBe(1);
  });

  it('never moves faster than the frame cap and never overshoots', () => {
    const s = { f: 0, v: 0 };
    let prev = 0;
    for (let i = 0; i < 240; i++) {
      springTo(s, 16, 1 / 60, true);
      expect(s.f - prev).toBeLessThanOrEqual(FRAME_RATE_CAP / 60 + 1e-9);
      expect(s.f).toBeLessThanOrEqual(16 + 1e-9);
      prev = s.f;
    }
    expect(s.f).toBe(16);
    for (const motion of [true, false]) {
      const r = { f: 16, v: 0 };
      let p = 16;
      for (let i = 0; i < 240; i++) {
        springTo(r, 8, 1 / 30, motion);
        expect(r.f).toBeGreaterThanOrEqual(8 - 1e-9);
        expect(r.f).toBeLessThanOrEqual(p + 1e-9);
        p = r.f;
      }
      expect(r.f).toBe(8);
    }
  });

  it('re-forms slowly across the greeting join and turns the head at the RIFE pace', () => {
    expect(frameCap(3.2, 1, [8])).toBe(FRAME_RATE_CAP);
    expect(frameCap(8, 1, [8])).toBeCloseTo(1 / 0.33, 6);
    expect(frameCap(8.5, -1, [8])).toBeCloseTo(1 / 0.33, 6);
    expect(frameCap(8, -1, [8])).toBe(FRAME_RATE_CAP); // going down from 8 is the head turn
    expect(frameCap(9, -1, [8])).toBeCloseTo(1 / 0.33, 6);
    // a step that would run from the head turn into the re-form slows down at the join
    const s = { f: 7.9, v: 14 };
    springTo(s, 9, 1 / 30, true, 9, (f, d) => frameCap(f, d, [8]));
    expect(s.f).toBeGreaterThan(8);
    expect(s.f).toBeLessThan(8.12);
  });

  it('turns to notice as you approach, greets once (a quick re-form) when you stop at their place, then holds notice', () => {
    const s = newCast();
    run(s, { dxM: -6 }, 1);
    expect(s.f).toBe(0);
    run(s, { dxM: -1 }, 1.5);
    expect(s.f).toBeCloseTo(8, 2);
    // you stop at their place: re-form into the greeting...
    let peak = 0;
    let reached = -1;
    let left = -1;
    let back = -1;
    for (let t = 0; t < 5; t += 1 / 60) {
      stepCast(s, sense({ dxM: -0.8, atPlace: true, stopped: true }), 1 / 60, NOK);
      peak = Math.max(peak, s.f);
      if (reached < 0 && s.f >= 9) reached = t;
      if (reached >= 0 && left < 0 && s.f < 9) left = t;
      if (left >= 0 && back < 0 && s.f <= 8.001) back = t;
    }
    expect(peak).toBe(9);
    expect(reached).toBeGreaterThan(0.28);
    expect(reached).toBeLessThan(0.45);
    // ...held about 1.4 s, re-formed back to notice in about the same time, held while you stay
    expect(left - reached).toBeGreaterThan(1.3);
    expect(left - reached).toBeLessThan(1.55);
    expect(back - left).toBeGreaterThan(0.28);
    expect(back - left).toBeLessThan(0.45);
    expect(s.f).toBeCloseTo(8, 2);
    // still there: no second greeting
    run(s, { dxM: -0.8, atPlace: true, stopped: true }, 4);
    expect(s.f).toBeCloseTo(8, 2);
    // leave: back to idle, and re-armed for next time
    run(s, { dxM: -6 }, 2);
    expect(s.f).toBe(0);
    expect(s.armed).toBe(true);
  });

  it('greets from idle too: the head turn first, then the re-form', () => {
    const s = newCast();
    let at8 = -1;
    let at9 = -1;
    for (let t = 0; t < 3; t += 1 / 60) {
      stepCast(s, sense({ dxM: -0.8, atPlace: true, stopped: true }), 1 / 60, NOK);
      if (at8 < 0 && s.f >= 8) at8 = t;
      if (at9 < 0 && s.f >= 9) at9 = t;
    }
    expect(at8).toBeGreaterThan(8 / FRAME_RATE_CAP - 0.02);
    expect(at9 - at8).toBeGreaterThan(0.3);
    expect(at9 - at8).toBeLessThan(0.45);
  });

  it('re-forms a head turn as a whole (no frozen half-way pose) when the turn itself is a re-form', () => {
    const s = newCast();
    // walking up: idle until clearly near, then one re-form to notice
    let maxMid = 0;
    for (let d = 5; d >= 1; d -= 0.02) {
      stepCast(s, sense({ dxM: -d }), 1 / 60, FAH);
      if (s.f > 0.02 && s.f < 0.98) maxMid = Math.max(maxMid, 1);
    }
    run(s, { dxM: -1 }, 0.5, FAH);
    expect(s.f).toBe(1);
    expect(maxMid).toBe(1); // it did pass through the re-form...
    // ...and never rests half-way: hold at any distance and it settles on a key frame
    for (const d of [1.6, 2.0, 2.4, 2.8, 3.2]) {
      run(s, { dxM: -d }, 1.5, FAH);
      expect([0, 1]).toContain(s.f);
    }
    // the greeting: idle, notice and greet are all re-forms for Fah
    run(s, { dxM: -0.8, atPlace: true, stopped: true }, 0.8, FAH); // turn (0.33 s) then greet (0.33 s)
    expect(s.f).toBe(2);
    run(s, { dxM: -0.8, atPlace: true, stopped: true }, 3, FAH);
    expect(s.f).toBe(1);
    run(s, { dxM: -6 }, 1, FAH);
    expect(s.f).toBe(0);
  });

  it('eases without overshoot under reduced motion as well', () => {
    const s = newCast();
    let prev = 0;
    for (let t = 0; t < 3; t += 1 / 60) {
      stepCast(s, sense({ dxM: -0.8, atPlace: true, stopped: true, motion: false }), 1 / 60, NOK);
      expect(s.f).toBeLessThanOrEqual(9 + 1e-9);
      if (s.greet?.phase === 'rise') expect(s.f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s.f;
    }
  });

  it('only sways and breathes while idle, and the feet never move (the shader pins the soles)', () => {
    const a = idleLife(1.2, 42, 0);
    expect(Math.abs(a.sway)).toBeGreaterThan(0);
    let maxSway = 0;
    for (let t = 0; t < 20; t += 0.05) maxSway = Math.max(maxSway, Math.abs(idleLife(t, 42, 0).sway));
    expect(maxSway).toBeLessThanOrEqual(0.0071);
    expect(maxSway).toBeGreaterThan(0.004);
    expect(idleLife(1.2, 42, 0.6)).toEqual({ sway: 0, breath: 0 });
    expect(idleLife(1.2, 42, 8)).toEqual({ sway: 0, breath: 0 });
  });
});
