// The Street game state: baht, reputation with each person, tasks done, people
// met, and chapter progress. Stored in the kv table under "street".

import type { Store } from '../db/store';
import type { Content } from '../content/repo';
import { AFTER_PARTS, DOOR_TO_DOOR, METERS_PARTS, METER_ITEMS, STREET_TASKS, taskById, type DoorStop, type MeterPart } from '../content/street-seed';
import type { PlaceId, StreetTask } from '../content/types';

export interface ChapterState {
  best?: number;
  /** score of the last finished attempt (Door to Door compares against it) */
  last?: number;
  done?: boolean;
  /** highest part finished */
  part?: number;
  runs?: number;
  /** After Hours endings found */
  endings?: string[];
  /** Door to Door: hints per scene on the last run */
  hints?: Record<string, number>;
}

export interface StreetState {
  baht: number;
  rep: Record<string, number>;
  done: string[];
  /** chapter progress and best runs */
  chapters: Record<string, ChapterState>;
  /** people you have met (first meeting plays Gather) */
  met?: string[];
  /** one-off sequences already shown, e.g. "wai" */
  seen?: string[];
  /** where you stood on the street, 0..1 */
  at?: number;
}

export const START_BAHT = 500;
export const REP_MAX = 10;

export function loadStreet(store: Store): StreetState {
  const s = store.get<StreetState>('street', { baht: START_BAHT, rep: {}, done: [], chapters: {} });
  return { met: [], seen: [], ...s };
}

export function saveStreet(store: Store, s: StreetState) {
  store.set('street', s);
}

export function updateStreet(store: Store, fn: (s: StreetState) => StreetState | void): StreetState {
  const s = loadStreet(store);
  const next = fn(s) ?? s;
  saveStreet(store, next);
  return next;
}

/**
 * Street tasks open by this day: how many are done, how many first open today,
 * and the next one in path order. Only tasks in the loaded scripts count; ids
 * done under an earlier set stay in the state, untouched.
 */
export function streetProgress(store: Store, day: number, adult = false): { done: number; total: number; today: number; next: StreetTask | null } {
  const s = loadStreet(store);
  const open = STREET_TASKS.filter((t) => !t.chapter && t.day <= day && (!t.adult || adult));
  const left = open.filter((t) => !s.done.includes(t.id));
  return { done: open.length - left.length, total: open.length, today: open.filter((t) => t.day === day).length, next: left[0] ?? null };
}

export function repOf(s: StreetState, person: string): number {
  return Math.max(0, Math.min(REP_MAX, s.rep[person] ?? 0));
}

/** 0..1: how clearly a person resolves. Faint and broken at first, solid at full reputation. */
/** How clearly a person's face resolves: clear from the first meeting, a little sharper as reputation grows. */
export function clarityFor(rep: number): number {
  return 0.8 + 0.2 * Math.max(0, Math.min(1, rep / REP_MAX));
}

export function totalRep(s: StreetState): number {
  return Object.values(s.rep).reduce((a, b) => a + Math.max(0, b), 0);
}

/**
 * Apply a finished run. The first completion pays the reward and moves baht
 * and reputation. A replay of a task already done is practice: its answers are
 * still logged (they test understanding), but baht and reputation do not move.
 */
export function applyRun(
  s: StreetState,
  r: { taskId: string; person: string; outcome: 'done' | 'failed' | 'left' | 'quit'; baht: number; rep: number; reward: { baht: number; rep: number } },
): { state: StreetState; paid: { baht: number; rep: number } } {
  const replay = s.done.includes(r.taskId);
  const first = r.outcome === 'done' && !replay;
  const paid = replay ? { baht: 0, rep: 0 } : { baht: r.baht + (first ? r.reward.baht : 0), rep: r.rep + (first ? r.reward.rep : 0) };
  const rep = Math.max(0, Math.min(REP_MAX, (s.rep[r.person] ?? 0) + paid.rep));
  return {
    state: {
      ...s,
      baht: Math.max(0, s.baht + paid.baht),
      rep: { ...s.rep, [r.person]: rep },
      done: first ? [...s.done, r.taskId] : s.done,
      met: s.met?.includes(r.person) ? s.met : [...(s.met ?? []), r.person],
    },
    paid,
  };
}

// ---------- chapters: what the loaded scripts can play ----------
// With a generated course loaded, a chapter part whose script the course lacks
// is not ready yet. The chapter screens say so plainly and skip it.

