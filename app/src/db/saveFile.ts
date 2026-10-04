// The save file: all progress as one plain text file the learner keeps,
// carries to another device and loads back (Settings → Save progress /
// Load a save file). The top of the file is written for people: what the save
// holds and how to load it. Below the marker line is the progress itself as
// JSON, one database row per line. Before loading, the app reads the file and
// says what is in it, so a wrong or older file is never loaded by accident.
// Older .sqlite backups still load.

import type { Database, SqlJsStatic } from 'sql.js';
import { courseDay, localDate } from '../core/dates';
import { Store } from './store';

export const SAVE_APP = 'apparitions-phi';
export const SAVE_FORMAT = 1;
export const SAVE_MARKER = '==== PROGRESS DATA · do not edit below this line ====';

/** kv keys that belong to the device, never to a save file. */
export const DEVICE_ONLY = ['live_server'];

/** The tables a save carries. Course content is left out: the app loads it fresh. */
const SAVE_TABLES = ['meta', 'kv', 'cards', 'log', 'activity'] as const;
type SaveTable = (typeof SAVE_TABLES)[number];

export interface SaveSummary {
  /** the course day the save was on when it was last used */
  day: number;
  courseDays: number;
  words: number;
  letters: number;
  patterns: number;
  /** answers ever given */
  answers: number;
  /** yyyy-mm-dd of the last study session, or null */
  lastStudied: string | null;
  /** days with any study time */
  daysStudied: number;
  /** minutes studied in all */
  minutes: number;
}

