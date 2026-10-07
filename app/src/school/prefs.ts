// School of the Night's saved state on the device, in the kv table under new
// keys of its own (nothing existing is renamed): preferences, the training
// wheels, ticks, saved presets, the session being run and the last summary.

import type { Store } from '../db/store';
import type { LineResult, They, Wheels } from './runner';

export const KEYS = {
  prefs: 'school.prefs',
  wheels: 'school.wheels',
  ticks: 'school.ticks',
  presets: 'school.presets',
  session: 'school.session',
  last: 'school.last',
  /** custom sections built on this device (see custom.ts) */
  custom: 'school.custom',
  /** a custom section still under review (not saved yet) */
  customDraft: 'school.customDraft',
} as const;

export type Minutes = 5 | 10 | 20;
export const MINUTES: Minutes[] = [5, 10, 20];

export interface SchoolPrefs {
  minutes: Minutes;
  /** "they speak as": the other person's forms in replies, and the tutor's voice */
  they: They;
  /** read the English instructions aloud with the phone's voice (mic muted meanwhile) */
  readAloud: boolean;
  /**
   * eyes-off: every instruction and every result is read aloud, the mic opens
   * by itself after the tutor speaks and closes when you stop, and the screen
   * stays awake. For a lesson with the phone face down or in a pocket.
   */
  eyesOff: boolean;
}

export const DEFAULT_PREFS: SchoolPrefs = { minutes: 10, they: 'f', readAloud: false, eyesOff: false };

export function loadPrefs(store: Store): SchoolPrefs {
  return { ...DEFAULT_PREFS, ...store.get<Partial<SchoolPrefs>>(KEYS.prefs, {}) };
}

export function savePrefs(store: Store, patch: Partial<SchoolPrefs>): SchoolPrefs {
  const next = { ...loadPrefs(store), ...patch };
  store.set(KEYS.prefs, next);
  return next;
}

export function loadWheels(store: Store): Wheels {
  return store.get<Wheels>(KEYS.wheels, {});
}

export function saveWheels(store: Store, w: Wheels) {
  store.set(KEYS.wheels, w);
}

/** Ticked line ids (ticking a section ticks its lines). */
export function loadTicks(store: Store): string[] {
  return store.get<string[]>(KEYS.ticks, []);
}

export function saveTicks(store: Store, ids: string[]) {
  store.set(KEYS.ticks, [...new Set(ids)]);
}

export interface Preset {
  id: string;
  name: string;
  lineIds: string[];
}

export function loadPresets(store: Store): Preset[] {
  return store.get<Preset[]>(KEYS.presets, []);
}

export function savePreset(store: Store, name: string, lineIds: string[]): Preset {
  const p: Preset = { id: `p${Date.now().toString(36)}`, name: name.trim().slice(0, 60) || 'My session', lineIds: [...new Set(lineIds)] };
  store.set(KEYS.presets, [...loadPresets(store), p]);
  return p;
}

export function deletePreset(store: Store, id: string) {
  store.set(KEYS.presets, loadPresets(store).filter((p) => p.id !== id));
}

/** The session the lesson screen runs. */
export interface SessionPlan {
  title: string;
  lineIds: string[];
  minutes: Minutes;
  /** practise the sections' frames too */
  slots: boolean;
  /** 'branch': opened by a door phrase, so Teach is marked done */
  startAt?: 'teach' | 'branch';
}

export function loadSession(store: Store): SessionPlan | null {
  return store.get<SessionPlan | null>(KEYS.session, null);
}

export function saveSession(store: Store, s: SessionPlan) {
  store.set(KEYS.session, s);
}

/** The last lesson's results, for the summary and "Pick for me". */
export interface LastLesson {
  at: number;
  title: string;
  results: LineResult[];
  missed: string[];
  /** course item ids whose cards moved */
  items: string[];
}

export function loadLast(store: Store): LastLesson | null {
  return store.get<LastLesson | null>(KEYS.last, null);
}

export function saveLast(store: Store, l: LastLesson) {
  store.set(KEYS.last, l);
}
