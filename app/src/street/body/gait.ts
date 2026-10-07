// Walking "you" along the street without sliding feet.
//
// The walk clip says how far the body travels for every bit of stride: the
// foot that bears weight sweeps backward under the hips, and the body moves
// forward by exactly that sweep (stride length x scale). So the position is
// driven by the phase (root motion) and the foot on the floor stays locked.
// progressTable() gives the same relation as a table (distance travelled at
// each phase), and phaseAtDistance() inverts it.
//
// Starting and stopping: each leg has its own stride amplitude (0 = standing).
// A leg's amplitude changes freely while that foot is in the air; while it
// bears weight it may only change in a way that carries the body forward, so a
// stop finishes on the next step with the feet together and nothing slides.

import { contactAt, footContactX, J, Pose, walkPose, type Frame3, type WalkClip, type WalkState } from './skeleton';

export interface GaitOut {
  /** forward travel this frame, body heights (never negative) */
  advance: number;
}

const FULL = 1;

/** Forward travel of the body between two poses: the weighted backward sweep of the feet bearing weight. */
export function travel(prev: Pose, next: Pose): number {
  const dR = footContactX(next, true) - footContactX(prev, true);
  const dL = footContactX(next, false) - footContactX(prev, false);
  const w = next.wR + next.wL;
  return w > 1e-6 ? -(next.wR * dR + next.wL * dL) / w : 0;
}

/** Distance travelled (body heights) from phase 0 at each of `n` phases over one full stride; [n] is the stride length. */
export function progressTable(clip: WalkClip, frame: Frame3, n = 256): Float64Array {
  const out = new Float64Array(n + 1);
  const a = new Pose();
  const b = new Pose();
  walkPose(clip, frame, { phase: 0, aR: FULL, aL: FULL, aU: FULL }, a);
  for (let i = 1; i <= n; i++) {
    walkPose(clip, frame, { phase: i / n, aR: FULL, aL: FULL, aU: FULL }, b);
    out[i] = out[i - 1] + Math.max(0, travel(a, b));
    a.p.set(b.p);
    a.wR = b.wR;
    a.wL = b.wL;
  }
  return out;
}

/** The phase (0..1, unwrapped: may exceed 1) at which the body has travelled `d` body heights. */
export function phaseAtDistance(table: Float64Array, d: number): number {
  const n = table.length - 1;
  const L = table[n];
  const cycles = Math.floor(d / L);
  const r = d - cycles * L;
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (table[m] <= r) lo = m;
    else hi = m;
  }
  const span = table[hi] - table[lo];
  const f = span > 1e-12 ? (r - table[lo]) / span : 0;
  return cycles + (lo + f) / n;
}

export class Gait {
  readonly s: WalkState = { phase: 0.02, aR: 0, aL: 0, aU: 0 };
  readonly pose = new Pose();
  private prev = new Pose();
  /** the clip's own pose (root motion is measured on this, before the feet are pinned) */
  private raw = new Pose();
  /** world x of the pelvis (px) */
  x: number;
  /** +1 walking right, -1 left */
  dir: 1 | -1 = 1;
  /** facing angle: 0 right, pi left; passes pi/2 (facing the viewer) while turning */
  theta = 0;
  private breathT = 0;
  // foot locks: where each planted foot's contact point is held (world px), and the correction applied
  private lock: [number | null, number | null] = [null, null];
  private corr: [number, number] = [0, 0];
  readonly stride: number;

  constructor(
    public clip: WalkClip,
    public frame: Frame3,
    x: number,
  ) {
    this.x = x;
    this.stride = progressTable(clip, frame)[256];
    walkPose(clip, frame, this.s, this.raw);
    this.pose.p.set(this.raw.p);
  }

  /** Standing still (all legs settled)? */
  get standing() {
    return this.s.aR < 0.02 && this.s.aL < 0.02;
  }

