// Stroke paths for letters. Three sources, in order of trust:
//   1. authored in the app's stroke tool, saved in the store kv as `strokes:<letterId>`
//   2. bundled with the content (Letter.strokes), once authored paths are shipped
//   3. the drafts below, for the 10 seed letters only
// Paths are SVG path data in the 100 x 100 stroke box (see glyph.ts for how the
// font glyph sits in that box). Each stroke is drawn in order, start to end.

import type { Letter, StrokePath } from '../content/types';
import type { Store } from '../db/store';

export type StrokeSource = 'authored' | 'content' | 'draft';

export interface StrokePart {
  label: string;
  /** path data for this piece alone, starting with M */
  d: string;
}

interface Draft {
  char: string;
  /** one continuous stroke, split into named pieces in writing order */
  parts: StrokePart[];
}

/**
 * DRAFT centre-line paths for the 10 seed letters. Drawn for Phi by tracing the
 * Noto Sans Thai Looped glyph in the stroke box and checked for fit by
 * measuring how deep each path sits inside the glyph. Not reviewed by a Thai
 * writer. The start points and stroke order are the main risk: ก in
 * particular has no head loop, and the order chosen here (up from the left
 * foot, through the notch) needs checking. Replace each with an authored path
 * from the stroke tool.
 */
const DRAFTS: Record<string, Draft> = {
  'l-gor': {
    char: 'ก',
    parts: [
      { label: 'Left foot and notch', d: 'M34 72 L34 50 L45 44 L31 41' },
      { label: 'Arch', d: 'M31 41 C31 31 38 26 49 26 C60 26 65.5 32 65.5 42' },
      { label: 'Right leg', d: 'M65.5 42 L65.5 72' },
    ],
  },
  'l-jor': {
    char: 'จ',
    parts: [
      { label: 'Head loop', d: 'M42 46 C40 41 31 42 31 48 C31 54 41 55 44 51' },
      { label: 'Stem and bowl', d: 'M44 51 L44 64 C44 68 47 70 52 70 C60 70 65 62 65 50' },
      { label: 'Top and tail', d: 'M65 50 C65 35 59 26 48 26 C39 26 33 28 30 30' },
    ],
  },
  'l-dor': {
    char: 'ด',
    parts: [
      { label: 'Head loop', d: 'M53 54 C57 50 55 42 48.5 42 C43 42 41.5 47 42.5 51 C43.5 55 50 56 53 55' },
      { label: 'Down to the foot', d: 'M53 55 C49 60 42 65 36 70' },
      { label: 'Left side and top', d: 'M36 70 C31 66 29.5 58 29.5 50 C29.5 34 38 26 49 26 C61 26 67 33 67 42' },
      { label: 'Right leg', d: 'M67 42 L67 72' },
    ],
  },
  'l-dtor': {
    char: 'ต',
    parts: [
      { label: 'Head loop', d: 'M53 54 C57 50 55 42 48.5 42 C43 42 41.5 47 42.5 51 C43.5 55 50 56 53 55' },
      { label: 'Down to the foot', d: 'M53 55 C49 60 42 65 36 70' },
      { label: 'Left side and notched top', d: 'M36 70 C31 66 29.5 58 29.5 50 C29.5 38 31 30 38 29 L48.5 34 L59 29 C64 30 67 34 67 42' },
      { label: 'Right leg', d: 'M67 42 L67 72' },
    ],
  },
  'l-bor': {
    char: 'บ',
    parts: [
      { label: 'Head loop', d: 'M38.5 34 C38.5 29 36 26.5 33 26.5 C29.5 26.5 27 29 27 32 C27 35.5 30 38 34 38 C37 38 38 40 38 43' },
      { label: 'Stem', d: 'M38 43 L38 64' },
      { label: 'Base', d: 'M38 64 C38 68 40 69.5 44 69.5 L62 69.5 C65 69.5 67 67.5 67 64' },
      { label: 'Right side', d: 'M67 64 L67 24' },
    ],
  },
  'l-bpor': {
    char: 'ป',
    parts: [
      { label: 'Head loop', d: 'M38.5 34 C38.5 29 36 26.5 33 26.5 C29.5 26.5 27 29 27 32 C27 35.5 30 38 34 38 C37 38 38 40 38 43' },
      { label: 'Stem', d: 'M38 43 L38 64' },
      { label: 'Base', d: 'M38 64 C38 68 40 69.5 44 69.5 L62 69.5 C65 69.5 67 67.5 67 64' },
      { label: 'Tall right side', d: 'M67 64 L67 6' },
    ],
  },
  'l-or': {
    char: 'อ',
    parts: [
      { label: 'Head loop', d: 'M49.5 47.5 C49.5 50 47.5 52 45 52 C42.5 52 40.5 50 40.5 47.5 C40.5 45 42.5 42.5 45 42.5' },
      { label: 'Left side and base', d: 'M45 42.5 C40 42.5 33.5 44 33.5 50 L33.5 64 C33.5 68 36 70 40 70 L59 70 C62.5 70 64.5 67.5 64.5 64' },
      { label: 'Right side and top', d: 'M64.5 64 L64.5 40 C64.5 31 58 26.5 47.5 26.5 C40 26.5 35 27.5 32.5 32' },
    ],
  },
  'l-ngor': {
    char: 'ง',
    parts: [
      { label: 'Head loop', d: 'M56 37 C53 37 51.5 34.5 51.5 31.5 C51.5 28.5 54 26.5 56.5 26.5 C59.5 26.5 61.5 29 61.5 32' },
      { label: 'Right side', d: 'M61.5 32 L61.5 64' },
      { label: 'Base', d: 'M61.5 64 C61.5 68 59 69.5 55 69.5 L46 69.5 C43 69.5 41.5 67 41 64' },
      { label: 'Diagonal', d: 'M41 64 L34 38' },
    ],
  },
  'l-nor': {
    char: 'น',
    parts: [
      { label: 'Head loop', d: 'M38.5 34 C38.5 29 36 26.5 33 26.5 C29.5 26.5 27 29 27 32 C27 35.5 30 38 34 38 C37 38 38 40 38 43' },
      { label: 'Stem', d: 'M38 43 L38 64' },
      { label: 'Diagonal', d: 'M38 64 C38 68 39.5 70 42 69 L54 61.5 C57 60 61 59.5 64 59.5' },
      { label: 'Tail loop', d: 'M64 59.5 C68 59.5 70 62.5 70 65.5 C70 69 67 71 64 71 C60.5 71 58.5 68.5 58.5 65.5 C58.5 61 62 58 64 55' },
      { label: 'Right side', d: 'M64 55 C65 53.5 65.5 51 65.5 48 L65.5 24' },
    ],
  },
  'l-mor': {
    char: 'ม',
    parts: [
      { label: 'Head loop', d: 'M39 34 C39 29 37 26.5 34 26.5 C30.5 26.5 28 29 28 32 C28 35.5 31 38 35 38 C38 38 39.5 40 39.5 43' },
      { label: 'Stem', d: 'M39.5 43 L39.5 66' },
      { label: 'Foot loop', d: 'M39.5 66 C39.5 69 37.5 71 35 71 C31 71 28.5 68.5 28.5 65.5 C28.5 62 31 60 34.5 60' },
      { label: 'Diagonal', d: 'M34.5 60 C40 60 46 61 52 64 L60 68.5 C63 70 66.5 69 66.5 64' },
      { label: 'Right side', d: 'M66.5 64 L66.5 24' },
    ],
  },
};

