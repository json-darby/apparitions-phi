// Code-drawn shapes from text: word strength, letter from dots, face to word.

import type { DotScene, Engine, FrameCtx, GL, Target } from '../gl/engine';
import { dotPx } from '../gl/engine';
import { drawCloud, drawParticles, Particles } from '../gl/draw';
import { assignTransport, fitScale, glyphOrder, hash1, hashStr, hexToRgb, rng, smooth } from '../core/math';
import { exprFor, lookFor } from '../core/looks';
import { BUST_DEPTH, FaceRenderer, faceRes } from './face';
import { fontReady, rasterText } from './text';
import { loadManifest, loadPair, resolvePortrait, type Composed } from '../packs';
import { headShape, paintDots, textShape } from '../fallback';

/** 12 floats per particle: from xyzl, to xyzl, delay, dur, seed, fade. */
function pushP(out: number[], fx: number, fy: number, fz: number, fl: number, tx: number, ty: number, tz: number, tl: number, delay: number, dur: number, seed: number, fade: number) {
  out.push(fx, fy, fz, fl, tx, ty, tz, tl, delay, dur, seed, fade);
}

// ---------------------------------------------------------------- word strength

export interface WordProps {
  text: string;
  strength: number;
  colour: string;
  live: boolean;
}

export class DotWordScene implements DotScene {
  props: WordProps = { text: '', strength: 1, colour: '#E8E8E8', live: false };
  private ps = new Particles();
  private built = '';
  private eng: Engine | null = null;
  private fontAsked = new Set<string>();
  private rows = 0;
  private cols = 0;

  frame(c: FrameCtx): boolean {
    this.eng = c.eng;
    const P = this.props;
    const aspect = c.cssW / Math.max(1, c.cssH);
    const rows = Math.max(16, Math.min(90, Math.round(c.cssH / 2.6)));
    const cols = Math.max(8, Math.round(rows * aspect));
    const key = `${P.text}|${rows}|${cols}`;
    if (!this.fontAsked.has(P.text)) {
      this.fontAsked.add(P.text);
      const text = P.text;
      const inst = c.inst;
      fontReady(text).then(() => {
        if (this.props.text !== text) return;
        this.built = '';
        inst.invalidate();
      });
    }
    if (key !== this.built) {
      this.built = key;
      this.rows = rows;
      this.cols = cols;
      const cov = rasterText(P.text, cols, rows, 600, 0.92);
      const out: number[] = [];
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const v = cov[y * cols + x];
          if (v < 0.3) continue;
          const px = ((x + 0.5) / cols) * 2 * aspect - aspect;
          const py = 1 - ((y + 0.5) / rows) * 2;
          pushP(out, px, py, 0, 0.55 + 0.45 * v, px, py, 0, 0.55 + 0.45 * v, 0, 0.001, hash1(x * 0.37 + y * 11.1), 0);
        }
      this.ps.set(new Float32Array(out));
    }
    const fit = fitScale(aspect, aspect, 'contain');
    const pt = dotPx(this.rows, fit[1], c.h) * 1.05;
    const s = Math.max(0, Math.min(1, P.strength));
    drawParticles(c, this.ps, { t: c.still || !P.live ? 3.7 : c.t, rows: this.rows, fit, pt, colour: hexToRgb(P.colour), strength: s, tear: (1 - s) * 0.3, twinkle: P.live ? 0.5 : 0.15 });
    void this.cols;
    return !c.still && P.live;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, textShape(this.props.text), 4);
  }
  lost() {
    this.ps.buf = null;
    this.ps.gen = -1;
  }
  dispose(gl: GL | null) {
    this.ps.free(gl, this.eng);
    this.built = '';
  }
}

// ---------------------------------------------------------------- letter from dots

export interface LetterProps {
  char: string;
  strokes: { d: string }[] | null;
  colour: string;
  onDone?: () => void;
}

const DRAW_S = 2.2;

