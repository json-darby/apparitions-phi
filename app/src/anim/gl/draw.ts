// Drawing helpers used by the scenes: the dot cloud (a grid of points that
// samples a source texture) and particle sets (dots that travel from one place
// to another: words, letters, links, face to word).

import type { Engine, FrameCtx, GL } from './engine';

export type Rect = [number, number, number, number];
/** Texture region for a render target (rows stored bottom-up). */
export const FLIP: Rect = [0, 1, 1, -1];
/** Texture region for an uploaded image (rows top-down). */
export const PLAIN: Rect = [0, 0, 1, 1];

export interface CloudOpts {
  a: WebGLTexture;
  ra?: Rect;
  b?: WebGLTexture | null;
  rb?: Rect;
  mix?: number;
  /** grid size */
  nx: number;
  ny: number;
  /** content aspect (x span); defaults to nx / ny. A face drawn with more dots per row than rows keeps 1 */
  aspect?: number;
  /** 1 fades the bottom of a bust out softly (people) */
  foot?: number;
  /** least share of dots kept where the source is dark (portraits: hair and the shadow side stay readable) */
  floor?: number;
  /** depth slope where dots start and finish thinning out (default 0.045 to 0.09) */
  slope?: [number, number];
  /** 1: the set of lit dots does not reshuffle over time */
  stable?: number;
  /** rows where the bust starts and finishes fading out (default 0.72 to 0.95) */
  footRange?: [number, number];
  depth?: [number, number];
  rot?: [number, number, number];
  xf?: [number, number, number, number];
  fit: [number, number];
  colour: [number, number, number];
  gain?: number;
  clarity?: number;
  dis?: number;
  gat?: number;
  keep?: number;
  voice?: [number, number, number];
  lo?: number;
  tear?: number;
  ghost?: number;
  parallax?: number;
  alpha?: number;
  /** time used for twinkle and tears */
  t: number;
  /** dot size in px at z = 0 (before xf scale) */
  pt: number;
}

export function drawCloud(c: FrameCtx, o: CloudOpts) {
  const { gl, eng } = c;
  const p = eng.cloudProg();
  gl.useProgram(p.p);
  const g = eng.grid(o.nx, o.ny);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
  const aG = p.a('aG');
  gl.enableVertexAttribArray(aG);
  gl.vertexAttribPointer(aG, 3, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, o.a);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, o.b ?? o.a);
  gl.uniform1i(p.u('uA'), 0);
  gl.uniform1i(p.u('uB'), 1);
  const ra = o.ra ?? FLIP;
  const rb = o.rb ?? ra;
  gl.uniform4f(p.u('uRA'), ra[0], ra[1], ra[2], ra[3]);
  gl.uniform4f(p.u('uRB'), rb[0], rb[1], rb[2], rb[3]);
  gl.uniform1f(p.u('uMix'), o.b ? (o.mix ?? 0) : 0);
  gl.uniform1f(p.u('uT'), o.t);
  gl.uniform1f(p.u('uN'), o.ny);
  gl.uniform1f(p.u('uAsp'), o.aspect ?? o.nx / o.ny);
  gl.uniform1f(p.u('uFoot'), o.foot ?? 0);
  gl.uniform1f(p.u('uFloor'), o.floor ?? 0);
  const sl = o.slope ?? [0.045, 0.09];
  gl.uniform2f(p.u('uSlope'), sl[0], sl[1]);
  gl.uniform1f(p.u('uStable'), o.stable ?? 0);
  const fr = o.footRange ?? [0.72, 0.95];
  gl.uniform2f(p.u('uFootR'), fr[0], fr[1]);
  gl.uniform1f(p.u('uG'), o.tear ?? 0.15);
  const d = o.depth ?? [0.45, 2.2];
  gl.uniform2f(p.u('uDepth'), d[0], d[1]);
  const r = o.rot ?? [0, 0, 0];
  gl.uniform3f(p.u('uRot'), r[0], r[1], r[2]);
  const xf = o.xf ?? [0, 0, 0, 1];
  gl.uniform4f(p.u('uXf'), xf[0], xf[1], xf[2], xf[3]);
  gl.uniform2f(p.u('uFit'), o.fit[0], o.fit[1]);
  gl.uniform1f(p.u('uPt'), o.pt);
  gl.uniform1f(p.u('uClar'), o.clarity ?? 1);
  gl.uniform1f(p.u('uDis'), o.dis ?? 0);
  gl.uniform1f(p.u('uGat'), o.gat ?? 1);
  gl.uniform1f(p.u('uKeep'), o.keep ?? 0);
  const t = c.touch;
  gl.uniform4f(p.u('uP0'), t[0], t[1], t[2], t[3]);
  gl.uniform4f(p.u('uP1'), t[4], t[5], t[6], t[7]);
  gl.uniform4f(p.u('uP2'), t[8], t[9], t[10], t[11]);
  const v = o.voice ?? [0, 0, 0.2];
  gl.uniform4f(p.u('uVoice'), v[0], v[1], v[2], 0);
  gl.uniform1f(p.u('uLo'), o.lo ?? 0.3);
  gl.uniform1f(p.u('uGain'), o.gain ?? 1);
  gl.uniform2f(p.u('uPar'), o.parallax ?? 0, 0);
  gl.uniform1f(p.u('uGhost'), o.ghost ?? 0);
  gl.uniform3f(p.u('uC'), o.colour[0], o.colour[1], o.colour[2]);
  gl.uniform1f(p.u('uAlpha'), o.alpha ?? 1);
  gl.drawArrays(gl.POINTS, 0, g.count);
  gl.disableVertexAttribArray(aG);
  eng.addDots(g.count);
}

