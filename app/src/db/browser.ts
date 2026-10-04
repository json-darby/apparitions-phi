// Browser side of the store: loads the sql.js wasm bundled with the app (so it
// works offline) and keeps the database file in IndexedDB.

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { openStore, type Persistence, type Store } from './store';
import { localDate } from '../core/dates';

const DB_NAME = 'phi';
const OBJ = 'files';
const KEY = 'phi.sqlite';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OBJ);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | null> {
  return idb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(OBJ, 'readonly').objectStore(OBJ).get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(key: string, value: unknown): Promise<void> {
  return idb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(OBJ, 'readwrite');
        tx.objectStore(OBJ).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// ---- the start of the day: a copy of the progress as it was when the app first opened today,
// so "Start today again" can put the day back. Kept beside the main file; one copy only.
const DAY_KEY = 'phi.daystart.sqlite';
const DAY_DATE = 'phi.daystart.date';

/** Keep a start-of-day copy the first time the app opens on a new date. */
export async function keepDayStart(store: Store, today: string): Promise<void> {
  try {
    if ((await idbGet<string>(DAY_DATE)) === today) return;
    await idbPut(DAY_KEY, store.exportBytes());
    await idbPut(DAY_DATE, today);
  } catch {
    /* no copy today: "Start today again" says so */
  }
}

/** Start fresh: the day's copy becomes the empty start too, so nothing erased can come back. */
export async function replaceDayStart(bytes: Uint8Array, today: string): Promise<void> {
  try {
    await idbPut(DAY_KEY, bytes);
    await idbPut(DAY_DATE, today);
  } catch {
    /* ignore */
  }
}

/** Today's start-of-day copy, or null when there is none for today. */
export async function readDayStart(today: string): Promise<Uint8Array | null> {
  try {
    if ((await idbGet<string>(DAY_DATE)) !== today) return null;
    return await idbGet<Uint8Array>(DAY_KEY);
  } catch {
    return null;
  }
}

export const indexedDbPersistence: Persistence = {
  async load() {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(OBJ, 'readonly').objectStore(OBJ).get(KEY);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  },
  async save(bytes) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJ, 'readwrite');
      tx.objectStore(OBJ).put(bytes, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

export async function openBrowserStore(): Promise<Store> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const store = await openStore(SQL, indexedDbPersistence);
  // Ask the browser not to evict our data. Installed apps usually get this.
  void navigator.storage?.persist?.();
  const flush = () => void store.flush();
  const today = () => localDate(Date.now());
  await keepDayStart(store, today());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    // left open overnight: the first look on a new day keeps that day's start
    else void keepDayStart(store, today());
  });
  window.addEventListener('pagehide', flush);
  return store;
}
