// Object turn (fact screens) and the street in depth (The Street). Each has a
// code-drawn stand-in rendered by a shader, and loads an image + depth pack when
// one exists (objects/<id>, scenes/<place>).

import type { DotScene, Engine, FrameCtx, GL, Inst, Target } from '../gl/engine';
import { dotPx } from '../gl/engine';
import { drawCloud, PLAIN } from '../gl/draw';
import { fitScale, hexToRgb } from '../core/math';
import { FULL_VS, OBJECT_FS, SCENE_FS } from '../gl/glsl';
import { loadManifest, loadPair, objectKind, type StillPack } from '../packs';
import { blobShape, paintDots } from '../fallback';
import { fontReady, textCanvas } from './text';

const OBJ_ID: Record<string, number> = { dish: 0, tuktuk: 1, temple: 2, banknote: 3, bottle: 4, ice: 5, stall: 6 };
export const OBJECTS = Object.keys(OBJ_ID);

/** Loads a still pack (object or scene) into a texture when the manifest lists it. */
class StillLoader {
  key: string | null = null;
  pack: StillPack | null = null;
  private token = 0;
  load(kind: 'objects' | 'scenes', id: string, eng: Engine, inst: Inst | null) {
    const tok = ++this.token;
    loadManifest().then((m) => {
      const sp = m[kind][id];
      if (!sp || tok !== this.token) return;
      loadPair(sp).then((c) => {
        if (!c || tok !== this.token) return;
        eng.acquireTex(c.key, () => c.canvas, c.w, c.h);
        this.key = c.key;
        this.pack = sp;
        inst?.invalidate();
      });
    });
  }
  drop(eng: Engine | null) {
    this.token++;
    if (this.key) eng?.releaseTex(this.key);
    this.key = null;
    this.pack = null;
  }
}

export interface ObjectProps {
  object: string;
  colour: string;
}

export class ObjectScene implements DotScene {
  props: ObjectProps = { object: 'dish', colour: '#FFB03A' };
  private eng: Engine | null = null;
  private tgt: Target | null = null;
  private kind = '';
  private still = new StillLoader();

  frame(c: FrameCtx): boolean {
    const { eng, gl } = c;
    this.eng = eng;
    const kind = objectKind(this.props.object);
    if (kind !== this.kind) {
      this.kind = kind;
      this.still.drop(eng);
      this.still.load('objects', kind, eng, c.inst);
    }
    const t = c.still ? 0 : c.t;
    const n = c.n;
    const fit = fitScale(c.w / c.h, 1, 'contain');
    const pt = dotPx(n, fit[1], c.h);
    const colour = hexToRgb(this.props.colour);
    const tex = this.still.key ? eng.tex(this.still.key) : null;
    if (tex && this.still.pack) {
      const dm = this.still.pack.depth_map;
      drawCloud(c, { a: tex.tex, ra: PLAIN, nx: n, ny: n, fit, pt, colour, t, depth: [dm.offset, dm.scale], rot: [Math.sin(t * 0.35) * 0.6 + (c.still ? 0.3 : 0), 0.05 * Math.sin(t * 0.21), 0], tear: 0.1, lo: 0.25 });
    } else {
      const res = Math.max(96, Math.min(224, Math.ceil((n * 1.15) / 16) * 16));
      this.tgt = eng.target(res, res, this.tgt);
      const id = OBJ_ID[kind] ?? 7;
      const yaw = c.still ? 0.6 : 0.6 + t * 0.35;
      eng.renderSource(eng.program('object', FULL_VS, OBJECT_FS), this.tgt, (p) => {
        gl.uniform1f(p.u('uObj'), id);
        gl.uniform1f(p.u('uYaw'), id === 3 ? Math.sin(t * 0.5) * 1.1 + 0.25 : yaw);
        gl.uniform1f(p.u('uTilt'), id === 3 ? 0.08 : 0.32);
      });
      drawCloud(c, { a: this.tgt.tex, nx: n, ny: n, fit, pt, colour, t, depth: [0.7, 1.4], tear: 0.1, lo: 0.5 });
    }
    return !c.still;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, blobShape);
  }
  lost() {
    this.tgt = null;
  }
  dispose(gl: GL | null) {
    const eng = gl ? this.eng : null;
    eng?.freeTarget(this.tgt);
    this.tgt = null;
    this.still.drop(eng);
    this.kind = '';
  }
}

