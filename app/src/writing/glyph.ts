// How a letter's font glyph sits in the 100 x 100 stroke box, and the one place
// the font is rendered to pixels (for the recogniser's fallback and the stroke
// tool's fit check). Nothing here touches the DOM at import time.
//
// The convention every stroke path is authored against:
//   <text x="50" y="74" font-size="90" text-anchor="middle"
//         font-family="Noto Sans Thai Looped" font-weight="500">ก</text>
// in an SVG with viewBox="0 0 100 100". A consonant body then spans roughly
// y 22 to 74 and x 25 to 72; ascenders (ป) reach about y 6.

import { ridgePoints, thin, type Pt } from './geometry';

export const GLYPH = {
  size: 100,
  x: 50,
  baseline: 74,
  fontSize: 90,
  weight: 500,
  family: 'Noto Sans Thai Looped',
  /** top of the consonant body (x-height), for guide lines */
  xHeight: 22.7,
} as const;

export const GLYPH_FONT = `${GLYPH.weight} ${GLYPH.fontSize}px "${GLYPH.family}"`;

/** Props for an SVG <text> that draws the glyph in the stroke box. */
export function glyphTextProps(): Record<string, string | number> {
  return {
    x: GLYPH.x,
    y: GLYPH.baseline,
    fontSize: GLYPH.fontSize,
    fontWeight: GLYPH.weight,
    fontFamily: `'${GLYPH.family}'`,
    textAnchor: 'middle',
  };
}

/** Ask the browser to load the font for these characters. Safe to call anywhere. */
export function warmGlyphFont(chars: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return document.fonts.load(GLYPH_FONT, chars).then(() => undefined, () => undefined);
}

function fontReady(char: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) return false;
  try {
    return document.fonts.check(GLYPH_FONT, char);
  } catch {
    return false;
  }
}

export interface GlyphMask {
  mask: Uint8Array;
  /** cells per side; one stroke-box unit is `res / 100` cells */
  res: number;
}

const maskCache = new Map<string, GlyphMask>();

/**
 * The glyph as a filled mask in the stroke box. Null outside a browser or
 * before the font has loaded (it then starts the load, so ask again later).
 */
export function rasteriseGlyph(char: string, res = 200): GlyphMask | null {
  const key = `${char}@${res}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  if (!fontReady(char)) {
    void warmGlyphFont(char);
    return null;
  }
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const k = res / GLYPH.size;
  ctx.scale(k, k);
  ctx.font = GLYPH_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  ctx.fillText(char, GLYPH.x, GLYPH.baseline);
  const data = ctx.getImageData(0, 0, res, res).data;
  const mask = new Uint8Array(res * res);
  let any = false;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    any ||= mask[i] === 1;
  }
  if (!any) return null;
  const out = { mask, res };
  maskCache.set(key, out);
  return out;
}

const ridgeCache = new Map<string, Pt[]>();

/**
 * An unordered centre-line point cloud for a glyph, in stroke-box units. Used
 * when a letter has no stroke paths yet.
 */
export function glyphCentreline(char: string): Pt[] | null {
  const hit = ridgeCache.get(char);
  if (hit) return hit;
  const g = rasteriseGlyph(char, 200);
  if (!g) return null;
  const k = GLYPH.size / g.res;
  const pts = thin(
    ridgePoints(g.mask, g.res, g.res, 2).map((p) => ({ x: p.x * k, y: p.y * k })),
    1.6,
  );
  if (pts.length < 4) return null;
  ridgeCache.set(char, pts);
  return pts;
}

/** Share of the points that fall inside the glyph (0..1), or null if the font is not ready. */
export function insideGlyph(char: string, pts: Pt[]): number | null {
  const g = rasteriseGlyph(char, 200);
  if (!g || !pts.length) return null;
  const k = g.res / GLYPH.size;
  let n = 0;
  for (const p of pts) {
    const x = Math.floor(p.x * k);
    const y = Math.floor(p.y * k);
    if (x >= 0 && y >= 0 && x < g.res && y < g.res && g.mask[y * g.res + x]) n++;
  }
  return n / pts.length;
}