/** A set of travelling dots: from (x,y,z,l), to (x,y,z,l), meta (delay, duration, seed, fade). */
export class Particles {
  buf: WebGLBuffer | null = null;
  count = 0;
  gen = 0;
  data: Float32Array | null = null;

  set(data: Float32Array) {
    this.data = data;
    this.count = Math.floor(data.length / 12);
    this.gen = 0; // re-upload
  }

  ensure(eng: Engine) {
    const gl = eng.gl;
    if (!this.data) return false;
    if (this.buf && this.gen === eng.gen) return true;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.STATIC_DRAW);
    this.gen = eng.gen;
    return true;
  }

  free(gl: GL | null, eng: Engine | null) {
    if (gl && this.buf && eng && this.gen === eng.gen) gl.deleteBuffer(this.buf);
    this.buf = null;
    this.gen = 0;
  }
}

export interface PartOpts {
  t: number;
  rows: number;
  fit: [number, number];
  pt: number;
  colour: [number, number, number];
  xf?: [number, number, number, number];
  strength?: number;
  swirl?: number;
  tear?: number;
  rot?: [number, number];
  twinkle?: number;
  alpha?: number;
}

export function drawParticles(c: FrameCtx, ps: Particles, o: PartOpts) {
  const { gl, eng } = c;
  // replace a stale buffer (set() was called) before drawing
  if (ps.buf && ps.gen === 0) {
    gl.deleteBuffer(ps.buf);
    ps.buf = null;
  }
  if (!ps.ensure(eng) || !ps.count) return;
  const p = eng.partProg();
  gl.useProgram(p.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, ps.buf);
  const a0 = p.a('aFrom');
  const a1 = p.a('aTo');
  const a2 = p.a('aM');
  gl.enableVertexAttribArray(a0);
  gl.enableVertexAttribArray(a1);
  gl.enableVertexAttribArray(a2);
  gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, 48, 0);
  gl.vertexAttribPointer(a1, 4, gl.FLOAT, false, 48, 16);
  gl.vertexAttribPointer(a2, 4, gl.FLOAT, false, 48, 32);
  gl.uniform1f(p.u('uT'), o.t);
  gl.uniform1f(p.u('uN'), o.rows);
  gl.uniform1f(p.u('uG'), o.tear ?? 0.1);
  const xf = o.xf ?? [0, 0, 0, 1];
  gl.uniform4f(p.u('uXf'), xf[0], xf[1], xf[2], xf[3]);
  gl.uniform2f(p.u('uFit'), o.fit[0], o.fit[1]);
  gl.uniform1f(p.u('uPt'), o.pt);
  gl.uniform1f(p.u('uStr'), o.strength ?? 1);
  gl.uniform1f(p.u('uSwirl'), o.swirl ?? 0);
  const r = o.rot ?? [0, 0];
  gl.uniform3f(p.u('uRot'), r[0], r[1], 0);
  gl.uniform1f(p.u('uTw'), o.twinkle ?? 0.6);
  const t = c.touch;
  gl.uniform4f(p.u('uP0'), t[0], t[1], t[2], t[3]);
  gl.uniform4f(p.u('uP1'), t[4], t[5], t[6], t[7]);
  gl.uniform4f(p.u('uP2'), t[8], t[9], t[10], t[11]);
  gl.uniform3f(p.u('uC'), o.colour[0], o.colour[1], o.colour[2]);
  gl.uniform1f(p.u('uAlpha'), o.alpha ?? 1);
  gl.drawArrays(gl.POINTS, 0, ps.count);
  gl.disableVertexAttribArray(a0);
  gl.disableVertexAttribArray(a1);
  gl.disableVertexAttribArray(a2);
  eng.addDots(ps.count);
}
