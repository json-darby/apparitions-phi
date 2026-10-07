// The street's people from their approved full-body photos: one atlas per
// person (packed by pipeline/pack_bodies.py into public/packs/bodies/). Frames
// run idle (0) .. RIFE in-betweens .. notice (8), then greet (9). All frames
// share one crop with the feet pinned, so the soles never move.
//
// Neighbouring frames normally cross-fade. A pair listed in "reform" is too
// different to interpolate (the greeting gesture): there the figure re-forms
// as an apparition instead, each dot leaving the old pose and joining the new
// one at its own moment (drawn by the street's figure shader).
//
// This module reads the index and holds each person's behaviour: how far into
// notice / greet they are (a float frame, eased by a critically damped spring,
// slower across a re-form), and the small idle life (a weight-shift sway and a
// breath) that fades out as soon as they start to turn.

import { smooth } from './geometry';

export interface BodyAtlas {
  image: string;
  /** tile size in px */
  tile: [number, number];
  cols: number;
  frames: number;
  keys: { idle: number; notice: number; greet: number };
  /** crown and soles (tile fractions, top-down) and the body's centre (fraction across), measured on idle */
  head: number;
  feet: number;
  centre: number;
  /** which way the notice and greet poses turn in the source picture */
  looks: 'right' | 'left';
  /** the same layout for another outfit (Fah's jacket when 18+ is off) */
  alt: Record<string, { image: string }>;
  /** joins between neighbouring frames that re-form instead of cross-fading: the lower frame of each pair */
  reform: number[];
}

export interface BodiesIndex {
  version: number;
  credit: string;
  people: Record<string, BodyAtlas>;
}

export const NO_BODIES: BodiesIndex = { version: 1, credit: '', people: {} };

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const path = (x: unknown) => (typeof x === 'string' && /^[\w./-]+\.webp$/i.test(x) && !x.includes('..') && !x.startsWith('/') ? x : null);
const frac = (x: unknown) => {
  const n = num(x);
  return n != null && n >= 0 && n <= 1 ? n : null;
};

/** Validate the index; a person with anything malformed is left out (and keeps the stand-in figure). */
export function parseBodies(json: unknown): BodiesIndex {
  if (!json || typeof json !== 'object') return NO_BODIES;
  const j = json as Record<string, unknown>;
  const out: BodiesIndex = { version: num(j.version) ?? 1, credit: typeof j.credit === 'string' ? j.credit : '', people: {} };
  for (const [who, raw] of Object.entries((j.people ?? {}) as Record<string, unknown>)) {
    if (!/^[a-z]+$/.test(who)) continue;
    const r = (raw ?? {}) as Record<string, unknown>;
    const image = path(r.image);
    const tile = Array.isArray(r.tile) && r.tile.length === 2 ? [num(r.tile[0]), num(r.tile[1])] : [null, null];
    const cols = num(r.cols);
    const frames = num(r.frames);
    const k = (r.keys ?? {}) as Record<string, unknown>;
    const keys = { idle: num(k.idle), notice: num(k.notice), greet: num(k.greet) };
    const head = frac(r.head);
    const feet = frac(r.feet);
    const centre = frac(r.centre);
    if (!image || !tile[0] || !tile[1] || tile[0] < 8 || tile[1] < 8 || !cols || !frames || cols < 1 || frames < 1) continue;
    if (keys.idle == null || keys.notice == null || keys.greet == null || head == null || feet == null || centre == null || feet - head < 0.3) continue;
    if (![keys.idle, keys.notice, keys.greet].every((f) => Number.isInteger(f) && f >= 0 && f < frames!)) continue;
    if (!(keys.idle! < keys.notice! && keys.notice! < keys.greet!)) continue;
    const reform: number[] = [];
    for (const pr of Array.isArray(r.reform) ? r.reform : []) {
      if (!Array.isArray(pr) || pr.length !== 2) continue;
      const a = num(pr[0]);
      const b = num(pr[1]);
      if (a == null || b == null || !Number.isInteger(a) || !Number.isInteger(b) || Math.abs(a - b) !== 1) continue;
      const lo = Math.min(a, b);
      if (lo >= 0 && lo + 1 < frames! && !reform.includes(lo)) reform.push(lo);
    }
    const alt: Record<string, { image: string }> = {};
    for (const [name, a] of Object.entries((r.alt ?? {}) as Record<string, unknown>)) {
      const im = path((a as Record<string, unknown> | null)?.image);
      if (im && /^[a-z]+$/.test(name)) alt[name] = { image: im };
    }
    out.people[who] = {
      image,
      tile: [tile[0], tile[1]],
      cols: Math.floor(cols),
      frames: Math.floor(frames),
      keys: { idle: keys.idle!, notice: keys.notice!, greet: keys.greet! },
      head,
      feet,
      centre,
      looks: r.looks === 'left' ? 'left' : 'right',
      alt,
      reform,
    };
  }
  return out;
}