/** Join pieces into one stroke: later pieces drop their leading M. */
function joinParts(parts: StrokePart[]): string {
  return parts.map((p, i) => (i === 0 ? p.d : p.d.replace(/^\s*M\s*[-\d.]+[ ,]+[-\d.]+\s*/, ''))).join(' ');
}

const draftById = new Map<string, StrokePath[]>();
const draftByChar = new Map<string, { id: string; strokes: StrokePath[] }>();
for (const [id, d] of Object.entries(DRAFTS)) {
  const strokes = [{ d: joinParts(d.parts) }];
  draftById.set(id, strokes);
  draftByChar.set(d.char, { id, strokes });
}

/** The draft path for a letter, by id or character. Null when there is none. */
export function draftStrokes(letter: Pick<Letter, 'id' | 'char'>): StrokePath[] | null {
  return draftById.get(letter.id) ?? draftByChar.get(letter.char)?.strokes ?? null;
}

/** Named pieces of the draft stroke, for "build from parts". */
export function draftParts(letter: Pick<Letter, 'id' | 'char'>): StrokePart[] | null {
  const d = DRAFTS[letter.id] ?? (draftByChar.get(letter.char) ? DRAFTS[draftByChar.get(letter.char)!.id] : undefined);
  return d ? d.parts : null;
}

// ---------- authored strokes in the store ----------

export const strokeKey = (letterId: string) => `strokes:${letterId}`;

export interface AuthoredRecord {
  v: 1;
  char: string;
  strokes: StrokePath[];
  savedAt: number;
}

/** In-memory copy of authored strokes so the recogniser can read them without the store. */
const authoredCache = new Map<string, StrokePath[]>();
let primedFor: Store | null = null;

