// The browser side of save files: hand the file to the learner (download, or
// the phone's share sheet for Drive, email or Files) and remember when.

import type { Store } from './store';
import { localDate } from '../core/dates';
import { saveName, saveText } from './saveFile';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

export const LAST_SAVE_KEY = 'last_backup';

export function lastSave(store: Store): string | null {
  return store.get<string | null>(LAST_SAVE_KEY, null);
}

async function makeFile(store: Store, day: number): Promise<File> {
  // the date goes in first, so the file knows when it was made
  store.set(LAST_SAVE_KEY, localDate(Date.now()));
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(store.exportBytes());
  try {
    return new File([saveText(db)], saveName(day), { type: 'text/plain' });
  } finally {
    db.close();
  }
}

/** True where the share sheet can take a file (most phones and tablets). */
export function canShareFiles(): boolean {
  try {
    const probe = new File(['x'], 'x.txt', { type: 'text/plain' });
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** Downloads the save file (Downloads folder on Android and PC, Files on iPhone and iPad). */
export async function downloadSave(store: Store, day: number): Promise<void> {
  const file = await makeFile(store, day);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Opens the share sheet with the save file. False when the learner closed it. */
export async function shareSave(store: Store, day: number): Promise<boolean> {
  const file = await makeFile(store, day);
  try {
    await navigator.share({ files: [file], title: 'APPARITIONS: PHI save file' });
    return true;
  } catch {
    return false;
  }
}