const PLACE_ID: Record<string, number> = { food: 0, taxi: 1, hotel: 2, market: 3, bar: 4, pharmacy: 5 };
const SIGN_RECT: Record<string, [number, number, number, number]> = {
  food: [0, 0.3, 0.55, 0.09],
  taxi: [-0.95, 0.3, 0.34, 0.08],
  hotel: [0, 0.3, 0.6, 0.1],
  market: [0, 0.42, 0.5, 0.08],
  bar: [0, 0.55, 0.45, 0.1],
  pharmacy: [-0.1, 0.3, 0.6, 0.09],
};
const SCENE_ASPECT = 1.6;

export interface StreetProps {
  place: string;
  camera: number;
  colour: string;
  sign: string;
}

export class StreetSceneDots implements DotScene {
  props: StreetProps = { place: 'food', camera: 0.5, colour: '#FFB03A', sign: '' };
  private eng: Engine | null = null;
  private tgt: Target | null = null;
  private place = '';
  private still = new StillLoader();
  private signKey: string | null = null;
  private blank: string | null = null;
  private cam = 0.5;
  private signTok = 0;

  frame(c: FrameCtx): boolean {
    const { eng, gl } = c;
    this.eng = eng;
    const P = this.props;
    if (P.place !== this.place) {
      this.place = P.place;
      this.still.drop(eng);
      this.still.load('scenes', P.place, eng, c.inst);
      if (this.signKey) eng.releaseTex(this.signKey);
      this.signKey = null;
      const tok = ++this.signTok;
      const text = P.sign;
      const inst = c.inst;
      if (text)
        fontReady(text).then(() => {
          if (tok !== this.signTok) return;
          const key = `sign:${text}`;
          eng.acquireTex(key, () => textCanvas(text, 512, 128), 512, 128);
          this.signKey = key;
          inst.invalidate();
        });
    }
    if (!this.blank) {
      this.blank = 'blank:1';
      const cv = document.createElement('canvas');
      cv.width = cv.height = 2;
      eng.acquireTex(this.blank, () => cv, 2, 2);
    }
    const t = c.still ? 0 : c.t;
    const a = c.still ? 1 : 1 - Math.exp(-c.dt * 3);
    this.cam += (P.camera - this.cam) * a;
    const ny = c.n;
    const nx = Math.round(ny * SCENE_ASPECT);
    const fit = fitScale(c.w / c.h, SCENE_ASPECT, 'cover');
    const pt = dotPx(ny, fit[1], c.h);
    const colour = hexToRgb(P.colour);
    const sway = c.still ? 0 : Math.sin(t * 0.2) * 0.04;
    const camOff = (this.cam - 0.5) * 2;
    const tex = this.still.key ? eng.tex(this.still.key) : null;
    if (tex && this.still.pack) {
      const dm = this.still.pack.depth_map;
      drawCloud(c, { a: tex.tex, ra: PLAIN, nx, ny, fit, pt, colour, t, depth: [dm.offset, dm.scale], rot: [camOff * 0.12 + sway, 0, 0], parallax: -camOff * 0.35, tear: 0.12, lo: 0.1 });
    } else {
      const h = Math.max(64, Math.min(256, Math.ceil((ny * 1.1) / 8) * 8));
      const w = Math.round(h * SCENE_ASPECT);
      this.tgt = eng.target(w, h, this.tgt);
      const sign = eng.tex(this.signKey ?? this.blank) ?? eng.tex(this.blank)!;
      const sr = SIGN_RECT[P.place] ?? SIGN_RECT.food;
      eng.renderSource(eng.program('scene', FULL_VS, SCENE_FS), this.tgt, (p) => {
        gl.uniform1f(p.u('uPlace'), PLACE_ID[P.place] ?? 0);
        gl.uniform1f(p.u('uT'), t);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sign.tex);
        gl.uniform1i(p.u('uSign'), 0);
        gl.uniform4f(p.u('uSignRect'), sr[0], sr[1], sr[2], sr[3]);
      });
      drawCloud(c, { a: this.tgt.tex, nx, ny, fit, pt, colour, t, depth: [0.5, 1.3], rot: [camOff * 0.12 + sway, 0.02, 0], parallax: -camOff * 0.4, tear: 0.1, lo: 0.1 });
    }
    return !c.still;
  }
  paint2D(ctx: CanvasRenderingContext2D, w: number, h: number) {
    paintDots(ctx, w, h, this.props.colour, blobShape);
  }
  lost() {
    this.tgt = null;
  }
  dispose(gl: GL | null) {
    const eng = gl ? this.eng : null;
    eng?.freeTarget(this.tgt);
    this.tgt = null;
    this.still.drop(eng);
    this.signTok++;
    if (this.signKey) eng?.releaseTex(this.signKey);
    if (this.blank) eng?.releaseTex(this.blank);
    this.signKey = null;
    this.blank = null;
    this.place = '';
  }
}