type HasItems = Pick<Content, 'item'>;

// The generated course teaches left and right as ซ้าย and ขวา (what a passenger says to a driver);
// the seed set has เลี้ยวซ้าย and เลี้ยวขวา. Either serves the drive.
const METER_FALLBACK: Partial<Record<(typeof METER_ITEMS)[number], string>> = { 'turn-left': 'left', 'turn-right': 'right' };

/** The item a drive direction is said with in the loaded content, or undefined. */
export function meterItem(content: HasItems, dir: (typeof METER_ITEMS)[number]) {
  const alt = METER_FALLBACK[dir];
  return content.item(dir) ?? (alt ? content.item(alt) : undefined);
}

/** A Meter's Running part can be played: its talk is in the loaded scripts, and the content has the direction words the drive is built from. */
export function meterPartReady(p: MeterPart, content: HasItems): boolean {
  return !!taskById(p.task, 'm') && METER_ITEMS.every((id) => !!meterItem(content, id));
}

export interface AfterPartState {
  part: number;
  task: string;
  title: string;
  day: number;
  /** who the scene is with; unknown for a part the course lacks */
  person?: string;
  ready: boolean;
}

/** After Hours parts in path order, each ready or not. Parts only the course knows are included. */
export function afterHoursParts(): AfterPartState[] {
  const have = STREET_TASKS.filter((t) => t.chapter === 'after-hours');
  const missing = AFTER_PARTS.filter((p) => !have.some((t) => t.id === p.task));
  return [...have.map((t) => ({ task: t.id, title: t.title, day: t.day, person: t.person, ready: true })), ...missing.map((p) => ({ ...p, ready: false }))]
    .sort((a, b) => a.day - b.day || a.task.localeCompare(b.task))
    .map((p, i) => ({ ...p, part: i + 1 }));
}

export interface DoorStopState extends DoorStop {
  ready: boolean;
}

/** Door to Door stops in order, each ready or not. */
export function doorStops(): DoorStopState[] {
  return DOOR_TO_DOOR.map((d) => ({ ...d, ready: !!taskById(d.task, 'm') }));
}

/** True when a chapter has at least one part to play. */
export function chapterReady(id: 'meters-running' | 'after-hours' | 'door-to-door', content: HasItems): boolean {
  if (id === 'meters-running') return METERS_PARTS.some((p) => meterPartReady(p, content));
  if (id === 'after-hours') return afterHoursParts().some((p) => p.ready);
  return doorStops().some((d) => d.ready);
}

// ---------- for the Library: everything replayable ----------

export interface SceneEntry {
  id: string;
  title: string;
  place: PlaceId;
  person: string;
  day: number;
  /** route that replays it */
  to: string;
}

/** Street tasks already done, in path order. Each replays at /street/talk/:id. */
export function doneTasks(store: Store): SceneEntry[] {
  const s = loadStreet(store);
  return STREET_TASKS.filter((t) => !t.chapter && s.done.includes(t.id))
    .sort((a, b) => a.day - b.day)
    .map((t) => ({ id: t.id, title: t.title, place: t.place, person: t.person, day: t.day, to: `/street/talk/${t.id}` }));
}

export interface ChapterEntry {
  id: 'meters-running' | 'after-hours' | 'door-to-door';
  part: number | null;
  title: string;
  day: number;
  adult: boolean;
  /** route; the chapter screens open straight into a part with ?part=n */
  to: string;
}

/** Every chapter part that can be played, replayable from its picker even after completion. After Hours stays behind the 18+ setting. */
export function chapterList(content: HasItems): ChapterEntry[] {
  const stops = doorStops().filter((d) => d.ready);
  return [
    ...METERS_PARTS.filter((p) => meterPartReady(p, content)).map((p) => ({ id: 'meters-running' as const, part: p.part, title: `Meter's Running · ${p.title}`, day: p.day, adult: false, to: `/street/meters-running?part=${p.part}` })),
    ...afterHoursParts().filter((p) => p.ready).map((p) => ({ id: 'after-hours' as const, part: p.part, title: p.title, day: p.day, adult: true, to: `/street/after-hours?part=${p.part}` })),
    ...(stops.length
      ? [{ id: 'door-to-door' as const, part: null, title: 'Door to Door', day: Math.min(...stops.map((d) => STREET_TASKS.find((t) => t.id === d.task)?.day ?? 99)), adult: false, to: '/street/door-to-door' }]
      : []),
  ];
}
