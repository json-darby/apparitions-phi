// A posed skeleton drawn as a human body: rounded volumes (tapered limbs,
// ellipsoids for the pelvis, belly, ribcage, head and jaw, hands and feet),
// rendered by ray casting into a small grey + alpha image with a depth buffer.
// The street's dot renderer turns that image into dots exactly as it does for
// every figure, so the body sits in the street like the rest of the cast.
// Brightness: lit from above and from the viewer, the far side of the body
// dimmer, edges darker so overlapping limbs read.

import { J, Pose } from './skeleton';

export type Hair = 'short' | 'bob' | 'bun' | 'long' | 'cap' | 'locs';

export interface Look {
  sex: 'm' | 'f';
  /** 1 = average; broader people > 1 */
  build: number;
  hair: Hair;
}

/** The image's extent around the body, in body heights (x about the body centre, y up from the floor). */
export interface Tile {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export const WALK_TILE: Tile = { x0: -0.46, x1: 0.46, y0: -0.03, y1: 1.06 };

type V = [number, number, number];

export class BodyRaster {
  w = 0;
  h = 0;
  data = new Uint8Array(0);
  private zb = new Float32Array(0);
  private k = 1; // px per body height
  private c = 1;
  private s = 0;
  private dc = 0;
  constructor(public tile: Tile = WALK_TILE) {}

  /** Image height in px; the width follows the tile. */
  resize(rows: number) {
    const t = this.tile;
    const h = Math.max(16, Math.round(rows));
    const w = Math.max(8, Math.round((h * (t.x1 - t.x0)) / (t.y1 - t.y0)));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
    this.zb = new Float32Array(w * h);
  }

  get aspect() {
    return (this.tile.x1 - this.tile.x0) / (this.tile.y1 - this.tile.y0);
  }

  /** Body frame to view: facing angle theta (0 = facing screen right, pi/2 = facing the viewer). */
  private view(x: number, y: number, z: number): V {
    return [x * this.c + z * this.s, y, x * this.s - z * this.c];
  }
  private dir(v: V): V {
    return [v[0] * this.c + v[2] * this.s, v[1], v[0] * this.s - v[2] * this.c];
  }

