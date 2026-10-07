// The Street drawn in dots: the street photograph as a field of glowing dots in
// rows (size and brightness follow the picture, colour from the lit shopfronts,
// parallax from its depth), the sign words on the shop boards, and the people
// (the walk cycle for you, standing figures for the cast). Plain WebGL with no
// library, one context. Where WebGL is missing, Street2D draws the photograph
// dim with plain figures instead.

import { hexToRgb } from '../../anim/core/math';
import { fontReady, THAI_FONT } from '../../anim/sources/text';
import { GROUND_Y, KERB_Y, STREET_H, STREET_W, type Rect } from '../geometry';

export type RGB = [number, number, number];
/** Texture region: u, v, w, h (0..1, rows top-down). */
export type Region = [number, number, number, number];

export interface View {
  s: number;
  left: number;
  top: number;
  /** stage size in CSS px */
  w: number;
  h: number;
}

export interface FigureDraw {
  tex: string;
  a: Region;
  b: Region;
  mix: number;
  /** feet position (world px) and crown-to-sole height */
  x: number;
  foot: number;
  h: number;
  /** crown, soles and body centre as tile fractions; tile width / height */
  head: number;
  feet: number;
  centre: number;
  aspect: number;
  flip: boolean;
  colour: RGB;
  clarity: number;
  alpha: number;
  ring?: number;
  /** soft edges: dots fade with the image's coverage (moving bodies, so edge dots never pop) */
  soft?: boolean;
  /** idle life, world px: sideways sway at the shoulders (none at the knees and below) and breath lift of the shoulders */
  sway?: number;
  breath?: number;
  /** frames a and b re-form (each dot leaves a and joins b at its own moment, scattering a little) instead of cross-fading; mix is the progress */
  reform?: boolean;
  /** drawn as the person's own photograph (the street people), not as dots */
  photo?: boolean;
}

/** Texture or image a figure can be drawn from. */
export type FigureSource = HTMLCanvasElement | HTMLImageElement;

/**
 * Dot spacing for people, CSS px: about 2.9 device px, never coarser than
 * 1.45 CSS px. Finer spacing was tried (2.1 device px): the dots then merge
 * and alias into streaks, which reads worse than clean, slightly larger dots.
 */
export function figurePitch(dpr: number) {
  return Math.max(0.95, Math.min(1.45, 2.9 / Math.max(1, dpr)));
}

/** Grid rows for a figure tile of tileH world px at view scale s. */
export function figureRows(tileH: number, s: number, dpr: number) {
  return Math.max(36, Math.min(260, Math.round((tileH * s) / figurePitch(dpr))));
}

export interface LightDraw {
  rect: Rect;
  reach: number;
  colour: RGB;
  level: number;
}

export interface SignDef {
  text: string;
  rect: Rect;
  colour: string;
}

export interface FrameDraw {
  view: View;
  t: number;
  motion: boolean;
  lights: LightDraw[];
  /** brightness per sign (same order as setSigns) */
  signs: number[];
  figures: FigureDraw[];
}

export interface StreetRenderer {
  readonly kind: 'gl' | '2d';
  resize(w: number, h: number, dpr: number): void;
  setStreet(src: { canvas: HTMLCanvasElement; px: Uint8ClampedArray; w: number; h: number }, plain: HTMLImageElement | null): void;
  setSigns(signs: SignDef[]): void;
  /** `mipmap`: the image is much finer than the dots it becomes (photos): pre-filter it so the dots never shimmer. */
  setTexture(key: string, canvas: FigureSource, mipmap?: boolean): void;
  /** A texture from raw RGBA pixels (rows top-down), updated every frame for moving bodies. */
  setPixels(key: string, w: number, h: number, data: Uint8Array): void;
  render(f: FrameDraw): void;
  dispose(): void;
}

// ---------------------------------------------------------------- shaders

const HEAD = `
precision highp float;
uniform vec4 uCam;   // left, top, scale, device pixel ratio
uniform vec2 uView;  // stage w, h (CSS px)
uniform float uRefX; // world x at the centre of the stage
uniform float uT; uniform float uMo;
uniform float uMaxPt;
varying vec3 vC; varying float vA; varying float vK;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(hash(vec2(i,7.)),hash(vec2(i+1.,7.)),f);}
float boxd(vec2 p,vec4 r){vec2 d=max(max(r.xy-p,p-r.zw),0.);return length(d);}
// world px to clip space; f > 1 moves faster than the pavement as the camera pans (nearer), f < 1 slower
vec4 place(vec2 w,float f){
  float sx=((w.x-uRefX)*f+uRefX-uCam.x)*uCam.z;
  float sy=(w.y-uCam.y)*uCam.z;
  return vec4(sx/uView.x*2.-1.,1.-sy/uView.y*2.,0.,1.);
}
const vec4 OFF=vec4(3.,3.,3.,1.);
`;

