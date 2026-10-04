// Pixi drawing for the dot look: glowing dots from a glyph list, Thai labels,
// and a font loader so Thai shapes correctly on canvas.

import { Container, Graphics, Text, type Application } from 'pixi.js';
import { THAI_FONT, UI_FONT } from '../shared/pixi';
import type { DotPt } from './dots-glyphs';

/**
 * Draw dots into a Graphics, centred on (0, 0), size = half-width in pixels.
 * glow adds a faint halo per dot (left off for reduced motion).
 */
export function drawDots(g: Graphics, dots: DotPt[], size: number, glow = true) {
  if (glow) {
    for (const d of dots) g.circle(d.x * size, d.y * size, Math.max(1.5, d.r * size * 2.6)).fill({ color: d.c, alpha: 0.09 * (d.a ?? 1) });
  }
  for (const d of dots) g.circle(d.x * size, d.y * size, Math.max(0.8, d.r * size)).fill({ color: d.c, alpha: d.a ?? 1 });
  return g;
}

export function dotGraphics(dots: DotPt[], size: number, glow = true): Graphics {
  const g = new Graphics();
  drawDots(g, dots, size, glow);
  if (glow) g.blendMode = 'add';
  return g;
}

/** A ring of dots, part-lit: used for patience rings and target rings. */
export function drawDotRing(g: Graphics, radius: number, frac: number, colour: number, dim = 0x3a3a3a, n = 40, r = 2.2) {
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const ang = -Math.PI / 2 + t * Math.PI * 2;
    const lit = t < frac;
    g.circle(Math.cos(ang) * radius, Math.sin(ang) * radius, lit ? r : r * 0.7).fill({ color: lit ? colour : dim, alpha: lit ? 1 : 0.7 });
  }
  return g;
}

export function thaiLabel(text: string, size = 18, colour = 0xf2f2f2, weight: '500' | '600' | '700' = '600'): Text {
  const t = new Text({
    text,
    style: { fontFamily: THAI_FONT, fontSize: size, fill: colour, fontWeight: weight, align: 'center', padding: 6 },
    resolution: Math.min(3, (window.devicePixelRatio || 1) * 1.5),
  });
  t.anchor.set(0.5);
  return t;
}

export function uiLabel(text: string, size = 11, colour = 0x8c8c8c, weight: '500' | '600' | '700' = '600', spacing = 1.6): Text {
  const t = new Text({
    text,
    style: { fontFamily: UI_FONT, fontSize: size, fill: colour, fontWeight: weight, letterSpacing: spacing, padding: 4 },
    resolution: Math.min(3, (window.devicePixelRatio || 1) * 1.5),
  });
  t.anchor.set(0.5);
  return t;
}

/** A pill behind a label, hairline border. */
export function pillBehind(label: Text, padX = 10, padY = 4, fill = 0x0c0c0c, stroke = 0xffffff, strokeAlpha = 0.34): Container {
  const c = new Container();
  const w = label.width + padX * 2;
  const h = label.height + padY * 2;
  const g = new Graphics().roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: fill, alpha: 0.9 }).stroke({ color: stroke, alpha: strokeAlpha, width: 1 });
  c.addChild(g, label);
  return c;
}

let fontsPromise: Promise<unknown> | null = null;
/** Make sure the Thai and UI fonts are loaded before Pixi measures text. */
export function loadGameFonts(): Promise<unknown> {
  if (!fontsPromise) {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fontsPromise = fonts
      ? Promise.all([
          fonts.load(`600 20px 'Noto Sans Thai Looped'`, 'กขค'),
          fonts.load(`500 20px 'Noto Sans Thai Looped'`, 'กขค'),
          fonts.load(`600 12px 'Inter Variable'`, 'A'),
        ]).catch(() => null)
      : Promise.resolve();
  }
  return fontsPromise;
}

/** Hex number to CSS colour. */
export const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Pixi's resizeTo only listens to window resizes. A drill's field also changes
 * size when the bar under it grows, so watch the element itself.
 */
export function followSize(app: Application, el: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver(() => app.resize());
  ro.observe(el);
  return () => ro.disconnect();
}
