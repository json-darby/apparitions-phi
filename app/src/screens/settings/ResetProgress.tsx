// Settings → Your progress: start today again (the day goes back to how it was
// when the app first opened today) and start fresh (everything goes, back to
// the set-up questions). Both ask first, in a sheet.

import { useEffect, useState } from 'react';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { useApp } from '../../app/context';
import { localDate } from '../../core/dates';
import { readDayStart, replaceDayStart } from '../../db/browser';
import { Sheet } from '../../ui/kit';

/** kv kept when today starts again: preferences and this device's own settings, not progress. */
const KEEP_TODAY = ['settings', 'live_server', 'last_backup', 'install_hidden_until'];

type Ask = 'today' | 'fresh' | null;

export function ResetProgress() {
  const { store } = useApp();
  const [dayStart, setDayStart] = useState<Uint8Array | null | undefined>(undefined);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    void readDayStart(localDate(Date.now())).then((b) => on && setDayStart(b));
    return () => {
      on = false;
    };
  }, []);

  const startToday = async () => {
    if (!dayStart) return;
    setBusy(true);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const db = new SQL.Database(dayStart);
    for (const key of KEEP_TODAY) {
      const now = store.one<{ json: string }>('SELECT json FROM kv WHERE key = ?', [key]);
      db.run('DELETE FROM kv WHERE key = ?', [key]);
      if (now) db.run('INSERT INTO kv(key, json) VALUES(?, ?)', [key, now.json]);
    }
    await store.replaceFile(db.export());
    location.hash = '#/';
    location.reload();
  };

  const startFresh = async () => {
    setBusy(true);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const empty = new SQL.Database().export();
    await replaceDayStart(empty, localDate(Date.now()));
    await store.replaceFile(empty);
    location.hash = '#/welcome';
    location.reload();
  };

  const row = (title: string, note: string, label: string, onClick: () => void, disabled = false) => (
    <div className="row" style={{ cursor: 'default', alignItems: 'center', flexWrap: 'wrap', rowGap: 10 }}>
      <span className="stack gap-1" style={{ minWidth: 0, flex: '1 1 190px' }}>
        <span>{title}</span>
        <span className="small">{note}</span>
      </span>
      <button type="button" className="pill small" style={{ flex: 'none' }} onClick={onClick} disabled={disabled || busy}>{label}</button>
    </div>
  );

  return (
    <>
      {row(
        'Start today again',
        dayStart
          ? 'Puts today back to how it was when you first opened the app today: new words, reviews, minutes and steps. Settings stay.'
          : dayStart === null
            ? 'Nothing to undo yet: today starts from the next time the app opens.'
            : 'Checking…',
        'Start again',
        () => setAsk('today'),
        !dayStart,
      )}
      {row('Start fresh', 'Erases all progress on this device and goes back to the set-up questions. Save a file first if you might want it back.', 'Start fresh', () => setAsk('fresh'))}

      {ask && (
        <Sheet label={ask === 'today' ? 'Start today again?' : 'Start fresh?'} onClose={() => !busy && setAsk(null)}>
          <div className="stack gap-4">
            <h2 className="h-m" style={{ margin: 0 }}>{ask === 'today' ? 'Start today again?' : 'Start fresh?'}</h2>
            <p className="body" style={{ margin: 0 }}>
              {ask === 'today'
                ? 'Today’s new words, reviews, answers and minutes are undone, and the day starts again from the first step. Everything before today stays.'
                : 'Every word, review, answer, street task and setting on this device is erased, and the app opens at the set-up questions. This cannot be undone.'}
            </p>
            <div className="hrow wrap" style={{ gap: 10 }}>
              <button type="button" className="pill" onClick={() => setAsk(null)} disabled={busy}>Cancel</button>
              <button type="button" className="pill solid grow" onClick={() => void (ask === 'today' ? startToday() : startFresh())} disabled={busy}>
                {ask === 'today' ? 'Start today again' : 'Erase and start fresh'}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
