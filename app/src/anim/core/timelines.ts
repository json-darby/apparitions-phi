// Timelines for the five frame sequences when no clip pack exists. Pure: given a
// time in seconds, return the pose and the dot treatment. The figure shader
// draws the pose; frames are stepped at ~10 a second with the last one ghosted.

import { clamp, lerp, smooth } from './math';
import { EXPR, NEUTRAL, mixExpr, type ExprParams } from './looks';

export type SequenceName = 'palm' | 'wai' | 'handover' | 'glance' | 'walkaway';
export const SEQUENCES: SequenceName[] = ['palm', 'wai', 'handover', 'glance', 'walkaway'];

export interface SeqPose {
  expr: ExprParams;
  torsoYaw: number;
  /** whole-body bow (radians) */
  lean: number;
  /** hand: x, y, z, pitch, yaw, scale, flatten, visible */
  hand: [number, number, number, number, number, number, number, number];
  /** wai: hands rise 0..1; handover: reach 0..1 */
  arm: number;
  /** walk: z offset, stride phase, body yaw, visible */
  walk: [number, number, number, number];
  /** camera: zoom, centre y, depth far, depth range */
  cam: [number, number, number, number];
}

export interface SeqLook {
  /** dissolve 0..1 */
  dis: number;
  /** gather in 0..1 (1 = formed) */
  gat: number;
  tear: number;
  ghost: number;
  bright: number;
  /** how much the hand outlasts the rest when dissolving */
  keepMat: number;
}

export interface SeqInfo {
  duration: number;
  /** a frame that reads as the whole moment, for the still fallback */
  keyFrame: number;
  fps: number;
  label: string;
}

export const SEQ_INFO: Record<SequenceName, SeqInfo> = {
  palm: { duration: 14, keyFrame: 9.2, fps: 10, label: 'Palm on the glass' },
  wai: { duration: 6.5, keyFrame: 3.1, fps: 10, label: 'Wai' },
  handover: { duration: 6.5, keyFrame: 3.6, fps: 10, label: 'Hand-over' },
  glance: { duration: 7, keyFrame: 3.6, fps: 10, label: "Driver's glance" },
  walkaway: { duration: 7.5, keyFrame: 2.8, fps: 10, label: 'Walk-away' },
};

const BUST_CAM: SeqPose['cam'] = [0.95, -0.55, 4.6, 2.6];
const NO_HAND: SeqPose['hand'] = [0, -6, 0, 0, 0, 1, 0, 0];
const NO_WALK: SeqPose['walk'] = [0, 0, 0, 0];