  /**
   * Draw a pose. `theta` is which way the body faces; `ox` shifts it sideways in
   * the tile (body heights), e.g. to keep the pelvis centred.
   */
  render(pose: Pose, look: Look, theta: number, ox = 0) {
    this.data.fill(0);
    this.zb.fill(-1e9);
    this.c = Math.cos(theta);
    this.s = Math.sin(theta);
    this.k = (this.h - 0) / (this.tile.y1 - this.tile.y0);
    const P = (j: number): V => {
      const v = this.view(pose.p[j * 3], pose.p[j * 3 + 1], pose.p[j * 3 + 2]);
      v[0] += ox;
      return v;
    };
    const pel = P(J.pelvis);
    this.dc = pel[2];
    const f = look.sex === 'f';
    const b = look.build;
    const lat = (r: number) => r * b;

    // trunk axes: up the spine, forward (sagittal), left
    const ch = P(J.chest);
    const sx = pose.p[J.chest * 3] - pose.p[J.pelvis * 3];
    const sy = pose.p[J.chest * 3 + 1] - pose.p[J.pelvis * 3 + 1];
    const sl = Math.hypot(sx, sy) || 1;
    const up = this.dir([sx / sl, sy / sl, 0]);
    const fw = this.dir([sy / sl, -sx / sl, 0]);
    const lf = this.dir([0, 0, 1]);
    const at = (o: V, u: number, fo: number, l = 0): V => [o[0] + up[0] * u + fw[0] * fo + lf[0] * l, o[1] + up[1] * u + fw[1] * fo + lf[1] * l, o[2] + up[2] * u + fw[2] * fo + lf[2] * l];
    const trunk = (c: V, ru: number, rf: number, rl: number) => this.ell(c, up, fw, lf, ru, rf, rl);

    // legs (both; the depth buffer sorts near and far)
    for (const side of [0, 1]) {
      const o = side ? 5 : 0;
      const hip = P(J.hipR + o), knee = P(J.kneeR + o), ank = P(J.ankleR + o), heel = P(J.heelR + o), toe = P(J.toeR + o);
      this.cap(hip, knee, lat(f ? 0.066 : 0.064), lat(0.04));
      // calf: fuller behind the shin, tapering to the ankle
      const mid: V = [knee[0] + (ank[0] - knee[0]) * 0.33, knee[1] + (ank[1] - knee[1]) * 0.33, knee[2] + (ank[2] - knee[2]) * 0.33];
      const back = this.dir([-(pose.p[(J.ankleR + o) * 3 + 1] - pose.p[(J.kneeR + o) * 3 + 1]), pose.p[(J.ankleR + o) * 3] - pose.p[(J.kneeR + o) * 3], 0]);
      const bl = Math.hypot(back[0], back[1], back[2]) || 1;
      const calf: V = [mid[0] - (back[0] / bl) * 0.008, mid[1] - (back[1] / bl) * 0.008, mid[2] - (back[2] / bl) * 0.008];
      this.cap(knee, calf, lat(0.04), lat(f ? 0.039 : 0.042));
      this.cap(calf, ank, lat(f ? 0.039 : 0.042), 0.021);
      // foot: a flattened ellipsoid heel to toe, and the ankle into it
      const fx = toe[0] - heel[0], fy = toe[1] - heel[1], fz = toe[2] - heel[2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      const fa: V = [fx / fl, fy / fl, fz / fl];
      const fu = this.dir([-(pose.p[(J.toeR + o) * 3 + 1] - pose.p[(J.heelR + o) * 3 + 1]) / fl, (pose.p[(J.toeR + o) * 3] - pose.p[(J.heelR + o) * 3]) / fl, 0]);
      const fm: V = [(heel[0] + toe[0]) / 2 + fu[0] * 0.016, (heel[1] + toe[1]) / 2 + fu[1] * 0.016, (heel[2] + toe[2]) / 2 + fu[2] * 0.016];
      this.ell(fm, fa, fu, lf, fl / 2 + 0.014, 0.024, f ? 0.028 : 0.032);
      this.cap(ank, fm, 0.022, 0.022);
    }

    // pelvis, seat, belly, ribcage, shoulder girdle
    trunk(at(pel, 0.0, -0.004), 0.075, f ? 0.074 : 0.07, lat(f ? 0.108 : 0.096));
    trunk(at(pel, -0.022, -0.034), 0.064, f ? 0.066 : 0.058, lat(f ? 0.1 : 0.088));
    trunk(at(pel, 0.13, 0.004), 0.1, f ? 0.06 : 0.064, lat(f ? 0.078 : 0.088));
    trunk(at(ch, -0.088, 0.006), 0.108, f ? 0.068 : 0.074, lat(f ? 0.09 : 0.104));
    trunk(at(ch, -0.018, -0.004), 0.042, 0.056, lat(f ? 0.104 : 0.122));
    if (f) {
      for (const l of [-0.042, 0.042]) this.ell(at(ch, -0.105, 0.052, l), up, fw, lf, 0.042, 0.04, 0.042);
    }

    // neck and head
    const ear = P(J.ear);
    const neckTop: V = [ear[0] - fw[0] * 0.012, ear[1] - 0.03, ear[2] - fw[2] * 0.012];
    this.cap(at(ch, 0.0, -0.008), neckTop, lat(f ? 0.03 : 0.035), f ? 0.026 : 0.03);
    // head axes: forward pitched down by headPitch, turned by headYaw
    const hp = pose.headPitch, hy = pose.headYaw;
    const hf0: V = [Math.cos(hp) * Math.cos(hy), -Math.sin(hp), Math.cos(hp) * Math.sin(-hy)];
    const hu0: V = [Math.sin(hp) * Math.cos(hy), Math.cos(hp), Math.sin(hp) * Math.sin(-hy)];
    const hl0: V = [Math.sin(hy), 0, Math.cos(hy)];
    const hf = this.dir(hf0), hu = this.dir(hu0), hl = this.dir(hl0);
    const H = (fo: number, u: number, l = 0): V => [ear[0] + hf[0] * fo + hu[0] * u + hl[0] * l, ear[1] + hf[1] * fo + hu[1] * u + hl[1] * l, ear[2] + hf[2] * fo + hu[2] * u + hl[2] * l];
    const sz = f ? 0.95 : 1;
    // hair that sits behind and around the skull goes first, under the face
    if (look.hair === 'long') this.ell(H(-0.03, -0.03), hf, hu, hl, 0.05 * sz, 0.1 * sz, 0.062 * sz);
    if (look.hair === 'bob') this.ell(H(-0.012, 0.0), hf, hu, hl, 0.066 * sz, 0.066 * sz, 0.062 * sz);
    if (look.hair === 'bun') this.ell(H(-0.07 * sz, 0.03 * sz), hf, hu, hl, 0.026, 0.026, 0.026);
    if (look.hair === 'locs') this.ell(H(-0.06 * sz, 0.0), hf, hu, hl, 0.03, 0.045, 0.032);
    this.ell(H(-0.004, 0.026), hf, hu, hl, 0.06 * sz, 0.064 * sz, 0.053 * sz); // skull
    this.ell(H(0.032, -0.022), hf, hu, hl, 0.04 * sz, 0.056 * sz, 0.044 * sz); // face
    this.ell(H(0.026, -0.052), hf, hu, hl, 0.04 * sz, 0.026 * sz, (f ? 0.036 : 0.042) * sz); // jaw and chin
    this.cap(H(0.064 * sz, 0.0), H(0.077 * sz, -0.018 * sz), 0.009, 0.007); // nose
    if (look.hair === 'cap') {
      this.ell(H(0.0, 0.05), hf, hu, hl, 0.064, 0.04, 0.058);
      this.ell(H(0.07, 0.035), hf, hu, hl, 0.04, 0.008, 0.048);
    }

    // arms last: the depth buffer keeps the far arm behind the body
    for (const side of [0, 1]) {
      const o = side ? 4 : 0;
      const sh = P(J.shR + o), el = P(J.elR + o), wr = P(J.wrR + o), hd = P(J.handR + o);
      this.cap(sh, el, lat(f ? 0.036 : 0.042), lat(f ? 0.027 : 0.031));
      this.cap(el, wr, lat(f ? 0.028 : 0.031), 0.019);
      const hx = hd[0] - wr[0], hy2 = hd[1] - wr[1], hz = hd[2] - wr[2];
      const hl2 = Math.hypot(hx, hy2, hz) || 1;
      const ha: V = [hx / hl2, hy2 / hl2, hz / hl2];
      // the palm faces the body: its thin side is across the body
      const pz = lf;
      const pw: V = [ha[1] * pz[2] - ha[2] * pz[1], ha[2] * pz[0] - ha[0] * pz[2], ha[0] * pz[1] - ha[1] * pz[0]];
      const pl = Math.hypot(...pw) || 1;
      this.ell([wr[0] + ha[0] * 0.045, wr[1] + ha[1] * 0.045, wr[2] + ha[2] * 0.045], ha, [pw[0] / pl, pw[1] / pl, pw[2] / pl], pz, 0.052, f ? 0.026 : 0.029, 0.015);
    }
  }

  // ---------------------------------------------------------------- drawing

  private shadeAt(Y: number, nD: number, nY: number, axisD: number) {
    const base = 0.5 + 0.38 * Y;
    const lit = 0.58 + 0.42 * Math.max(0, Math.min(1, 0.8 * nD + 0.4 * nY + 0.12));
    const dim = Math.max(0.56, Math.min(1, 0.86 + 3.6 * (axisD - this.dc)));
    return base * lit * dim;
  }

  private put(i: number, D: number, v: number) {
    if (D <= this.zb[i]) return;
    this.zb[i] = D;
    const g = Math.max(0, Math.min(255, Math.round(v * 255)));
    const k = i * 4;
    this.data[k] = this.data[k + 1] = this.data[k + 2] = g;
    this.data[k + 3] = 255;
  }

  /** Tapered capsule from a to b (view space, body heights). */
  private cap(a: V, b: V, ra: number, rb: number) {
    const t = this.tile, k = this.k;
    const r = Math.max(ra, rb);
    const px0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r - t.x0) * k));
    const px1 = Math.min(this.w - 1, Math.ceil((Math.max(a[0], b[0]) + r - t.x0) * k));
    const py0 = Math.max(0, Math.floor((t.y1 - Math.max(a[1], b[1]) - r) * k));
    const py1 = Math.min(this.h - 1, Math.ceil((t.y1 - Math.min(a[1], b[1]) + r) * k));
    const dx = b[0] - a[0], dy = b[1] - a[1], dd = b[2] - a[2];
    const l2 = dx * dx + dy * dy || 1e-9;
    for (let py = py0; py <= py1; py++) {
      const Y = t.y1 - (py + 0.5) / k;
      for (let px = px0; px <= px1; px++) {
        const X = t.x0 + (px + 0.5) / k;
        let u = ((X - a[0]) * dx + (Y - a[1]) * dy) / l2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const cx = a[0] + dx * u, cy = a[1] + dy * u;
        const ex = X - cx, ey = Y - cy;
        const d2 = ex * ex + ey * ey;
        const rr = ra + (rb - ra) * u;
        if (d2 >= rr * rr) continue;
        const s = Math.sqrt(1 - d2 / (rr * rr));
        const axisD = a[2] + dd * u;
        this.put(py * this.w + px, axisD + rr * s, this.shadeAt(Y, s, ey / rr, axisD));
      }
    }
  }

  /** Ellipsoid: centre, three orthonormal axes (view space) and radii along them. */
  private ell(c: V, e0: V, e1: V, e2: V, r0: number, r1: number, r2: number) {
    const t = this.tile, k = this.k;
    const E = [e0, e1, e2], R = [r0, r1, r2];
    const exX = Math.sqrt((r0 * e0[0]) ** 2 + (r1 * e1[0]) ** 2 + (r2 * e2[0]) ** 2);
    const exY = Math.sqrt((r0 * e0[1]) ** 2 + (r1 * e1[1]) ** 2 + (r2 * e2[1]) ** 2);
    const px0 = Math.max(0, Math.floor((c[0] - exX - t.x0) * k));
    const px1 = Math.min(this.w - 1, Math.ceil((c[0] + exX - t.x0) * k));
    const py0 = Math.max(0, Math.floor((t.y1 - c[1] - exY) * k));
    const py1 = Math.min(this.h - 1, Math.ceil((t.y1 - c[1] + exY) * k));
    // q_i = (alpha_i + beta_i * t) with t the depth offset from the centre
    const bx = E.map((e, i) => e[0] / R[i]);
    const by = E.map((e, i) => e[1] / R[i]);
    const bd = E.map((e, i) => e[2] / R[i]);
    const A = bd[0] * bd[0] + bd[1] * bd[1] + bd[2] * bd[2];
    for (let py = py0; py <= py1; py++) {
      const Y = t.y1 - (py + 0.5) / k;
      const dy = Y - c[1];
      for (let px = px0; px <= px1; px++) {
        const dx = t.x0 + (px + 0.5) / k - c[0];
        const a0 = dx * bx[0] + dy * by[0], a1 = dx * bx[1] + dy * by[1], a2 = dx * bx[2] + dy * by[2];
        const B = a0 * bd[0] + a1 * bd[1] + a2 * bd[2];
        const C = a0 * a0 + a1 * a1 + a2 * a2;
        const disc = B * B - A * (C - 1);
        if (disc <= 0) continue;
        const tt = (-B + Math.sqrt(disc)) / A;
        const q0 = (a0 + bd[0] * tt) / R[0], q1 = (a1 + bd[1] * tt) / R[1], q2 = (a2 + bd[2] * tt) / R[2];
        let nx = q0 * e0[0] + q1 * e1[0] + q2 * e2[0];
        let ny = q0 * e0[1] + q1 * e1[1] + q2 * e2[1];
        let nd = q0 * e0[2] + q1 * e1[2] + q2 * e2[2];
        const nl = Math.hypot(nx, ny, nd) || 1;
        nx /= nl;
        ny /= nl;
        nd /= nl;
        this.put(py * this.w + px, c[2] + tt, this.shadeAt(Y, nd, ny, c[2]));
      }
    }
  }
}
