// The street's scale and movement maths: people at life size on the
// photograph, the places where the photograph has them, a calm glide, and name
// tags that never overlap.

import { describe, expect, it } from 'vitest';
import { PLACES } from '../content/seed';
import {
  GROUND_Y,
  KERB_Y,
  PX_PER_M,
  SIGN_BOARDS,
  SIGN_TOP,
  STREET_H,
  STREET_W,
  THEO_SHOP,
  WALK_MAX,
  WALK_MIN,
  easeSpeed,
  heightPx,
  layoutLabels,
  paceTo,
  viewFor,
  worldX,
} from './geometry';
import { streetPitch } from './parts/streetGL';

describe('scale', () => {
  it('puts a 2.1 m door and a 1.70 m adult in proportion', () => {
    // the doors measure about 148 px at the shopfront; the pavement is a little nearer
    const door = 2.1 * PX_PER_M;
    expect(door).toBeGreaterThan(148);
    expect(door).toBeLessThan(170);
    const adult = heightPx(1.7);
    expect(adult / door).toBeCloseTo(1.7 / 2.1, 5);
    expect(adult).toBeGreaterThan(120);
    expect(adult).toBeLessThan(140);
  });
  it('stands people on the pavement, between the shop step and the kerb', () => {
    expect(GROUND_Y).toBeGreaterThan(690);
    expect(GROUND_Y).toBeLessThan(KERB_Y);
    expect(KERB_Y).toBeLessThan(STREET_H);
  });
  it('keeps every place on the walkable pavement, in order, far enough apart to tell them apart', () => {
    const xs = [...PLACES].sort((a, b) => a.x - b.x).map((p) => p.x * STREET_W);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(WALK_MIN);
      expect(x).toBeLessThanOrEqual(WALK_MAX);
    }
    const all = [...xs, THEO_SHOP.x * STREET_W].sort((a, b) => a - b);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThan(60); // the nearest place within NEAR (100) wins
  });
  it('puts each sign over its own shop', () => {
    for (const p of PLACES) {
      const [x0, y0, x1, y1] = SIGN_BOARDS[p.id].main;
      expect(x1).toBeGreaterThan(x0);
      expect(y1).toBeGreaterThan(y0);
      expect(Math.abs((x0 + x1) / 2 - p.x * STREET_W)).toBeLessThan(200);
    }
  });
});

describe('gliding', () => {
  it('eases in and out, never starting or stopping at once', () => {
    let v = 0;
    v = easeSpeed(v, 1, 120, 1 / 60);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(20);
    for (let i = 0; i < 120; i++) v = easeSpeed(v, 1, 120, 1 / 60);
    expect(v).toBeGreaterThan(119);
    v = easeSpeed(v, 0, 120, 1 / 60);
    expect(v).toBeGreaterThan(100);
  });
  it('slows down over the last stretch when walking to a place', () => {
    expect(paceTo(500)).toBe(1);
    expect(paceTo(-500)).toBe(-1);
    expect(Math.abs(paceTo(10))).toBeLessThan(0.5);
    expect(paceTo(0.1)).toBe(0);
  });
});

