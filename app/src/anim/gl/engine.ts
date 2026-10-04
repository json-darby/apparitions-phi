// The dot engine: ONE WebGL context for the whole app.
//
// Every dot canvas on screen is a plain 2D canvas. Each frame the engine
// renders every visible, animating instance into its own region of a single
// offscreen WebGL canvas (shelf-packed like a texture atlas), then copies each
// region to that instance's 2D canvas with drawImage. So the Cast page with 8
// faces, the Constellation and the catalogue with 25 previews all share one GL
// context, well under the browser cap (~16).
//
// Safeguards from the plan:
//  - instances off screen (IntersectionObserver) and hidden tabs do not render
//  - an instance that is not animating renders once and then costs nothing
//  - dot density is budgeted across all live canvases, lower on phones
//  - weak devices: if frames run slow for ~1.5 s the quality steps down
//    (2 full, 1 light, 0 still image); no WebGL at all gives a 2D still
//  - reduced motion (app setting or OS) renders one still frame
//  - context loss: everything is rebuilt lazily on restore

import { allocateGrids, DENSITY_DESKTOP, DENSITY_PHONE, hash1, QualityMonitor, springStep, type QualityLevel } from '../core/math';
import { CLOUD_VS, DOT_FS, FULL_VS, PART_VS } from './glsl';

export type GL = WebGLRenderingContext;

export interface Prog {
  p: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
  a: (name: string) => number;
}

export interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
  gen: number;
}

export interface Tex {
  tex: WebGLTexture;
  w: number;
  h: number;
}

export interface FrameCtx {
  gl: GL;
  eng: Engine;
  inst: Inst;
  /** viewport in device px */
  w: number;
  h: number;
  /** CSS px */
  cssW: number;
  cssH: number;
  /** seconds on this instance's clock (pauses while off screen) */
  t: number;
  dt: number;
  still: boolean;
  quality: QualityLevel;
  /** dots along the short side for this canvas, from the shared budget */
  n: number;
  /** touch scatter: 3 x (x, y, amp, radius) in clip space */
  touch: Float32Array;
  /** where the face should look: -1..1 each way */
  follow: [number, number];
}

