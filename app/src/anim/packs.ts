// Asset packs: real portraits, clips, objects and scenes made by the owner with
// the image model, given depth by the free depth model, and packed by
// phi-project/pipeline/pack_portraits.py. When a pack exists it replaces the
// code-drawn stand-in; until then everything is drawn in code.
//
// Layout under public/packs/ (format documented in pipeline/CAST_SHEET.md):
//   manifest.json                      what exists (the app reads only this first)
//   <who>/<expression>.webp            brightness, alpha = matte
//   <who>/<expression>.depth.webp      depth, white = near
//   seq/<name>.webp, seq/<name>.depth.webp     frame atlas (cols x rows tiles)
//   objects/<id>.webp, objects/<id>.depth.webp
//   scenes/<place>.webp, scenes/<place>.depth.webp

import type { Expression } from './core/looks';

export interface PairRef {
  image: string;
  depth: string;
}
export interface DepthMap {
  /** z = (depth - offset) * scale */
  offset: number;
  scale: number;
}
export interface PersonPack {
  credit: string;
  depth: DepthMap;
  expressions: Partial<Record<Expression, PairRef>>;
}
export interface StillPack extends PairRef {
  credit: string;
  depth_map: DepthMap;
  size: [number, number];
}
export interface SeqPack extends PairRef {
  credit: string;
  who: string | null;
  fps: number;
  frames: number;
  cols: number;
  rows: number;
  tile: [number, number];
  depth_map: DepthMap;
  /** frame to show as the still fallback */
  key_frame: number;
  /** "near": the nearest dots (a hand on the glass) outlast the rest when it fades */
  linger: 'near' | null;
  /** dissolve the last part of the clip (0..1) */
  end_fade: number;
}
export interface PackManifest {
  version: number;
  credit: string;
  people: Record<string, PersonPack>;
  sequences: Record<string, SeqPack>;
  objects: Record<string, StillPack>;
  scenes: Record<string, StillPack>;
}

export const EMPTY_MANIFEST: PackManifest = { version: 1, credit: '', people: {}, sequences: {}, objects: {}, scenes: {} };
const PORTRAIT_DEPTH: DepthMap = { offset: 0.6, scale: 0.9 };

const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x: unknown) => (typeof x === 'string' && x.length > 0 && !x.includes('..') && !/^[a-z]+:/i.test(x) ? x : null);
const depthOf = (x: unknown, d: DepthMap): DepthMap => {
  const o = (x ?? {}) as Record<string, unknown>;
  return { offset: num(o.offset, d.offset), scale: num(o.scale, d.scale) };
};

/** Validate a manifest; anything malformed is dropped rather than trusted. */
export function parseManifest(json: unknown): PackManifest {
  if (!json || typeof json !== 'object') return EMPTY_MANIFEST;
  const j = json as Record<string, unknown>;
  const out: PackManifest = { version: num(j.version, 1), credit: typeof j.credit === 'string' ? j.credit : '', people: {}, sequences: {}, objects: {}, scenes: {} };
  const credit = out.credit || 'AI-generated';
  for (const [who, raw] of Object.entries((j.people ?? {}) as Record<string, unknown>)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const ex: PersonPack['expressions'] = {};
    for (const [e, pr] of Object.entries((r.expressions ?? {}) as Record<string, unknown>)) {
      const p = (pr ?? {}) as Record<string, unknown>;
      const image = str(p.image);
      const depth = str(p.depth);
      if (image && depth) ex[e as Expression] = { image, depth };
    }
    if (Object.keys(ex).length) out.people[who] = { credit: typeof r.credit === 'string' ? r.credit : credit, depth: depthOf(r.depth, PORTRAIT_DEPTH), expressions: ex };
  }
  const still = (src: unknown, into: Record<string, StillPack>) => {
    for (const [id, raw] of Object.entries((src ?? {}) as Record<string, unknown>)) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const image = str(r.image);
      const depth = str(r.depth);
      if (!image || !depth) continue;
      const size = Array.isArray(r.size) && r.size.length === 2 ? ([num(r.size[0], 256), num(r.size[1], 256)] as [number, number]) : ([256, 256] as [number, number]);
      into[id] = { image, depth, credit: typeof r.credit === 'string' ? r.credit : credit, depth_map: depthOf(r.depth_map, PORTRAIT_DEPTH), size };
    }
  };
  still(j.objects, out.objects);
  still(j.scenes, out.scenes);
  for (const [id, raw] of Object.entries((j.sequences ?? {}) as Record<string, unknown>)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const image = str(r.image);
    const depth = str(r.depth);
    const frames = Math.floor(num(r.frames, 0));
    const cols = Math.floor(num(r.cols, 0));
    const rows = Math.floor(num(r.rows, 0));
    if (!image || !depth || frames < 1 || cols < 1 || rows < 1 || cols * rows < frames) continue;
    const tile = Array.isArray(r.tile) && r.tile.length === 2 ? ([num(r.tile[0], 192), num(r.tile[1], 192)] as [number, number]) : ([192, 192] as [number, number]);
    out.sequences[id] = {
      image,
      depth,
      credit: typeof r.credit === 'string' ? r.credit : credit,
      who: typeof r.who === 'string' ? r.who : null,
      fps: Math.max(1, Math.min(30, num(r.fps, 10))),
      frames,
      cols,
      rows,
      tile,
      depth_map: depthOf(r.depth_map, PORTRAIT_DEPTH),
      key_frame: Math.max(0, Math.min(frames - 1, Math.floor(num(r.key_frame, frames - 1)))),
      linger: r.linger === 'near' ? 'near' : null,
      end_fade: Math.max(0, Math.min(1, num(r.end_fade, 0.6))),
    };
  }
  return out;
}