/** What a save holds, or null when it is not an APPARITIONS: PHI save. */
export function describeSave(db: Database): SaveSummary | null {
  const one = (sql: string): unknown => {
    try {
      const r = db.exec(sql);
      return r[0]?.values?.[0]?.[0] ?? null;
    } catch {
      return undefined;
    }
  };
  // a save has these tables; anything else is refused
  const tables = new Set(
    (db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map((v) => String(v[0])),
  );
  if (!['cards', 'log', 'kv', 'activity'].every((t) => tables.has(t))) return null;
  let settings: { startDate?: string; courseDays?: number } = {};
  try {
    settings = JSON.parse(String(one("SELECT json FROM kv WHERE key = 'settings'") ?? '{}'));
  } catch {
    settings = {};
  }
  const lastStudied = (one('SELECT MAX(date) FROM activity WHERE ms > 0') as string | null) ?? null;
  const count = (like: string) => Number(one(`SELECT COUNT(DISTINCT ref) FROM cards WHERE ref LIKE '${like}'`) ?? 0);
  const start = settings.startDate;
  return {
    day: start ? Math.max(1, courseDay(start, lastStudied ?? start)) : 1,
    courseDays: settings.courseDays ?? 30,
    words: count('item:%'),
    letters: count('letter:%'),
    patterns: count('pattern:%'),
    answers: Number(one('SELECT COUNT(*) FROM log') ?? 0),
    lastStudied,
    daysStudied: Number(one('SELECT COUNT(*) FROM activity WHERE ms > 0') ?? 0),
    minutes: Math.round(Number(one('SELECT SUM(ms) FROM activity') ?? 0) / 60_000),
  };
}

/** "Day 12 of 30 · 143 words, 23 letters, 9 patterns · last studied 4 Oct 2026 · 1,204 answers" */
export function saveLine(s: SaveSummary): string {
  const parts = [`${s.words} word${s.words === 1 ? '' : 's'}`, `${s.letters} letter${s.letters === 1 ? '' : 's'}`];
  if (s.patterns) parts.push(`${s.patterns} pattern${s.patterns === 1 ? '' : 's'}`);
  const when = s.lastStudied ? `last studied ${prettyDate(s.lastStudied)}` : 'not studied yet';
  return `Day ${s.day} of ${s.courseDays} · ${parts.join(', ')} · ${when} · ${s.answers.toLocaleString('en-GB')} answer${s.answers === 1 ? '' : 's'}`;
}

/** The file name a save gets: apparitions-phi-day12-2026-10-04.txt */
export function saveName(day: number, now = Date.now()): string {
  return `${SAVE_APP}-day${day}-${localDate(now)}.txt`;
}

export function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function prettyTime(ms: number): string {
  const d = new Date(ms);
  return `${prettyDate(localDate(ms))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Days since the last save (null: never saved). */
export function daysSinceSave(last: string | null, today: string): number | null {
  if (!last) return null;
  return Math.max(0, courseDay(last, today) - 1);
}

/** A gentle reminder after a week without a save, once there is something worth keeping. */
export function saveDue(last: string | null, today: string, daysStudied: number): boolean {
  if (daysStudied < 3) return false;
  const since = daysSinceSave(last, today);
  return since == null || since >= 7;
}

// ---------- writing ----------

function rowsOf(db: Database, table: SaveTable): { cols: string[]; rows: unknown[][] } {
  // course content reloads by itself; the Talk live access code stays on the device it was typed on
  const where = table === 'meta' ? " WHERE key NOT LIKE 'content_%'" : table === 'kv' ? ` WHERE key NOT IN (${DEVICE_ONLY.map((k) => `'${k}'`).join(', ')})` : '';
  const order = table === 'log' ? ' ORDER BY seq' : '';
  const r = db.exec(`SELECT * FROM ${table}${where}${order}`)[0];
  if (r) return { cols: r.columns, rows: r.values as unknown[][] };
  const cols = (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((v) => String(v[1]));
  return { cols, rows: [] };
}

/** The whole save as text: a readable top, then the data. */
export function saveText(db: Database, now = Date.now()): string {
  const s = describeSave(db);
  if (!s) throw new Error('not a progress database');
  const data = Object.fromEntries(SAVE_TABLES.map((t) => [t, rowsOf(db, t)]));
  const counts = Object.fromEntries(SAVE_TABLES.map((t) => [t, data[t].rows.length]));
  const hours = Math.floor(s.minutes / 60);
  const top = [
    'APPARITIONS: PHI · SAVE FILE',
    '',
    `Saved ${prettyTime(now)}`,
    saveLine(s),
    `${s.daysStudied} day${s.daysStudied === 1 ? '' : 's'} studied, ${hours ? `${hours} h ` : ''}${s.minutes % 60} min in all`,
    '',
    'To load it: open APPARITIONS: PHI, go to Settings, tap "Load a save file" and pick this file.',
    'It replaces the progress on that device, and the app shows you what is in the file first.',
    'Keep a copy somewhere safe: Google Drive, an email to yourself, or a USB stick.',
    'Editing anything below the line can break the file.',
    '',
    SAVE_MARKER,
  ];
  const head = JSON.stringify({ app: SAVE_APP, format: SAVE_FORMAT, saved: new Date(now).toISOString(), counts });
  const body = SAVE_TABLES.map((t) => {
    const { cols, rows } = data[t];
    const lines = rows.map((r) => JSON.stringify(r)).join(',\n');
    return `${JSON.stringify(t)}: {"cols": ${JSON.stringify(cols)}, "rows": [${rows.length ? `\n${lines}\n` : ''}]}`;
  });
  return `${top.join('\n')}\n{"save": ${head},\n${body.join(',\n')}\n}\n`;
}

// ---------- reading ----------

export class SaveFileError extends Error {}

const SQLITE_HEAD = 'SQLite format 3\u0000';

/** True for an older .sqlite backup. */
export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  for (let i = 0; i < 16; i++) if (bytes[i] !== SQLITE_HEAD.charCodeAt(i)) return false;
  return true;
}

interface SaveData {
  save: { app: string; format: number; saved: string; counts: Record<string, number> };
  [table: string]: unknown;
}

/** Reads a save file (text, or an older .sqlite backup) into a database ready to describe and load. */
export function readSave(SQL: SqlJsStatic, bytes: Uint8Array): { db: Database; saved: string | null } {
  if (isSqliteFile(bytes)) {
    const db = new SQL.Database(bytes);
    if (!describeSave(db)) throw new SaveFileError('This file is not an APPARITIONS: PHI save.');
    return { db, saved: null };
  }
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  const at = text.indexOf(SAVE_MARKER);
  if (at < 0) throw new SaveFileError('This file is not an APPARITIONS: PHI save.');
  let data: SaveData;
  try {
    data = JSON.parse(text.slice(at + SAVE_MARKER.length)) as SaveData;
  } catch {
    throw new SaveFileError('This save file is damaged or cut short, so nothing was loaded.');
  }
  if (data?.save?.app !== SAVE_APP) throw new SaveFileError('This file is not an APPARITIONS: PHI save.');
  if (data.save.format > SAVE_FORMAT) throw new SaveFileError('This save comes from a newer version of the app. Update the app, then load it.');

  const db = new SQL.Database();
  new Store(db, null); // the tables, empty
  db.exec('BEGIN');
  try {
    for (const t of SAVE_TABLES) {
      const part = data[t] as { cols?: unknown; rows?: unknown } | undefined;
      if (!part || !Array.isArray(part.cols) || !Array.isArray(part.rows)) throw new SaveFileError('This save file is damaged or cut short, so nothing was loaded.');
      if (part.rows.length !== data.save.counts?.[t]) throw new SaveFileError('This save file is damaged or cut short, so nothing was loaded.');
      // only the columns this version knows; a name is never trusted into the SQL
      const known = new Set((db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map((v) => String(v[1])));
      const cols = (part.cols as unknown[]).map(String);
      const keep = cols.map((c, i) => (known.has(c) ? i : -1)).filter((i) => i >= 0);
      if (!keep.length) continue;
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${t} (${keep.map((i) => `"${cols[i]}"`).join(', ')}) VALUES (${keep.map(() => '?').join(', ')})`);
      try {
        for (const row of part.rows as unknown[]) {
          if (!Array.isArray(row)) throw new SaveFileError('This save file is damaged, so nothing was loaded.');
          stmt.run(keep.map((i) => {
            const v = row[i];
            return v == null || typeof v === 'number' || typeof v === 'string' ? v : JSON.stringify(v);
          }) as (string | number | null)[]);
        }
      } finally {
        stmt.free();
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.close();
    if (e instanceof SaveFileError) throw e;
    throw new SaveFileError('This save file is damaged, so nothing was loaded.');
  }
  if (!describeSave(db)) throw new SaveFileError('This file is not an APPARITIONS: PHI save.');
  return { db, saved: data.save.saved ?? null };
}

/** "4 Oct 2026, 21:14" from the ISO time in a save, or null. */
export function savedAt(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? prettyTime(ms) : null;
}
