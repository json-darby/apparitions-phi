import { describe, expect, it } from 'vitest';
import { fitSize, sameFit } from './fit';

/** A fake line of text: width grows with the size, wraps when too wide. */
const box = (chars: number, width: number, lines = 1, lh = 1.2, height = Infinity) => (px: number) => {
  const w = chars * px * 0.55;
  const need = Math.ceil(w / width);
  return need <= lines && need * px * lh <= height;
};

describe('fitSize', () => {
  it('keeps the largest size when the text already fits', () => {
    const r = fitSize(box(5, 300), 48, 16);
    expect(r).toEqual({ size: 48, fits: true, tries: 1 });
  });

  it('finds the largest size that fits, on the step grid', () => {
    const fits = (px: number) => px * 10 <= 300;
    const r = fitSize(fits, 48, 12, 0.5);
    expect(r.size).toBe(30);
    expect(r.fits).toBe(true);
  });

  it('never goes below the floor, and says when even that does not fit', () => {
    const r = fitSize(() => false, 40, 14);
    expect(r).toMatchObject({ size: 14, fits: false });
  });

  it('a long phrase shrinks; a short word does not', () => {
    const word = fitSize(box(6, 344), 50, 20);
    const phrase = fitSize(box(18, 344), 50, 20);
    expect(word.size).toBe(50);
    expect(phrase.size).toBeLessThan(50);
    expect(phrase.size).toBeGreaterThanOrEqual(20);
    expect(box(18, 344)(phrase.size)).toBe(true);
    expect(box(18, 344)(phrase.size + 0.5)).toBe(false);
  });

  it('uses a second line when that gives larger type than one squeezed line', () => {
    // a box two lines tall at 20px: 60 characters fit better as two lines of ~16px than one of ~10px
    const fits = box(60, 344, 2, 1.2, 2 * 20 * 1.2);
    const r = fitSize(fits, 20, 9);
    expect(r.size).toBeGreaterThan(14);
  });

  it('is bounded: about log2 of the steps, never a loop', () => {
    let calls = 0;
    const r = fitSize((px) => {
      calls++;
      return px <= 13.3;
    }, 200, 8, 0.5);
    expect(r.size).toBe(13);
    expect(calls).toBe(r.tries);
    expect(calls).toBeLessThanOrEqual(Math.ceil(Math.log2((200 - 8) / 0.5)) + 3);
  });

  it('copes with min above max', () => {
    expect(fitSize(() => true, 10, 20).size).toBe(20);
  });
});

describe('sameFit', () => {
  const k = { text: 'ไก่', w: 300, h: 60, max: 48, min: 16 };
  it('skips a refit when nothing changed', () => {
    expect(sameFit(k, { ...k })).toBe(true);
    expect(sameFit(k, { ...k, w: 300.2 })).toBe(true);
  });
  it('refits when the text, the box or the sizes change', () => {
    expect(sameFit(null, k)).toBe(false);
    expect(sameFit(k, { ...k, text: 'ไข่' })).toBe(false);
    expect(sameFit(k, { ...k, w: 280 })).toBe(false);
    expect(sameFit(k, { ...k, h: 80 })).toBe(false);
    expect(sameFit(k, { ...k, max: 40 })).toBe(false);
  });
});
