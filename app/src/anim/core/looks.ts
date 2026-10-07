// Code-drawn stand-ins for the cast: the numbers that shape each head in the
// SDF shader, and the expression targets. Real portraits from the image model
// replace these when a pack exists (see packs.ts). All people are original and
// AI-generated or code-drawn; none is based on a real person.

import { hashStr, lerp } from './math';

export type Expression = 'neutral' | 'smile' | 'puzzled' | 'sad' | 'closed' | 'turn';
export const EXPRESSIONS: Expression[] = ['neutral', 'smile', 'puzzled', 'sad', 'closed', 'turn'];

/** Hair styles understood by the head shader. */
export const HAIR = { crop: 0, short: 1, tied: 2, long: 3, bob: 4, quiff: 6 } as const;
/** Headwear: 0 none, 1 cap, 2 sunglasses pushed up. */
export const HEADWEAR = { none: 0, cap: 1, sunglasses: 2 } as const;
/** Necklines: 0 round tee, 1 polo, 2 uniform collar, 3 white coat, 4 open shirt, 5 apron, 6 linen collar. */
export const COLLAR = { tee: 0, polo: 1, uniform: 2, coat: 3, open: 4, apron: 5, linen: 6 } as const;

export interface FaceLook {
  /** headW, jawW, faceLen, cheek fullness */
  shape: [number, number, number, number];
  /** age 0..1, masculine 0..1, neck thickness, nose width */
  age: [number, number, number, number];
  /** style, volume, hair brightness, fringe */
  hair: [number, number, number, number];
  /** collar, headwear, cloth brightness, skin brightness */
  acc: [number, number, number, number];
  /** resting expression bias (smile) */
  rest: number;
  /** per-person head tilt so no two stand-ins sit alike */
  tilt: number;
}

export const LOOKS: Record<string, FaceLook> = {
  // Nok: food vendor, 50s, short practical hair, apron, warm and quick
  nok: { shape: [1.04, 1.06, 0.97, 1.0], age: [0.85, 0.1, 1.0, 1.12], hair: [HAIR.short, 1.07, 0.55, 0], acc: [COLLAR.apron, HEADWEAR.none, 0.7, 1.0], rest: 0.18, tilt: 0.04 },
  // Ton: taxi driver, 40s, polo, sunglasses pushed up, patient
  ton: { shape: [1.02, 1.12, 1.02, 0.85], age: [0.6, 0.95, 1.2, 1.15], hair: [HAIR.crop, 1.0, 0.45, 0], acc: [COLLAR.polo, HEADWEAR.sunglasses, 0.75, 0.95], rest: 0.0, tilt: -0.03 },
  // Ploy: hotel receptionist, 20s, neat uniform, hair tied back, precise
  ploy: { shape: [0.95, 0.9, 1.0, 0.95], age: [0.05, 0.0, 0.85, 0.92], hair: [HAIR.tied, 0.99, 0.5, 0], acc: [COLLAR.uniform, HEADWEAR.none, 0.85, 1.05], rest: 0.08, tilt: 0.0 },
  // Lek: market trader, 30s, cap, fast talker, teasing
  lek: { shape: [0.97, 1.04, 1.05, 0.8], age: [0.35, 0.9, 1.1, 1.05], hair: [HAIR.crop, 1.0, 0.45, 0], acc: [COLLAR.tee, HEADWEAR.cap, 0.7, 1.0], rest: 0.25, tilt: 0.06 },
  // Mai: pharmacist, 30s, white coat, long dark hair, calm
  mai: { shape: [0.96, 0.92, 1.03, 0.9], age: [0.3, 0.05, 0.9, 0.95], hair: [HAIR.long, 1.03, 0.35, 0], acc: [COLLAR.coat, HEADWEAR.none, 1.25, 1.05], rest: 0.04, tilt: -0.02 },
  // Bank: bar regular, late 20s, open shirt, easy laugh
  bank: { shape: [1.0, 1.08, 1.0, 0.9], age: [0.18, 1.0, 1.15, 1.08], hair: [HAIR.quiff, 1.0, 0.5, 0], acc: [COLLAR.open, HEADWEAR.none, 0.8, 1.0], rest: 0.3, tilt: 0.05 },
  // Fah: bar regular, late 20s, short bob, direct gaze, dry humour
  fah: { shape: [0.96, 0.9, 0.98, 0.92], age: [0.15, 0.0, 0.85, 0.95], hair: [HAIR.bob, 1.04, 0.5, 1], acc: [COLLAR.tee, HEADWEAR.none, 0.75, 1.05], rest: 0.0, tilt: -0.05 },
  theo: { shape: [1.0, 1.04, 1.0, 0.92], age: [0.18, 1.0, 1.1, 1.06], hair: [HAIR.tied, 1.1, 0.45, 0], acc: [COLLAR.open, HEADWEAR.none, 0.75, 0.8], rest: 0.25, tilt: 0.03 },
  // Pim: guide and narrator, 30s, linen shirt, unhurried
  pim: { shape: [0.97, 0.94, 1.02, 0.95], age: [0.3, 0.05, 0.9, 1.0], hair: [HAIR.long, 1.0, 0.55, 0], acc: [COLLAR.linen, HEADWEAR.none, 0.95, 1.05], rest: 0.12, tilt: 0.03 },
  // you: a plain head, no features of anyone in particular
  you: { shape: [0.98, 0.98, 1.0, 0.9], age: [0.2, 0.5, 1.0, 1.0], hair: [HAIR.crop, 1.0, 0.5, 0], acc: [COLLAR.tee, HEADWEAR.none, 0.75, 1.0], rest: 0.0, tilt: 0.0 },
};