  /**
   * One frame. `want` is the wanted pace, -1..1 (sign = direction); `pxPerH` is
   * the person's height in world px. Returns how far the body moved (world px, signed).
   */
  update(dt: number, want: number, pxPerH: number, breathe = true): number {
    const s = this.s;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    if (!Number.isFinite(want)) want = 0;
    // turn round only from a stand; until then a reversal means stop
    const wdir = want > 0.02 ? 1 : want < -0.02 ? -1 : 0;
    if (wdir && wdir !== this.dir) {
      if (this.standing) this.dir = wdir as 1 | -1;
      want = 0;
    }
    const thT = this.dir > 0 ? 0 : Math.PI;
    this.theta += (thT - this.theta) * (1 - Math.exp(-dt * 9));
    if (Math.abs(thT - this.theta) > 0.3) want = 0;
    const m = Math.min(1, Math.abs(want));
    const target = m > 0.02 ? Math.max(0.45, Math.sqrt(m)) : 0;
    // cadence: steps lengthen and quicken together; finishing a stop runs at a calm pace
    let rate = 0;
    if (target > 0) rate = m / target / this.clip.period;
    else if (!this.standing) rate = 0.8 / this.clip.period;
    this.prev.p.set(this.raw.p);
    this.prev.wR = this.raw.wR;
    this.prev.wL = this.raw.wL;
    const old = { ...s };
    s.phase = (s.phase + rate * dt) % 1;
    const k = 1 - Math.exp(-dt * 5);
    const cR = contactAt(this.clip, s.phase);
    const cL = contactAt(this.clip, s.phase + 0.5);
    const step = (a: number) => a + (target - a) * k;
    // swinging legs change freely; a leg bearing weight only if that carries the body forward
    s.aR = cR < 0.5 ? step(s.aR) : s.aR;
    s.aL = cL < 0.5 ? step(s.aL) : s.aL;
    s.aU += ((s.aR + s.aL) / 2 - s.aU) * k;
    if (target === 0 && s.aR < 0.02 && s.aL < 0.02) {
      s.aR = s.aL = 0;
    }
    this.breathT += dt;
    const breath = breathe ? (0.5 + 0.5 * Math.sin((this.breathT * Math.PI * 2) / 4.2)) * (1 - s.aU) : 0;
    walkPose(this.clip, this.frame, s, this.raw, breath);
    // try the weight-bearing legs' amplitude change too
    const tryR = cR >= 0.5 && Math.abs(step(s.aR) - s.aR) > 1e-5;
    const tryL = cL >= 0.5 && Math.abs(step(s.aL) - s.aL) > 1e-5;
    let adv = travel(this.prev, this.raw);
    if (tryR || tryL) {
      const keepR = s.aR, keepL = s.aL;
      if (tryR) s.aR = step(s.aR);
      if (tryL) s.aL = step(s.aL);
      walkPose(this.clip, this.frame, s, this.raw, breath);
      const adv2 = travel(this.prev, this.raw);
      if (adv2 >= Math.min(adv, 0) - 1e-7 && adv2 >= -1e-7) adv = adv2;
      else {
        s.aR = keepR;
        s.aL = keepL;
        walkPose(this.clip, this.frame, s, this.raw, breath);
      }
    }
    if (rate === 0 && old.aR === 0 && old.aL === 0) adv = 0;
    const px = Math.max(0, adv) * pxPerH * this.dir;
    this.x += px;
    // the drawn pose: the clip's pose with each planted foot pinned
    this.pose.p.set(this.raw.p);
    this.pose.wR = this.raw.wR;
    this.pose.wL = this.raw.wL;
    this.pose.headPitch = this.raw.headPitch;
    this.lockFeet(dt, pxPerH);
    return px;
  }

  /**
   * Root motion keeps the weight-bearing foot still; where both feet bear weight
   * the clip's two feet do not agree exactly, so each planted foot is pinned to
   * where it landed and its leg bends to reach it (two-bone IK). A lifted foot
   * lets go of its pin smoothly, in the air where it cannot be seen to slide.
   */
  private lockFeet(dt: number, pxPerH: number) {
    const p = this.pose;
    for (const k of [0, 1] as const) {
      const right = k === 0;
      const w = right ? p.wR : p.wL;
      const world = this.x + this.dir * footContactX(p, right) * pxPerH;
      if (w > 0.6) {
        if (this.lock[k] == null) this.lock[k] = world - this.dir * this.corr[k] * pxPerH;
        this.corr[k] = Math.max(-0.05, Math.min(0.05, (this.lock[k]! - world) / (this.dir * pxPerH)));
      } else {
        this.lock[k] = null;
        this.corr[k] *= Math.exp(-dt * 10);
      }
      const c = this.corr[k];
      if (Math.abs(c) < 1e-6) continue;
      const j0 = right ? J.hipR : J.hipL;
      const P = p.p;
      for (const j of [j0 + 2, j0 + 3, j0 + 4]) P[j * 3] += c;
      // knee: two-bone IK in the leg's plane, bending forward
      const hx = P[j0 * 3], hy = P[j0 * 3 + 1];
      const ax = P[(j0 + 2) * 3], ay = P[(j0 + 2) * 3 + 1];
      const l1 = this.clip.len.thigh, l2 = this.clip.len.shin;
      const dx = ax - hx, dy = ay - hy;
      const d = Math.min(l1 + l2 - 1e-5, Math.max(Math.abs(l1 - l2) + 1e-5, Math.hypot(dx, dy)));
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
      // perpendicular pointing forward (+x) for a leg hanging down
      const px = -uy, py = ux;
      const sg = px >= 0 ? 1 : -1;
      P[(j0 + 1) * 3] = hx + ux * a + px * h * sg;
      P[(j0 + 1) * 3 + 1] = hy + uy * a + py * h * sg;
    }
  }

  /** The pelvis x in the body frame (the body is drawn centred on it). */
  get pelvisX() {
    return this.pose.p[J.pelvis * 3];
  }
}