/** Something drawn on a dot canvas. */
export interface DotScene {
  /** Draw one frame into the current viewport. Return true to keep animating. */
  frame(c: FrameCtx): boolean;
  /** Free GL resources. The scene may be added again later (React strict mode). */
  dispose(gl: GL | null): void;
  /** The engine was rebuilt after a context loss: forget GL handles. */
  lost?(): void;
  /** CPU fallback when WebGL is unavailable. */
  paint2D?(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** false to opt out of touch scatter */
  scatter?: boolean;
  /** true when the scene turns toward the pointer or tilt */
  wantsFollow?: boolean;
}

export class Inst {
  ctx: CanvasRenderingContext2D | null;
  cssW = 0;
  cssH = 0;
  pw = 0;
  ph = 0;
  visible = false;
  dirty = true;
  animating = true;
  still = false;
  t = 0;
  touchAmp = { x: 0, v: 0 };
  touch = new Float32Array(12);
  follow: [number, number] = [0, 0];
  n = 64;
  lastDrawn = 0;
  constructor(
    public el: HTMLCanvasElement,
    public scene: DotScene,
  ) {
    this.ctx = el.getContext('2d');
  }
  invalidate() {
    this.dirty = true;
    engineRef?.kick();
  }
  setStill(v: boolean) {
    if (this.still !== v) {
      this.still = v;
      this.invalidate();
    }
  }
  /** Restart the instance clock (one-shot replays). */
  restart() {
    this.t = 0;
    this.invalidate();
  }
}

interface TexEntry {
  t: Tex | null;
  gen: number;
  refs: number;
  src: TexImageSource;
  w: number;
  h: number;
}

const QKEY = 'phi.anim.quality';

export interface EngineStats {
  fps: number;
  dots: number;
  live: number;
  drawn: number;
  quality: QualityLevel;
  contexts: number;
  webgl: 1 | 2 | 0;
  ms: number;
}

let engineRef: Engine | null = null;
let engineFailed = false;

/** The shared engine, or null if this browser has no WebGL. */
export function getEngine(): Engine | null {
  if (engineRef) return engineRef;
  if (engineFailed || typeof document === 'undefined') return null;
  try {
    engineRef = new Engine();
    if (import.meta.env?.DEV) (window as unknown as { __phiDots?: Engine }).__phiDots = engineRef;
  } catch (e) {
    console.warn('Phi dots: WebGL unavailable, showing still images.', e);
    engineFailed = true;
    engineRef = null;
  }
  return engineRef;
}

export class Engine {
  canvas: HTMLCanvasElement;
  gl: GL;
  version: 1 | 2;
  gen = 1;
  lost = false;
  insts = new Set<Inst>();
  quality: QualityLevel = 2;
  forceStill = false;
  densityScale = 1;
  phone: boolean;
  stats: EngineStats;
  private progs = new Map<string, Prog>();
  private grids = new Map<string, { buf: WebGLBuffer; count: number; used: number }>();
  private texs = new Map<string, TexEntry>();
  private tri: WebGLBuffer | null = null;
  private raf = 0;
  private last = 0;
  private frameNo = 0;
  private monitor = new QualityMonitor();
  private io: IntersectionObserver | null;
  private ro: ResizeObserver | null;
  private byEl = new WeakMap<Element, Inst>();
  private listeners = new Set<() => void>();
  private statAcc = { frames: 0, since: 0, ms: 0 };
  private ptr = { x: -1e4, y: -1e4, down: false, moved: -1e4, touch: false, hist: [] as { x: number; y: number; t: number }[] };
  private tilt = { x: 0, y: 0, on: false, b0: NaN };
  private pendingDots = 0;
  /** live GPU objects, for leak checks in the catalogue and dev tools */
  live = { targets: 0, textures: 0 };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    const attrs: WebGLContextAttributes = { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, depth: false, stencil: false, powerPreference: 'default' };
    let gl = this.canvas.getContext('webgl2', attrs) as unknown as GL | null;
    this.version = 2;
    if (!gl) {
      gl = this.canvas.getContext('webgl', attrs) as GL | null;
      this.version = 1;
    }
    if (!gl) throw new Error('no webgl');
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) throw new Error('no vertex textures');
    this.gl = gl;
    this.phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
    try {
      const q = Number(localStorage.getItem(QKEY));
      if (q === 1 || q === 2) this.quality = q;
    } catch {
      /* storage blocked */
    }
    this.stats = { fps: 0, dots: 0, live: 0, drawn: 0, quality: this.quality, contexts: 1, webgl: this.version, ms: 0 };
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.gen++;
      this.progs.clear();
      this.grids.clear();
      this.tri = null;
      this.live = { targets: 0, textures: 0 };
      for (const e of this.texs.values()) e.t = null;
      for (const i of this.insts) {
        i.scene.lost?.();
        i.dirty = true;
      }
      this.kick();
    });
    this.io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (es) => {
              for (const e of es) {
                const i = this.byEl.get(e.target);
                if (!i) continue;
                i.visible = e.isIntersecting;
                if (i.visible) i.dirty = true;
              }
              this.kick();
            },
            { rootMargin: '120px' },
          )
        : null;
    this.ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((es) => {
            for (const e of es) {
              const i = this.byEl.get(e.target);
              if (!i) continue;
              const r = e.contentRect;
              i.cssW = r.width;
              i.cssH = r.height;
              i.dirty = true;
            }
            this.kick();
          })
        : null;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      } else {
        this.monitor.reset();
        this.last = 0;
        this.kick();
      }
    });
    const mv = (e: PointerEvent) => {
      const now = performance.now();
      this.ptr.x = e.clientX;
      this.ptr.y = e.clientY;
      this.ptr.moved = now;
      this.ptr.touch = e.pointerType !== 'mouse';
      this.ptr.hist.push({ x: e.clientX, y: e.clientY, t: now });
      if (this.ptr.hist.length > 24) this.ptr.hist.shift();
      if (this.anyScatter()) this.kick();
    };
    window.addEventListener('pointermove', mv, { passive: true });
    window.addEventListener('pointerdown', (e) => {
      this.ptr.down = true;
      mv(e);
    }, { passive: true });
    const up = () => {
      this.ptr.down = false;
      if (this.ptr.touch) this.ptr.moved = -1e4;
    };
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('blur', up);
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      if (Number.isNaN(this.tilt.b0)) this.tilt.b0 = e.beta;
      this.tilt.on = true;
      this.tilt.x = Math.max(-1, Math.min(1, e.gamma / 28));
      this.tilt.y = Math.max(-1, Math.min(1, (e.beta - this.tilt.b0) / 28));
      this.tilt.b0 += (e.beta - this.tilt.b0) * 0.004; // slowly re-centre
    });
  }

  // ---- registry ----

  add(el: HTMLCanvasElement, scene: DotScene): Inst {
    const i = new Inst(el, scene);
    this.insts.add(i);
    this.byEl.set(el, i);
    const r = el.getBoundingClientRect();
    i.cssW = r.width;
    i.cssH = r.height;
    i.visible = !this.io; // until the observer reports
    this.io?.observe(el);
    this.ro?.observe(el);
    this.kick();
    return i;
  }

  remove(i: Inst) {
    this.insts.delete(i);
    this.io?.unobserve(i.el);
    this.ro?.unobserve(i.el);
    this.byEl.delete(i.el);
    try {
      i.scene.dispose(this.lost ? null : this.gl);
    } catch (e) {
      console.warn(e);
    }
    if (!this.insts.size) this.trim();
  }

  /** Free cached grids when nothing is mounted. */
  private trim() {
    const gl = this.gl;
    for (const g of this.grids.values()) gl.deleteBuffer(g.buf);
    this.grids.clear();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    for (const f of this.listeners) f();
  }

  setQuality(q: QualityLevel, persist = true) {
    this.quality = q;
    this.stats.quality = q;
    this.monitor.reset();
    if (persist) {
      try {
        localStorage.setItem(QKEY, String(Math.max(1, q)));
      } catch {
        /* ignore */
      }
    }
    for (const i of this.insts) i.dirty = true;
    this.kick();
    this.emit();
  }

  setForceStill(v: boolean) {
    this.forceStill = v;
    for (const i of this.insts) i.dirty = true;
    this.kick();
    this.emit();
  }

  kick() {
    if (this.raf || this.lost || (typeof document !== 'undefined' && document.hidden)) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  private anyScatter() {
    for (const i of this.insts) if (i.visible && i.scene.scatter !== false) return true;
    return false;
  }

  // ---- GL helpers ----

  program(key: string, vs: string, fs: string): Prog {
    let p = this.progs.get(key);
    if (p) return p;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        console.error(`Phi dots: shader ${key} failed`, log);
      }
      return s;
    };
    const prog = gl.createProgram()!;
    const v = sh(gl.VERTEX_SHADER, vs);
    const f = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) console.error(`Phi dots: link ${key} failed`, gl.getProgramInfoLog(prog));
    gl.deleteShader(v);
    gl.deleteShader(f);
    const uc = new Map<string, WebGLUniformLocation | null>();
    const ac = new Map<string, number>();
    p = {
      p: prog,
      u: (n) => {
        if (!uc.has(n)) uc.set(n, gl.getUniformLocation(prog, n));
        return uc.get(n)!;
      },
      a: (n) => {
        if (!ac.has(n)) ac.set(n, gl.getAttribLocation(prog, n));
        return ac.get(n)!;
      },
    };
    this.progs.set(key, p);
    return p;
  }

  /** A grid of nx * ny points (u, v, seed), shared by every canvas of that size. */
  grid(nx: number, ny: number) {
    const key = `${nx}x${ny}`;
    let g = this.grids.get(key);
    if (!g) {
      const gl = this.gl;
      const a = new Float32Array(nx * ny * 3);
      let j = 0;
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          a[j++] = (x + 0.5) / nx;
          a[j++] = (y + 0.5) / ny;
          a[j++] = hash1(x * 0.731 + y * 17.13 + 0.5);
        }
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
      g = { buf, count: nx * ny, used: this.frameNo };
      this.grids.set(key, g);
      if (this.grids.size > 24) {
        // drop the least recently used
        let old: string | null = null;
        let ou = Infinity;
        for (const [k, v] of this.grids) if (v.used < ou && k !== key) {
          ou = v.used;
          old = k;
        }
        if (old) {
          gl.deleteBuffer(this.grids.get(old)!.buf);
          this.grids.delete(old);
        }
      }
    }
    g.used = this.frameNo;
    return g;
  }

  /** A full-screen triangle for the source shaders. */
  triangle(): WebGLBuffer {
    if (!this.tri) {
      const gl = this.gl;
      this.tri = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    return this.tri;
  }

  /** An offscreen render target for a source (face, figure, object, scene). */
  target(w: number, h: number, old?: Target | null): Target {
    const gl = this.gl;
    if (old && old.gen === this.gen && old.w === w && old.h === h) return old;
    if (old && old.gen === this.gen) this.freeTarget(old);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.live.targets++;
    return { tex, fb, w, h, gen: this.gen };
  }

  freeTarget(t: Target | null | undefined) {
    if (!t || t.gen !== this.gen || this.lost) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
    this.live.targets--;
  }

  /** A texture from an image/canvas, shared by key and reference counted. */
  acquireTex(key: string, src: () => TexImageSource, w: number, h: number): void {
    const e = this.texs.get(key);
    if (e) {
      e.refs++;
      return;
    }
    this.texs.set(key, { t: null, gen: 0, refs: 1, src: src(), w, h });
  }
  tex(key: string): Tex | null {
    const e = this.texs.get(key);
    if (!e) return null;
    if (!e.t || e.gen !== this.gen) {
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, e.src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e.t = { tex, w: e.w, h: e.h };
      e.gen = this.gen;
      this.live.textures++;
    }
    return e.t;
  }
  releaseTex(key: string) {
    const e = this.texs.get(key);
    if (!e) return;
    if (--e.refs > 0) return;
    if (e.t && e.gen === this.gen && !this.lost) {
      this.gl.deleteTexture(e.t.tex);
      this.live.textures--;
    }
    this.texs.delete(key);
  }

  // ---- drawing (called by scenes inside frame) ----

  private outRegion = { x: 0, y: 0, w: 0, h: 0 };

  /** Render a source shader into a target, then return to the canvas region. */
  renderSource(prog: Prog, tgt: Target, setUniforms: (p: Prog) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
    gl.viewport(0, 0, tgt.w, tgt.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triangle());
    const a = prog.a('a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(prog.u('uRes'), tgt.w, tgt.h);
    setUniforms(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(a);
    this.bindOut();
  }

  /** Read back a target's pixels (small targets only; used once per face-to-word). */
  read(tgt: Target): Uint8Array {
    const gl = this.gl;
    const px = new Uint8Array(tgt.w * tgt.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
    gl.readPixels(0, 0, tgt.w, tgt.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.bindOut();
    return px;
  }

  bindOut() {
    const gl = this.gl;
    const r = this.outRegion;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(r.x, r.y, r.w, r.h);
    gl.scissor(r.x, r.y, r.w, r.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  /** Count dots for the stats line. */
  addDots(n: number) {
    this.pendingDots += n;
  }

  cloudProg() {
    return this.program('cloud', CLOUD_VS, DOT_FS);
  }
  partProg() {
    return this.program('part', PART_VS, DOT_FS);
  }
  fullVS() {
    return FULL_VS;
  }

  /**
   * Measure: run n frames back to back (as if at 60 fps) and wait for the GPU
   * each time. Returns the average ms per frame. For the catalogue and tests.
   */
  bench(n = 60): number {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const px = new Uint8Array(4);
    let t = performance.now();
    const t0 = performance.now();
    for (let k = 0; k < n; k++) {
      t += 16.7;
      this.loop(t);
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    }
    const ms = (performance.now() - t0) / n;
    this.monitor.reset();
    this.last = 0;
    this.kick();
    return ms;
  }

  // ---- the frame loop ----

  private loop = (now: number) => {
    this.raf = 0;
    if (this.lost) return;
    const gl = this.gl;
    const dtMs = this.last ? now - this.last : 16.7;
    this.last = now;
    const dt = Math.min(0.05, dtMs / 1000);
    this.frameNo++;

    const todo: Inst[] = [];
    let animatingAny = false;
    const ptrRecent = now - this.ptr.moved < 1500 || this.ptr.down;
    for (const i of this.insts) {
      if (!i.visible || i.cssW < 2 || i.cssH < 2) continue;
      const still = i.still || this.forceStill || this.quality === 0;
      // touch scatter spring
      let inside = false;
      if (!still && i.scene.scatter !== false && (ptrRecent || Math.abs(i.touchAmp.x) > 0.002 || Math.abs(i.touchAmp.v) > 0.002)) {
        const r = i.el.getBoundingClientRect();
        const lx = ((this.ptr.x - r.left) / r.width) * 2 - 1;
        const ly = 1 - ((this.ptr.y - r.top) / r.height) * 2;
        inside = Math.abs(lx) <= 1.05 && Math.abs(ly) <= 1.05;
        const target = inside ? (this.ptr.down ? 1 : this.ptr.touch ? 0 : now - this.ptr.moved < 600 ? 0.5 : 0) : 0;
        springStep(i.touchAmp, target, dt, 55, 7.5);
        const amp = i.touchAmp.x;
        const tr = i.touch;
        const put = (k: number, x: number, y: number, a: number) => {
          tr[k * 4] = ((x - r.left) / r.width) * 2 - 1;
          tr[k * 4 + 1] = 1 - ((y - r.top) / r.height) * 2;
          tr[k * 4 + 2] = a;
          tr[k * 4 + 3] = 0.34;
        };
        put(0, this.ptr.x, this.ptr.y, amp * 0.55);
        const h = this.ptr.hist;
        const back = (ms: number) => {
          for (let k = h.length - 1; k >= 0; k--) if (now - h[k].t >= ms) return h[k];
          return h[0] ?? { x: this.ptr.x, y: this.ptr.y };
        };
        const b1 = back(90);
        const b2 = back(200);
        put(1, b1.x, b1.y, amp * 0.3);
        put(2, b2.x, b2.y, amp * 0.18);
      } else {
        i.touch.fill(0);
        i.touchAmp.x = 0;
        i.touchAmp.v = 0;
      }
      const touching = Math.abs(i.touchAmp.x) > 0.002 || Math.abs(i.touchAmp.v) > 0.01;
      // follow target (pointer anywhere, or device tilt on touch devices)
      if (!i.scene.wantsFollow) {
        /* no follow */
      } else if (this.tilt.on && this.ptr.touch) {
        i.follow = [this.tilt.x, -this.tilt.y];
      } else if (this.ptr.x > -1e3) {
        const r = i.el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        i.follow = [Math.max(-1, Math.min(1, (this.ptr.x - cx) / (innerWidth * 0.45))), Math.max(-1, Math.min(1, -(this.ptr.y - cy) / (innerHeight * 0.45)))];
      }
      const wants = i.dirty || (!still && (i.animating || touching));
      if (!wants) continue;
      todo.push(i);
      if (!still && (i.animating || touching)) animatingAny = true;
    }

    // dot budget across everything drawn this frame
    const dens = this.phone ? DENSITY_PHONE : DENSITY_DESKTOP;
    const scale = this.densityScale * (this.quality >= 2 ? 1 : 0.72);
    const ns = allocateGrids(todo.map((i) => ({ side: Math.min(i.cssW, i.cssH), aspect: Math.max(i.cssW, i.cssH) / Math.max(1, Math.min(i.cssW, i.cssH)) })), dens, scale);

    // device px per canvas
    const dprCap = this.phone ? 2 : this.quality >= 2 ? 2 : 1.5;
    const maxSide = this.phone ? 1100 : 1600;
    let needW = 0;
    let needH = 0;
    for (const i of todo) {
      const dpr = Math.min(devicePixelRatio || 1, dprCap, maxSide / Math.max(i.cssW, i.cssH));
      i.pw = Math.max(1, Math.round(i.cssW * dpr));
      i.ph = Math.max(1, Math.round(i.cssH * dpr));
      needW = Math.max(needW, i.pw);
      needH = Math.max(needH, i.ph);
    }
    // size the shared canvas so most frames fit in one pass (fewer GL flushes);
    // it only grows, capped at 2048 (4096 for a single huge canvas)
    const maxTex = Math.min(4096, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
    const cap = Math.min(maxTex, Math.max(2048, needW, needH));
    const wantW = Math.min(cap, Math.max(needW, Math.min(2048, todo.reduce((s, i) => s + i.pw, 0))));
    let shelfX = 0;
    let shelfY = 0;
    let shelfH = 0;
    for (const i of todo) {
      if (shelfX + i.pw > wantW) {
        shelfX = 0;
        shelfY += shelfH;
        shelfH = 0;
      }
      shelfX += i.pw;
      shelfH = Math.max(shelfH, i.ph);
    }
    const wantH = Math.min(cap, shelfY + shelfH);
    const round = (v: number) => Math.ceil(v / 128) * 128;
    const cw = Math.min(maxTex, Math.max(this.canvas.width, round(wantW), 512));
    const ch = Math.min(maxTex, Math.max(this.canvas.height, round(wantH), 512));
    if (cw !== this.canvas.width || ch !== this.canvas.height) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    const t0 = performance.now();
    let x = 0;
    let y = 0;
    let rowH = 0;
    const pending: { i: Inst; x: number; y: number }[] = [];
    const flush = () => {
      for (const p of pending) {
        const c = p.i.ctx;
        if (!c) continue;
        if (p.i.el.width !== p.i.pw || p.i.el.height !== p.i.ph) {
          p.i.el.width = p.i.pw;
          p.i.el.height = p.i.ph;
        }
        c.globalCompositeOperation = 'copy';
        c.drawImage(this.canvas, p.x, p.y, p.i.pw, p.i.ph, 0, 0, p.i.pw, p.i.ph);
        c.globalCompositeOperation = 'source-over';
      }
      pending.length = 0;
      x = 0;
      y = 0;
      rowH = 0;
    };
    let dots = 0;
    todo.forEach((i, k) => {
      const w = Math.min(i.pw, cw);
      const h = Math.min(i.ph, ch);
      if (x + w > cw) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + h > ch) flush();
      const glY = ch - y - h;
      this.outRegion = { x, y: glY, w, h };
      this.bindOut();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const still = i.still || this.forceStill || this.quality === 0;
      i.n = ns[k];
      this.pendingDots = 0;
      let more = false;
      try {
        more = i.scene.frame({
          gl,
          eng: this,
          inst: i,
          w,
          h,
          cssW: i.cssW,
          cssH: i.cssH,
          t: i.t,
          dt: still ? 0 : dt,
          still,
          quality: this.quality,
          n: ns[k],
          touch: i.touch,
          follow: i.follow,
        });
      } catch (e) {
        console.error('Phi dots: scene failed', e);
        more = false;
      }
      dots += this.pendingDots;
      i.animating = more;
      i.dirty = false;
      i.lastDrawn = now;
      if (!still && more) i.t += dt;
      pending.push({ i, x, y });
      x += w;
      rowH = Math.max(rowH, h);
    });
    flush();
    gl.disable(gl.SCISSOR_TEST);
    const spent = performance.now() - t0;

    // stats twice a second
    const sa = this.statAcc;
    sa.frames++;
    sa.ms += spent;
    if (now - sa.since > 500) {
      this.stats.fps = Math.round((sa.frames * 1000) / Math.max(1, now - sa.since));
      this.stats.ms = +(sa.ms / Math.max(1, sa.frames)).toFixed(2);
      sa.frames = 0;
      sa.ms = 0;
      sa.since = now;
      this.stats.dots = dots;
      this.stats.drawn = todo.length;
      this.stats.live = this.insts.size;
      this.emit();
    }

    // weak device: step down when animation runs slow
    if (animatingAny && this.monitor.push(dtMs) && this.quality > 0) {
      console.info('Phi dots: frames are slow here, lowering animation quality to', this.quality - 1);
      this.setQuality((this.quality - 1) as QualityLevel);
    }
    if (!animatingAny) this.monitor.reset();

    if (animatingAny || [...this.insts].some((i) => i.visible && i.dirty)) this.kick();
    else this.last = 0;
  };
}

/** Pixels per dot for a grid of `rows` rows filling a viewport `hPx` tall at fit `fitY`. */
export function dotPx(rows: number, fitY: number, hPx: number): number {
  return (1.05 * 0.908 * fitY * hPx) / rows;
}