/** Any id gets a look: cast ids use theirs, others a seeded variation of "you". */
export function lookFor(who: string | undefined): FaceLook {
  const k = (who ?? 'you').toLowerCase();
  if (LOOKS[k]) return LOOKS[k];
  const h = hashStr(k);
  const base = LOOKS.you;
  const styles = [HAIR.crop, HAIR.short, HAIR.long, HAIR.bob, HAIR.quiff, HAIR.tied];
  return {
    ...base,
    shape: [0.95 + h * 0.1, 0.9 + ((h * 7) % 1) * 0.2, 0.97 + ((h * 13) % 1) * 0.08, 0.9],
    hair: [styles[Math.floor(((h * 31) % 1) * styles.length)], 1.0, 0.5, 0],
    age: [((h * 17) % 1) * 0.6, (h * 3) % 1 > 0.5 ? 0.9 : 0.1, 1, 1],
  };
}

/** Expression parameters fed to the head shader. */
export interface ExprParams {
  smile: number; // -1 sad corners .. 1 smile
  lid: number; // 0 open .. 1 closed
  jaw: number; // mouth open
  browUp: number; // -1 frown .. 1 raised
  browAsym: number; // puzzled: one brow up, one down
  browSad: number; // inner brows up
  mouthShift: number; // sideways mouth
  squint: number; // lower lid up
  yaw: number; // head turn (radians)
  pitch: number; // head nod (radians, + = down)
  roll: number; // head tilt
}

export const NEUTRAL: ExprParams = { smile: 0, lid: 0, jaw: 0, browUp: 0, browAsym: 0, browSad: 0, mouthShift: 0, squint: 0, yaw: 0, pitch: 0, roll: 0 };

export const EXPR: Record<Expression, ExprParams> = {
  neutral: NEUTRAL,
  smile: { ...NEUTRAL, smile: 1, squint: 0.7, browUp: 0.25, jaw: 0.012, roll: 0.03 },
  puzzled: { ...NEUTRAL, smile: -0.1, browAsym: 1, mouthShift: 0.7, roll: 0.13, pitch: -0.03, squint: 0.3 },
  sad: { ...NEUTRAL, smile: -0.75, browSad: 1, lid: 0.32, pitch: 0.14, browUp: -0.1 },
  closed: { ...NEUTRAL, lid: 1, smile: 0.08, pitch: 0.04 },
  turn: { ...NEUTRAL, yaw: 0.68, pitch: -0.02 },
};

export function exprFor(e: Expression | undefined, look: FaceLook): ExprParams {
  const base = EXPR[e ?? 'neutral'] ?? NEUTRAL;
  if (!e || e === 'neutral' || e === 'turn') return { ...base, smile: base.smile + look.rest * 0.5 };
  return base;
}

export function mixExpr(a: ExprParams, b: ExprParams, k: number): ExprParams {
  const o = { ...a };
  for (const key of Object.keys(a) as (keyof ExprParams)[]) o[key] = lerp(a[key], b[key], k);
  return o;
}

export function exprDistance(a: ExprParams, b: ExprParams): number {
  let d = 0;
  for (const key of Object.keys(a) as (keyof ExprParams)[]) d = Math.max(d, Math.abs(a[key] - b[key]));
  return d;
}

/** The sequence each named frame sequence uses by default. */
export const SEQUENCE_WHO: Record<string, string> = { palm: 'fah', wai: 'ploy', handover: 'nok', glance: 'ton', walkaway: 'fah' };