/** Atlas region (u, v, w, h; rows top-down) of frame i, inset half a texel so the filter never reads a neighbour. */
export function atlasRect(a: Pick<BodyAtlas, 'tile' | 'cols' | 'frames'>, i: number): [number, number, number, number] {
  const n = Math.max(0, Math.min(a.frames - 1, Math.floor(i)));
  const rows = Math.ceil(a.frames / a.cols);
  const W = a.cols * a.tile[0];
  const H = rows * a.tile[1];
  const c = n % a.cols;
  const r = Math.floor(n / a.cols);
  return [(c * a.tile[0] + 0.5) / W, (r * a.tile[1] + 0.5) / H, (a.tile[0] - 1) / W, (a.tile[1] - 1) / H];
}

/**
 * Should a person be mirrored? Their notice and greet poses turn toward
 * `looks` in the source; mirror them once, for good, so that turn faces the
 * spot you stop at to talk to them.
 */
export function mirrorFor(looks: 'right' | 'left', personX: number, stopX: number): boolean {
  const toward = stopX - personX >= 0 ? 'right' : 'left';
  return toward !== looks;
}

/**
 * Which atlas to draw someone from. Fah's own photos are 18+: with 18+ off
 * only her jacket set will do, and without it she keeps the stand-in figure.
 */
export function atlasKey(who: string, a: Pick<BodyAtlas, 'alt'> | undefined, adult: boolean): string | null {
  if (!a) return null;
  if (who === 'fah' && !adult) return a.alt.jacket ? 'photo:fah-jacket' : null;
  return `photo:${who}`;
}

// ---------------------------------------------------------------- behaviour

export const FRAME_RATE_CAP = 14; // atlas frames per second, at most (RIFE in-betweens)
export const REFORM_SECONDS = 0.33; // one re-form join takes this long

export interface CastState {
  /** frame in the atlas, from the idle key through notice to greet; NaN until the first step */
  f: number;
  v: number;
  /** turned to you (used where the turn is a re-form, which has no half-way state) */
  turned: boolean;
  /** greeting: 'rise' toward greet, 'hold' there, then back to notice; null when not greeting */
  greet: null | { phase: 'rise' | 'hold' | 'back'; t: number };
  /** a greeting is available (re-armed when you leave their place) */
  armed: boolean;
}

export const newCast = (): CastState => ({ f: NaN, v: 0, turned: false, greet: null, armed: true });

export interface CastAtlas {
  keys: { idle: number; notice: number; greet: number };
  reform: readonly number[];
}

export interface CastSense {
  /** your x minus theirs, metres */
  dxM: number;
  /** the way their notice pose turns on screen: +1 right, -1 left */
  gaze: 1 | -1;
  /** you are at the place they serve (the stop that makes them greet) */
  atPlace: boolean;
  /** you are standing still */
  stopped: boolean;
  /** motion allowed (else frames still change, but ease plainly) */
  motion: boolean;
}

export const NOTICE_FAR = 3.5;
export const NOTICE_NEAR = 1.2;
export const BEHIND_NEAR = 0.6;
const GREET_HOLD = 1.4;

/** How much someone has noticed you (0..1): from 3.5 m to 1.2 m on the side they look toward; behind them only right beside. */
export function noticeWeight(dxM: number, gaze: 1 | -1): number {
  const d = Math.abs(dxM);
  if (d < 1e-6 || Math.sign(dxM) === gaze) return smooth(NOTICE_FAR, NOTICE_NEAR, d);
  return smooth(BEHIND_NEAR + 0.25, BEHIND_NEAR, d);
}

/** The frames-per-second limit for moving from f toward `dir` (+1 / -1): slower across a re-form join. */
export function frameCap(f: number, dir: number, reform: readonly number[]): number {
  const seg = dir > 0 ? Math.floor(f + 1e-6) : Math.ceil(f - 1e-6) - 1;
  return reform.includes(seg) ? 1 / REFORM_SECONDS : FRAME_RATE_CAP;
}

/** One frame of a person's behaviour; returns the same state, updated. */
export function stepCast(s: CastState, sense: CastSense, dt: number, atlas: CastAtlas): CastState {
  const keys = atlas.keys;
  if (!Number.isFinite(s.f)) s.f = keys.idle;
  let w = noticeWeight(sense.dxM, sense.gaze);
  // a turn made of in-betweens follows how near you are; a turn that re-forms has no half-way
  // pose, so it happens as a whole once you are clearly near (and undoes once clearly away)
  const turnReforms = atlas.reform.some((i) => i >= keys.idle && i < keys.notice);
  if (turnReforms) {
    s.turned = s.turned ? w > 0.35 : w > 0.65;
    w = s.turned ? 1 : 0;
  }
  if (!sense.atPlace) {
    s.armed = true;
    s.greet = null;
  } else if (sense.stopped && s.armed && !s.greet) {
    s.greet = { phase: 'rise', t: 0 };
    s.armed = false;
  }
  const span = keys.notice - keys.idle;
  let target = keys.idle + span * w;
  if (sense.atPlace && (sense.stopped || !s.armed)) target = keys.notice;
  const g = s.greet;
  if (g) {
    g.t += dt;
    if (g.phase === 'rise') {
      target = keys.greet;
      if (s.f >= keys.greet - 0.001) {
        g.phase = 'hold';
        g.t = 0;
      }
    } else if (g.phase === 'hold') {
      target = keys.greet;
      if (g.t >= GREET_HOLD) {
        g.phase = 'back';
        g.t = 0;
      }
    } else {
      target = keys.notice;
      if (Math.abs(s.f - keys.notice) < 0.02) s.greet = null;
    }
  }
  springTo(s, target, dt, sense.motion, 9, (f, dir) => frameCap(f, dir, atlas.reform));
  return s;
}

