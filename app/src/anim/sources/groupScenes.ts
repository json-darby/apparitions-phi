// Many faces on one canvas: the day's constellation and the whole cast finale.
// One dot canvas (one draw region) for the lot, so eight faces cost one blit.

import type { DotScene, Engine, FrameCtx, GL } from '../gl/engine';
import { dotPx } from '../gl/engine';
import { drawCloud, drawParticles, Particles, PLAIN } from '../gl/draw';
import { constellationLayout, constellationLinks, easeInOut, finaleLayout, fitScale, hash1, hashStr, hexToRgb, smooth } from '../core/math';
import { EXPR, exprFor, lookFor, mixExpr } from '../core/looks';
import { BUST_DEPTH, FaceRenderer } from './face';
import { PortraitSet } from './faceScene';
import { loadManifest } from '../packs';
import { personColour } from '../people';
import { headShape, paintDots } from '../fallback';
import { tinted } from '../tint';

class Member {
  face = new FaceRenderer();
  portraits: PortraitSet | null = null;
  constructor(public who: string) {}
  private freed = false;
  init(eng: Engine, inst: FrameCtx['inst']) {
    loadManifest().then((m) => {
      if (this.freed || !m.people[this.who] || this.portraits) return;
      this.portraits = new PortraitSet(this.who, m);
      this.portraits.want('neutral', eng, inst);
      this.portraits.want('smile', eng, inst);
    });
  }
  free(eng: Engine | null) {
    this.freed = true;
    this.face.free(eng);
    this.portraits?.release(eng);
    this.portraits = null;
  }
}

const FACE_RES = 112;

function drawMember(c: FrameCtx, m: Member, o: { x: number; y: number; s: number; n: number; fit: [number, number]; pt: number; colour: [number, number, number]; t: number; gat: number; yaw: number; pitch: number; smile: number; clarity?: number }) {
  const { eng } = c;
  const look = lookFor(m.who);
  const pk = m.portraits;
  const common = { nx: o.n, ny: o.n, fit: o.fit, pt: o.pt, colour: o.colour, t: o.t + hash1(hashStr(m.who)) * 10, gat: o.gat, tear: 0.12 + 0.5 * (1 - o.gat), rot: [o.yaw, o.pitch, 0] as [number, number, number], xf: [o.x, o.y, 0, o.s] as [number, number, number, number], clarity: o.clarity ?? 1 };
  const nk = pk?.key('neutral');
  const nt = nk ? eng.tex(nk) : null;
  if (pk && nt) {
    const sk = pk.keys.smile;
    const st = sk ? eng.tex(sk) : null;
    drawCloud(c, { ...common, nx: o.n * 2, aspect: 1, pt: o.pt * 0.62, foot: 1, a: nt.tex, ra: PLAIN, b: st?.tex ?? null, rb: PLAIN, mix: o.smile, depth: pk.depth });
  } else {
    const e = mixExpr(exprFor('neutral', look), EXPR.smile, o.smile);
    const tgt = m.face.render(eng, FACE_RES, look, e);
    drawCloud(c, { ...common, a: tgt.tex, depth: BUST_DEPTH, lo: 0.5 });
  }
}

// ---------------------------------------------------------------- constellation

export interface ConstellationProps {
  people: string[];
}

export class ConstellationScene implements DotScene {
  props: ConstellationProps = { people: [] };
  private eng: Engine | null = null;
  private members: Member[] = [];
  private key = '';
  private links = new Particles();
  private linkKey = '';
  private onDoneFired = false;
  onDone?: () => void;
  private lastT = -1;

