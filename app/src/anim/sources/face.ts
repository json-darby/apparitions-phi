// Code-drawn faces: renders a cast member's head (SDF, raymarched) into a small
// offscreen texture only when its parameters change. The dot cloud samples it.

import { FACE_FS, FIGURE_FS, FULL_VS } from '../gl/glsl';
import type { Engine, GL, Prog, Target } from '../gl/engine';
import type { ExprParams, FaceLook } from '../core/looks';

export function setHeadUniforms(gl: GL, p: Prog, look: FaceLook, e: ExprParams, gaze: [number, number], torsoYaw?: number) {
  gl.uniform4f(p.u('uShape'), ...look.shape);
  gl.uniform4f(p.u('uAge'), ...look.age);
  gl.uniform4f(p.u('uHair'), ...look.hair);
  gl.uniform4f(p.u('uAcc'), ...look.acc);
  gl.uniform4f(p.u('uEx'), e.smile, e.lid, e.jaw, e.browUp);
  gl.uniform4f(p.u('uEx2'), e.browAsym, e.browSad, e.mouthShift, e.squint);
  gl.uniform4f(p.u('uPose'), e.yaw, e.pitch, e.roll + look.tilt, torsoYaw ?? e.yaw * 0.3);
  gl.uniform2f(p.u('uGaze'), gaze[0], gaze[1]);
}

/** Bust camera: zoom, centre y, depth far, depth range (matches demo 1 framing). */
export const BUST_CAM: [number, number, number, number] = [0.82, -0.12, 4.6, 2.2];
/** Cloud depth mapping for a bust render: z = (d - 0.4545) * 2.2 is the true depth. */
export const BUST_DEPTH: [number, number] = [0.4545, 1.7];

export function faceProg(eng: Engine) {
  return eng.program('face', FULL_VS, FACE_FS);
}
export function figureProg(eng: Engine) {
  return eng.program('figure', FULL_VS, FIGURE_FS);
}

function key(look: FaceLook, e: ExprParams, gaze: [number, number], res: number, extra: string) {
  const r = (x: number) => Math.round(x * 400);
  return [res, look.shape, look.age, look.hair, look.acc, look.tilt, r(e.smile), r(e.lid), r(e.jaw), r(e.browUp), r(e.browAsym), r(e.browSad), r(e.mouthShift), r(e.squint), r(e.yaw), r(e.pitch), r(e.roll), r(gaze[0]), r(gaze[1]), extra].join('|');
}

/** One face, re-rendered only when something about it changes. */
export class FaceRenderer {
  tgt: Target | null = null;
  private last = '';

  render(eng: Engine, res: number, look: FaceLook, e: ExprParams, gaze: [number, number] = [0, 0], cam = BUST_CAM, fade: [number, number] = [-2.1, -0.95]): Target {
    const gl = eng.gl;
    const k = key(look, e, gaze, res, cam.join(',') + fade.join(','));
    const tgt = eng.target(res, res, this.tgt);
    if (tgt !== this.tgt) this.last = '';
    this.tgt = tgt;
    if (k === this.last) return tgt;
    this.last = k;
    eng.renderSource(faceProg(eng), tgt, (p) => {
      setHeadUniforms(gl, p, look, e, gaze);
      gl.uniform4f(p.u('uCam'), cam[0], cam[1], cam[2], cam[3]);
      gl.uniform2f(p.u('uFade'), fade[0], fade[1]);
    });
    return tgt;
  }

  free(eng: Engine | null) {
    eng?.freeTarget(this.tgt);
    this.tgt = null;
    this.last = '';
  }
  lost() {
    this.tgt = null;
    this.last = '';
  }
}

/** Texture size for a face drawn with n dots across. */
export function faceRes(n: number): number {
  return Math.max(96, Math.min(224, Math.ceil((n * 1.15) / 16) * 16));
}
