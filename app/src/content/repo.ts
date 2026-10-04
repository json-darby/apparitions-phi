// Content repository: everything the learner can meet, loaded from the local
// database. On first run (or when the bundled content version changes) the
// bundled content is written into the database; progress is never touched.
//
// Phase 4: the generated course arrives as content/course.json (precached by
// the PWA). App boot fetches it (fetchCourse) and, when its version differs
// from the stored one, reseeds from it (applyCourse). Without a course file
// the seed set stays. loadContent stays synchronous after boot.

import type { Store } from '../db/store';
import { CAST, PLACES, SEED_CULTURE, SEED_ITEMS, SEED_LETTERS, SEED_PATTERNS } from './seed';
import { emptyMedia, type CastMember, type ContentKind, type CultureNote, type Item, type Letter, type MediaSlots, type Pattern, type Place, type Skill, type StreetTask } from './types';

/** bump when the bundled content changes */
export const CONTENT_VERSION = 'seed-2';

export type Ref = `${ContentKind}:${string}`;
export const ref = (kind: ContentKind, id: string): Ref => `${kind}:${id}`;
export function parseRef(r: string): { kind: ContentKind; id: string } {
  const i = r.indexOf(':');
  return { kind: r.slice(0, i) as ContentKind, id: r.slice(i + 1) };
}

export interface ContentEntry {
  ref: Ref;
  kind: ContentKind;
  day: number;
  skills: Skill[];
  survival: boolean;
  adult: boolean;
  /** a short label for lists and logs */
  label: string;
}

/** A dialogue or example line with its own audio (course.json `lines`). */
export interface CourseLine {
  id: string;
  thai: string;
  roman?: string;
  en?: string;
  speaker?: string;
  /** keys "<voice>.<speed>" (voice may be a cast id), values paths relative to the app root */
  audio: Record<string, string | null>;
  pitch?: (number | null)[][] | null;
}

/** The generated course file (pipeline/CONTRACT.md). */
export interface CourseFile {
  version: string;
  generatedAt?: string;
  courseDays?: number;
  voices?: Record<string, string>;
  items: Item[];
  letters?: Letter[];
  patterns?: Pattern[];
  culture?: CultureNote[];
  tasks?: StreetTask[];
  lines?: Record<string, Omit<CourseLine, 'id'>>;
  checks?: Record<string, unknown>;
}

function hasFiles(m: MediaSlots | undefined | null): boolean {
  return !!m && Object.values(m.audio ?? {}).some(Boolean);
}

export class Content {
  readonly items: Item[];
  readonly letters: Letter[];
  readonly patterns: Pattern[];
  readonly culture: CultureNote[];
  /** course lines by id (empty for the seed set) */
  readonly lines: Map<string, CourseLine>;
  /** street tasks from the course file (empty for the seed set, which builds its own) */
  readonly tasks: StreetTask[];
  /** true when at least one clip exists: the sound service switches to real audio */
  readonly hasAudio: boolean;
  readonly cast: CastMember[] = CAST;
  readonly places: Place[] = PLACES;
  private entries = new Map<string, ContentEntry>();
  private itemMap = new Map<string, Item>();
  private letterMap = new Map<string, Letter>();
  private patternMap = new Map<string, Pattern>();

  constructor(data: { items: Item[]; letters: Letter[]; patterns: Pattern[]; culture: CultureNote[]; lines?: CourseLine[]; tasks?: StreetTask[] }) {
    this.items = data.items;
    this.letters = data.letters;
    this.patterns = data.patterns;
    this.culture = data.culture;
    this.lines = new Map((data.lines ?? []).map((l) => [l.id, l]));
    this.tasks = data.tasks ?? [];
    this.hasAudio =
      this.items.some((x) => hasFiles(x.media)) ||
      this.letters.some((x) => hasFiles(x.media)) ||
      this.patterns.some((x) => hasFiles(x.media)) ||
      [...this.lines.values()].some((l) => Object.values(l.audio ?? {}).some(Boolean));
    for (const it of this.items) {
      this.itemMap.set(it.id, it);
      this.entries.set(ref('item', it.id), {
        ref: ref('item', it.id), kind: 'item', day: it.day, skills: it.skills, survival: it.survival,
        adult: !!it.adult, label: it.en,
      });
    }
    for (const l of this.letters) {
      this.letterMap.set(l.id, l);
      this.entries.set(ref('letter', l.id), {
        ref: ref('letter', l.id), kind: 'letter', day: l.day, skills: l.skills, survival: false, adult: false,
        label: `${l.char} ${l.name}`,
      });
    }
    for (const p of this.patterns) {
      this.patternMap.set(p.id, p);
      this.entries.set(ref('pattern', p.id), {
        ref: ref('pattern', p.id), kind: 'pattern', day: p.day, skills: p.skills, survival: false, adult: false,
        label: p.en,
      });
    }
  }

