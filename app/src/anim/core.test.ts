import { describe, expect, it } from 'vitest';
import {
  allocateGrids,
  assignTransport,
  blinkAmount,
  constellationLayout,
  constellationLinks,
  DENSITY_DESKTOP,
  DENSITY_PHONE,
  findGlyphStart,
  finaleLayout,
  fitScale,
  glyphOrder,
  gridSize,
  hashStr,
  hexToRgb,
  QualityMonitor,
  samplePitch,
  springStep,
  voiceBand,
  voiceDuration,
} from './core/math';
import { EXPR, EXPRESSIONS, exprDistance, exprFor, LOOKS, lookFor, mixExpr, SEQUENCE_WHO } from './core/looks';
import { packEndFade, SEQ_INFO, seqAt, SEQUENCES, seqStep } from './core/timelines';
import { EMPTY_MANIFEST, objectKind, parseManifest, resolvePortrait, seqFrameRect } from './packs';
import { CAST } from '../content/seed';

describe('colour', () => {
  it('parses hex and falls back to blue', () => {
    expect(hexToRgb('#FFB03A')).toEqual([1, 176 / 255, 58 / 255]);
    expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
    expect(hexToRgb('rgb(255, 0, 0)')).toEqual([1, 0, 0]);
    expect(hexToRgb('nonsense')).toEqual([0.18, 0.61, 1]);
    expect(hexToRgb(undefined)).toEqual([0.18, 0.61, 1]);
  });
});

describe('voice tear', () => {
  it('samples a pitch curve linearly', () => {
    expect(samplePitch([0, 1], 0.5)).toBeCloseTo(0.5);
    expect(samplePitch([0.2], 0.9)).toBeCloseTo(0.2);
    expect(samplePitch([], 0.3)).toBe(0.5);
    expect(samplePitch(null, 0.3)).toBe(0.5);
  });
  it('a rising tone sweeps the band upward through the face', () => {
    const rising = Array.from({ length: 16 }, (_, i) => i / 15);
    const d = voiceDuration(rising);
    const ys = [0.15, 0.5, 0.85].map((f) => voiceBand(rising, f * d).y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(voiceBand(rising, d + 1).amp).toBe(0);
    const falling = rising.map((v) => 1 - v);
    expect(voiceBand(falling, 0.1 * d).y).toBeGreaterThan(voiceBand(falling, 0.9 * d).y);
  });
  it('longer words take longer', () => {
    expect(voiceDuration(new Array(48).fill(0.5))).toBeGreaterThan(voiceDuration(new Array(16).fill(0.5)));
  });
});

describe('density budget', () => {
  it('uses fewer dots on phones', () => {
    expect(gridSize(400, DENSITY_PHONE)).toBeLessThan(gridSize(400, DENSITY_DESKTOP));
  });
  it('clamps to the min and max', () => {
    expect(gridSize(10, DENSITY_DESKTOP)).toBe(DENSITY_DESKTOP.nMin);
    expect(gridSize(5000, DENSITY_DESKTOP)).toBe(DENSITY_DESKTOP.nMax);
  });
  it('shrinks everyone to fit the shared budget', () => {
    const many = Array.from({ length: 30 }, () => ({ side: 600, aspect: 1 }));
    const ns = allocateGrids(many, DENSITY_DESKTOP);
    const total = ns.reduce((s, n) => s + n * n, 0);
    expect(total).toBeLessThanOrEqual(DENSITY_DESKTOP.budget * 1.01);
    const one = allocateGrids([{ side: 600, aspect: 1 }], DENSITY_DESKTOP);
    expect(one[0]).toBe(gridSize(600, DENSITY_DESKTOP));
  });
});

describe('fit', () => {
  it('contain keeps a square subject inside wide and tall views', () => {
    const [sx, sy] = fitScale(2, 1, 'contain');
    expect(sx * 1).toBeLessThanOrEqual(1);
    expect(sy).toBe(1);
    const [tx, ty] = fitScale(0.5, 1, 'contain');
    expect(tx * 1).toBeLessThanOrEqual(1.0001);
    expect(ty).toBeLessThan(1);
  });
  it('cover fills a tall view with a wide scene', () => {
    const [sx] = fitScale(0.5, 1.6, 'cover');
    expect(1.6 * sx).toBeGreaterThanOrEqual(1);
  });
});

describe('weak device detection', () => {
  it('asks to drop quality when frames are slow', () => {
    const m = new QualityMonitor(30, 1000 / 24, 5);
    let drop = false;
    for (let i = 0; i < 40; i++) drop = m.push(60) || drop;
    expect(drop).toBe(true);
  });
  it('stays put at 60 fps and ignores long gaps', () => {
    const m = new QualityMonitor(30, 1000 / 24, 5);
    let drop = false;
    for (let i = 0; i < 100; i++) drop = m.push(i % 10 === 0 ? 900 : 16.7) || drop;
    expect(drop).toBe(false);
  });
});

describe('idle life', () => {
  it('blinks briefly and stays open most of the time', () => {
    let closed = 0;
    for (let t = 0; t < 30; t += 0.01) if (blinkAmount(t, 0.4) > 0.5) closed++;
    expect(closed).toBeGreaterThan(5);
    expect(closed).toBeLessThan(300);
  });
  it('settles the touch spring back to rest', () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 30; i++) springStep(s, 1, 1 / 60);
    expect(s.x).toBeGreaterThan(0.3);
    for (let i = 0; i < 240; i++) springStep(s, 0, 1 / 60);
    expect(Math.abs(s.x)).toBeLessThan(0.01);
  });
});

