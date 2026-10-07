// A person as a dot apparition: idle (breathe, blink, drift), gather, follow,
// expression change, voice tear, clearer-as-you-learn, walk-away and touch
// scatter. Uses the portrait pack when one exists, the code-drawn head until then.

import type { DotScene, Engine, FrameCtx, GL, Inst } from '../gl/engine';
import { dotPx } from '../gl/engine';
import { drawCloud, PLAIN } from '../gl/draw';
import { blinkAmount, clamp, easeInOut, fitScale, hash1, hashStr, hexToRgb, smooth, voiceBand, voiceDuration } from '../core/math';
import { exprFor, lookFor, mixExpr, type Expression, type ExprParams, type FaceLook } from '../core/looks';
import { BUST_DEPTH, FaceRenderer, faceRes } from './face';
import { loadManifest, loadPair, resolvePortrait, type PackManifest } from '../packs';
import { headShape, paintDots } from '../fallback';

export type ApparitionMode = 'idle' | 'gather' | 'follow' | 'tear' | 'walkaway' | 'still';

export interface FaceProps {
  who: string;
  mode: ApparitionMode;
  expression: Expression;
  colour: string;
  clarity: number;
  pitch: number[] | null;
  onDone?: () => void;
}

const GATHER_S = 2.6;
const WALK_S = 2.9;

/** Portrait textures for one person from a pack, loaded on demand. */
export class PortraitSet {
  keys: Partial<Record<Expression, string>> = {};
  depth: [number, number] = [0.6, 0.9];
  private asked = new Set<string>();
  constructor(
    public who: string,
    private m: PackManifest,
  ) {
    const p = m.people[who];
    if (p) this.depth = [p.depth.offset, p.depth.scale];
  }
  get has() {
    return !!this.m.people[this.who];
  }
  want(e: Expression, eng: Engine, inst: Inst | null) {
    const r = resolvePortrait(this.m, this.who, e);
    if (!r || this.asked.has(r.expr)) return;
    this.asked.add(r.expr);
    loadPair(r.ref).then((c) => {
      if (!c || this.disposed) return;
      eng.acquireTex(c.key, () => c.canvas, c.w, c.h);
      this.keys[r.expr] = c.key;
      if (r.expr !== e) this.keys[e] = c.key; // fallback shares the neutral texture
      inst?.invalidate();
    });
  }
  key(e: Expression): string | undefined {
    return this.keys[e] ?? this.keys.neutral;
  }
  disposed = false;
  release(eng: Engine | null) {
    this.disposed = true;
    const seen = new Set<string>();
    for (const k of Object.values(this.keys)) {
      if (!k || seen.has(k)) continue;
      seen.add(k);
      eng?.releaseTex(k);
    }
    this.keys = {};
  }
}

export class FaceScene implements DotScene {
  props: FaceProps = { who: 'you', mode: 'idle', expression: 'neutral', colour: '#2E9BFF', clarity: 1, pitch: null };
  wantsFollow = false;
  private face = new FaceRenderer();
  private eng: Engine | null = null;
  private inst: Inst | null = null;
  private mode: ApparitionMode | null = null;
  private t0 = 0;
  private lastT = -1;
  private done = false;
  private exprName: Expression | null = null;
  private from: ExprParams | null = null;
  private to: ExprParams | null = null;
  private k = 1;
  private shownPack: Expression = 'neutral';
  private prevPack: Expression = 'neutral';
  private yaw = 0;
  private pitch = 0;
  private gaze: [number, number] = [0, 0];
  private look: FaceLook = lookFor('you');
  private who = '';
  private portraits: PortraitSet | null = null;
  private ptok = 0;

