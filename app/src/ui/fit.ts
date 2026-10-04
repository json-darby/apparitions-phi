// The pure part of FitText: find the largest font size, between a floor and a
// ceiling, at which some text still fits its box. The DOM measuring lives in
// FitText.tsx; this file only searches, so it can be tested without a browser.

export interface FitResult {
  /** the chosen font size in px */
  size: number;
  /** false when even the smallest size does not fit (the text then wraps anywhere) */
  fits: boolean;
  /** how many sizes were tried, for tests */
  tries: number;
}

/**
 * The largest size in [min, max], on a grid of `step` px, for which `fits`
 * says yes. `fits` must be monotonic: if a size fits, every smaller one does.
 * Tries the largest size first (most text fits at once), then the smallest,
 * then halves the range: never more than about log2((max - min) / step) + 2
 * calls, and never a loop.
 */
export function fitSize(fits: (px: number) => boolean, max: number, min: number, step = 0.5): FitResult {
  const hi0 = Math.max(min, max);
  const lo0 = Math.min(min, max);
  let tries = 1;
  if (fits(hi0)) return { size: hi0, fits: true, tries };
  if (hi0 === lo0) return { size: lo0, fits: false, tries };
  tries++;
  if (!fits(lo0)) return { size: lo0, fits: false, tries };
  // lo fits, hi does not: search the steps in between
  let lo = 0;
  let hi = Math.max(1, Math.round((hi0 - lo0) / step));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    tries++;
    if (fits(lo0 + mid * step)) lo = mid;
    else hi = mid;
  }
  return { size: round(lo0 + lo * step), fits: true, tries };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whether a fit must be redone: the text, the box or the ceiling changed. */
export function sameFit(a: FitKey | null, b: FitKey): boolean {
  return !!a && a.text === b.text && a.max === b.max && a.min === b.min && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}

export interface FitKey {
  text: string;
  w: number;
  h: number;
  max: number;
  min: number;
}