describe('layouts', () => {
  it('spreads constellation faces apart', () => {
    const pts = constellationLayout(6, 1.6, 0.3);
    expect(pts).toHaveLength(6);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(0.2);
    const links = constellationLinks(pts);
    expect(links.length).toBeGreaterThanOrEqual(5);
  });
  it('puts the whole cast in rows that fit', () => {
    for (const asp of [0.5, 1, 2.4]) {
      const lay = finaleLayout(8, asp);
      expect(lay).toHaveLength(8);
      for (const p of lay) {
        expect(Math.abs(p.x) + p.s * 0.8).toBeLessThanOrEqual(asp + 0.01);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('face to word transport', () => {
  it('pairs dots left-to-right and fades the extras', () => {
    const from = [-1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1];
    const to = [-0.5, 0, 0, 1, 0.5, 0, 0, 1];
    const { map, spare } = assignTransport(from, to, 4);
    expect(map[0]).toBe(0); // leftmost goes to leftmost
    expect([...map].filter((j) => j < 0)).toHaveLength(1);
    expect(spare).toHaveLength(0);
  });
  it('fades in destinations nobody reaches', () => {
    const { map, spare } = assignTransport([0, 0, 0, 1], [0, 0, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1], 4);
    expect(map[0]).toBeGreaterThanOrEqual(0);
    expect(spare).toHaveLength(2);
  });
});

describe('letter order', () => {
  // a ring (a Thai letter head) with a stem going right from it
  const w = 12;
  const h = 8;
  const mask = new Uint8Array(w * h);
  const set = (x: number, y: number) => (mask[y * w + x] = 1);
  for (let x = 1; x <= 4; x++) {
    set(x, 1);
    set(x, 4);
  }
  for (let y = 1; y <= 4; y++) {
    set(1, y);
    set(4, y);
  }
  for (let x = 5; x <= 10; x++) set(x, 4);
  it('starts from the loop (head)', () => {
    const s = findGlyphStart(mask, w, h);
    const sx = s % w;
    expect(sx).toBeLessThanOrEqual(4);
  });
  it('orders the stem after the head, ending at the far end', () => {
    const o = glyphOrder(mask, w, h);
    expect(o[4 * w + 10]).toBeCloseTo(1);
    expect(o[4 * w + 6]).toBeLessThan(o[4 * w + 9]);
    expect(o[0]).toBe(-1);
  });
});

describe('cast looks', () => {
  it('has a look for every cast member and adults only', () => {
    for (const c of CAST) {
      expect(LOOKS[c.id]).toBeDefined();
      expect(/\d0s|twenties|thirties|forties|fifties/.test(c.age + c.look)).toBe(true);
    }
  });
  it('gives unknown ids a stable stand-in', () => {
    expect(lookFor('stranger')).toEqual(lookFor('stranger'));
    expect(hashStr('a')).not.toBe(hashStr('b'));
  });
  it('blends expressions smoothly', () => {
    const half = mixExpr(EXPR.neutral, EXPR.smile, 0.5);
    expect(half.smile).toBeCloseTo(0.5);
    expect(exprDistance(EXPR.neutral, EXPR.smile)).toBeGreaterThan(0.5);
    for (const e of EXPRESSIONS) expect(exprFor(e, LOOKS.nok)).toBeDefined();
    expect(EXPR.turn.yaw).toBeGreaterThan(0.4);
    expect(EXPR.closed.lid).toBe(1);
  });
});

describe('sequences', () => {
  it('every sequence has a stand-in, a default person and a still frame', () => {
    for (const s of SEQUENCES) {
      expect(SEQ_INFO[s].keyFrame).toBeLessThan(SEQ_INFO[s].duration);
      expect(SEQUENCE_WHO[s]).toBeDefined();
      const { look } = seqAt(s, SEQ_INFO[s].keyFrame);
      expect(look.gat).toBe(1);
    }
  });
  it('palm: the handprint outlasts the face', () => {
    const late = seqAt('palm', 12.4).look;
    expect(late.dis).toBeGreaterThan(0.8);
    expect(late.keepMat).toBeGreaterThan(0.5);
    expect(seqAt('palm', 13.95).look.keepMat).toBeLessThan(0.05);
    expect(seqAt('palm', 9).pose.hand[7]).toBe(1);
  });
  it('walk-away breaks up into the dark', () => {
    expect(seqAt('walkaway', 7.4).look.dis).toBeGreaterThan(0.95);
    expect(seqAt('walkaway', 5).pose.walk[0]).toBeLessThan(0);
  });
  it('steps at about ten stills a second', () => {
    expect(seqStep(0.99, 10)).toBe(9);
    expect(seqStep(1.0, 10)).toBe(10);
  });
  it('packed clips fade out over the end', () => {
    expect(packEndFade(0, 8)).toBe(0);
    expect(packEndFade(8, 8)).toBeCloseTo(0.6);
    expect(packEndFade(8, 8, 0)).toBe(0);
  });
});

describe('pack manifest', () => {
  const good = {
    version: 1,
    credit: 'AI-generated (Gemini); depth by MiDaS',
    people: {
      nok: { expressions: { neutral: { image: 'nok/neutral.webp', depth: 'nok/neutral.depth.webp' }, smile: { image: 'nok/smile.webp', depth: 'nok/smile.depth.webp' } } },
      bad: { expressions: { neutral: { image: '../../etc/passwd', depth: 'x' } } },
      evil: { expressions: { neutral: { image: 'https://example.com/x.webp', depth: 'x.webp' } } },
    },
    sequences: {
      palm: { image: 'seq/palm.webp', depth: 'seq/palm.depth.webp', fps: 10, frames: 80, cols: 10, rows: 8, tile: [192, 192], linger: 'near' },
      broken: { image: 'seq/b.webp', depth: 'seq/b.depth.webp', fps: 10, frames: 90, cols: 10, rows: 8 },
    },
    objects: { dish: { image: 'objects/dish.webp', depth: 'objects/dish.depth.webp' } },
  };
  it('keeps valid entries and drops unsafe or broken ones', () => {
    const m = parseManifest(good);
    expect(Object.keys(m.people)).toEqual(['nok']);
    expect(m.people.nok.credit).toContain('AI-generated');
    expect(m.sequences.palm.linger).toBe('near');
    expect(m.sequences.broken).toBeUndefined();
    expect(m.objects.dish.size).toEqual([256, 256]);
    expect(parseManifest(null)).toEqual(EMPTY_MANIFEST);
    expect(parseManifest('x')).toEqual(EMPTY_MANIFEST);
  });
  it('falls back to neutral for a missing expression', () => {
    const m = parseManifest(good);
    expect(resolvePortrait(m, 'nok', 'sad')?.expr).toBe('neutral');
    expect(resolvePortrait(m, 'nok', 'smile')?.expr).toBe('smile');
    expect(resolvePortrait(m, 'ton', 'smile')).toBeNull();
  });
  it('finds frames in the atlas', () => {
    const s = { cols: 10, rows: 8, frames: 80 };
    expect(seqFrameRect(s, 0)).toEqual([0, 0, 0.1, 0.125]);
    expect(seqFrameRect(s, 11)).toEqual([0.1, 0.125, 0.1, 0.125]);
    expect(seqFrameRect(s, 500)).toEqual(seqFrameRect(s, 79));
  });
  it('maps free-text object names to stand-ins', () => {
    expect(objectKind('A plate of fried rice')).toBe('dish');
    expect(objectKind('A 100 baht note')).toBe('banknote');
    expect(objectKind('A glass of tube ice')).toBe('ice');
    expect(objectKind('A market stall')).toBe('stall');
    expect(objectKind('A tuk-tuk')).toBe('tuktuk');
    expect(objectKind('Temple roof')).toBe('temple');
    expect(objectKind('Lantern')).toBe('lantern');
  });
});