/** The portrait for an expression, or neutral when that one was not made. */
export function resolvePortrait(m: PackManifest, who: string, e: Expression): { expr: Expression; ref: PairRef } | null {
  const p = m.people[who];
  if (!p) return null;
  const ref = p.expressions[e];
  if (ref) return { expr: e, ref };
  if (p.expressions.neutral) return { expr: 'neutral', ref: p.expressions.neutral };
  const any = Object.entries(p.expressions)[0];
  return any ? { expr: any[0] as Expression, ref: any[1] as PairRef } : null;
}

/** Atlas region (u, v, w, h in 0..1, rows top-down) of frame f of a packed clip. */
export function seqFrameRect(s: Pick<SeqPack, 'cols' | 'rows' | 'frames'>, f: number): [number, number, number, number] {
  const i = Math.max(0, Math.min(s.frames - 1, Math.floor(f)));
  const c = i % s.cols;
  const r = Math.floor(i / s.cols);
  return [c / s.cols, r / s.rows, 1 / s.cols, 1 / s.rows];
}

/** Map a free-text object name ("A plate of fried rice") to a pack id / stand-in. */
export function objectKind(name: string): string {
  const s = name.toLowerCase();
  const rules: [RegExp, string][] = [
    [/tuk|three.?wheel/, 'tuktuk'],
    [/temple|wat\b|roof|shrine/, 'temple'],
    [/baht|\bnote|money|cash|banknote/, 'banknote'],
    [/\bice\b|glass|drink|\bcup\b/, 'ice'],
    [/bottle|water/, 'bottle'],
    [/stall|market|shop|vendor/, 'stall'],
    [/rice|dish|plate|food|noodle|curry|bowl|som ?tam|pad/, 'dish'],
  ];
  for (const [re, id] of rules) if (re.test(s)) return id;
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'thing';
}

// ---- loading (browser only) ----

let manifestP: Promise<PackManifest> | null = null;
let manifestNow: PackManifest | null = null;

const base = () => {
  try {
    return (import.meta.env?.BASE_URL as string | undefined) ?? './';
  } catch {
    return './';
  }
};
const url = (rel: string) => `${base()}packs/${rel}`;

export function loadManifest(): Promise<PackManifest> {
  if (manifestP) return manifestP;
  manifestP = fetch(url('manifest.json'), { cache: 'no-cache' })
    .then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return EMPTY_MANIFEST;
      return parseManifest(await r.json());
    })
    .catch(() => EMPTY_MANIFEST)
    .then((m) => {
      manifestNow = m;
      return m;
    });
  return manifestP;
}

/** The manifest if already loaded (null while loading). */
export function manifestSync(): PackManifest | null {
  return manifestNow;
}

/** For the catalogue: forget the manifest and loaded images, then reload. */
export function reloadPacks() {
  manifestP = null;
  manifestNow = null;
  pairCache.clear();
  return loadManifest();
}

export interface Composed {
  key: string;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** CPU copy of the composed pixels (r = brightness, g = depth, a = matte) */
  px: Uint8ClampedArray;
}

const pairCache = new Map<string, Promise<Composed | null>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`could not load ${src}`));
    im.src = src;
  });
}

/** Load an image + depth pair and pack it into one RGBA canvas for the GPU. */
export function loadPair(ref: PairRef, nearSpecial = false): Promise<Composed | null> {
  const key = `${ref.image}|${ref.depth}|${nearSpecial ? 1 : 0}`;
  let p = pairCache.get(key);
  if (p) return p;
  p = Promise.all([loadImage(url(ref.image)), loadImage(url(ref.depth))])
    .then(([im, dm]) => {
      const w = im.naturalWidth;
      const h = im.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(im, 0, 0);
      const a = x.getImageData(0, 0, w, h);
      x.clearRect(0, 0, w, h);
      x.drawImage(dm, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h);
      const o = a.data;
      for (let i = 0; i < o.length; i += 4) {
        const l = 0.3 * o[i] + 0.59 * o[i + 1] + 0.11 * o[i + 2];
        o[i] = l;
        o[i + 1] = d.data[i];
        o[i + 2] = nearSpecial ? Math.max(0, Math.min(255, (d.data[i] - 190) * 4)) : 0;
      }
      x.putImageData(a, 0, 0);
      return { key, canvas: c, w, h, px: o };
    })
    .catch((e) => {
      console.warn('Phi packs:', e);
      return null;
    });
  pairCache.set(key, p);
  return p;
}

export const PEOPLE_CREDIT = 'People shown are AI-generated, not real. Until portrait packs are made they are drawn in code.';
