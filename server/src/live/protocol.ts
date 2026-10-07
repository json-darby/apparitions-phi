// The small protocol between the app and this server on /live
// (ws://127.0.0.1:8787/live on the PC, wss://…run.app/live on Cloud Run).
// Google's own message format stays on the server side; the browser never sees
// a credential or a Google endpoint. The app keeps a copy of these types in
// app/src/live/client.ts.
//
// Binary frames: browser -> server is PCM16 little-endian mono 16 kHz (the
// learner's voice, only while the talk button is held); server -> browser is
// PCM16 little-endian mono 24 kHz (the character's voice).

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

/** The scripted task, sent so mock mode can answer from it (and ignored by the real model). */
export interface ScriptOption {
  thai: string;
  en: string;
  correct: boolean;
  next: string | null;
}
export interface ScriptNode {
  id: string;
  /** the task step this node fills */
  slot: string;
  thai: string;
  en: string;
  options: ScriptOption[];
}
export interface TaskScript {
  start: string;
  nodes: ScriptNode[];
}

/**
 * One step of a School of the Night lesson. The app runs the lesson and sends
 * the model one short directive per step, passed to it as a text turn; the
 * model never decides what comes next. `say` and `expect` repeat what the
 * text asks for, so mock mode can play the tutor without reading prose.
 */
export interface Directive {
  /** the app's step id */
  step: string;
  /** the text turn the model gets */
  text: string;
  /** the Thai the tutor says in this step, if any */
  say?: string;
  /** the lines the learner may answer with, the right one first */
  expect?: { lineId: string; thai: string }[];
  /** say it slowly */
  slower?: boolean;
}

export type ClientMsg =
  | {
      type: 'start';
      taskId: string;
      systemInstruction: string;
      tools: FunctionDeclaration[];
      /** the character's speech form, picks the voice */
      voice: 'f' | 'm';
      /** the learner's 18+ setting */
      adult: boolean;
      /** the task is an After Hours (18+) scene */
      adultTask: boolean;
      script?: TaskScript;
      /** a School of the Night lesson: the tutor, driven by directives */
      tutor?: boolean;
    }
  | { type: 'resume'; sessionId: string }
  | { type: 'talk'; on: boolean }
  | { type: 'text'; text: string }
  | { type: 'directive'; directive: Directive }
  | { type: 'toolResult'; id: string; name: string; response: Record<string, unknown> }
  | { type: 'stop' };

export type LimitReason = 'daily' | 'session' | 'budget' | 'rate' | 'busy';

export type ServerMsg =
  | { type: 'ready'; sessionId: string; mock: boolean; minutesLeft: number; resumed?: boolean }
  | { type: 'transcript'; who: 'npc' | 'learner'; text: string; final: boolean; turn: number }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'turnComplete' }
  | { type: 'interrupted' }
  | { type: 'status'; state: 'live' | 'reconnecting' }
  | { type: 'limit'; reason: LimitReason; minutesLeft: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'ended'; reason: string; seconds: number };

export function isScript(x: unknown): x is TaskScript {
  const s = x as TaskScript;
  return !!s && typeof s.start === 'string' && Array.isArray(s.nodes) &&
    s.nodes.every((n) => typeof n?.id === 'string' && typeof n.thai === 'string' && Array.isArray(n.options));
}

export const MAX_DIRECTIVE_CHARS = 1200;

/** A directive with its fields checked and trimmed to size, or null. */
export function cleanDirective(x: unknown): Directive | null {
  const d = x as Directive;
  if (!d || typeof d.step !== 'string' || typeof d.text !== 'string' || !d.text.trim()) return null;
  const out: Directive = { step: d.step.slice(0, 80), text: d.text.slice(0, MAX_DIRECTIVE_CHARS) };
  if (typeof d.say === 'string' && d.say.trim()) out.say = d.say.slice(0, 200);
  if (Array.isArray(d.expect)) {
    out.expect = d.expect
      .filter((e) => e && typeof e.lineId === 'string' && typeof e.thai === 'string')
      .slice(0, 6)
      .map((e) => ({ lineId: e.lineId.slice(0, 80), thai: e.thai.slice(0, 200) }));
  }
  if (d.slower === true) out.slower = true;
  return out;
}
