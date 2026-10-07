// The street photograph and everything measured from it. World units are pixels
// of the packed street image (scenes/street.webp, 2048 x 869); x runs left to
// right along the shopfronts, y down from the top of the picture.
//
// Measured in generated/street-one/street-final.png (6336 x 2688), scaled to 2048 wide:
//   hotel glass door leaf      y 526 to 675 = 149 px
//   pharmacy door              y 529 to 675 = 146 px
//   a 2.1 m door is 147.5 px, so the shopfront plane is 70.2 px per metre.
//   the taxi (1.47 m tall) is 137 px, 93 px per metre, about 4 m nearer the camera:
//   the camera stands about 16 m back, so the middle of the pavement (1.3 m in
//   front of the doors) is 70.2 * 16.3 / 15 = 76 px per metre.
//   pavement: shop step y 690, kerb edge y 716; feet go on y 704. Road below 716.
// A 1.72 m adult is 131 px from crown to sole.

import type { PlaceId } from '../content/types';

export const STREET_W = 2048;
export const STREET_H = 869;
export const PX_PER_M = 76;
export const GROUND_Y = 704;
export const KERB_Y = 716;

/** Pixels tall for a person of `m` metres standing on the pavement. */
export const heightPx = (m: number) => m * PX_PER_M;

/** Where you can walk: up to the taxi rank's pole sign (x 1738); the parked taxi's rear bumper starts at x 1728, Ton stands by it. */
export const WALK_MIN = 60;
export const WALK_MAX = 1700;

/** Theo's shop (green, plants and jars). Not a place with tasks yet. */
export const THEO_SHOP = { x: 0.624, colour: '#9BE564', front: [1180, 455, 1376, 690] as Rect };

export type Rect = [number, number, number, number]; // x0, y0, x1, y1

/**
 * The sign each place's Thai words go on: the blank boards above the pharmacy,
 * bar, market and the shutter by the taxi; the hotel and the food stall have
 * none, so their words go on the wall above the canopy and awning. The small
 * sign (an item the place uses) goes on a surface in the shopfront.
 */
export const SIGN_BOARDS: Record<PlaceId, { main: Rect; sub: Rect }> = {
  hotel: { main: [196, 374, 380, 424], sub: [236, 444, 370, 470] },
  food: { main: [412, 376, 560, 422], sub: [474, 518, 612, 542] },
  pharmacy: { main: [679, 372, 889, 427], sub: [706, 496, 792, 518] },
  bar: { main: [935, 372, 1143, 427], sub: [948, 470, 1092, 494] },
  market: { main: [1437, 372, 1645, 427], sub: [1470, 488, 1600, 514] },
  taxi: { main: [1697, 372, 1896, 427], sub: [1717, 472, 1761, 536] },
};

/** The lit openings whose light colours the dots around them and their reflections in the road. */
export const SHOP_LIGHTS: { id: PlaceId | 'theo' | 'lamp'; rect: Rect; reach: number }[] = [
  { id: 'hotel', rect: [222, 470, 392, 682], reach: 46 },
  { id: 'food', rect: [400, 430, 655, 700], reach: 40 },
  { id: 'pharmacy', rect: [692, 450, 902, 690], reach: 44 },
  { id: 'bar', rect: [930, 440, 1150, 690], reach: 52 },
  { id: 'theo', rect: [1180, 456, 1376, 690], reach: 40 },
  { id: 'market', rect: [1382, 480, 1662, 702], reach: 40 },
  { id: 'taxi', rect: [1680, 600, 2048, 760], reach: 30 },
  { id: 'lamp', rect: [1740, 96, 1800, 124], reach: 90 },
];

// ---------- walking ----------

/**
 * Walking speed after easing: speed eases toward the wanted one (no instant
 * start or stop). `want` is -1..1 of full pace.
 */
export function easeSpeed(v: number, want: number, vmax: number, dt: number, rate = 5): number {
  return v + (want * vmax - v) * (1 - Math.exp(-dt * rate));
}

/** Wanted pace (-1..1) when walking to a point: full pace, slowing over the last stretch. */
export function paceTo(dx: number, slow = 70): number {
  if (Math.abs(dx) < 0.5) return 0;
  return Math.sign(dx) * Math.min(1, Math.sqrt(Math.abs(dx) / slow));
}

// ---------- camera ----------

/**
 * The view onto the street for a stage of w x h CSS px: scale (CSS px per world
 * px) and the world point at the stage's top-left. The street fills the stage;
 * on small stages it zooms in (cutting the sky) so a person stays at least
 * `minFig` px tall. The bottom of the picture (the wet road) stays in view.
 */
export function viewFor(w: number, h: number, centreX: number, figH = heightPx(1.72), minFig = 74, push = 0): { s: number; left: number; top: number } {
  const s0 = Math.max(h / STREET_H, w / STREET_W, minFig / figH);
  // the push-in (0..1, when you stop with someone): up to 1.6x, but never so far that a shop sign
  // leaves the top or the name labels under the kerb leave the bottom
  const e = push * push * (3 - 2 * push);
  const sFit = (h - LABELS_BELOW - SIGN_MARGIN) / (KERB_Y - SIGN_TOP);
  const s = s0 + (Math.max(s0, Math.min(s0 * 1.6, sFit)) - s0) * e;
  const vw = w / s;
  const vh = h / s;
  const left = Math.max(0, Math.min(STREET_W - vw, centreX - vw / 2));
  const bottom = Math.max(0, STREET_H - vh);
  // pushed in, the kerb sits just high enough for the labels: the empty road is what gets cropped
  const kerbed = Math.min(bottom, Math.max(0, KERB_Y - (h - LABELS_BELOW) / s));
  const top = bottom + (kerbed - bottom) * e;
  return { s, left, top };
}

/** The top of the highest sign board (world px), and the room the name labels need under the kerb (CSS px). */
export const SIGN_TOP = 368;
const SIGN_MARGIN = 12;
const LABELS_BELOW = 84;

/** World x under a stage x (CSS px). */
export const worldX = (stageX: number, view: { s: number; left: number }) => view.left + stageX / view.s;

// ---------- labels ----------

export interface LabelBox {
  /** centre and width on the stage, CSS px */
  x: number;
  w: number;
  prio: number;
}

/**
 * Which labels in a row show, and how strongly (0..1): none overlaps another
 * (keeping `gap` between them), none is cut by the stage edge (they fade out
 * as they near it), and where two would collide the higher priority wins.
 */
export function layoutLabels(items: LabelBox[], stageW: number, gap = 14, edge = 6): number[] {
  const out = items.map(() => 0);
  const order = items.map((_, i) => i).sort((a, b) => items[b].prio - items[a].prio || items[a].x - items[b].x);
  const taken: [number, number][] = [];
  for (const i of order) {
    const x0 = items[i].x - items[i].w / 2;
    const x1 = items[i].x + items[i].w / 2;
    const fade = Math.max(0, Math.min(1, Math.min(x0 - edge, stageW - edge - x1) / 14));
    if (fade <= 0) continue;
    if (taken.some(([a, b]) => x0 < b + gap && x1 > a - gap)) continue;
    taken.push([x0, x1]);
    out[i] = fade;
  }
  return out;
}

/** Smoothstep from a to b (either order): 0 at a, 1 at b, eased. */
export function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
