// The Tapes keep their own small IndexedDB, apart from the progress database,
// so loading or removing a study file never touches the learner's progress.

import { dataUrlToBlob, parsePack, type Pack } from './pack';

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

/** Read a study file and keep it on this device. `onProgress` gets 0..1. */
export async function importPack(file: File, onProgress: (f: number) => void): Promise<Pack> {
  onProgress(0.02);
  const html = await file.text();
  onProgress(0.08);
  const { pack, clips } = parsePack(html);
  await clear(CLIPS);
  const BATCH = 60;
  for (let i = 0; i < clips.length; i += BATCH) {
    const batch = clips.slice(i, i + BATCH).map((c) => [c.key, dataUrlToBlob(c.dataUrl)] as [string, unknown]);
    await putMany(CLIPS, batch);
    onProgress(0.08 + 0.9 * Math.min(1, (i + BATCH) / Math.max(1, clips.length)));
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
