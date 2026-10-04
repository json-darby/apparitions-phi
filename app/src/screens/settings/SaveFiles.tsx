// Settings → Your progress: save all progress to a small text file, and load
// one back. Loading shows what is in the file (and what is on the device now)
// before anything is replaced.

import { useState } from 'react';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { Database } from 'sql.js';
import { useApp, useStoreVersion } from '../../app/context';
import { localDate } from '../../core/dates';
import { canShareFiles, downloadSave, lastSave, shareSave } from '../../db/saveDevice';
import { DEVICE_ONLY, daysSinceSave, describeSave, readSave, saveLine, savedAt, SaveFileError, type SaveSummary } from '../../db/saveFile';
import { Label, Sheet } from '../../ui/kit';

/** "today", "yesterday", "3 days ago", or null when never saved */
export function savedAgo(last: string | null, today: string): string | null {
  const n = daysSinceSave(last, today);
  if (n == null) return null;
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

interface Pending {
  db: Database;
  file: SaveSummary;
  saved: string | null;
  name: string;
  here: SaveSummary | null;
}

export function SaveFiles() {
  const { store, engine } = useApp();
  useStoreVersion();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const ago = savedAgo(lastSave(store), localDate(Date.now()));
  const share = canShareFiles();

  const save = async (how: 'download' | 'share') => {
    setBusy(true);
    setMsg(null);
    try {
      if (how === 'share') {
        if (await shareSave(store, engine.day())) setMsg('Saved. Keep that file somewhere safe.');
      } else {
        await downloadSave(store, engine.day());
        setMsg('Saved to your downloads. Keep that file somewhere safe.');
      }
    } catch {
      setMsg('The file could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    setBusy(true);
    try {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const { db, saved } = readSave(SQL, new Uint8Array(await f.arrayBuffer()));
      const here = describeSave(new SQL.Database(store.exportBytes()));
      setPending({ db, file: describeSave(db)!, saved: savedAt(saved), name: f.name, here });
    } catch (e) {
      setMsg(e instanceof SaveFileError ? e.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const load = async () => {
    if (!pending) return;
    setBusy(true);
    // what belongs to this device (the Talk live address and code) stays as it is
    for (const key of DEVICE_ONLY) {
      const here = store.one<{ json: string }>('SELECT json FROM kv WHERE key = ?', [key]);
      pending.db.run('DELETE FROM kv WHERE key = ?', [key]);
      if (here) pending.db.run('INSERT INTO kv(key, json) VALUES(?, ?)', [key, here.json]);
    }
    await store.replaceFile(pending.db.export());
    location.reload();
  };

  const close = () => {
    pending?.db.close();
    setPending(null);
  };

  return (
    <>
      <div className="row" style={{ cursor: 'default', alignItems: 'center', flexWrap: 'wrap', rowGap: 10 }}>
        <span className="stack gap-1" style={{ minWidth: 0, flex: '1 1 190px' }}>
          <span>Save progress to a file</span>
          <span className="small">
            A small text file with everything you have learned. Keep it in Google Drive or email it to yourself, and load it
            on any device. {ago ? `Last saved ${ago}.` : 'Not saved yet.'}
          </span>
        </span>
        <span className="hrow" style={{ flex: 'none', gap: 8 }}>
          <button className="pill small" disabled={busy} onClick={() => void save('download')}>Save file</button>
          {share && <button className="pill small" disabled={busy} onClick={() => void save('share')}>Share</button>}
        </span>
      </div>
      <div className="row" style={{ cursor: 'default', alignItems: 'center', flexWrap: 'wrap', rowGap: 10 }}>
        <span className="stack gap-1" style={{ minWidth: 0, flex: '1 1 190px' }}>
          <span>Load a save file</span>
          <span className="small">Replaces the progress on this device. You see what is in the file first.</span>
        </span>
        <label className={`pill small ${busy ? 'disabled' : ''}`} style={{ flex: 'none' }}>
          Choose file
          <input
            type="file"
            accept=".txt,text/plain,.sqlite,application/x-sqlite3"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {msg && <p className="small" role="status" style={{ margin: '8px 0 0' }}>{msg}</p>}

      {pending && (
        <Sheet label="Load this save file?" onClose={close}>
          <div className="stack gap-4">
            <h2 className="h-m" style={{ margin: 0 }}>Load this save?</h2>
            <div className="stack gap-1">
              <Label>In the file</Label>
              <p className="body" style={{ margin: 0 }}>{saveLine(pending.file)}</p>
              <p className="small" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                {pending.name}
                {pending.saved ? ` · saved ${pending.saved}` : ''}
              </p>
            </div>
            {pending.here && (
              <div className="stack gap-1">
                <Label>On this device now</Label>
                <p className="body" style={{ margin: 0 }}>{saveLine(pending.here)}</p>
              </div>
            )}
            <p className="small" style={{ margin: 0 }}>
              Loading replaces everything on this device with the file. Save this device’s progress first if you might want it.
            </p>
            <div className="hrow wrap" style={{ gap: 10 }}>
              <button className="pill" onClick={close} disabled={busy}>Cancel</button>
              <button className="pill solid grow" onClick={() => void load()} disabled={busy}>Load it</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
