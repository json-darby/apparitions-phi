// The Tapes keep their own small IndexedDB, apart from the progress database,
// so loading or removing a study file never touches the learner's progress.

import { dataUrlToBlob, parsePack, type Pack } from './pack';
import { SEALED_PATH, unseal } from './sealed';

const DB_NAME = 'phi-tapes';
const KV = 'kv';
const CLIPS = 'clips';

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(KV);
        req.result.createObjectStore(CLIPS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    });
  }
  return opening;
}

async function get<T>(store: string, key: string): Promise<T | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function putMany(store: string, entries: [string, unknown][]): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const [k, v] of entries) os.put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function clear(store: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- the pack ----

let packCache: Pack | null | undefined;

export async function loadPack(): Promise<Pack | null> {
  if (packCache !== undefined) return packCache;
  try {
    packCache = await get<Pack>(KV, 'pack');
  } catch {
    packCache = null;
  }
  return packCache;
}

export function cachedPack(): Pack | null | undefined {
  return packCache;
}

/** Keep a pack and its clips on this device. `onProgress` gets from..1. */
async function store(pack: Pack, clips: { key: string; blob: () => Blob }[], onProgress: (f: number) => void, from: number): Promise<Pack> {
  await clear(CLIPS);
  const BATCH = 60;
  for (let i = 0; i < clips.length; i += BATCH) {
    await putMany(CLIPS, clips.slice(i, i + BATCH).map((c) => [c.key, c.blob()] as [string, unknown]));
    onProgress(from + (0.99 - from) * Math.min(1, (i + BATCH) / Math.max(1, clips.length)));
    // let the screen draw the progress
    await new Promise((r) => setTimeout(r, 0));
  }
  await putMany(KV, [['pack', pack]]);
  packCache = pack;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* the browser decides */
  }
  onProgress(1);
  return pack;
}

/** Read a study file chosen from this device and keep it. `onProgress` gets 0..1. */
export async function importPack(file: File, onProgress: (f: number) => void): Promise<Pack> {
  onProgress(0.02);
  const html = await file.text();
  onProgress(0.08);
  const { pack, clips } = parsePack(html);
  return store(pack, clips.map((c) => ({ key: c.key, blob: () => dataUrlToBlob(c.dataUrl) })), onProgress, 0.08);
}

/** Download the locked pack from the app's own site, open it with the password, keep it. */
let sealedCache: ArrayBuffer | null = null;

export async function unlockPack(password: string, onProgress: (f: number) => void): Promise<Pack> {
  onProgress(0.01);
  // a mistyped password is tried again against the same download, not a new one
  const buf = sealedCache ?? (await download(onProgress));
  sealedCache = buf;
  onProgress(0.76);
  const opened = await unseal(buf, password);
  sealedCache = null;
  onProgress(0.8);
  return store(opened.pack, opened.clips.map((c) => ({ key: c.key, blob: () => c.blob })), onProgress, 0.8);
}

async function download(onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}${SEALED_PATH}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let buf: ArrayBuffer;
  if (res.body && total) {
    const reader = res.body.getReader();
    const out = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > out.length) throw new Error('download size');
      out.set(value, got);
      got += value.length;
      onProgress(0.01 + 0.74 * (got / total));
    }
    buf = out.buffer.slice(0, got);
  } else {
    buf = await res.arrayBuffer();
  }
  return buf;
}

/** Remove the study file and its clips from this device (your Tapes progress stays). */
export async function removePack(): Promise<void> {
  await clear(CLIPS);
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(KV, 'readwrite');
    tx.objectStore(KV).delete('pack');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  packCache = null;
}

// ---- clips ----

const urls = new Map<string, string>();

export async function clipUrl(key: string): Promise<string | null> {
  const have = urls.get(key);
  if (have) return have;
  const blob = await get<Blob>(CLIPS, key);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(key, u);
  return u;
}

// ---- the learner's own marks: units heard, review cards ----

export interface Card {
  ivl: number;
  ease: number;
  due: number;
}

export interface TapesState {
  heard: number[];
  lastUnit: number | null;
  cards: Record<string, Card>;
  /** new cards started per day number */
  intro: Record<string, number>;
  newPerDay: number;
  /** speaker filter on unit pages */
  who: 'all' | 'm' | 'f' | null;
  hideRoman: boolean;
  tipsSeen: boolean;
  /** what the flashcards show first */
  cardFront?: 'en' | 'th' | 'audio';
  /** flashcard answers per day number */
  cardDays?: Record<string, number>;
  /** false: flashcards skip the single words and keep the phrases */
  cardWords?: boolean;
}

export const defaultState = (): TapesState => ({ heard: [], lastUnit: null, cards: {}, intro: {}, newPerDay: 10, who: null, hideRoman: false, tipsSeen: false });

let stateCache: TapesState | null = null;

export async function loadState(): Promise<TapesState> {
  if (stateCache) return stateCache;
  let s: Partial<TapesState> | null = null;
  try {
    s = await get<TapesState>(KV, 'state');
  } catch {
    /* fresh */
  }
  stateCache = { ...defaultState(), ...(s ?? {}) };
  return stateCache;
}

export async function saveState(s: TapesState): Promise<void> {
  stateCache = s;
  try {
    await putMany(KV, [['state', s]]);
  } catch {
    /* kept for this visit */
  }
}