  frame(c: FrameCtx): boolean {
    const { eng } = c;
    this.eng = eng;
    const people = this.props.people;
    const key = people.join(',');
    if (key !== this.key) {
      this.key = key;
      for (const m of this.members) m.free(eng);
      this.members = people.map((w) => new Member(w));
      for (const m of this.members) m.init(eng, c.inst);
      this.linkKey = '';
    }
    if (c.t < this.lastT) this.onDoneFired = false;
    this.lastT = c.t;
    const V = c.w / c.h;
    const n = this.members.length;
    const pts = constellationLayout(n, V, hashStr(key) || 0.37);
    const s = Math.min(0.42, 1.25 / Math.sqrt(n + 1));
    const fit = fitScale(V, V, 'contain');
    const t = c.still ? 30 : c.t;
    const step = 0.45;
    const linkStart = n * step + 1.2;

    // links: dots along each line, appearing in order
    const lk = `${key}|${V.toFixed(2)}`;
    if (lk !== this.linkKey) {
      this.linkKey = lk;
      const out: number[] = [];
      constellationLinks(pts).forEach(([a, b], li) => {
        const A = pts[a];
        const B = pts[b];
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        const gap = s * 0.55;
        const k = Math.max(2, Math.floor((len - 2 * gap) / 0.03));
        for (let i = 0; i <= k; i++) {
          const f = i / k;
          const d = gap + f * (len - 2 * gap);
          const x = A.x + ((B.x - A.x) * d) / len;
          const y = A.y + ((B.y - A.y) * d) / len;
          const seed = hash1(li * 13.7 + i * 0.31);
          out.push(x, y, 0, 0.5, x, y, 0, 0.55, linkStart + li * 0.35 + f * 0.6, 0.25, seed, -1);
        }
      });
      this.links.set(new Float32Array(out));
    }
    const rows = Math.max(60, c.n);
    drawParticles(c, this.links, { t, rows, fit, pt: dotPx(rows, fit[1], c.h) * 0.8, colour: [0.85, 0.85, 0.85], twinkle: 0.9, alpha: 0.7 });

    const fn = Math.max(28, Math.round(c.n * s * 0.95));
    const pt = dotPx(fn, fit[1], c.h);
    this.members.forEach((m, i) => {
      const p = pts[i];
      drawMember(c, m, { x: p.x, y: p.y + 0.015 * Math.sin(t * 0.8 + i), s, n: fn, fit, pt, colour: hexToRgb(tinted(personColour(m.who))), t, gat: smooth(i * step, i * step + 1.4, t), yaw: 0.12 * Math.sin(t * 0.3 + i * 1.7), pitch: 0, smile: 0 });
    });
    const end = linkStart + Math.max(0, n - 1) * 0.35 + 1;
    if (t >= end && !this.onDoneFired) {
      this.onDoneFired = true;
      if (this.onDone) queueMicrotask(this.onDone);
    }
    return !c.still;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, '#E8E8E8', headShape);
  }
  lost() {
    for (const m of this.members) m.face.lost();
    this.links.buf = null;
    this.links.gen = -1;
  }
  dispose(gl: GL | null) {
    const eng = gl ? this.eng : null;
    for (const m of this.members) m.free(eng);
    this.members = [];
    this.links.free(gl, this.eng);
    this.key = '';
    this.linkKey = '';
    this.lastT = -1;
  }
}

// ---------------------------------------------------------------- the whole cast

export interface FinaleProps {
  people: string[];
  onDone?: () => void;
}

export const FINALE_S = 11;

export class FinaleScene implements DotScene {
  props: FinaleProps = { people: [] };
  private eng: Engine | null = null;
  private members: Member[] = [];
  private key = '';
  private done = false;
  private lastT = -1;

  frame(c: FrameCtx): boolean {
    const { eng } = c;
    this.eng = eng;
    const key = this.props.people.join(',');
    if (key !== this.key) {
      this.key = key;
      for (const m of this.members) m.free(eng);
      this.members = this.props.people.map((w) => new Member(w));
      for (const m of this.members) m.init(eng, c.inst);
    }
    if (c.t < this.lastT) this.done = false;
    this.lastT = c.t;
    const t = c.still ? FINALE_S : c.t;
    const V = c.w / c.h;
    const n = this.members.length;
    const lay = finaleLayout(n, V);
    const fit = fitScale(V, V, 'contain');
    const step = 0.7;
    const allIn = n * step + 1.6;
    const fn = Math.max(28, Math.round(c.n * (lay[0]?.s ?? 0.3) * 0.95));
    const pt = dotPx(fn, fit[1], c.h);
    // they arrive turned away, then all face you, smile, and bow together
    const face = easeInOut(smooth(allIn, allIn + 1.3, t));
    const smile = smooth(allIn + 1.4, allIn + 2.2, t);
    const bow = smooth(allIn + 2.6, allIn + 3.1, t) * (1 - smooth(allIn + 3.5, allIn + 4.2, t));
    this.members.forEach((m, i) => {
      const l = lay[i];
      const side = l.x > 0 ? -1 : 1;
      drawMember(c, m, { x: l.x, y: l.y - bow * 0.03, s: l.s, n: fn, fit, pt, colour: hexToRgb(tinted(personColour(m.who))), t, gat: smooth(i * step, i * step + 1.6, t), yaw: (1 - face) * 0.85 * side + 0.05 * Math.sin(t * 0.4 + i), pitch: bow * 0.3, smile });
    });
    if (t >= FINALE_S && !this.done) {
      this.done = true;
      if (this.props.onDone) queueMicrotask(this.props.onDone);
    }
    return !c.still;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, '#E8E8E8', headShape);
  }
  lost() {
    for (const m of this.members) m.face.lost();
  }
  dispose(gl: GL | null) {
    const eng = gl ? this.eng : null;
    for (const m of this.members) m.free(eng);
    this.members = [];
    this.key = '';
    this.lastT = -1;
  }
}