/**
 * Ease s.f toward a target: a critically damped spring (exact step, so no
 * overshoot from rest), never faster than the cap (frames a second; by default
 * FRAME_RATE_CAP, slower across re-form joins). Without motion: a plain
 * exponential ease, also capped.
 */
export function springTo(s: { f: number; v: number }, target: number, dt: number, motion: boolean, omega = 9, capAt: (f: number, dir: number) => number = () => FRAME_RATE_CAP) {
  let next: number;
  if (motion) {
    const c1 = s.f - target;
    const c2 = s.v + omega * c1;
    const e = Math.exp(-omega * dt);
    next = target + (c1 + c2 * dt) * e;
    s.v = (c2 - omega * (c1 + c2 * dt)) * e;
  } else {
    next = s.f + (target - s.f) * (1 - Math.exp(-dt * 7));
    s.v = 0;
  }
  // a slow join (a re-form) runs at its own steady pace, not the spring's ease
  const linear = capAt(s.f, Math.sign(target - s.f)) < FRAME_RATE_CAP;
  if (linear) next = target;
  // walk toward `next`, one frame join at a time, each at its own speed limit
  const dir = Math.sign(next - s.f);
  let f = s.f;
  let left = dt;
  let capped = false;
  for (let k = 0; k < 64 && dir !== 0 && left > 1e-9 && f !== next; k++) {
    const rate = capAt(f, dir);
    const edge = dir > 0 ? Math.floor(f + 1e-9) + 1 : Math.ceil(f - 1e-9) - 1;
    const free = f + dir * rate * left;
    const to = dir > 0 ? Math.min(next, edge, free) : Math.max(next, edge, free);
    left -= Math.abs(to - f) / rate;
    f = to;
    if (to === next) break; // reached where the spring wanted to be
    if (to === free) {
      capped = true; // out of time at the speed limit
      break;
    }
    // else: reached a frame join; carry on into the next one at its own limit
  }
  if (capped && motion) s.v = dir * capAt(f, dir);
  // arriving by a re-form leaves no momentum to carry past the pose
  if (linear && f === target) s.v = 0;
  s.f = f;
  if (Math.abs(target - s.f) < 0.003 && Math.abs(s.v) < 0.05) {
    s.f = target;
    s.v = 0;
  }
}

/** Idle life, in units of body height: a weight-shift sway (at the shoulders) and a breath (lift at the shoulders). */
export function idleLife(t: number, seed: number, f: number, idle = 0): { sway: number; breath: number } {
  const fade = 1 - smooth(0.1, 0.5, Math.abs(f - idle));
  if (fade <= 0) return { sway: 0, breath: 0 };
  const period = 5 + (seed % 997) / 997 * 2; // 5..7 s
  const ph = (t / period) * Math.PI * 2 + seed;
  const sway = 0.006 * (0.82 * Math.sin(ph) + 0.18 * Math.sin(2 * ph + 1.3));
  const breath = 0.004 * (0.5 + 0.5 * Math.sin((t / (3.6 + (seed % 7) * 0.1)) * Math.PI * 2 + seed * 0.37));
  return { sway: sway * fade, breath: breath * fade };
}

// ---------------------------------------------------------------- loading (browser only)

let indexP: Promise<BodiesIndex> | null = null;

const base = () => {
  try {
    return (import.meta.env?.BASE_URL as string | undefined) ?? './';
  } catch {
    return './';
  }
};
export const bodyUrl = (rel: string) => `${base()}packs/${rel}`;

export function loadBodies(): Promise<BodiesIndex> {
  if (indexP) return indexP;
  indexP = fetch(bodyUrl('bodies/index.json'), { cache: 'no-cache' })
    .then(async (r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? parseBodies(await r.json()) : NO_BODIES))
    .catch(() => NO_BODIES);
  return indexP;
}

export function loadAtlas(rel: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => (im.decode ? im.decode().then(() => res(im), () => res(im)) : res(im));
    im.onerror = () => {
      console.warn('Phi street bodies: could not load', rel);
      res(null);
    };
    im.src = bodyUrl(rel);
  });
}
