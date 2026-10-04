import { describe, expect, it } from 'vitest';
import { SEED_LETTERS } from '../content/seed';
import type { Letter } from '../content/types';
import { polyLength, resample, ridgePoints, samplePath, simplify, smoothPath, splitByLength, strokePoints, type Pt } from './geometry';
import { compareInk, handwritingDetail, handwritingScore, modelFromCloud, recognise, type Ink } from './recognise';
import { draftParts, draftStrokes, resolveStrokes } from './strokes';

// deterministic noise
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Ink as a learner might produce it: the model path, wobbled, scaled and moved, with a timestamp. */
function inkFor(letter: Letter, o: { scale?: number; dx?: number; dy?: number; noise?: number; seed?: number; reverse?: boolean } = {}): Ink {
  const { scale = 1, dx = 0, dy = 0, noise = 0, seed = 1, reverse = false } = o;
  const r = rng(seed);
  const strokes = resolveStrokes(letter)!;
  const ink = strokes.map((s) => resample(strokePoints(s.d), 80).map((p, i) => ({
    x: (p.x + (r() - 0.5) * 2 * noise) * scale + dx,
    y: (p.y + (r() - 0.5) * 2 * noise) * scale + dy,
    t: i * 16,
  })));
  return reverse ? ink.map((s) => [...s].reverse()).reverse() : ink;
}

const byId = (id: string) => SEED_LETTERS.find((l) => l.id === id)!;

describe('geometry', () => {
  it('samples absolute and relative path commands', () => {
    const a = samplePath('M0 0 L10 0 L10 10');
    const b = samplePath('m0 0 l10 0 l0 10');
    expect(a[0].at(-1)).toEqual({ x: 10, y: 10 });
    expect(b[0].at(-1)).toEqual({ x: 10, y: 10 });
    const h = samplePath('M0 0 H5 V5 h5 v5');
    expect(h[0].at(-1)).toEqual({ x: 10, y: 10 });
    const c = samplePath('M0 0 C0 10 10 10 10 0');
    expect(c[0][0]).toEqual({ x: 0, y: 0 });
    expect(c[0].at(-1)!.x).toBeCloseTo(10);
    // the curve bulges to y = 7.5 at its middle
    expect(Math.max(...c[0].map((p) => p.y))).toBeCloseTo(7.5, 1);
    expect(samplePath('M0 0 L1 1 M5 5 L6 6')).toHaveLength(2);
  });

  it('resamples evenly by arc length', () => {
    const r = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 5);
    expect(r).toHaveLength(5);
    expect(r[2].x).toBeCloseTo(10);
    expect(r[2].y).toBeCloseTo(0);
    expect(r[4]).toEqual({ x: 10, y: 10 });
    expect(polyLength(r)).toBeCloseTo(20);
  });

  it('simplifies a straight run to its ends and smooths back to a path', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0.01 * (i % 2) }));
    expect(simplify(line, 0.5)).toHaveLength(2);
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }]);
    expect(d.startsWith('M0 0')).toBe(true);
    expect(strokePoints(d).at(-1)).toEqual({ x: 20, y: 0 });
  });

  it('splits a stroke by length', () => {
    const parts = splitByLength([{ x: 0, y: 0 }, { x: 10, y: 0 }], [0.3, 0.7]);
    expect(parts).toHaveLength(3);
    expect(parts[0].at(-1)!.x).toBeCloseTo(3);
    expect(parts[2][0].x).toBeCloseTo(7);
  });

  it('finds the centre line of a thick ring', () => {
    const w = 60;
    const mask = new Uint8Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot(x + 0.5 - 30, y + 0.5 - 30);
      if (r >= 15 && r <= 23) mask[y * w + x] = 1;
    }
    const ridge = ridgePoints(mask, w, w, 1.5);
    expect(ridge.length).toBeGreaterThan(40);
    const radii = ridge.map((p) => Math.hypot(p.x - 30, p.y - 30));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    expect(mean).toBeGreaterThan(17.5);
    expect(mean).toBeLessThan(20.5);
  });
});