const STREET_VS =
  HEAD +
  `
attribute vec3 aG;            // world x, y, seed
uniform sampler2D uImg;       // r brightness, g depth (white near)
uniform sampler2D uBlur;      // the same, small and soft (for the glow)
uniform vec2 uSize;
uniform float uPitch, uDRef, uPar, uRoad, uGlow, uGain;
uniform vec4 uL[8]; uniform vec4 uLC[8]; uniform float uLR[8];
uniform vec4 uB[12];
void main(){
  vec2 uv=aG.xy/uSize;
  vec4 s=texture2D(uImg,uv);
  float l=uGlow>.5? texture2D(uBlur,uv).r : s.r;
  vec3 hue=vec3(0.); float ws=0., lv=1.;
  float below=aG.y-uRoad;
  for(int i=0;i<8;i++){
    float r=uLR[i];
    float dd=boxd(aG.xy,uL[i]);
    float w=exp(-dd*dd/(r*r));
    // the wet road mirrors each lit opening as a long streak below it
    float dx=max(max(uL[i].x-aG.x,aG.x-uL[i].z),0.);
    float rf=below>0.? exp(-dx*dx/(r*r*1.6))*exp(-below/150.)*.9 : 0.;
    w=max(w,rf)*step(uL[i].x,uL[i].z);
    hue+=w*uLC[i].rgb*uLC[i].a; ws+=w*uLC[i].a;
    lv*=mix(1.,uLC[i].a,w);
  }
  vec3 base=vec3(.66,.73,.88);
  vec3 col=mix(base,hue/max(ws,1e-4),clamp(ws,0.,1.)*.9);
  // the sign boards go dark so the words glow on them
  float bd=1.;
  for(int i=0;i<12;i++){ bd=min(bd,smoothstep(0.,5.,boxd(aG.xy,uB[i]))+step(uB[i].z,uB[i].x)); }
  // where the picture has no content (its matte) the dots fade out
  l*=mix(.14,1.,bd)*lv*uGain*smoothstep(.05,.6,s.a);
  float road=step(0.,below);
  // a faint rain shimmer in the reflections
  l*=1.+road*uMo*.24*sin(aG.x*.09+aG.y*.023+uT*1.3+aG.z*6.)*sin(aG.y*.29-uT*3.4);
  float row=floor(aG.y/uPitch);
  float x=aG.x;
  float burst=step(.93,noise(uT*.7+row*.011))*noise(uT*7.+row*.29);
  x+=uMo*burst*(hash(vec2(row,floor(uT*6.)))-.5)*uPitch*4.;
  float f=clamp(1.+uPar*(s.g-uDRef),.9,1.12);
  gl_Position=place(vec2(x,aG.y),f);
  float px=uPitch*uCam.z*uCam.w;
  if(uGlow>.5){
    float g=smoothstep(.38,.95,l)*(.2+.8*clamp(ws,0.,1.));
    vC=mix(col,vec3(1.),.15)*g*.11; vA=0.; vK=3.;
    gl_PointSize=min(uMaxPt,px*3.2);
    if(g<.01) gl_Position=OFF;
  } else {
    float lit=pow(clamp(l,0.,1.4),.75);
    float th=hash(aG.xy*.173+aG.z)*.9+.03;
    float on=step(th,lit*2.1+.015);
    float tw=1.+uMo*.07*(hash(aG.xy+floor(uT*4.))-.5);
    vC=(col*(.14+1.*lit)+mix(col,vec3(1.),.4)*lit*lit*.42)*tw; vA=0.;
    float line=uMo*step(.992,hash(vec2(row,floor(uT*2.5))))*step(.3,lit);
    vK=line>.5? 1. : (road>.5&&lit>.2? 2. : 0.);
    gl_PointSize=min(uMaxPt,px*(vK>.5? 1.5 : .42+.62*sqrt(lit)));
    if(on<.5) gl_Position=OFF;
  }
}`;

const SIGN_VS =
  HEAD +
  `
attribute vec4 aS;            // world x, y, sign atlas u, v
attribute vec4 aM;            // colour, sign index
uniform sampler2D uImg; uniform sampler2D uSign;
uniform vec2 uSize; uniform float uDRef, uPar, uSP, uGlow;
uniform float uSL[12];
void main(){
  float m=texture2D(uSign,aS.zw).r;
  float d=texture2D(uImg,aS.xy/uSize).g;
  float f=clamp(1.+uPar*(d-uDRef),.9,1.12);
  int i=int(aM.w+.5);
  float lv=uSL[i];
  float h=hash(aS.xy*.71);
  gl_Position=place(aS.xy,f);
  float px=uSP*uCam.z*uCam.w;
  vA=0.;
  if(uGlow>.5){
    float on=step(.3,m)*step(h,.22);
    vC=aM.rgb*m*lv*.16; vK=3.;
    gl_PointSize=min(uMaxPt,px*6.);
    if(on<.5) gl_Position=OFF;
  } else {
    float on=step(.28+h*.3,m);
    vC=(aM.rgb*(.5+.65*m)+mix(aM.rgb,vec3(1.),.45)*m*m*.5)*lv; vK=0.;
    gl_PointSize=min(uMaxPt,px*(.85+.3*m));
    if(on<.5||lv<.01) gl_Position=OFF;
  }
}`;