/** Order cells by authored strokes: each cell takes the position along the stroke nearest to it. */
function strokeOrder(strokes: { d: string }[], n: number): { mask: Uint8Array; order: Float32Array } | null {
  if (typeof document === 'undefined' || !strokes.length) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  document.body.appendChild(svg);
  const samples: { x: number; y: number; o: number }[] = [];
  try {
    strokes.forEach((s, i) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', s.d);
      svg.appendChild(p);
      const L = p.getTotalLength();
      const steps = Math.max(8, Math.ceil(L));
      for (let k = 0; k <= steps; k++) {
        const pt = p.getPointAtLength((k / steps) * L);
        samples.push({ x: pt.x, y: pt.y, o: (i + k / steps) / strokes.length });
      }
    });
  } catch {
    return null;
  } finally {
    svg.remove();
  }
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.scale(n / 100, n / 100);
  g.strokeStyle = '#fff';
  g.lineWidth = 8;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of strokes) {
    try {
      g.stroke(new Path2D(s.d));
    } catch {
      /* bad path */
    }
  }
  const px = g.getImageData(0, 0, n, n).data;
  const mask = new Uint8Array(n * n);
  const order = new Float32Array(n * n).fill(-1);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (px[i * 4] < 90) continue;
      mask[i] = 1;
      const cx = ((x + 0.5) / n) * 100;
      const cy = ((y + 0.5) / n) * 100;
      let best = 0;
      let bd = Infinity;
      for (const s of samples) {
        const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = s.o;
        }
      }
      order[i] = best;
    }
  return { mask, order };
}

export class LetterScene implements DotScene {
  props: LetterProps = { char: 'ก', strokes: null, colour: '#E8E8E8' };
  private ps = new Particles();
  private built = '';
  private eng: Engine | null = null;
  private lastT = -1;
  private done = false;
  private n = 0;
  private fontTried = new Set<string>();

  frame(c: FrameCtx): boolean {
    this.eng = c.eng;
    const P = this.props;
    const n = Math.max(40, Math.min(110, c.n));
    const key = `${P.char}|${n}|${P.strokes?.map((s) => s.d).join('/') ?? ''}`;
    if (!this.fontTried.has(P.char)) {
      this.fontTried.add(P.char);
      const inst = c.inst;
      fontReady(P.char).then(() => {
        this.built = '';
        inst.invalidate();
      });
    }
    if (key !== this.built) {
      this.built = key;
      this.n = n;
      let mask: ArrayLike<number>;
      let order: Float32Array;
      const so = P.strokes?.length ? strokeOrder(P.strokes, n) : null;
      if (so) {
        mask = so.mask;
        order = so.order;
      } else {
        const cov = rasterText(P.char, n, n, 500, 0.8);
        const m = new Uint8Array(n * n);
        for (let i = 0; i < n * n; i++) m[i] = cov[i] > 0.35 ? 1 : 0;
        mask = m;
        order = glyphOrder(m, n, n);
      }
      const r = rng(hashStr(P.char) + 0.1);
      const out: number[] = [];
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (!mask[i] || order[i] < 0) continue;
          const tx = ((x + 0.5) / n) * 2 - 1;
          const ty = 1 - ((y + 0.5) / n) * 2;
          const a = r() * Math.PI * 2;
          const rad = 0.25 + r() * 0.5;
          // dots come in from close to the pen, so the stroke reads as being drawn
          const fx = tx + Math.cos(a) * rad;
          const fy = ty + Math.sin(a) * rad + 0.15;
          pushP(out, fx, fy, (r() - 0.5) * 0.6, 0.9, tx, ty, 0, 1, order[i] * DRAW_S, 0.5, r(), -1);
        }
      this.ps.set(new Float32Array(out));
    }
    if (c.t < this.lastT) this.done = false;
    this.lastT = c.t;
    const t = c.still ? DRAW_S + 1 : c.t;
    const end = t >= DRAW_S + 0.6;
    if (end && !this.done) {
      this.done = true;
      if (P.onDone) queueMicrotask(P.onDone);
    }
    const fit = fitScale(c.w / c.h, 1, 'contain');
    drawParticles(c, this.ps, { t, rows: this.n, fit, pt: dotPx(this.n, fit[1], c.h) * 1.1, colour: hexToRgb(P.colour), swirl: 0.25, tear: 0.05, twinkle: end ? 0.2 : 0.4 });
    return !c.still && !end;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, textShape(this.props.char), 4);
    if (!this.done) {
      this.done = true;
      if (this.props.onDone) queueMicrotask(this.props.onDone);
    }
  }
  lost() {
    this.ps.buf = null;
    this.ps.gen = -1;
  }
  dispose(gl: GL | null) {
    this.ps.free(gl, this.eng);
    this.built = '';
    this.lastT = -1;
  }
}