describe('name tags', () => {
  const overlaps = (a: { x: number; w: number }, b: { x: number; w: number }, gap: number) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap;
  it('never shows two tags that overlap; the one you are at wins', () => {
    const items = [
      { x: 100, w: 60, prio: 1 },
      { x: 150, w: 140, prio: 2 },
      { x: 240, w: 50, prio: 1 },
      { x: 330, w: 50, prio: 1 },
    ];
    const o = layoutLabels(items, 400);
    expect(o[1]).toBeGreaterThan(0);
    expect(o[0]).toBe(0);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) if (o[i] > 0 && o[j] > 0) expect(overlaps(items[i], items[j], 14)).toBe(false);
  });
  it('fades tags out at the stage edges instead of piling them there', () => {
    const o = layoutLabels([{ x: 10, w: 60, prio: 1 }, { x: 200, w: 60, prio: 1 }, { x: 395, w: 60, prio: 1 }], 400);
    expect(o).toEqual([0, 1, 0]);
    expect(layoutLabels([{ x: 40, w: 60, prio: 1 }], 400)[0]).toBeGreaterThan(0);
    expect(layoutLabels([{ x: 40, w: 60, prio: 1 }], 400)[0]).toBeLessThan(1);
  });
  it('keeps the real street tags apart on a phone as you walk its length', () => {
    // the tags sit 0.8 m beside each place; on a 375 px phone at the closest zoom
    const xs = [...PLACES.map((p) => p.x * STREET_W + (p.id === 'market' ? -56 : p.id === 'taxi' ? 55 : 60)), THEO_SHOP.x * STREET_W + 60].sort((a, b) => a - b);
    for (let c = 0; c <= STREET_W; c += 37) {
      const v = viewFor(375, 380, c);
      const items = xs.map((x) => ({ x: (x - v.left) * v.s, w: 64, prio: 1 }));
      const o = layoutLabels(items, 375);
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) if (o[i] > 0 && o[j] > 0) expect(overlaps(items[i], items[j], 14)).toBe(false);
      // short names all fit side by side
      const inside = items.filter((it) => it.x - 32 > 32 && it.x + 32 < 375 - 32);
      expect(inside.every((it) => o[items.indexOf(it)] > 0)).toBe(true);
    }
  });
});

describe('camera', () => {
  it('fills the stage and keeps a person readable on a phone', () => {
    const v = viewFor(375, 360, 300);
    expect(heightPx(1.73) * v.s).toBeGreaterThanOrEqual(74 - 1e-9);
    expect(v.left).toBeGreaterThanOrEqual(0);
    expect(v.top + 360 / v.s).toBeCloseTo(STREET_H, 6); // the road stays in view
  });
  it('shows the whole height on a wide stage and stops at the ends', () => {
    const v = viewFor(1100, 560, 50);
    expect(v.left).toBe(0);
    const r = viewFor(1100, 560, 5000);
    expect(r.left + 1100 / r.s).toBeCloseTo(STREET_W, 6);
    expect(worldX(550, r)).toBeCloseTo(r.left + 550 / r.s, 9);
  });
  it('keeps the dots about the same size on screen at any zoom', () => {
    for (const s of [0.4, 0.55, 0.8, 1.1]) {
      const css = streetPitch(s) * s;
      expect(css).toBeGreaterThan(2.2);
      expect(css).toBeLessThan(3.6);
    }
  });
});

describe('the push-in when you stop with someone', () => {
  const stages: [number, number][] = [[375, 330], [412, 460], [768, 520], [1440, 560]];
  it('brings people closer, but never crops a sign or the name labels', () => {
    for (const [w, h] of stages) {
      const out = viewFor(w, h, 1000, heightPx(1.73), 74, 0);
      const inn = viewFor(w, h, 1000, heightPx(1.73), 74, 1);
      expect(inn.s).toBeGreaterThanOrEqual(out.s);
      expect(inn.s).toBeLessThanOrEqual(out.s * 1.6 + 1e-9);
      // every sign board's top is on the stage, with a margin
      expect((SIGN_TOP - inn.top) * inn.s).toBeGreaterThanOrEqual(11.9);
      // the label row (16 px under the kerb) and the YOU tag under it fit
      expect((KERB_Y - inn.top) * inn.s + 84).toBeLessThanOrEqual(h + 1e-6);
      // and the view never runs past the bottom of the street
      expect(inn.top + h / inn.s).toBeLessThanOrEqual(STREET_H + 1e-6);
    }
  });
  it('is a real push on a phone-sized stage', () => {
    const out = viewFor(412, 460, 1000, heightPx(1.73), 74, 0);
    const inn = viewFor(412, 460, 1000, heightPx(1.73), 74, 1);
    expect(inn.s / out.s).toBeGreaterThan(1.3);
  });
});