const FIG_VS =
  HEAD +
  `
attribute vec3 aG;            // tile u, v, seed
uniform sampler2D uTex;
uniform vec4 uRA; uniform vec4 uRB; uniform float uMix;
uniform vec4 uBox;            // tile in world px: x0, y0, w, h
uniform vec4 uBody;           // crown and soles (tile fractions), sway and breath (world px)
uniform float uFlip, uRows, uClar, uAlpha, uMode, uSoft, uLod, uReform;
uniform vec3 uC;
void main(){
  vec2 t=vec2(uFlip>.5? 1.-aG.x : aG.x, aG.y);
  // uLod: the mip level that matches one dot's footprint (no derivatives in a vertex shader)
  vec4 sa=texture2DLod(uTex,uRA.xy+t*uRA.zw,uLod), sb=texture2DLod(uTex,uRB.xy+t*uRB.zw,uLod);
  vec4 s=mix(sa,sb,uMix);
  // re-form: each dot switches from pose a to pose b at its own random moment (never both at
  // once), fading out just before and in just after, scattered a little around the middle
  float rf=1.; vec2 scat=vec2(0.);
  if(uReform>.5){
    float th=.15+.7*hash(aG.xy*7.13+3.1);
    float useB=step(th,uMix);
    s=mix(sa,sb,useB);
    rf=useB>.5? smoothstep(th,th+.14,uMix) : smoothstep(th,th-.14,uMix);
    float sc=sin(3.14159*uMix);
    float an=6.2832*hash(aG.xy*3.7+1.9);
    scat=vec2(cos(an),sin(an))*sc*(.35+.65*hash(aG.yx*5.1+.7))*uBox.w*.013;
    rf*=1.-.25*sc;
  }
  float mk=s.a, l=dot(s.rgb,vec3(.299,.587,.114));
  float row=floor(aG.y*uRows);
  float broken=1.-uClar;
  float off=broken*.5*(hash(vec2(row,floor(uT*2.)))-.5)*step(.55,hash(vec2(row*.37,floor(uT*1.3))));
  off+=step(.9,noise(uT*1.1+row*.03))*noise(uT*9.+row*.31)*.05;
  vec2 w=uBox.xy+aG.xy*uBox.zw;
  w.x+=off*uMo*uBox.w*.25;
  // idle life: the body above the knees sways, the shoulders lift with a breath; the soles never move
  float up=(uBody.y-aG.y)/max(uBody.y-uBody.x,.05);
  w.x+=uBody.z*smoothstep(.27,.82,up);
  w.y-=uBody.w*smoothstep(.5,.82,up);
  w+=scat;
  gl_Position=place(w,1.);
  float px=uBox.w/uRows*uCam.z*uCam.w;
  float L=.3+.7*l;
  float cov=uSoft>.5? smoothstep(.12,.75,mk) : 1.;
  float on=step(uSoft>.5? .12 : .5,mk)*step(aG.z,.3+.7*uClar);
  vA=0.;
  if(uMode>1.5){
    // a soft shadow behind the figure so it reads in front of the lit street
    on=step(.3,mk)*step(hash(aG.xy*3.1),.45);
    vC=vec3(0.); vA=.75*uAlpha*rf; vK=3.;
    gl_PointSize=min(uMaxPt,px*4.);
  } else if(uMode>.5){
    on*=step(hash(aG.xy*5.3),.25);
    vC=uC*L*.09*uAlpha*rf; vK=3.;
    gl_PointSize=min(uMaxPt,px*5.);
  } else {
    vC=(uC*(.42+.8*L)+mix(uC,vec3(1.),.3)*L*L*.35)*min(1.,L*2.+.2)*uAlpha*(.75+.25*uClar)*cov*rf; vK=0.;
    gl_PointSize=min(uMaxPt,px*(.78+.3*L)*(.55+.45*cov));
  }
  if(on<.5) gl_Position=OFF;
}`;

const RING_VS =
  HEAD +
  `
attribute vec3 aR;            // offset x, y (world px), brightness
uniform vec2 uO; uniform float uSz; uniform vec3 uC;
void main(){
  gl_Position=place(uO+aR.xy,1.);
  vC=uC*aR.z; vA=0.; vK=0.;
  gl_PointSize=uSz;
}`;

const RAIN_VS =
  HEAD +
  `
attribute vec3 aR;            // x 0..1, phase, speed
uniform float uSz;
void main(){
  float y=fract(aR.y+uT*(.55+aR.z*.6));
  float x=fract(aR.x-uRefX*.0003*(.6+aR.z)+y*.04);
  gl_Position=vec4(x*2.-1.,1.-y*2.,0.,1.);
  vC=vec3(.5,.62,.85)*(.05+.07*aR.z); vA=0.; vK=2.;
  gl_PointSize=uSz*(.7+aR.z*.6);
}`;

const FS = `
precision mediump float;
varying vec3 vC; varying float vA; varying float vK;
void main(){
  vec2 pc=gl_PointCoord-.5;
  float a;
  if(vK>2.5) a=exp(-dot(pc,pc)*12.);
  else {
    float r=vK<.5? length(pc) : vK<1.5? max(abs(pc.y)*3.,abs(pc.x)) : max(abs(pc.x)*1.8,abs(pc.y));
    a=smoothstep(.5,.2,r);
  }
  if(a<.004) discard;
  gl_FragColor=vec4(vC*a,a*vA);
}`;

// the street people as their own photographs: a quad per person, cut out by the matte, lit a
// little by the shop behind them; head turns blend real frames, greetings dissolve grain by grain
const PHOTO_VS =
  HEAD +
  `
attribute vec2 aQ;            // quad corner, 0..1
uniform vec4 uBox;            // tile in world px: x0, y0, w, h
uniform float uPad;           // extra world px on each side (sway, shadow)
varying vec2 vUv;
void main(){
  vec2 w=uBox.xy-uPad+aQ*(uBox.zw+2.*uPad);
  vUv=(w-uBox.xy)/uBox.zw;
  gl_Position=place(w,1.);
}`;