describe('draft strokes', () => {
  it('exist for all 10 seed letters, start with M and stay in the box', () => {
    for (const l of SEED_LETTERS) {
      const s = draftStrokes(l);
      expect(s, l.char).not.toBeNull();
      for (const st of s!) {
        expect(st.d).toMatch(/^M/);
        for (const p of strokePoints(st.d)) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(100);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('parts join end to start', () => {
    for (const l of SEED_LETTERS) {
      const parts = draftParts(l)!;
      for (let i = 1; i < parts.length; i++) {
        const end = strokePoints(parts[i - 1].d).at(-1)!;
        const start = strokePoints(parts[i].d)[0];
        expect(Math.hypot(end.x - start.x, end.y - start.y), `${l.char} part ${i}`).toBeLessThan(0.01);
      }
    }
  });
});

describe('recognise', () => {
  it('puts the right letter first for clean ink at any size and place', () => {
    for (const l of SEED_LETTERS) {
      const ink = inkFor(l, { scale: 3.2, dx: 40, dy: -25 });
      const top = recognise(ink, SEED_LETTERS)[0];
      expect(top.id, l.char).toBe(l.id);
      expect(top.score).toBeGreaterThan(0.9);
    }
  });

  it('puts the right letter first for wobbly ink', () => {
    let ok = 0;
    for (const l of SEED_LETTERS) {
      for (let seed = 1; seed <= 5; seed++) {
        const ink = inkFor(l, { noise: 1.6, seed, scale: 2 });
        if (recognise(ink, SEED_LETTERS)[0].id === l.id) ok++;
      }
    }
    // 50 attempts, look-alike pairs included (ด ต, บ ป, น ม)
    expect(ok).toBeGreaterThanOrEqual(48);
  });

  it('tells the look-alikes apart', () => {
    for (const [a, b] of [['l-bor', 'l-bpor'], ['l-dor', 'l-dtor'], ['l-nor', 'l-mor']]) {
      const ink = inkFor(byId(a), { noise: 1, seed: 7 });
      const r = recognise(ink, [byId(a), byId(b)]);
      expect(r[0].id).toBe(a);
      expect(r[0].score - r[1].score).toBeGreaterThan(0.03);
    }
  });

  it('still recognises a letter written backwards', () => {
    for (const l of SEED_LETTERS) {
      const ink = inkFor(l, { reverse: true });
      expect(recognise(ink, SEED_LETTERS)[0].id, l.char).toBe(l.id);
    }
  });

  it('returns zero for empty ink and is fast', () => {
    expect(recognise([], SEED_LETTERS).every((m) => m.score === 0)).toBe(true);
    const ink = inkFor(byId('l-gor'), { noise: 1 });
    recognise(ink, SEED_LETTERS);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) recognise(ink, SEED_LETTERS);
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});

describe('handwritingScore', () => {
  const gor = byId('l-gor');
  const bor = byId('l-bor');

  it('scores a faithful copy high', () => {
    expect(handwritingScore(inkFor(gor), gor)).toBeGreaterThan(0.95);
    expect(handwritingScore(inkFor(bor, { noise: 1.2, scale: 1.5 }), bor)).toBeGreaterThan(0.8);
  });

  it('marks down a reversed direction and says why', () => {
    const d = handwritingDetail(inkFor(bor, { reverse: true }), bor);
    expect(d.directionOk).toBe(false);
    expect(d.startOk).toBe(false);
    expect(d.score).toBeLessThan(0.6);
    expect(d.shape).toBeGreaterThan(0.9);
  });

  it('marks down a different letter and a scribble', () => {
    const wrong = handwritingScore(inkFor(byId('l-ngor')), bor);
    expect(wrong).toBeLessThan(0.5);
    const r = rng(3);
    const scribble: Ink = [Array.from({ length: 40 }, () => ({ x: r() * 100, y: r() * 100 }))];
    expect(handwritingScore(scribble, bor)).toBeLessThan(0.3);
  });

  it('counts position when tracing, not when writing freely', () => {
    const moved = inkFor(bor, { dx: 18 });
    expect(handwritingScore(moved, bor)).toBeGreaterThan(0.95);
    expect(handwritingScore(moved, bor, { inPlace: true })).toBeLessThan(0.5);
    expect(handwritingScore(inkFor(bor), bor, { inPlace: true })).toBeGreaterThan(0.95);
  });

  it('uses supplied strokes over the draft', () => {
    const line = [{ d: 'M20 50 L80 50' }];
    const ink: Ink = [[{ x: 20, y: 50 }, { x: 80, y: 50 }]];
    expect(handwritingScore(ink, bor, { strokes: line })).toBeGreaterThan(0.95);
    expect(handwritingScore(ink, bor)).toBeLessThan(0.4);
  });

  it('falls back to a shape-only score against a centre-line cloud', () => {
    const ring: Pt[] = Array.from({ length: 60 }, (_, i) => ({ x: 50 + 20 * Math.cos((i / 60) * 2 * Math.PI), y: 50 + 20 * Math.sin((i / 60) * 2 * Math.PI) }));
    const model = modelFromCloud(ring);
    const circle: Ink = [Array.from({ length: 50 }, (_, i) => ({ x: 10 + 5 * Math.cos((i / 49) * 2 * Math.PI), y: 10 + 5 * Math.sin((i / 49) * 2 * Math.PI) }))];
    const line: Ink = [[{ x: 0, y: 0 }, { x: 10, y: 10 }]];
    const good = compareInk(circle, model);
    expect(good.basis).toBe('font');
    expect(good.start).toBeNull();
    expect(good.score).toBeGreaterThan(0.8);
    expect(compareInk(line, model).score).toBeLessThan(0.3);
  });

  it('gives nothing for a single dot', () => {
    expect(handwritingScore([[{ x: 5, y: 5 }]], bor)).toBe(0);
  });
});