function validStrokes(x: unknown): x is StrokePath[] {
  return Array.isArray(x) && x.length > 0 && x.every((s) => s && typeof (s as StrokePath).d === 'string' && /^\s*[Mm]/.test((s as StrokePath).d));
}

/** Load every authored stroke set into memory. Cheap; call when a writing screen opens. */
export function primeStrokes(store: Store) {
  if (primedFor === store) return;
  authoredCache.clear();
  const rows = store.all<{ key: string; json: string }>("SELECT key, json FROM kv WHERE key LIKE 'strokes:%'");
  for (const r of rows) {
    try {
      const rec = JSON.parse(r.json) as AuthoredRecord;
      if (validStrokes(rec?.strokes)) authoredCache.set(r.key.slice('strokes:'.length), rec.strokes);
    } catch {
      // ignore a broken row
    }
  }
  primedFor = store;
}

export function authoredStrokes(store: Store, letterId: string): AuthoredRecord | null {
  const rec = store.get<AuthoredRecord | null>(strokeKey(letterId), null);
  return rec && validStrokes(rec.strokes) ? rec : null;
}

export function saveStrokes(store: Store, letter: Pick<Letter, 'id' | 'char'>, strokes: StrokePath[]) {
  if (!validStrokes(strokes)) throw new Error('Nothing to save: every stroke needs path data.');
  const rec: AuthoredRecord = { v: 1, char: letter.char, strokes, savedAt: Date.now() };
  store.set(strokeKey(letter.id), rec);
  authoredCache.set(letter.id, strokes);
}

export function clearStrokes(store: Store, letterId: string) {
  store.run('DELETE FROM kv WHERE key = ?', [strokeKey(letterId)]);
  authoredCache.delete(letterId);
}

/** Strokes for a letter: authored, then bundled, then draft, else null. */
export function getStrokes(store: Store, letter: Letter): StrokePath[] | null {
  return strokeInfo(store, letter)?.strokes ?? null;
}

export function strokeInfo(store: Store, letter: Letter): { strokes: StrokePath[]; source: StrokeSource } | null {
  const a = authoredStrokes(store, letter.id);
  if (a) {
    authoredCache.set(letter.id, a.strokes);
    return { strokes: a.strokes, source: 'authored' };
  }
  if (validStrokes(letter.strokes)) return { strokes: letter.strokes, source: 'content' };
  const d = draftStrokes(letter);
  return d ? { strokes: d, source: 'draft' } : null;
}

/**
 * The same order without the store, from the in-memory copy. Used by the
 * recogniser; call primeStrokes(store) once so authored paths are seen.
 */
export function resolveStrokes(letter: Pick<Letter, 'id' | 'char' | 'strokes'>): StrokePath[] | null {
  return authoredCache.get(letter.id) ?? (validStrokes(letter.strokes) ? letter.strokes : null) ?? draftStrokes(letter);
}

// ---------- export and import ----------

export interface StrokeExport {
  format: 'phi-strokes';
  version: 1;
  box: { size: 100; note: string };
  exportedAt: string;
  letters: Record<string, { char: string; strokes: StrokePath[] }>;
}

export function exportStrokes(store: Store, letters: Letter[]): StrokeExport {
  const out: StrokeExport = {
    format: 'phi-strokes',
    version: 1,
    box: { size: 100, note: 'SVG path data in a 100 x 100 box; glyph drawn at x 50, baseline 74, 90px Noto Sans Thai Looped 500, centred.' },
    exportedAt: new Date().toISOString(),
    letters: {},
  };
  for (const l of letters) {
    const a = authoredStrokes(store, l.id);
    if (a) out.letters[l.id] = { char: l.char, strokes: a.strokes };
  }
  return out;
}

/** Import authored strokes. Letters are matched by id, then by character. */
export function importStrokes(store: Store, letters: Letter[], json: string): { imported: string[]; skipped: string[] } {
  let data: StrokeExport;
  try {
    data = JSON.parse(json) as StrokeExport;
  } catch {
    throw new Error('That file is not JSON.');
  }
  if (!data || data.format !== 'phi-strokes' || typeof data.letters !== 'object') throw new Error('That file is not a Phi stroke export.');
  const imported: string[] = [];
  const skipped: string[] = [];
  store.transaction(() => {
    for (const [id, rec] of Object.entries(data.letters)) {
      const l = letters.find((x) => x.id === id) ?? letters.find((x) => x.char === rec?.char);
      if (!l || !validStrokes(rec?.strokes)) {
        skipped.push(rec?.char ?? id);
        continue;
      }
      saveStrokes(store, l, rec.strokes);
      imported.push(l.char);
    }
  });
  return { imported, skipped };
}
