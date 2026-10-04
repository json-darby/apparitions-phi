import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { openStore } from './store';
import { daysSinceSave, describeSave, readSave, saveDue, saveLine, saveName, saveText, SaveFileError, SAVE_MARKER } from './saveFile';

describe('save files', () => {
  it('reads what a save holds: day, words, letters, answers, last studied', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    store.set('settings', { startDate: '2026-10-01', courseDays: 30 });
    const card = { due: 0, state: '{}', lapses: 0, leech: 0, introduced: 0, meta: '{}' };
    store.putCard({ ...card, key: 'item:hello:hear', ref: 'item:hello', skill: 'hear' });
    store.putCard({ ...card, key: 'item:hello:read', ref: 'item:hello', skill: 'read' });
    store.putCard({ ...card, key: 'item:rice:hear', ref: 'item:rice', skill: 'hear' });
    store.putCard({ ...card, key: 'letter:l-gor:read', ref: 'letter:l-gor', skill: 'read' });
    store.addActivity('2026-10-04', 60_000);
    const s = describeSave(new SQL.Database(store.exportBytes()));
    expect(s).toMatchObject({ day: 4, courseDays: 30, words: 2, letters: 1, patterns: 0, lastStudied: '2026-10-04' });
    expect(saveLine(s!)).toBe('Day 4 of 30 · 2 words, 1 letter · last studied 4 Oct 2026 · 0 answers');
  });

  it('refuses a file that is not a save', async () => {
    const SQL = await initSqlJs();
    const other = new SQL.Database();
    other.run('CREATE TABLE notes (x TEXT)');
    expect(describeSave(new SQL.Database(other.export()))).toBeNull();
  });

  it('names the file by app, day and date, and reminds after a week', () => {
    expect(saveName(12, new Date(2026, 9, 4, 12).getTime())).toBe('apparitions-phi-day12-2026-10-04.txt');
    expect(daysSinceSave(null, '2026-10-04')).toBeNull();
    expect(daysSinceSave('2026-10-01', '2026-10-04')).toBe(3);
    expect(saveDue(null, '2026-10-04', 2)).toBe(false);
    expect(saveDue(null, '2026-10-04', 3)).toBe(true);
    expect(saveDue('2026-10-01', '2026-10-04', 10)).toBe(false);
    expect(saveDue('2026-09-26', '2026-10-04', 10)).toBe(true);
  });

  it('writes a text file people can read, and reads it back exactly', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    store.set('settings', { startDate: '2026-10-01', courseDays: 30, name: 'Jo "the" learner' });
    store.setMeta('content_version', 'v9');
    store.putCard({ key: 'item:hello:hear', ref: 'item:hello', skill: 'hear', due: 1759600000000, state: '{"s":1.5}', lapses: 1, leech: 0, introduced: 1759500000000, meta: '{}' });
    store.appendLog({ at: 1759500000000, ref: 'item:hello', skill: 'hear', source: 'review', rating: 4, grade: 3, correct: 1, ms: 2100, counted: 1, data: '{"note":"line\nbreak"}' });
    store.addActivity('2026-10-04', 25 * 60_000, 'new');
    store.set('live_server', { url: 'https://example.run.app', code: 'secret-code-123' });
    const db = new SQL.Database(store.exportBytes());
    const text = saveText(db, new Date(2026, 9, 4, 21, 14).getTime());
    expect(text.startsWith('APPARITIONS: PHI · SAVE FILE')).toBe(true);
    expect(text).toContain('Saved 4 Oct 2026, 21:14');
    expect(text).toContain('Day 4 of 30 · 1 word, 0 letters · last studied 4 Oct 2026 · 1 answer');
    expect(text).toContain('1 day studied, 25 min in all');
    expect(text).toContain(SAVE_MARKER);
    // the Talk live access code never leaves the device in a save file
    expect(text).not.toContain('secret-code-123');
    // Windows Notepad line endings and a byte-order mark still load
    const crlf = '﻿' + text.replace(/\n/g, '\r\n');
    for (const t of [text, crlf]) {
      const back = readSave(SQL, new TextEncoder().encode(t)).db;
      for (const table of ['cards', 'log', 'activity']) {
        expect(back.exec(`SELECT * FROM ${table}`)).toEqual(db.exec(`SELECT * FROM ${table}`));
      }
      expect(back.exec("SELECT * FROM kv")).toEqual(db.exec("SELECT * FROM kv WHERE key <> 'live_server'"));
      // course content is never carried, so the app loads it fresh
      expect(back.exec("SELECT * FROM meta WHERE key LIKE 'content_%'")).toEqual([]);
      // the loaded file still keeps the answer log append-only
      expect(() => back.run("DELETE FROM log")).toThrow();
    }
  });

  it('refuses damaged, cut-short or foreign files, and still loads an old .sqlite backup', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    store.set('settings', { startDate: '2026-10-01', courseDays: 30 });
    store.addActivity('2026-10-02', 60_000);
    const db = new SQL.Database(store.exportBytes());
    const text = saveText(db);
    const enc = (t: string) => new TextEncoder().encode(t);
    expect(() => readSave(SQL, enc(text.slice(0, text.length - 40)))).toThrow(SaveFileError);
    expect(() => readSave(SQL, enc(text.replace('"rows": [\n', '"rows": [\n["2026-10-09", 1, "{}"],\n')))).toThrow(SaveFileError);
    expect(() => readSave(SQL, enc('Dear diary, today I learned Thai.'))).toThrow(SaveFileError);
    expect(() => readSave(SQL, enc(text.replace('"apparitions-phi"', '"other-app"')))).toThrow(/not an APPARITIONS: PHI save/);
    const old = readSave(SQL, store.exportBytes());
    expect(describeSave(old.db)?.lastStudied).toBe('2026-10-02');
  });
});
