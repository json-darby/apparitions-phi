// Frame sequences (stop motion): palm on the glass, wai, hand-over, driver's
// glance, walk-away. Plays the packed clip (8 to 12 stills a second, image +
// depth atlas) when one exists; until then a code-drawn figure posed by the
// timelines in core/timelines.ts. Both step at ~10 fps with the previous frame
// left as a ghost, as in animation-demos/4.

import type { DotScene, Engine, FrameCtx, GL, Inst, Target } from '../gl/engine';
import { dotPx } from '../gl/engine';
import { drawCloud, PLAIN, type Rect } from '../gl/draw';
import { fitScale, hexToRgb } from '../core/math';
import { lookFor, SEQUENCE_WHO } from '../core/looks';
import { packEndFade, SEQ_INFO, seqAt, seqStep, type SequenceName } from '../core/timelines';
import { faceRes, figureProg, setHeadUniforms } from './face';
import { loadManifest, loadPair, seqFrameRect, type SeqPack } from '../packs';
import { headShape, paintDots } from '../fallback';

const SCENE_ID: Record<SequenceName, number> = { palm: 1, wai: 2, handover: 3, glance: 4, walkaway: 5 };

export interface SequenceProps {
  name: SequenceName;
  who?: string;
  colour: string;
  loop: boolean;
  onDone?: () => void;
}

export class SequenceScene implements DotScene {
  props: SequenceProps = { name: 'wai', colour: '#2E9BFF', loop: false };
  private eng: Engine | null = null;
  private inst: Inst | null = null;
  private tg: [Target | null, Target | null] = [null, null];
  private cur = 0;
  private step = -1;
  private stepKey = '';
  private lastT = -1;
  private done = false;
  private name: SequenceName | null = null;
  private pack: SeqPack | null = null;
  private packKey: string | null = null;
  private tok = 0;
  private who: string | undefined;

  frame(c: FrameCtx): boolean {
    const { eng, gl } = c;
    this.eng = eng;
    this.inst = c.inst;
    const P = this.props;
    if (P.name !== this.name || P.who !== this.who) {
      this.name = P.name;
      this.who = P.who;
      this.dropPack(eng);
      const name = P.name;
      const who = P.who;
      const tok = ++this.tok;
      loadManifest().then((m) => {
        // a clip made for this person ("handover-lek") wins over the default ("handover")
        const sp = (who ? m.sequences[`${name}-${who}`] : undefined) ?? m.sequences[name];
        if (!sp || tok !== this.tok) return;
        loadPair(sp, sp.linger === 'near').then((cmp) => {
          if (!cmp || tok !== this.tok) return;
          eng.acquireTex(cmp.key, () => cmp.canvas, cmp.w, cmp.h);
          this.pack = sp;
          this.packKey = cmp.key;
          this.inst?.invalidate();
        });
      });
      this.step = -1;
      this.done = false;
    }
    if (c.t < this.lastT) {
      this.done = false;
      this.step = -1;
    }
    this.lastT = c.t;

    const pack = this.pack && this.packKey ? eng.tex(this.packKey) : null;
    const fps = pack && this.pack ? this.pack.fps : SEQ_INFO[P.name].fps;
    const duration = pack && this.pack ? this.pack.frames / this.pack.fps : SEQ_INFO[P.name].duration;
    let t = c.t;
    if (P.loop && !c.still) t = t % (duration + 0.8);
    if (c.still) t = pack && this.pack ? this.pack.key_frame / this.pack.fps : SEQ_INFO[P.name].keyFrame;
    const over = !P.loop && t >= duration;
    if ((over || c.still) && !this.done) {
      this.done = true;
      if (P.onDone) queueMicrotask(P.onDone);
    }
    t = Math.min(t, duration);
    const st = seqStep(t, fps);
    const ts = st / fps;

    const n = c.n;
    const fit = fitScale(c.w / c.h, 1, 'contain');
    const pt = dotPx(n, fit[1], c.h);
    const colour = hexToRgb(P.colour);

    if (pack && this.pack) {
      const sp = this.pack;
      const f = Math.min(sp.frames - 1, st);
      const ra: Rect = seqFrameRect(sp, f);
      const rp: Rect = seqFrameRect(sp, Math.max(0, f - 1));
      const dis = packEndFade(t, duration, sp.end_fade);
      const base = { nx: n, ny: n, fit, pt, colour, t: ts, depth: [sp.depth_map.offset, sp.depth_map.scale] as [number, number], dis, keep: sp.linger === 'near' ? 1 : 0, tear: 0.15 + 0.4 * dis, lo: 0.25 };
      if (f > 0 && !c.still) drawCloud(c, { ...base, a: pack.tex, ra: rp, ghost: 1, alpha: 0.45, xf: [0.012, 0, 0, 1] });
      drawCloud(c, { ...base, a: pack.tex, ra: ra ?? PLAIN });
    } else {
      // code-drawn figure, rendered once per step into a ping-pong pair
      const res = faceRes(n);
      const who = P.who ?? SEQUENCE_WHO[P.name];
      const key = `${res}|${who}|${P.name}`;
      if (st !== this.step || key !== this.stepKey || !this.tg[this.cur] || this.tg[this.cur]!.gen !== eng.gen) {
        const fresh = key !== this.stepKey || this.step < 0;
        this.cur = 1 - this.cur;
        this.tg[this.cur] = eng.target(res, res, this.tg[this.cur]);
        this.renderPose(eng, gl, this.tg[this.cur]!, P.name, ts, who);
        if (fresh || !this.tg[1 - this.cur] || this.tg[1 - this.cur]!.gen !== eng.gen) {
          // no previous frame yet: the ghost starts as the same frame
          this.tg[1 - this.cur] = eng.target(res, res, this.tg[1 - this.cur]);
          this.renderPose(eng, gl, this.tg[1 - this.cur]!, P.name, Math.max(0, ts - 1 / fps), who);
        }
        this.step = st;
        this.stepKey = key;
      }
      const { pose, look } = seqAt(P.name, ts);
      const range = pose.cam[3];
      const depth: [number, number] = [(pose.cam[2] - 3.6) / range, range * 0.75];
      const base = { nx: n, ny: n, fit, pt, colour, t: ts, depth, dis: look.dis, gat: c.still ? 1 : look.gat, keep: look.keepMat, tear: look.tear, gain: look.bright * 1.3, lo: 0.5 };
      if (!c.still) drawCloud(c, { ...base, a: this.tg[1 - this.cur]!.tex, ghost: 1, alpha: look.ghost, xf: [0.012, 0, 0, 1] });
      drawCloud(c, { ...base, a: this.tg[this.cur]!.tex });
    }
    return !c.still && (P.loop || !this.done);
  }