// ---------------------------------------------------------------- face to word

export interface FaceWordProps {
  who: string;
  thai: string;
  colour: string;
  onDone?: () => void;
}

const HOLD_FACE = 1.4;
const TRAVEL = 2.2;

export class FaceToWordScene implements DotScene {
  props: FaceWordProps = { who: 'pim', thai: '', colour: '#2E9BFF' };
  private face = new FaceRenderer();
  private ps = new Particles();
  private eng: Engine | null = null;
  private built = '';
  private lastT = -1;
  private done = false;
  private pack: Composed | null = null;
  private packTex: string | null = null;
  private who = '';
  private tok = 0;

  frame(c: FrameCtx): boolean {
    const { eng } = c;
    this.eng = eng;
    const P = this.props;
    if (P.who !== this.who) {
      this.who = P.who;
      this.dropPack(eng);
      const tok = ++this.tok;
      const inst = c.inst;
      loadManifest().then((m) => {
        const r = resolvePortrait(m, P.who, 'neutral');
        if (!r || tok !== this.tok) return;
        loadPair(r.ref).then((cmp) => {
          if (!cmp || tok !== this.tok) return;
          eng.acquireTex(cmp.key, () => cmp.canvas, cmp.w, cmp.h);
          this.pack = cmp;
          this.packTex = cmp.key;
          this.built = '';
          inst.invalidate();
        });
      });
      fontReady(P.thai).then(() => {
        if (tok !== this.tok) return;
        this.built = '';
        inst.invalidate();
      });
    }
    if (c.t < this.lastT) this.done = false;
    this.lastT = c.t;
    const n = Math.max(48, Math.min(150, c.n));
    const fit = fitScale(c.w / c.h, 1, 'contain');
    const pt = dotPx(n, fit[1], c.h);
    const colour = hexToRgb(P.colour);
    const look = lookFor(P.who);
    const e = exprFor('neutral', look);
    const t = c.still ? HOLD_FACE + TRAVEL + 1 : c.t;
    const packTex = this.packTex ? eng.tex(this.packTex) : null;
    const depth: [number, number] = packTex && this.pack ? [0.6, 0.9] : BUST_DEPTH;
    let tgt: Target | null = null;
    if (!packTex) tgt = this.face.render(eng, faceRes(n), look, e, [0, 0]);

    if (t < HOLD_FACE) {
      const breath = Math.sin(t * 1.5);
      drawCloud(c, { a: packTex ? packTex.tex : tgt!.tex, ra: packTex ? [0, 0, 1, 1] : undefined, nx: n, ny: n, fit, pt, colour, t, depth, lo: packTex ? 0.3 : 0.5, tear: 0.13 + 0.4 * smooth(HOLD_FACE - 0.4, HOLD_FACE, t), rot: [0.05 * Math.sin(t * 0.4), 0, 0], xf: [0, 0.012 * breath, 0, 1] });
      return true;
    }
    const key = `${P.thai}|${n}|${packTex ? 'p' : 'c'}`;
    if (key !== this.built) {
      this.built = key;
      this.build(n, depth, packTex ? null : eng.read(tgt!), tgt?.w ?? 0);
    }
    const tt = t - HOLD_FACE;
    if (tt >= TRAVEL + 0.3 && !this.done) {
      this.done = true;
      if (P.onDone) queueMicrotask(P.onDone);
    }
    drawParticles(c, this.ps, { t: tt, rows: n, fit, pt, colour, swirl: 0.55, tear: 0.08, twinkle: 0.5 });
    return !c.still && tt < TRAVEL + 0.5;
  }

