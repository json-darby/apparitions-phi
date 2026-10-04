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
    }
  | { type: 'resume'; sessionId: string }
  | { type: 'talk'; on: boolean }
  | { type: 'text'; text: string }
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
