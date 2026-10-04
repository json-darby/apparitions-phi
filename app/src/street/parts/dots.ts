// Pixi helpers for The Street: people as glowing dot figures that resolve as your
// reputation grows (Clearer as you learn), and a seeded random source. The
// portrait renderer (Phase 3) draws faces; on the street these stand-ins keep
// the same look: dots, glow, rows that tear when you barely know someone.

import { BlurFilter, Container, Graphics } from 'pixi.js';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Is (x, y) inside a standing figure of height h? y runs from -h (top) to 0 (feet). */
function inside(x: number, y: number, h: number, build: number): boolean {
  const u = h / 250;
  const ax = Math.abs(x) / u;
  const yy = (y + h) / u; // 0 at the top of the head
  if (yy < 0 || yy > 250) return false;
  // head
  const hx = x / u;
  const hy = yy - 24;
  if (hx * hx + hy * hy * 0.8 < 21 * 21) return true;
  // neck
  if (yy >= 42 && yy < 54) return ax < 8;
  // torso, shoulders to hips
  if (yy >= 54 && yy < 140) {
    const t = (yy - 54) / 86;
    const half = (34 - 9 * t) * build;
    if (ax < half) return true;
    // arms, hanging a little apart
    if (yy < 150 && ax >= half + 1 && ax < half + 10 - t * 2) return true;
    return false;
  }
  // arms past the hip
  if (yy >= 140 && yy < 152) return ax > 26 * build && ax < 34 * build;
  // legs
  if (yy >= 140) {
    const t = (yy - 140) / 110;
    return ax > 2 + t * 1 && ax < (17 - t * 6) * build;
  }
  return false;
}

export interface FigureOpts {
  colour: string;
  /** 0..1: faint and torn at 0, solid at 1 */
  clarity: number;
  seed: number;
  height?: number;
  build?: number;
}

/** A standing person drawn in dots with a soft glow. */
export function dotFigure({ colour, clarity, seed, height = 250, build = 1 }: FigureOpts): Container {
  const c = new Container();
  const r = rng(seed);
  const dots = new Graphics();
  const n = Math.round(380 + 620 * clarity);
  const rowShift = new Map<number, number>();
  const rowKeep = new Map<number, boolean>();
  let placed = 0;
  let guard = 0;
  while (placed < n && guard++ < n * 8) {
    const x = (r() - 0.5) * 96 * (height / 250) * build;
    const y = -r() * height;
    if (!inside(x, y, height, build)) continue;
    const row = Math.floor((y + height) / 7);
    if (!rowKeep.has(row)) {
      rowKeep.set(row, r() < 0.45 + clarity * 0.6);
      rowShift.set(row, (r() - 0.5) * (1 - clarity) * 34);
    }
    if (!rowKeep.get(row)) continue;
    const jitter = (1 - clarity) * 6;
    const px = x + rowShift.get(row)! + (r() - 0.5) * jitter;
    const py = y + (r() - 0.5) * jitter;
    const a = (0.25 + 0.75 * clarity) * (0.45 + r() * 0.55);
    dots.circle(px, py, 0.9 + r() * 1.3).fill({ color: colour, alpha: a });
    placed++;
  }
  const glow = dots.clone();
  glow.filters = [new BlurFilter({ strength: 9, quality: 2 })];
  glow.alpha = 0.55 + clarity * 0.35;
  glow.blendMode = 'add';
  const floor = new Graphics().ellipse(0, 2, 46 * build, 9).fill({ color: colour, alpha: 0.12 + clarity * 0.12 });
  floor.filters = [new BlurFilter({ strength: 6 })];
  c.addChild(floor, glow, dots);
  return c;
}