  private build(n: number, depth: [number, number], fbo: Uint8Array | null, res: number) {
    // face dots: the same grid cells the cloud drew
    const from: number[] = [];
    for (let gy = 0; gy < n; gy++)
      for (let gx = 0; gx < n; gx++) {
        const u = (gx + 0.5) / n;
        const v = (gy + 0.5) / n;
        let l = 0;
        let d = 0;
        let m = 0;
        if (fbo) {
          const px = Math.min(res - 1, Math.floor(u * res));
          const py = Math.min(res - 1, Math.floor((1 - v) * res));
          const k = (py * res + px) * 4;
          l = fbo[k] / 255;
          d = fbo[k + 1] / 255;
          m = fbo[k + 3] / 255;
        } else if (this.pack) {
          const P = this.pack;
          const px = Math.min(P.w - 1, Math.floor(u * P.w));
          const py = Math.min(P.h - 1, Math.floor(v * P.h));
          const k = (py * P.w + px) * 4;
          l = P.px[k] / 255;
          d = P.px[k + 1] / 255;
          m = P.px[k + 3] / 255;
        }
        if (m < 0.5 || l < 0.22 || hash1(gx * 0.7 + gy * 3.1) > l * 1.1) continue;
        from.push((u - 0.5) * 2, (0.5 - v) * 2, (d - depth[0]) * depth[1], l);
      }
    // word dots
    const cols = n;
    const rows = Math.max(12, Math.round(n * 0.42));
    const cov = rasterText(this.props.thai, cols, rows, 600, 0.9);
    const to: number[] = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = cov[y * cols + x];
        if (v < 0.3) continue;
        to.push(((x + 0.5) / cols) * 2 - 1, (1 - ((y + 0.5) / rows) * 2) * (rows / cols), 0, 0.6 + 0.4 * v);
      }
    const { map, spare } = assignTransport(from, to, 4);
    const r = rng(hashStr(this.props.thai) + 0.2);
    const out: number[] = [];
    for (let i = 0; i < map.length; i++) {
      const fx = from[i * 4];
      const fy = from[i * 4 + 1];
      const fz = from[i * 4 + 2];
      const fl = from[i * 4 + 3];
      const j = map[i];
      const delay = (fx + 1) * 0.18 + r() * 0.25;
      if (j >= 0) pushP(out, fx, fy, fz, fl, to[j * 4], to[j * 4 + 1], 0, to[j * 4 + 3], delay, 1.4, r(), 0);
      else pushP(out, fx, fy, fz, fl, fx + (r() - 0.5) * 0.4, fy + 0.3 + r() * 0.5, fz, 0, delay, 1.1, r(), 1);
    }
    for (const j of spare) {
      const tx = to[j * 4];
      const ty = to[j * 4 + 1];
      pushP(out, tx + (r() - 0.5) * 0.6, ty + (r() - 0.5) * 0.6, 0, 0.5, tx, ty, 0, to[j * 4 + 3], 0.5 + r() * 0.6, 1.2, r(), -1);
    }
    this.ps.set(new Float32Array(out));
  }

  private dropPack(eng: Engine | null) {
    this.tok++;
    if (this.packTex) eng?.releaseTex(this.packTex);
    this.packTex = null;
    this.pack = null;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, this.props.thai ? textShape(this.props.thai) : headShape, 5);
    if (!this.done) {
      this.done = true;
      if (this.props.onDone) queueMicrotask(this.props.onDone);
    }
  }
  lost() {
    this.face.lost();
    this.ps.buf = null;
    this.ps.gen = -1;
  }
  dispose(gl: GL | null) {
    const eng = gl ? this.eng : null;
    this.face.free(eng);
    this.ps.free(gl, this.eng);
    this.dropPack(eng);
    this.who = '';
    this.built = '';
    this.lastT = -1;
  }
}