/** Pose and look of a procedural sequence at time t (seconds). */
export function seqAt(name: SequenceName, t: number): { pose: SeqPose; look: SeqLook } {
  const pose: SeqPose = { expr: { ...NEUTRAL }, torsoYaw: 0, lean: 0, hand: [...NO_HAND], arm: 0, walk: [...NO_WALK], cam: [...BUST_CAM] };
  const look: SeqLook = { dis: 0, gat: 1, tear: 0.12, ghost: 0.45, bright: 1, keepMat: 0 };
  look.gat = smooth(0, 1.6, t);
  switch (name) {
    case 'palm': {
      // she looks at you, her face falls, she raises her palm to the glass,
      // then fades, the handprint last
      const fall = smooth(3.2, 5.0, t);
      pose.expr = mixExpr(EXPR.neutral, EXPR.sad, fall);
      pose.expr.pitch *= 0.5;
      const rise = smooth(5.4, 8.2, t);
      const press = smooth(8.2, 8.9, t);
      pose.hand = [lerp(-0.95, -0.32, rise), lerp(-3.4, -0.55, rise), lerp(0.4, 0.95, rise) + press * 0.3, lerp(-0.6, 0, rise), lerp(0.5, 0.05, rise), 1.0, press, rise > 0.001 ? 1 : 0];
      pose.cam = [0.86, -0.3, 4.6, 2.6];
      pose.expr.yaw = 0.03 * Math.sin(t * 0.5) * (1 - press);
      look.tear = 0.1 + 0.35 * press * (1 - smooth(8.9, 9.8, t)) + 0.4 * smooth(10, 12, t);
      look.dis = smooth(9.8, 12.6, t);
      look.keepMat = 1 - smooth(12.2, 13.8, t);
      look.bright = 1 - 0.25 * press;
      break;
    }
    case 'wai': {
      const up = smooth(0.8, 2.0, t);
      const bow = smooth(2.1, 2.7, t) * (1 - smooth(3.6, 4.4, t));
      pose.arm = up;
      pose.lean = bow * 0.22;
      pose.expr = mixExpr(EXPR.neutral, EXPR.smile, smooth(3.8, 4.6, t) * 0.8);
      pose.expr.pitch = bow * 0.35;
      pose.expr.lid = bow * 0.55;
      pose.cam = [1.05, -0.75, 4.6, 2.8];
      look.dis = 0;
      look.tear = 0.1;
      break;
    }
    case 'handover': {
      const reach = smooth(1.2, 3.0, t);
      const back = smooth(4.4, 5.6, t);
      pose.arm = reach;
      pose.expr = mixExpr(EXPR.neutral, EXPR.smile, smooth(2.6, 3.4, t));
      pose.expr.pitch = -0.04 * reach;
      pose.expr.jaw = 0.02 * Math.max(0, Math.sin(t * 9)) * smooth(2.8, 3.0, t) * (1 - smooth(3.8, 4.0, t));
      // the bag travels toward the glass, then is taken (fades)
      pose.hand = [lerp(0.55, 0.18, reach), lerp(-2.25, -1.05, reach), lerp(0.55, 2.05, reach), 0, 0, 1, 0, 1];
      look.dis = 0;
      look.keepMat = 0;
      look.tear = 0.1 + 0.25 * back;
      if (back > 0) {
        // the bag leaves the frame toward you, everything else stays
        pose.hand[2] += back * 1.6;
        pose.hand[7] = 1 - smooth(5.0, 5.6, t);
      }
      break;
    }
    case 'glance': {
      // from the back seat: he looks back over his shoulder, speaks, turns away
      const turn = smooth(1.4, 2.6, t) * (1 - smooth(5.0, 6.0, t));
      pose.torsoYaw = Math.PI;
      pose.expr = { ...NEUTRAL, yaw: Math.PI - turn * 2.05, pitch: -0.05 * turn, roll: 0.06 * turn };
      pose.expr.smile = 0.25 * smooth(3.0, 3.5, t);
      pose.expr.jaw = 0.025 * Math.max(0, Math.sin(t * 10)) * smooth(3.0, 3.2, t) * (1 - smooth(4.4, 4.6, t));
      pose.cam = [0.95, -0.4, 4.7, 2.8];
      look.tear = 0.12;
      break;
    }
    case 'walkaway': {
      const turn = smooth(1.2, 2.4, t);
      const walk = clamp((t - 2.4) / 5);
      pose.walk = [-walk * 7.5, (t - 2.4) * 6.2 * (walk > 0 ? 1 : 0), turn * Math.PI, 1];
      pose.expr = mixExpr(EXPR.neutral, EXPR.sad, smooth(0.3, 1.0, t) * 0.7);
      pose.cam = [0.62, 0.55, 12, 9];
      look.dis = smooth(3.4, 7.2, t);
      look.tear = 0.15 + 0.5 * smooth(3, 7, t);
      look.bright = 1 - 0.3 * walk;
      break;
    }
  }
  return { pose, look };
}

/** Frame step for a time: sequences step at their fps (stop-motion). */
export function seqStep(t: number, fps = 10): number {
  return Math.floor(t * fps);
}

/** For packed clips: dissolve over the last part of the clip (demo 4's end fade). */
export function packEndFade(t: number, duration: number, amount = 0.6): number {
  if (amount <= 0 || duration <= 0) return 0;
  const p = t / duration;
  const s0 = 1 - 0.3 * amount - 0.05;
  const d = clamp((p - s0) / (1 - s0));
  return d * d * (3 - 2 * d) * amount;
}
