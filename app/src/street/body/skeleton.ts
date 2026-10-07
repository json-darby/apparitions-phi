// The skeleton the street's people are drawn from: a walk clip (joint angles
// tracked from the owner's reference videos, see walkData.ts) turned into 3D
// joint positions. Body frame, in body heights: x forward, y up from the
// floor, z to the body's left. The near side in the clips is the right side.

export type Channel = 'thigh' | 'shin' | 'foot' | 'uarm' | 'farm' | 'spine' | 'neck' | 'head' | 'hipdx' | 'shdx';

export interface WalkClip {
  /** samples per stride */
  phases: number;
  /** seconds per stride (two steps) at the clip's natural pace */
  period: number;
  gait_from: string;
  /** bone lengths, body heights */
  len: { thigh: number; shin: number; uarm: number; farm: number; spine: number; neck: number; nose: number };
  /** heel and toe relative to the ankle with the foot flat (x forward, y up) */
  heel: [number, number];
  toe: [number, number];
  stand: Record<Channel, number>;
  /** the near (right) side over one stride; the far side is the same half a stride later */
  walk: Record<Channel, number[]>;
  /** how much the near foot bears weight, per phase sample (0..1) */
  contact: number[];
}

// joint indices into Pose.p (x, y, z each)
export const J = {
  pelvis: 0, chest: 1, ear: 2,
  hipR: 3, kneeR: 4, ankleR: 5, heelR: 6, toeR: 7,
  hipL: 8, kneeL: 9, ankleL: 10, heelL: 11, toeL: 12,
  shR: 13, elR: 14, wrR: 15, handR: 16,
  shL: 17, elL: 18, wrL: 19, handL: 20,
} as const;
export const JOINTS = 21;

export class Pose {
  p = new Float32Array(JOINTS * 3);
  /** head pitch (down positive) and yaw (to the body's left positive), radians */
  headPitch = 0;
  headYaw = 0;
  /** upper body turn about the spine, radians (to the left positive) */
  torsoYaw = 0;
  /** weight on the right and left foot (0..1) */
  wR = 1;
  wL = 1;
  get(j: number): [number, number, number] {
    return [this.p[j * 3], this.p[j * 3 + 1], this.p[j * 3 + 2]];
  }
  set(j: number, x: number, y: number, z: number) {
    this.p[j * 3] = x;
    this.p[j * 3 + 1] = y;
    this.p[j * 3 + 2] = z;
  }
}