  private renderPose(eng: Engine, gl: GL, tgt: Target, name: SequenceName, ts: number, who: string) {
    const { pose } = seqAt(name, ts);
    const look = lookFor(who);
    eng.renderSource(figureProg(eng), tgt, (p) => {
      setHeadUniforms(gl, p, look, pose.expr, [0, 0], name === 'glance' ? pose.torsoYaw : pose.expr.yaw * 0.3);
      gl.uniform4f(p.u('uCam'), pose.cam[0], pose.cam[1], pose.cam[2], pose.cam[3]);
      gl.uniform2f(p.u('uFade'), name === 'wai' || name === 'handover' ? -3.6 : -3.0, name === 'wai' || name === 'handover' ? -2.4 : -1.6);
      gl.uniform1f(p.u('uScene'), SCENE_ID[name]);
      const h = pose.hand;
      gl.uniform4f(p.u('uHand0'), h[0], h[1], h[2], h[7]);
      gl.uniform4f(p.u('uHand1'), h[3], h[4], h[5], h[6]);
      gl.uniform1f(p.u('uArm'), pose.arm);
      gl.uniform1f(p.u('uLean'), pose.lean);
      gl.uniform4f(p.u('uWalk'), pose.walk[0], pose.walk[1], pose.walk[2], pose.walk[3]);
    });
  }

  private dropPack(eng: Engine | null) {
    this.tok++;
    if (this.packKey) eng?.releaseTex(this.packKey);
    this.pack = null;
    this.packKey = null;
  }

  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, headShape);
    if (!this.done) {
      this.done = true;
      if (this.props.onDone) queueMicrotask(this.props.onDone);
    }
  }

  lost() {
    this.tg = [null, null];
    this.step = -1;
  }

  dispose(gl: GL | null) {
    const eng = gl ? this.eng : null;
    eng?.freeTarget(this.tg[0]);
    eng?.freeTarget(this.tg[1]);
    this.tg = [null, null];
    this.dropPack(eng);
    this.name = null;
    this.step = -1;
    this.lastT = -1;
  }
}
