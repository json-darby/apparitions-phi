// Local data on the device: SQLite (sql.js) held in memory and persisted as a
// whole-file snapshot. Holds content, schedules, settings, game state and an
// append-only log of every answer. The API is synchronous once opened.

import type { Database, SqlJsStatic } from 'sql.js';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS content (
  ref TEXT PRIMARY KEY,           -- "item:hello", "letter:l-gor", "pattern:p-khaw"
  kind TEXT NOT NULL,
  day INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS content_day ON content(day);
CREATE TABLE IF NOT EXISTS cards (
  key TEXT PRIMARY KEY,           -- "item:hello:hear"
  ref TEXT NOT NULL,
  skill TEXT NOT NULL,
  due INTEGER NOT NULL,           -- epoch ms
  state TEXT NOT NULL,            -- FSRS card JSON
  lapses INTEGER NOT NULL DEFAULT 0,
  leech INTEGER NOT NULL DEFAULT 0,
  introduced INTEGER NOT NULL,    -- epoch ms
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS cards_ref ON cards(ref);
CREATE TABLE IF NOT EXISTS log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  ref TEXT NOT NULL,
  skill TEXT,
  source TEXT NOT NULL,           -- "review", "drill:night-market", "street:task-id" ...
  rating INTEGER,                 -- 1..6 own rating, if given
  grade INTEGER,                  -- final FSRS grade 1..4, null if not counted
  correct INTEGER,
  ms INTEGER,
  counted INTEGER NOT NULL,       -- 1 if it moved the schedule
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS log_at ON log(at);
CREATE INDEX IF NOT EXISTS log_ref ON log(ref);
CREATE TRIGGER IF NOT EXISTS log_no_update BEFORE UPDATE ON log BEGIN SELECT RAISE(ABORT, 'log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS log_no_delete BEFORE DELETE ON log BEGIN SELECT RAISE(ABORT, 'log is append-only'); END;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity (
  date TEXT PRIMARY KEY,          -- local yyyy-mm-dd
  ms INTEGER NOT NULL DEFAULT 0,
  blocks TEXT NOT NULL DEFAULT '{}'
);
`;

export interface CardRow {
  key: string;
  ref: string;
  skill: string;
  due: number;
  state: string;
  lapses: number;
  leech: number;
  introduced: number;
  meta: string;
}

export interface LogRow {
  seq: number;
  at: number;
  ref: string;
  skill: string | null;
  source: string;
  rating: number | null;
  grade: number | null;
  correct: number | null;
  ms: number | null;
  counted: number;
  data: string;
}

export type LogInput = Omit<LogRow, 'seq'>;

export interface Persistence {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

type Bind = (string | number | null | Uint8Array)[];

export class Store {
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  /** set once the device's file has been replaced: nothing in memory may be written over it */
  private frozen = false;
  /** bumps on every write so React views can re-read */
  version = 0;

  constructor(private db: Database, private persistence: Persistence | null) {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    if (this.getMeta('schema') === null) this.setMeta('schema', String(SCHEMA_VERSION));
  }

  // ---- low level ----
  all<T>(sql: string, bind: Bind = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(bind);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }
  one<T>(sql: string, bind: Bind = []): T | null {
    return this.all<T>(sql, bind)[0] ?? null;
  }
  run(sql: string, bind: Bind = []) {
    this.db.run(sql, bind);
    this.touch();
  }
  transaction(fn: () => void) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.touch();
  }

  // ---- meta / kv ----
  getMeta(key: string): string | null {
    return this.one<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  }
  setMeta(key: string, value: string) {
    this.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
  get<T>(key: string, fallback: T): T {
    const row = this.one<{ json: string }>('SELECT json FROM kv WHERE key = ?', [key]);
    return row ? (JSON.parse(row.json) as T) : fallback;
  }
  set<T>(key: string, value: T) {
    this.run('INSERT INTO kv(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json', [key, JSON.stringify(value)]);
  }

  // ---- content ----
  putContent(ref: string, kind: string, day: number, data: unknown) {
    this.run(
      'INSERT INTO content(ref, kind, day, json) VALUES(?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET kind = excluded.kind, day = excluded.day, json = excluded.json',
      [ref, kind, day, JSON.stringify(data)],
    );
  }
  listContent<T>(kind: string): T[] {
    return this.all<{ json: string }>('SELECT json FROM content WHERE kind = ? ORDER BY day, ref', [kind]).map((r) => JSON.parse(r.json) as T);
  }
  clearContent() {
    this.run('DELETE FROM content');
  }

  // ---- cards ----
  getCard(key: string): CardRow | null {
    return this.one<CardRow>('SELECT * FROM cards WHERE key = ?', [key]);
  }
  putCard(c: CardRow) {
    this.run(
      `INSERT INTO cards(key, ref, skill, due, state, lapses, leech, introduced, meta) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET due = excluded.due, state = excluded.state, lapses = excluded.lapses,
       leech = excluded.leech, meta = excluded.meta`,
      [c.key, c.ref, c.skill, c.due, c.state, c.lapses, c.leech, c.introduced, c.meta],
    );
  }
  allCards(): CardRow[] {
    return this.all<CardRow>('SELECT * FROM cards');
  }
  dueCards(before: number): CardRow[] {
    return this.all<CardRow>('SELECT * FROM cards WHERE due <= ? ORDER BY due', [before]);
  }
  cardsForRef(ref: string): CardRow[] {
    return this.all<CardRow>('SELECT * FROM cards WHERE ref = ?', [ref]);
  }

  // ---- log (append only) ----
  appendLog(e: LogInput): number {
    this.db.run(
      'INSERT INTO log(at, ref, skill, source, rating, grade, correct, ms, counted, data) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [e.at, e.ref, e.skill, e.source, e.rating, e.grade, e.correct, e.ms, e.counted, e.data],
    );
    this.touch();
    return (this.one<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0);
  }
  logSince(at: number): LogRow[] {
    return this.all<LogRow>('SELECT * FROM log WHERE at >= ? ORDER BY seq', [at]);
  }
  logForRef(ref: string, limit = 50): LogRow[] {
    return this.all<LogRow>('SELECT * FROM log WHERE ref = ? ORDER BY seq DESC LIMIT ?', [ref, limit]);
  }
  logCount(): number {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM log')?.n ?? 0;
  }

  // ---- activity (minutes per day) ----
  addActivity(date: string, ms: number, block?: string) {
    const row = this.one<{ ms: number; blocks: string }>('SELECT ms, blocks FROM activity WHERE date = ?', [date]);
    const blocks = row ? (JSON.parse(row.blocks) as Record<string, number>) : {};
    if (block) blocks[block] = (blocks[block] ?? 0) + ms;
    this.run(
      'INSERT INTO activity(date, ms, blocks) VALUES(?, ?, ?) ON CONFLICT(date) DO UPDATE SET ms = excluded.ms, blocks = excluded.blocks',
      [date, (row?.ms ?? 0) + ms, JSON.stringify(blocks)],
    );
  }
  activity(): { date: string; ms: number; blocks: Record<string, number> }[] {
    return this.all<{ date: string; ms: number; blocks: string }>('SELECT * FROM activity ORDER BY date').map((r) => ({
      date: r.date, ms: r.ms, blocks: JSON.parse(r.blocks) as Record<string, number>,
    }));
  }

  // ---- change tracking and persistence ----
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private touch() {
    this.version++;
    this.dirty = true;
    for (const fn of this.listeners) fn();
    if (this.persistence && !this.frozen && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 400);
    }
  }
  async flush() {
    if (!this.dirty || !this.persistence || this.frozen) return;
    this.dirty = false;
    await this.persistence.save(this.db.export());
  }
  exportBytes(): Uint8Array {
    return this.db.export();
  }
  /**
   * Replace the device's saved file (loading a save file, erasing). After this
   * nothing in memory is written back, so a late timer or the page closing
   * cannot overwrite the new file; the caller reloads the page.
   */
  async replaceFile(bytes: Uint8Array) {
    if (!this.persistence) throw new Error('no saved file to replace');
    this.frozen = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.persistence.save(bytes);
  }
  close() {
    this.db.close();
  }
}

export async function openStore(SQL: SqlJsStatic, persistence: Persistence | null): Promise<Store> {
  const bytes = persistence ? await persistence.load() : null;
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  return new Store(db, persistence);
}