  entry(r: string): ContentEntry | undefined {
    return this.entries.get(r);
  }
  allEntries(): ContentEntry[] {
    return [...this.entries.values()];
  }
  item(id: string): Item | undefined {
    return this.itemMap.get(id.startsWith('item:') ? id.slice(5) : id);
  }
  letter(id: string): Letter | undefined {
    return this.letterMap.get(id.startsWith('letter:') ? id.slice(7) : id);
  }
  pattern(id: string): Pattern | undefined {
    return this.patternMap.get(id.startsWith('pattern:') ? id.slice(8) : id);
  }
  person(id: string): CastMember | undefined {
    return this.cast.find((c) => c.id === id);
  }
  cultureForDay(day: number): CultureNote | undefined {
    return this.culture.find((c) => c.day === day) ?? [...this.culture].reverse().find((c) => c.day <= day);
  }
}

export function seedContent(store: Store, force = false) {
  // a loaded course is kept until a newer course replaces it (never downgraded to the seed set)
  if (!force && store.getMeta('content_source') === 'course') return;
  if (!force && store.getMeta('content_version') === CONTENT_VERSION) return;
  store.transaction(() => {
    store.clearContent();
    for (const it of SEED_ITEMS) store.putContent(ref('item', it.id), 'item', it.day, it);
    for (const l of SEED_LETTERS) store.putContent(ref('letter', l.id), 'letter', l.day, l);
    for (const p of SEED_PATTERNS) store.putContent(ref('pattern', p.id), 'pattern', p.day, p);
    for (const c of SEED_CULTURE) store.putContent(`culture:${c.id}`, 'culture', c.day, c);
  });
  store.setMeta('content_version', CONTENT_VERSION);
  store.setMeta('content_source', 'seed');
}

/** Fetch the generated course (precached by the service worker). Null when absent or unreadable. */
export async function fetchCourse(url = 'content/course.json', timeoutMs = 8000): Promise<CourseFile | null> {
  if (typeof fetch === 'undefined') return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl?.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // a navigation fallback, not the file
    const data = (await res.json()) as CourseFile;
    return data && typeof data.version === 'string' && Array.isArray(data.items) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function withMedia<T extends { media?: MediaSlots }>(x: T): T {
  const m = x.media;
  return { ...x, media: { ...emptyMedia(), ...(m ?? {}), audio: { ...emptyMedia().audio, ...(m?.audio ?? {}) } } };
}

/**
 * Write a course into the store when its version differs from what is stored.
 * Draft items never reach the learner. Returns true when it reseeded.
 */
export function applyCourse(store: Store, course: CourseFile | null): boolean {
  if (!course) return false;
  if (store.getMeta('content_source') === 'course' && store.getMeta('content_version') === course.version) return false;
  const live = <T extends { status?: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.status !== 'draft');
  store.transaction(() => {
    store.clearContent();
    for (const it of live(course.items)) store.putContent(ref('item', it.id), 'item', it.day, withMedia(it));
    for (const l of live(course.letters)) store.putContent(ref('letter', l.id), 'letter', l.day, withMedia(l));
    for (const p of live(course.patterns)) store.putContent(ref('pattern', p.id), 'pattern', p.day, withMedia(p));
    for (const c of live(course.culture)) store.putContent(`culture:${c.id}`, 'culture', c.day, c);
    for (const t of course.tasks ?? []) store.putContent(`task:${t.id}`, 'task', t.day, t);
    for (const [id, l] of Object.entries(course.lines ?? {})) store.putContent(`line:${id}`, 'line', 0, { ...l, id, audio: l.audio ?? {} });
  });
  store.setMeta('content_version', course.version);
  store.setMeta('content_source', 'course');
  store.set('course_meta', { version: course.version, generatedAt: course.generatedAt ?? null, courseDays: course.courseDays ?? null, voices: course.voices ?? {} });
  return true;
}

export function loadContent(store: Store): Content {
  seedContent(store);
  return new Content({
    items: store.listContent<Item>('item'),
    letters: store.listContent<Letter>('letter'),
    patterns: store.listContent<Pattern>('pattern'),
    culture: store.listContent<CultureNote>('culture'),
    lines: store.listContent<CourseLine>('line'),
    tasks: store.listContent<StreetTask>('task'),
  });
}

// ---- speech forms ----

export type Identity = 'm' | 'f';

/** The Thai the learner says, with the polite ending for their speaking identity. */
export function sayForm(it: Item, identity: Identity): { thai: string; roman: string } {
  const base = it.forms ? it.forms[identity] : { thai: it.thai, roman: it.roman };
  if (!it.polite) return base;
  if (identity === 'm') return { thai: base.thai + 'ครับ', roman: `${base.roman} khráp` };
  // a woman says คะ after นะ (นะคะ, never นะค่ะ)
  return it.polite === 'question' || base.thai.endsWith('นะ')
    ? { thai: base.thai + 'คะ', roman: `${base.roman} khá` }
    : { thai: base.thai + 'ค่ะ', roman: `${base.roman} khâ` };
}

/** Both forms, for listening (listening always includes both). */
export function bothForms(it: Item): { m: { thai: string; roman: string }; f: { thai: string; roman: string } } {
  return { m: sayForm(it, 'm'), f: sayForm(it, 'f') };
}