const PHOTO_FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec4 uRA; uniform vec4 uRB; uniform float uMix; uniform float uReform;
uniform vec4 uBox; uniform vec4 uBody; uniform float uFlip;
uniform vec3 uC; uniform float uAlpha; uniform float uShade;
uniform vec2 uTexel;          // one atlas texel, in tile units
varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec4 at(vec2 t){
  vec2 f=vec2(uFlip>.5? 1.-t.x : t.x,t.y);
  float inside=step(0.,t.x)*step(t.x,1.)*step(0.,t.y)*step(t.y,1.);
  // sampled at full detail (a negative bias keeps the photo crisp instead of the softer mip)
  vec4 a=texture2D(uTex,uRA.xy+clamp(f,0.,1.)*uRA.zw,-.7), b=texture2D(uTex,uRB.xy+clamp(f,0.,1.)*uRB.zw,-.7);
  vec4 s;
  if(uReform>.5){
    // each grain (about a world px) switches pose at its own moment: never both poses at once
    float th=.1+.8*hash(floor(f*uBox.zw));
    s=uMix>th? b : a;
    s.a*=.55+.45*smoothstep(0.,.1,abs(uMix-th));
  } else s=mix(a,b,uMix);
  s.a*=inside;
  return s;
}
void main(){
  // idle life: above the knees the body sways and the shoulders lift with a breath; the soles never move
  vec2 t=vUv;
  float up=(uBody.y-t.y)/max(uBody.y-uBody.x,.05);
  t.x-=uBody.z*smoothstep(.27,.82,up)/uBox.z;
  t.y+=uBody.w*smoothstep(.5,.82,up)/uBox.w;
  if(uShade>.5){
    // a soft dark edge and contact shadow, from the matte spread about 2 world px
    vec2 r=vec2(2.2/uBox.z,2.2/uBox.w);
    float m=0.;
    for(int i=0;i<8;i++){ float a=float(i)*.785; m+=at(t+vec2(cos(a),sin(a))*r).a; }
    m=m/8.;
    float a=smoothstep(.05,.6,m)*.5*uAlpha;
    gl_FragColor=vec4(0.,0.,0.,a);
    return;
  }
  vec4 s=at(t);
  // a clean edge: the matte's soft rim is tightened, so no fringe of the photo's background shows
  float a=smoothstep(.3,.8,s.a)*uAlpha;
  if(a<.004) discard;
  // crisp like a digitised fighter: a light unsharp mask, a little more colour and contrast
  vec3 nb=(at(t+vec2(uTexel.x,0.)).rgb+at(t-vec2(uTexel.x,0.)).rgb+at(t+vec2(0.,uTexel.y)).rgb+at(t-vec2(0.,uTexel.y)).rgb)*.25;
  vec3 col=max(s.rgb+(s.rgb-nb)*.7,0.);
  col=mix(vec3(dot(col,vec3(.299,.587,.114))),col,1.2);
  col=(col-.5)*1.08+.5;
  // a slight wash of the shop's light
  col=clamp(col,0.,1.)*mix(vec3(1.),uC,.22)*1.05;
  gl_FragColor=vec4(col*a,a);
}`;

// ---------------------------------------------------------------- GL renderer

type GL = WebGLRenderingContext | WebGL2RenderingContext;

interface Prog {
  p: WebGLProgram;
  u: (n: string) => WebGLUniformLocation | null;
  a: (n: string) => number;
}

interface Tex {
  tex: WebGLTexture;
  w: number;
  h: number;
  /** has a full mip chain */
  mips: boolean;
}

const RAIN_N = 220;
const RING_N = 44;

/** Street dots per world px for a scale: about one dot every 2.7 CSS px, in quarter-px steps. */
export function streetPitch(s: number) {
  return Math.max(2.25, Math.min(8, Math.round((2.7 / s) * 4) / 4));
}

export class StreetGL implements StreetRenderer {
  readonly kind = 'gl' as const;
  private gl: GL;
  private lost = false;
  private progs: Record<'street' | 'sign' | 'fig' | 'photo' | 'ring' | 'rain', Prog> | null = null;
  private tex = new Map<string, Tex>();
  private srcs = new Map<string, { src: FigureSource; mip: boolean }>();
  private street: { canvas: HTMLCanvasElement; blur: HTMLCanvasElement; dRef: number } | null = null;
  private signDefs: SignDef[] = [];
  private signAtlas: { canvas: HTMLCanvasElement; slots: Region[] } | null = null;
  private signTok = 0;
  private bufs = new Map<string, { buf: WebGLBuffer; n: number }>();
  private pitch = 0;
  private dpr = 1;
  private maxPt = 64;

  static create(canvas: HTMLCanvasElement): StreetGL | null {
    const opts: WebGLContextAttributes = { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    let gl: GL | null = null;
    try {
      gl = (canvas.getContext('webgl2', opts) as WebGL2RenderingContext | null) ?? (canvas.getContext('webgl', opts) as WebGLRenderingContext | null);
    } catch {
      gl = null;
    }
    if (!gl || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) return null;
    const r = new StreetGL(canvas, gl);
    return r.progs ? r : null;
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: GL,
  ) {
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.init();
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.lost = false;
    this.tex.clear();
    this.bufs.clear();
    this.init();
  };

  private init() {
    const gl = this.gl;
    try {
      this.progs = {
        street: this.program(STREET_VS),
        sign: this.program(SIGN_VS),
        fig: this.program(FIG_VS),
        photo: this.program(PHOTO_VS, PHOTO_FS),
        ring: this.program(RING_VS),
        rain: this.program(RAIN_VS),
      };
    } catch (e) {
      console.warn('Phi street:', e);
      this.progs = null;
      return;
    }
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    this.maxPt = range ? Math.max(8, range[1]) : 64;
    for (const [k, c] of this.srcs) this.upload(k, c.src, c.mip);
    if (this.street) {
      this.upload('street', this.street.canvas);
      this.upload('blur', this.street.blur);
    }
    if (this.signAtlas) this.upload('signs', this.signAtlas.canvas);
    this.pitch = 0;
    // the rain and the ring never change
    const rain = new Float32Array(RAIN_N * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < RAIN_N; i++) rain.set([rnd(), rnd(), rnd()], i * 3);
    this.buffer('rain', rain);
    this.buffer('quad', new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
    // a flat stand-in for the street's depth until the photograph loads
    const flat = document.createElement('canvas');
    flat.width = flat.height = 2;
    const fg = flat.getContext('2d')!;
    fg.fillStyle = '#008000';
    fg.fillRect(0, 0, 2, 2);
    this.upload('flat', flat);
  }

  private program(vs: string, fs = FS): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const us = new Map<string, WebGLUniformLocation | null>();
    const as = new Map<string, number>();
    return {
      p,
      u: (n) => {
        if (!us.has(n)) us.set(n, gl.getUniformLocation(p, n));
        return us.get(n)!;
      },
      a: (n) => {
        if (!as.has(n)) as.set(n, gl.getAttribLocation(p, n));
        return as.get(n)!;
      },
    };
  }

  private upload(key: string, c: FigureSource, mip = false) {
    const gl = this.gl;
    const old = this.tex.get(key);
    const tex = old?.tex ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    const w = c instanceof HTMLImageElement ? c.naturalWidth : c.width;
    const h = c instanceof HTMLImageElement ? c.naturalHeight : c.height;
    // mipmaps need WebGL 2 for sizes that are not powers of two
    const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
    const mips = mip && (pot || (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext));
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex.set(key, { tex, w, h, mips });
  }

  private buffer(key: string, data: Float32Array, stride = 3) {
    const gl = this.gl;
    const old = this.bufs.get(key);
    if (old) gl.deleteBuffer(old.buf);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const v = { buf, n: data.length / stride };
    this.bufs.set(key, v);
    return v;
  }

  /** A unit grid (u, v, seed) of cols x rows points, cached. */
  private grid(cols: number, rows: number) {
    const key = `g${cols}x${rows}`;
    const have = this.bufs.get(key);
    if (have) return have;
    const d = new Float32Array(cols * rows * 3);
    let k = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        d[k++] = (x + 0.5) / cols;
        d[k++] = (y + 0.5) / rows;
        d[k++] = fract(Math.sin((x * 12.9898 + y * 78.233) * 1.0) * 43758.5453);
      }
    return this.buffer(key, d);
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  setStreet(src: { canvas: HTMLCanvasElement; px: Uint8ClampedArray; w: number; h: number }) {
    // the depth along the middle of the pavement: dots there move with the people
    const y = Math.round((GROUND_Y / STREET_H) * src.h);
    let sum = 0;
    for (let x = 0; x < src.w; x++) sum += src.px[(y * src.w + x) * 4 + 1];
    const dRef = sum / src.w / 255;
    const blur = document.createElement('canvas');
    blur.width = Math.round(src.w / 8);
    blur.height = Math.round(src.h / 8);
    const half = document.createElement('canvas');
    half.width = Math.round(src.w / 2);
    half.height = Math.round(src.h / 2);
    const hg = half.getContext('2d')!;
    hg.imageSmoothingQuality = 'high';
    hg.drawImage(src.canvas, 0, 0, half.width, half.height);
    const bg = blur.getContext('2d')!;
    bg.imageSmoothingQuality = 'high';
    bg.filter = 'blur(2px)';
    bg.drawImage(half, 0, 0, blur.width, blur.height);
    this.street = { canvas: src.canvas, blur, dRef };
    if (this.progs && !this.lost) {
      this.upload('street', src.canvas);
      this.upload('blur', blur);
    }
  }

  setTexture(key: string, canvas: FigureSource, mipmap = false) {
    this.srcs.set(key, { src: canvas, mip: mipmap });
    if (this.progs && !this.lost) this.upload(key, canvas, mipmap);
  }

  setPixels(key: string, w: number, h: number, data: Uint8Array) {
    if (!this.progs || this.lost) return;
    const gl = this.gl;
    const old = this.tex.get(key);
    const tex = old?.tex ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (old && old.w === w && old.h === h) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.tex.set(key, { tex, w, h, mips: false });
  }

  setSigns(signs: SignDef[]) {
    this.signDefs = signs;
    const tok = ++this.signTok;
    Promise.all(signs.map((s) => fontReady(s.text))).then(() => {
      if (tok !== this.signTok) return;
      this.signAtlas = signAtlas(signs);
      if (this.progs && !this.lost) this.upload('signs', this.signAtlas.canvas);
      this.pitch = 0;
    });
  }

  /** Rebuild the street and sign point sets for a dot pitch. */
  private build(pitch: number) {
    this.pitch = pitch;
    const cols = Math.floor(STREET_W / pitch);
    const rows = Math.floor(STREET_H / pitch);
    const mk = (step: number) => {
      const c = Math.floor(cols / step);
      const r = Math.floor(rows / step);
      const d = new Float32Array(c * r * 3);
      let k = 0;
      for (let y = 0; y < r; y++)
        for (let x = 0; x < c; x++) {
          d[k++] = (x + 0.5) * pitch * step;
          d[k++] = (y + 0.5) * pitch * step;
          d[k++] = fract(Math.sin(x * 91.7 + y * 47.3) * 9631.17);
        }
      return d;
    };
    this.buffer('street', mk(1));
    this.buffer('streetGlow', mk(3));
    if (this.signAtlas) {
      const sp = signPitch(pitch);
      const parts: number[] = [];
      this.signDefs.forEach((s, i) => {
        const [x0, y0, x1, y1] = s.rect;
        const slot = this.signAtlas!.slots[i];
        const c = hexToRgb(s.colour);
        const nc = Math.max(4, Math.round((x1 - x0) / sp));
        const nr = Math.max(3, Math.round((y1 - y0) / sp));
        for (let y = 0; y < nr; y++)
          for (let x = 0; x < nc; x++) {
            const u = (x + 0.5) / nc;
            const v = (y + 0.5) / nr;
            parts.push(x0 + u * (x1 - x0), y0 + v * (y1 - y0), slot[0] + u * slot[2], slot[1] + v * slot[3], c[0], c[1], c[2], i);
          }
      });
      this.buffer('signs', new Float32Array(parts), 8);
    }
  }

  private common(p: Prog, f: FrameDraw) {
    const gl = this.gl;
    const v = f.view;
    gl.useProgram(p.p);
    gl.uniform4f(p.u('uCam'), v.left, v.top, v.s, this.dpr);
    gl.uniform2f(p.u('uView'), v.w, v.h);
    gl.uniform1f(p.u('uRefX'), v.left + v.w / v.s / 2);
    gl.uniform1f(p.u('uT'), f.t);
    gl.uniform1f(p.u('uMo'), f.motion ? 1 : 0);
    gl.uniform1f(p.u('uMaxPt'), this.maxPt);
  }

  private attrib(p: Prog, name: string, buf: WebGLBuffer, size: number, stride: number, offset: number) {
    const gl = this.gl;
    const a = p.a(name);
    if (a < 0) return -1;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, size, gl.FLOAT, false, stride * 4, offset * 4);
    return a;
  }

  private bind(p: Prog, name: string, unit: number, key: string) {
    const gl = this.gl;
    const t = this.tex.get(key);
    if (!t) return false;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(p.u(name), unit);
    return true;
  }

  render(f: FrameDraw) {
    const gl = this.gl;
    if (this.lost || !this.progs || gl.isContextLost()) return;
    const P = this.progs;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(5 / 255, 5 / 255, 5 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    const light = () => gl.blendFunc(gl.ONE, gl.ONE);
    const shade = () => gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    light();
    const pitch = streetPitch(f.view.s);
    if (pitch !== this.pitch) this.build(pitch);
    const dRef = this.street?.dRef ?? 0.5;
    const PAR = 0.16;

    // the street
    if (this.street && this.tex.has('street')) {
      const p = P.street;
      this.common(p, f);
      this.bind(p, 'uImg', 0, 'street');
      this.bind(p, 'uBlur', 1, 'blur');
      gl.uniform2f(p.u('uSize'), STREET_W, STREET_H);
      gl.uniform1f(p.u('uDRef'), dRef);
      gl.uniform1f(p.u('uPar'), PAR);
      gl.uniform1f(p.u('uRoad'), KERB_Y);
      gl.uniform1f(p.u('uGain'), 1.05);
      const L = new Float32Array(32);
      const LC = new Float32Array(32);
      const LR = new Float32Array(8).fill(1);
      f.lights.slice(0, 8).forEach((l, i) => {
        L.set(l.rect, i * 4);
        LC.set([l.colour[0], l.colour[1], l.colour[2], l.level], i * 4);
        LR[i] = l.reach;
      });
      // unused lights: an empty box (x1 < x0) that the shader skips
      for (let i = f.lights.length; i < 8; i++) L.set([1, 0, 0, 0], i * 4);
      gl.uniform4fv(p.u('uL[0]'), L);
      gl.uniform4fv(p.u('uLC[0]'), LC);
      gl.uniform1fv(p.u('uLR[0]'), LR);
      const B = new Float32Array(48);
      for (let i = 0; i < 12; i++) B.set(this.signDefs[i] && this.signAtlas ? padRect(this.signDefs[i].rect, 2) : [1, 0, 0, 0], i * 4);
      gl.uniform4fv(p.u('uB[0]'), B);
      for (const [key, glow] of [['streetGlow', 1], ['street', 0]] as const) {
        const b = this.bufs.get(key)!;
        gl.uniform1f(p.u('uPitch'), glow ? pitch * 3 : pitch);
        gl.uniform1f(p.u('uGlow'), glow);
        const a = this.attrib(p, 'aG', b.buf, 3, 3, 0);
        gl.drawArrays(gl.POINTS, 0, b.n);
        gl.disableVertexAttribArray(a);
      }
    }

    // the sign words
    const sb = this.bufs.get('signs');
    if (sb && this.signAtlas && this.tex.has('signs')) {
      const p = P.sign;
      this.common(p, f);
      this.bind(p, 'uImg', 0, this.tex.has('street') ? 'street' : 'flat');
      this.bind(p, 'uSign', 1, 'signs');
      gl.uniform2f(p.u('uSize'), STREET_W, STREET_H);
      gl.uniform1f(p.u('uDRef'), dRef);
      gl.uniform1f(p.u('uPar'), PAR);
      gl.uniform1f(p.u('uSP'), signPitch(pitch));
      const SL = new Float32Array(12);
      for (let i = 0; i < 12; i++) SL[i] = f.signs[i] ?? 1;
      gl.uniform1fv(p.u('uSL[0]'), SL);
      for (const glow of [1, 0]) {
        gl.uniform1f(p.u('uGlow'), glow);
        const a0 = this.attrib(p, 'aS', sb.buf, 4, 8, 0);
        const a1 = this.attrib(p, 'aM', sb.buf, 4, 8, 4);
        gl.drawArrays(gl.POINTS, 0, sb.n);
        gl.disableVertexAttribArray(a0);
        gl.disableVertexAttribArray(a1);
      }
    }

    // the people
    for (const fig of f.figures) {
      const t = this.tex.get(fig.tex);
      if (!t) continue;
      const tileH = fig.h / (fig.feet - fig.head);
      const tileW = tileH * fig.aspect;
      const cx = fig.flip ? 1 - fig.centre : fig.centre;
      const box: [number, number, number, number] = [fig.x - cx * tileW, fig.foot - fig.feet * tileH, tileW, tileH];
      // people off screen cost nothing
      const vx0 = f.view.left - 8;
      const vx1 = f.view.left + f.view.w / f.view.s + 8;
      if (box[0] > vx1 || box[0] + tileW < vx0) continue;
      if (fig.photo) {
        this.drawPhoto(P.photo, fig, box, f);
        light();
        continue;
      }
      const rows = figureRows(tileH, f.view.s, this.dpr);
      const cols = Math.max(12, Math.round(rows * fig.aspect));
      const g = this.grid(cols, rows);
      if (fig.ring) this.drawRing(P.ring, fig, f);
      const p = P.fig;
      this.common(p, f);
      this.bind(p, 'uTex', 0, fig.tex);
      gl.uniform4f(p.u('uRA'), fig.a[0], fig.a[1], fig.a[2], fig.a[3]);
      gl.uniform4f(p.u('uRB'), fig.b[0], fig.b[1], fig.b[2], fig.b[3]);
      gl.uniform1f(p.u('uMix'), fig.mix);
      gl.uniform4f(p.u('uBox'), box[0], box[1], box[2], box[3]);
      gl.uniform4f(p.u('uBody'), fig.head, fig.feet, fig.sway ?? 0, fig.breath ?? 0);
      gl.uniform1f(p.u('uFlip'), fig.flip ? 1 : 0);
      gl.uniform1f(p.u('uRows'), rows);
      // texels per dot along the tile: pick the mip level that averages them
      gl.uniform1f(p.u('uLod'), t.mips ? Math.max(0, Math.min(6, Math.log2((fig.a[3] * t.h) / rows) - 0.35)) : 0);
      gl.uniform1f(p.u('uClar'), fig.clarity);
      gl.uniform1f(p.u('uAlpha'), fig.alpha);
      gl.uniform1f(p.u('uSoft'), fig.soft ? 1 : 0);
      gl.uniform1f(p.u('uReform'), fig.reform ? 1 : 0);
      gl.uniform3f(p.u('uC'), fig.colour[0], fig.colour[1], fig.colour[2]);
      const a = this.attrib(p, 'aG', g.buf, 3, 3, 0);
      for (const mode of [2, 1, 0]) {
        if (mode === 2) shade();
        else light();
        gl.uniform1f(p.u('uMode'), mode);
        gl.drawArrays(gl.POINTS, 0, g.n);
      }
      gl.disableVertexAttribArray(a);
    }

    // rain
    if (f.motion) {
      const p = P.rain;
      this.common(p, f);
      const b = this.bufs.get('rain')!;
      gl.uniform1f(p.u('uSz'), Math.max(3, 9 * this.dpr));
      const a = this.attrib(p, 'aR', b.buf, 3, 3, 0);
      gl.drawArrays(gl.POINTS, 0, b.n);
      gl.disableVertexAttribArray(a);
    }
  }

  /** A street person as their photograph: a soft shadow first, then the cut-out, blended over the street. */
  private drawPhoto(p: Prog, fig: FigureDraw, box: [number, number, number, number], f: FrameDraw) {
    const gl = this.gl;
    const q = this.bufs.get('quad');
    if (!q) return;
    this.common(p, f);
    if (!this.bind(p, 'uTex', 0, fig.tex)) return;
    gl.uniform4f(p.u('uBox'), box[0], box[1], box[2], box[3]);
    gl.uniform1f(p.u('uPad'), 4);
    gl.uniform4f(p.u('uRA'), fig.a[0], fig.a[1], fig.a[2], fig.a[3]);
    gl.uniform4f(p.u('uRB'), fig.b[0], fig.b[1], fig.b[2], fig.b[3]);
    gl.uniform1f(p.u('uMix'), fig.mix);
    gl.uniform1f(p.u('uReform'), fig.reform ? 1 : 0);
    gl.uniform4f(p.u('uBody'), fig.head, fig.feet, fig.sway ?? 0, fig.breath ?? 0);
    gl.uniform1f(p.u('uFlip'), fig.flip ? 1 : 0);
    gl.uniform3f(p.u('uC'), fig.colour[0], fig.colour[1], fig.colour[2]);
    gl.uniform1f(p.u('uAlpha'), fig.alpha);
    const t = this.tex.get(fig.tex)!;
    gl.uniform2f(p.u('uTexel'), 1 / Math.max(1, fig.a[2] * t.w), 1 / Math.max(1, fig.a[3] * t.h));
    const a = this.attrib(p, 'aQ', q.buf, 2, 2, 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const shadeOn of [1, 0]) {
      gl.uniform1f(p.u('uShade'), shadeOn);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (a >= 0) gl.disableVertexAttribArray(a);
  }

  private drawRing(p: Prog, fig: FigureDraw, f: FrameDraw) {
    const gl = this.gl;
    const s = f.view.s;
    this.common(p, f);
    // a ring of dots under the feet, about 0.6 m across
    const rx = fig.h * 0.2;
    const ry = fig.h * 0.045;
    const key = `ring${Math.round(rx)}`;
    let b = this.bufs.get(key);
    if (!b) {
      const d = new Float32Array(RING_N * 3);
      for (let i = 0; i < RING_N; i++) {
        const a = (i / RING_N) * Math.PI * 2;
        d.set([Math.cos(a) * rx, Math.sin(a) * ry, 0.45 + 0.55 * Math.max(0, Math.sin(a))], i * 3);
      }
      b = this.buffer(key, d);
    }
    gl.uniform2f(p.u('uO'), fig.x, fig.foot + ry * 0.4);
    gl.uniform1f(p.u('uSz'), Math.max(2, 2.6 * this.dpr * Math.min(1.4, Math.max(0.8, s * 1.6))));
    gl.uniform3f(p.u('uC'), (fig.ring ?? 1) * 0.9, (fig.ring ?? 1) * 0.9, (fig.ring ?? 1) * 0.9);
    const a = this.attrib(p, 'aR', b.buf, 3, 3, 0);
    gl.drawArrays(gl.POINTS, 0, b.n);
    gl.disableVertexAttribArray(a);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    if (!gl.isContextLost()) {
      for (const t of this.tex.values()) gl.deleteTexture(t.tex);
      for (const b of this.bufs.values()) gl.deleteBuffer(b.buf);
      if (this.progs) for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
    }
    this.tex.clear();
    this.bufs.clear();
    this.signTok++;
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

const fract = (x: number) => x - Math.floor(x);
const signPitch = (pitch: number) => Math.max(1.2, Math.min(3.2, pitch * 0.42));
const padRect = (r: Rect, p: number): Rect => [r[0] - p, r[1] - p, r[2] + p, r[3] + p];

/** All the sign words, white on black, one slot each (in the board's own proportions). */
function signAtlas(signs: SignDef[]): { canvas: HTMLCanvasElement; slots: Region[] } {
  const SH = 112;
  const W = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Math.max(1, signs.length) * SH;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  const slots: Region[] = [];
  signs.forEach((s, i) => {
    const aspect = (s.rect[2] - s.rect[0]) / Math.max(1, s.rect[3] - s.rect[1]);
    const sw = Math.min(W, Math.round(SH * aspect));
    const sh = sw < W ? SH : Math.round(W / aspect);
    const y0 = i * SH;
    let size = sh * 0.66;
    g.font = `600 ${size}px ${THAI_FONT}`;
    let m = g.measureText(s.text);
    const k = Math.min((sw * 0.86) / Math.max(1, m.width), (sh * 0.8) / Math.max(1, (m.actualBoundingBoxAscent || size * 0.75) + (m.actualBoundingBoxDescent || size * 0.25)));
    size *= Math.min(1.4, k);
    g.font = `600 ${size}px ${THAI_FONT}`;
    m = g.measureText(s.text);
    const asc = m.actualBoundingBoxAscent || size * 0.75;
    const desc = m.actualBoundingBoxDescent || size * 0.25;
    g.fillText(s.text, sw / 2, y0 + sh / 2 + (asc - desc) / 2);
    slots.push([0, y0 / cv.height, sw / W, sh / cv.height]);
  });
  return { canvas: cv, slots };
}

// ---------------------------------------------------------------- 2D fallback

/** No WebGL: the photograph drawn dim, the sign words as glowing text, plain figures. */
export class Street2D implements StreetRenderer {
  readonly kind = '2d' as const;
  private g: CanvasRenderingContext2D | null;
  private plain: HTMLImageElement | null = null;
  private signs: SignDef[] = [];
  private tex = new Map<string, HTMLCanvasElement>();
  private tinted = new Map<string, HTMLCanvasElement>();
  private w = 1;
  private h = 1;
  private dpr = 1;
  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d');
  }
  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }
  setStreet(_src: unknown, plain: HTMLImageElement | null) {
    this.plain = plain;
  }
  setSigns(signs: SignDef[]) {
    this.signs = signs;
  }
  setTexture(key: string, src: FigureSource) {
    let canvas: HTMLCanvasElement;
    if (src instanceof HTMLImageElement) {
      canvas = document.createElement('canvas');
      canvas.width = src.naturalWidth;
      canvas.height = src.naturalHeight;
      canvas.getContext('2d')?.drawImage(src, 0, 0);
    } else canvas = src;
    this.tex.set(key, canvas);
    for (const k of [...this.tinted.keys()]) if (k.startsWith(`${key}|`)) this.tinted.delete(k);
  }
  setPixels(key: string, w: number, h: number, data: Uint8Array) {
    let c = this.tex.get(key);
    if (!c || c.width !== w || c.height !== h) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    this.setTexture(key, c);
  }
  private tint(key: string, c: RGB) {
    const k = `${key}|${c.join(',')}`;
    let t = this.tinted.get(k);
    const src = this.tex.get(key);
    if (!t && src) {
      t = document.createElement('canvas');
      t.width = src.width;
      t.height = src.height;
      const g = t.getContext('2d')!;
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
      g.fillRect(0, 0, t.width, t.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(src, 0, 0);
      this.tinted.set(k, t);
    }
    return t;
  }
  render(f: FrameDraw) {
    const g = this.g;
    if (!g) return;
    const { s, left, top } = f.view;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#050505';
    g.fillRect(0, 0, this.w, this.h);
    g.setTransform(this.dpr * s, 0, 0, this.dpr * s, -left * s * this.dpr, -top * s * this.dpr);
    if (this.plain) {
      g.globalAlpha = 0.42;
      g.drawImage(this.plain, 0, 0, STREET_W, STREET_H);
      g.globalAlpha = 1;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    this.signs.forEach((sg, i) => {
      const [x0, y0, x1, y1] = sg.rect;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.globalAlpha = f.signs[i] ?? 1;
      g.font = `600 ${Math.round((y1 - y0) * 0.62)}px ${THAI_FONT}`;
      g.fillStyle = sg.colour;
      g.shadowColor = sg.colour;
      g.shadowBlur = 10;
      g.fillText(sg.text, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9);
      g.shadowBlur = 0;
      g.globalAlpha = 1;
    });
    for (const fig of f.figures) {
      const src = this.tint(fig.tex, fig.colour);
      if (!src) continue;
      const tileH = fig.h / (fig.feet - fig.head);
      const tileW = tileH * fig.aspect;
      const cx = fig.flip ? 1 - fig.centre : fig.centre;
      const x0 = fig.x - cx * tileW;
      const y0 = fig.foot - fig.feet * tileH;
      const a = fig.mix < 0.5 ? fig.a : fig.b;
      g.save();
      g.globalAlpha = fig.alpha;
      if (fig.flip) {
        g.translate(x0 + tileW, y0);
        g.scale(-1, 1);
      } else g.translate(x0, y0);
      g.drawImage(src, a[0] * src.width, a[1] * src.height, a[2] * src.width, a[3] * src.height, 0, 0, tileW, tileH);
      g.restore();
      if (fig.ring) {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 1.5 / s;
        g.beginPath();
        g.ellipse(fig.x, fig.foot + fig.h * 0.02, fig.h * 0.2, fig.h * 0.045, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  dispose() {
    this.tex.clear();
    this.tinted.clear();
  }
}

/** The best renderer this device has. */
export function makeStreetRenderer(canvas: HTMLCanvasElement): StreetRenderer {
  return StreetGL.create(canvas) ?? new Street2D(canvas);
}