/** Periodic Catmull-Rom sample of a channel at phase 0..1. */
export function sample(a: ArrayLike<number>, phase: number): number {
  const n = a.length;
  const f = (((phase % 1) + 1) % 1) * n;
  const i = Math.floor(f);
  const t = f - i;
  const p0 = a[(i - 1 + n) % n], p1 = a[i % n], p2 = a[(i + 1) % n], p3 = a[(i + 2) % n];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Near-foot weight at a phase, linear (it has sharp edges at heel strike and toe off). */
export function contactAt(clip: WalkClip, phase: number): number {
  const a = clip.contact;
  const n = a.length;
  const f = (((phase % 1) + 1) % 1) * n;
  const i = Math.floor(f);
  return Math.max(0, Math.min(1, a[i % n] + (a[(i + 1) % n] - a[i % n]) * (f - i)));
}

/** Half widths of the skeleton (body heights). */
export interface Frame3 {
  hip: number;
  shoulder: number;
}
export const FRAME: Record<'m' | 'f', Frame3> = {
  m: { hip: 0.05, shoulder: 0.104 },
  f: { hip: 0.052, shoulder: 0.092 },
};

const HEAD_NEUTRAL = -0.34; // ear-to-nose angle of a level head in the clips

export interface WalkState {
  phase: number;
  /** how far each leg is into its stride (0 standing, 1 full stride) */
  aR: number;
  aL: number;
  /** arms, trunk and head */
  aU: number;
}

/**
 * The pose at a point of the walk, blended toward the standing pose per leg.
 * Feet are put on the floor: the pelvis height comes from whichever feet bear
 * weight. `breath` (0..1) lifts the chest a little.
 */
export function walkPose(clip: WalkClip, frame: Frame3, s: WalkState, out: Pose, breath = 0): Pose {
  const S = clip.stand;
  const W = clip.walk;
  const L = clip.len;
  const ang = (c: Channel, ph: number, a: number) => S[c] + a * (sample(W[c], ph) - S[c]);
  const hipdx = s.aU * sample(W.hipdx, s.phase);
  const shdx = s.aU * sample(W.shdx, s.phase);
  const hw = frame.hip;
  const lows: number[] = [];
  const legs: [number, number, number, number, number][] = [
    // side sign (+1 right/near), joint base, phase, amplitude, x offset of the hip
    [1, J.hipR, s.phase, s.aR, hipdx / 2],
    [-1, J.hipL, s.phase + 0.5, s.aL, -hipdx / 2],
  ];
  for (const [side, j0, ph, a, hx] of legs) {
    const z = -side * hw;
    const th = ang('thigh', ph, a);
    const sh = ang('shin', ph, a);
    const fo = ang('foot', ph, a);
    const kx = hx + L.thigh * Math.sin(th);
    const ky = -L.thigh * Math.cos(th);
    const ax = kx + L.shin * Math.sin(sh);
    const ay = ky - L.shin * Math.cos(sh);
    const c = Math.cos(fo), sn = Math.sin(fo);
    const hx2 = ax + clip.heel[0] * c - clip.heel[1] * sn, hy2 = ay + clip.heel[0] * sn + clip.heel[1] * c;
    const tx = ax + clip.toe[0] * c - clip.toe[1] * sn, ty = ay + clip.toe[0] * sn + clip.toe[1] * c;
    out.set(j0, hx, 0, z);
    out.set(j0 + 1, kx, ky, z * 0.86);
    out.set(j0 + 2, ax, ay, z * 0.8);
    out.set(j0 + 3, hx2, hy2, z * 0.8);
    out.set(j0 + 4, tx, ty, z * 0.8 - side * 0.012);
    lows.push(Math.min(hy2, ty));
  }
  // weight: the clip's contact for a leg in stride, full weight for a standing leg
  const cR = contactAt(clip, s.phase);
  const cL = contactAt(clip, s.phase + 0.5);
  out.wR = 1 - s.aR * (1 - cR);
  out.wL = 1 - s.aL * (1 - cL);
  const wsum = Math.max(1e-4, out.wR + out.wL);
  const py = -(out.wR * lows[0] + out.wL * lows[1]) / wsum;
  for (let j = J.hipR; j <= J.toeL; j++) out.p[j * 3 + 1] += py;
  out.set(J.pelvis, 0, py, 0);
  // trunk, neck and head
  const sp = ang('spine', s.phase, s.aU);
  const lift = breath * 0.0035;
  const cx = L.spine * Math.sin(sp);
  const cy = py + L.spine * Math.cos(sp) + lift;
  out.set(J.chest, cx, cy, 0);
  const nk = ang('neck', s.phase, s.aU);
  out.set(J.ear, cx + L.neck * Math.sin(nk), cy + L.neck * Math.cos(nk) - lift * 0.5, 0);
  out.headPitch = -(ang('head', s.phase, s.aU) - HEAD_NEUTRAL);
  // arms: the near arm at the stride's phase, the far one half a stride later
  const sw = frame.shoulder;
  const arms: [number, number, number, number][] = [
    [1, J.shR, s.phase, shdx / 2],
    [-1, J.shL, s.phase + 0.5, -shdx / 2],
  ];
  for (const [side, j0, ph, sx] of arms) {
    const z = -side * sw;
    const ua = ang('uarm', ph, s.aU);
    const fa = ang('farm', ph, s.aU);
    const shx = cx + sx, shy = cy - 0.012 + lift * 0.6;
    const ex = shx + L.uarm * Math.sin(ua), ey = shy - L.uarm * Math.cos(ua);
    const wx = ex + L.farm * Math.sin(fa), wy = ey - L.farm * Math.cos(fa);
    const ha = fa + 0.12;
    out.set(j0, shx, shy, z);
    out.set(j0 + 1, ex, ey, z * 1.12);
    out.set(j0 + 2, wx, wy, z * 1.05);
    out.set(j0 + 3, wx + 0.085 * Math.sin(ha), wy - 0.085 * Math.cos(ha), z * 1.02);
  }
  out.headYaw = 0;
  out.torsoYaw = 0;
  return out;
}

/** World x of a foot's ground contact (weighted toward whichever of heel and toe is lower), body frame. */
export function footContactX(p: Pose, right: boolean): number {
  const h = right ? J.heelR : J.heelL;
  const t = right ? J.toeR : J.toeL;
  const hy = p.p[h * 3 + 1], ty = p.p[t * 3 + 1];
  const lo = Math.min(hy, ty);
  const wh = Math.exp(-(hy - lo) / 0.006);
  const wt = Math.exp(-(ty - lo) / 0.006);
  return (wh * p.p[h * 3] + wt * p.p[t * 3]) / (wh + wt);
}
