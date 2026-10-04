import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { SEED_LETTERS } from '../content/seed';
import { openStore } from '../db/store';
import {
  authoredStrokes, clearStrokes, exportStrokes, getStrokes, importStrokes, primeStrokes, resolveStrokes, saveStrokes, strokeInfo,
} from './strokes';

describe('stroke store', () => {
  it('prefers authored, then draft; exports and imports JSON', async () => {
    const SQL = await initSqlJs();
    const store = await openStore(SQL, null);
    const gor = SEED_LETTERS.find((l) => l.id === 'l-gor')!;

    expect(strokeInfo(store, gor)?.source).toBe('draft');
    const mine = [{ d: 'M30 70 L30 30' }, { d: 'M60 30 L60 70' }];
    saveStrokes(store, gor, mine);
    expect(getStrokes(store, gor)).toEqual(mine);
    expect(strokeInfo(store, gor)?.source).toBe('authored');
    expect(resolveStrokes(gor)).toEqual(mine);

    const json = JSON.stringify(exportStrokes(store, SEED_LETTERS));
    clearStrokes(store, gor.id);
    expect(authoredStrokes(store, gor.id)).toBeNull();
    expect(strokeInfo(store, gor)?.source).toBe('draft');

    const r = importStrokes(store, SEED_LETTERS, json);
    expect(r.imported).toEqual(['ก']);
    expect(getStrokes(store, gor)).toEqual(mine);

    // a fresh in-memory copy is rebuilt from the store
    const store2 = await openStore(SQL, null);
    store2.set('strokes:l-jor', { v: 1, char: 'จ', strokes: [{ d: 'M1 1 L2 2' }], savedAt: 0 });
    primeStrokes(store2);
    expect(resolveStrokes(SEED_LETTERS.find((l) => l.id === 'l-jor')!)).toEqual([{ d: 'M1 1 L2 2' }]);

    expect(() => importStrokes(store, SEED_LETTERS, '{"format":"other"}')).toThrow();
    expect(() => importStrokes(store, SEED_LETTERS, 'not json')).toThrow();
    const bad = importStrokes(store, SEED_LETTERS, JSON.stringify({ format: 'phi-strokes', version: 1, letters: { 'l-zzz': { char: '?', strokes: [] } } }));
    expect(bad.skipped).toEqual(['?']);
  });
});