  frame(c: FrameCtx): boolean {
    const { eng } = c;
    this.eng = eng;
    this.inst = c.inst;
    const P = this.props;
    this.wantsFollow = P.mode === 'follow';

    // who changed: new look, check for a portrait pack
    if (P.who !== this.who) {
      this.who = P.who;
      this.look = lookFor(P.who);
      this.portraits?.release(eng);
      this.portraits = null;
      const who = P.who;
      const tok = ++this.ptok;
      loadManifest().then((m) => {
        if (tok !== this.ptok || !m.people[who]) return;
        this.portraits = new PortraitSet(who, m);
        this.portraits.want('neutral', eng, this.inst);
        this.portraits.want(this.props.expression, eng, this.inst);
        this.portraits.want('closed', eng, this.inst);
      });
      this.exprName = null;
    }

    // replay (cue bump restarts the clock) or mode change restarts one-shots
    if (c.t < this.lastT || P.mode !== this.mode) {
      this.mode = P.mode;
      this.t0 = c.t;
      this.done = false;
    }
    this.lastT = c.t;
    const t = c.still ? 1.3 : c.t;
    const lt = c.t - this.t0; // time in the current mode

    // expression change: dots flow from one face to the next
    const target = exprFor(P.expression, this.look);
    if (this.exprName !== P.expression) {
      const cur = this.from && this.to ? mixExpr(this.from, this.to, easeInOut(clamp(this.k))) : target;
      this.from = this.exprName == null || c.still ? target : cur;
      this.to = target;
      this.k = this.exprName == null || c.still ? 1 : 0;
      this.prevPack = this.shownPack;
      this.shownPack = P.expression;
      this.exprName = P.expression;
      this.portraits?.want(P.expression, eng, this.inst);
    }
    this.to = target;
    if (this.k < 1) this.k = Math.min(1, this.k + c.dt / 0.85);
    const e = mixExpr(this.from ?? target, target, easeInOut(this.k));

    // timeline per mode
    let gat = 1;
    let dis = 0;
    let voice: [number, number, number] = [0, 0, 0.16];
    let clarity = clamp(P.clarity);
    let finished = false;
    if (P.mode === 'gather') {
      gat = c.still ? 1 : smooth(0, GATHER_S, lt);
      finished = c.still || lt >= GATHER_S;
    } else if (P.mode === 'walkaway') {
      if (c.still) {
        clarity = Math.min(clarity, 0.25);
        finished = true;
      } else {
        dis = smooth(0, WALK_S, lt);
        finished = lt >= WALK_S + 0.2;
      }
    } else if (P.mode === 'tear') {
      const dur = voiceDuration(P.pitch);
      if (c.still) finished = true;
      else {
        const cyc = dur + 1.0;
        const vb = voiceBand(P.pitch, lt % cyc);
        voice = [vb.y, vb.amp * 0.9, 0.17];
        e.jaw += 0.03 * vb.amp * (0.5 + 0.5 * Math.sin(lt * 15));
        finished = lt >= dur + 0.25;
      }
    } else if (P.mode === 'still') finished = true;
    if (finished && !this.done) {
      this.done = true;
      const cb = P.onDone;
      if (cb) queueMicrotask(cb);
    }

    // idle life: blink, breathe, drift; or follow the pointer / tilt
    if (!c.still && P.expression !== 'closed') e.lid = Math.max(e.lid, blinkAmount(t, hashStr(this.who)));
    let ty = 0.07 * Math.sin(t * 0.31) + 0.04 * Math.sin(t * 0.17 + 1);
    let tp = 0.03 * Math.sin(t * 0.23);
    let gx = (hash1(Math.floor(t / 1.9) + 0.3) - 0.5) * 0.5;
    let gy = (hash1(Math.floor(t / 1.9) + 7.1) - 0.5) * 0.3;
    if (P.mode === 'follow' && !c.still) {
      ty = c.follow[0] * 0.55;
      tp = -c.follow[1] * 0.3;
      gx = c.follow[0] * 0.9;
      gy = c.follow[1] * 0.8;
    }
    if (c.still) {
      ty = 0.04;
      tp = 0;
      gx = 0;
      gy = 0;
    }
    const a = c.still ? 1 : 1 - Math.exp(-c.dt * (P.mode === 'follow' ? 5 : 2));
    this.yaw += (ty - this.yaw) * a;
    this.pitch += (tp - this.pitch) * a;
    const ga = c.still ? 1 : 1 - Math.exp(-c.dt * 9);
    this.gaze = [this.gaze[0] + (gx - this.gaze[0]) * ga, this.gaze[1] + (gy - this.gaze[1]) * ga];
    const breath = c.still ? 0 : Math.sin(t * 1.5);

    // geometry for this canvas
    const n = c.n;
    const fit = fitScale(c.w / c.h, 1, 'contain');
    const pt = dotPx(n, fit[1], c.h);
    const colour = hexToRgb(P.colour);
    const tear = 0.13 + (1 - clarity) * 0.45 + 0.5 * (1 - gat) + 0.6 * dis;
    const common = {
      nx: n,
      ny: n,
      fit,
      pt,
      colour,
      t,
      gat,
      dis,
      clarity,
      voice,
      tear,
      rot: [this.yaw + dis * 0.7, this.pitch, 0] as [number, number, number],
      xf: [0, 0.012 * breath, 0, 1 + 0.006 * breath] as [number, number, number, number],
    };

    const pk = this.portraits;
    const keyNow = pk?.key(this.shownPack);
    const texNow = keyNow ? eng.tex(keyNow) : null;
    if (pk && texNow) {
      let b = texNow;
      let mix = 0;
      let aTex = texNow;
      if (this.k < 1) {
        const prevKey = pk.key(this.prevPack);
        const prev = prevKey ? eng.tex(prevKey) : null;
        if (prev) {
          aTex = prev;
          b = texNow;
          mix = easeInOut(this.k);
        }
      } else if (e.lid > 0.05 && P.expression !== 'closed') {
        const ck = pk.keys.closed;
        const closed = ck ? eng.tex(ck) : null;
        if (closed) {
          b = closed;
          mix = e.lid;
        }
      }
      // a portrait: twice the dots along each row (smooth scan lines, as in the reference), smaller dots,
      // and the bust fading out below the chin. The slope thinning starts a little later than for
      // code-drawn heads, so the cheeks and jaw hold their dots longer before fading; the fade at the
      // bottom starts lower, so the chin and neck stay solid
      drawCloud(c, { ...common, nx: n * 2, aspect: 1, pt: pt * 0.62, foot: 1, a: aTex.tex, ra: PLAIN, b: b.tex, rb: PLAIN, mix, depth: pk.depth, slope: [0.06, 0.12], footRange: [0.84, 1] });
    } else {
      const tgt = this.face.render(eng, faceRes(n), this.look, e, this.gaze);
      drawCloud(c, { ...common, a: tgt.tex, depth: BUST_DEPTH, lo: 0.5 });
    }

    if (c.still) return false;
    if (P.mode === 'walkaway' && this.done) return false;
    return true;
  }

  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, headShape);
    if (!this.done) {
      this.done = true;
      this.props.onDone && queueMicrotask(this.props.onDone);
    }
  }

  lost() {
    this.face.lost();
  }

  dispose(gl: GL | null) {
    void gl;
    this.face.free(gl ? this.eng : null);
    this.portraits?.release(gl ? this.eng : null);
    this.portraits = null;
    this.ptok++;
    this.who = '';
    this.mode = null;
    this.lastT = -1;
  }
}
