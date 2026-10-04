// The app's side of live conversation. It talks only to the app's own server
// (never to Google, never with a Google credential): a websocket for the
// conversation, plain HTTP for /health and /stt. The server is the one set in
// Settings → Talk live (serverConfig.ts), on this computer or on Cloud Run,
// and every request carries the owner's access code when one is set: the
// `x-phi-code` header over HTTP, and over the websocket (where a browser cannot
// set headers) a `phi-code.<base64url>` entry in the subprotocol list.
//
// Audio: the learner's voice is captured only while the talk button is held,
// downsampled to 16 kHz mono PCM16 and sent as binary frames; the character's
// voice comes back as 24 kHz mono PCM16 and is played in order, cut short when
// the server says the turn was interrupted. A dropped connection reconnects
// and resumes the same server session.

import { BUILD_SERVER_URL, codeFor, liveServer } from './serverConfig';

export { bindLiveStore, liveServer, LIVE_RECHECK, normalizeServerUrl, saveLiveServer, savedLiveServer, type LiveServerSetting } from './serverConfig';

/** The build-time default address (VITE_PHI_SERVER). The address in use is liveServer().url. */
export const SERVER_URL: string = BUILD_SERVER_URL;

export const CODE_HEADER = 'x-phi-code';
const WS_PROTOCOL = 'phi';
const WS_CODE_PREFIX = 'phi-code.';

// ---------- protocol (a copy of server/src/live/protocol.ts) ----------

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}
export interface ScriptOption {
  thai: string;
  en: string;
  correct: boolean;
  next: string | null;
}
export interface ScriptNode {
  id: string;
  slot: string;
  thai: string;
  en: string;
  options: ScriptOption[];
}
export interface TaskScript {
  start: string;
  nodes: ScriptNode[];
}
export interface StartMsg {
  type: 'start';
  taskId: string;
  systemInstruction: string;
  tools: FunctionDeclaration[];
  voice: 'f' | 'm';
  adult: boolean;
  adultTask: boolean;
  script?: TaskScript;
}
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

// ---------- health ----------

export interface Health {
  ok: boolean;
  mock: boolean;
  /** the server wants an access code (this answer means the code was right) */
  needsCode?: boolean;
  live: { available: boolean; model: string; minutesPerDay: number; minutesLeft: number; active: number };
  stt: { available: boolean; model: string; callsLeftToday: number };
  budget: { ok: boolean; spentUsd: number; capUsd: number };
}

const LOCAL_PAGE_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function isLoopbackHost(h: string): boolean {
  const x = h.toLowerCase();
  return x === 'localhost' || x === '[::1]' || x === '::1' || /^127\.\d+\.\d+\.\d+$/.test(x);
}

function pageLocation(): { host: string; protocol: string } {
  return typeof location !== 'undefined' ? { host: location.hostname, protocol: location.protocol } : { host: 'localhost', protocol: 'http:' };
}

/**
 * Can this page call that server at all?
 * - A server on this computer (localhost) only from a page on this computer: a
 *   phone or the hosted app would just fail the request.
 * - Any https server from any page (the owner's Cloud Run address).
 * - A plain http server elsewhere only from a plain http page (an https page
 *   may not call http: mixed content).
 */
export function serverReachable(base: string, pageHost = pageLocation().host, pageProtocol = pageLocation().protocol): boolean {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (isLoopbackHost(u.hostname)) return LOCAL_PAGE_HOSTS.includes(pageHost.toLowerCase());
  if (u.protocol === 'http:' && pageProtocol === 'https:') return false;
  return true;
}

/** A server on this computer answers at once; a Cloud Run server may be waking up. */
function healthTimeout(base: string): number {
  try {
    return isLoopbackHost(new URL(base).hostname) ? 1500 : 8000;
  } catch {
    return 1500;
  }
}

/** Headers that carry the access code (none when there is no code). */
export function codeHeaders(code: string): Record<string, string> {
  return code ? { [CODE_HEADER]: code } : {};
}

// The speech check (segmental.ts) skips a server that said it has no STT, or
// refused the code, for a while, so recordings are not sent for nothing.
const sttDown = new Map<string, number>();
const STT_RETRY_MS = 10 * 60_000;

export function noteSttAvailable(base: string, available: boolean) {
  if (available) sttDown.delete(base);
  else sttDown.set(base, Date.now());
}

export function sttMayWork(base: string): boolean {
  const t = sttDown.get(base);
  return t == null || Date.now() - t > STT_RETRY_MS;
}

export type ProbeState =
  | 'ok'
  /** answers, wants a code, none was sent */
  | 'needs-code'
  | 'wrong-code'
  /** too many wrong codes from this address: wait */
  | 'too-many-tries'
  /** on the internet without an access code set, so it refuses everyone */
  | 'locked'
  /** no answer (off, wrong address, offline, or this page's origin not allowed by the server) */
  | 'unreachable'
  /** this page cannot call that address at all (a computer's localhost from a phone, http from https) */
  | 'blocked';

export interface Probe {
  state: ProbeState;
  health: Health | null;
}

/** Ask the server's /health with the access code, and say exactly what came back. */
export async function probeServer(base = liveServer().url, code = codeFor(base), timeoutMs = healthTimeout(base)): Promise<Probe> {
  const none = (state: ProbeState): Probe => ({ state, health: null });
  if (!serverReachable(base)) return none('blocked');
  let r: Response;
  try {
    r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', headers: codeHeaders(code) });
  } catch {
    return none('unreachable');
  }
  type Answer = Partial<Health> & { needsCode?: boolean; locked?: boolean; error?: string };
  const j = (await r.json().catch(() => null)) as Answer | null; // not JSON: not our server
  if (r.status === 429 || j?.error === 'too-many-tries') return none('too-many-tries');
  if (r.status === 401 || j?.error === 'wrong-code') return none('wrong-code');
  if (!r.ok || !j?.ok) return none('unreachable');
  if (j.locked) return none('locked');
  // the short answer a server gives without a valid code
  if (!j.live || !j.stt || !j.budget) return none(j.needsCode ? 'needs-code' : 'unreachable');
  const h = j as Health;
  noteSttAvailable(base, !!h.stt.available);
  return { state: 'ok', health: h };
}

/** What a test result says, in one line. */
export function probeMessage(p: Probe, base: string, pageOrigin = typeof location !== 'undefined' ? location.origin : ''): string {
  switch (p.state) {
    case 'ok': {
      const h = p.health!;
      if (!h.live.available) return 'Connected · live is not set up on the server yet (no Gemini key)';
      if (!h.mock && !h.budget.ok) return 'Connected · the spending cap is reached, so live is off';
      const left = Math.floor(h.live.minutesLeft);
      return `Connected · ${left} live minute${left === 1 ? '' : 's'} left today${h.mock ? ' (practice server, no cost)' : ''}`;
    }
    case 'wrong-code':
      return 'Wrong code';
    case 'needs-code':
      return 'Connected, but this server needs its access code';
    case 'too-many-tries':
      return 'Too many wrong codes from this device. Wait 15 minutes, then test again.';
    case 'locked':
      return 'The server has no access code set (PHI_ACCESS_CODE), so it refuses everyone';
    case 'blocked':
      return /^http:\/\/(localhost|127\.|\[::1\])/i.test(base)
        ? 'Not reachable · that address is a computer’s own; use the https address of your server'
        : 'Not reachable · an https page cannot use an http address; use the https address';
    default:
      return `Not reachable · check the address, and that the server allows ${pageOrigin || 'this page'} (PHI_ALLOWED_ORIGINS)`;
  }
}

// The background checks stop sending a code the server called wrong (until the
// code or address changes), so a stale code does not lock this device out.
// The Test button in Settings always asks.
let wrongCode: string | null = null;

/** The server's health, or null when it is not running, not reachable or not letting this device in. */
export async function checkHealth(base?: string, timeoutMs?: number): Promise<Health | null> {
  const b = base ?? liveServer().url;
  const code = codeFor(b);
  const key = `${b}\n${code}`;
  if (code && wrongCode === key) return null;
  const p = await probeServer(b, code, timeoutMs ?? healthTimeout(b));
  wrongCode = p.state === 'wrong-code' ? key : wrongCode === key ? null : wrongCode;
  return p.health;
}

/** Live is offered only when the server answers and has a way to talk to Gemini (or is in mock mode). */
export function liveUsable(h: Health | null): boolean {
  return !!h && h.live.available && h.live.minutesLeft > 0 && (h.mock || h.budget.ok);
}

export function wsUrl(base = liveServer().url): string {
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/live';
}

function base64url(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The websocket subprotocols: 'phi' (which the server picks) and the code, when there is one. */
export function wsProtocols(code: string): string[] | undefined {
  return code ? [WS_PROTOCOL, WS_CODE_PREFIX + base64url(code)] : undefined;
}

// ---------- audio helpers (pure, tested) ----------

/** Float samples at any rate to 16 kHz PCM16 (box-filtered decimation). */
export function toPcm16k(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / 16000;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let s = 0;
    for (let k = a; k < b; k++) s += input[k];
    const v = Math.max(-1, Math.min(1, s / (b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** PCM16 little-endian bytes to floats. */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const v = new DataView(bytes);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
  return out;
}

// ---------- microphone ----------

const WORKLET = `
class PhiMic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('phi-mic', PhiMic);
`;

class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private buf: Float32Array[] = [];
  private bufLen = 0;
  on = false;
  private onFrame: (pcm: Int16Array) => void;

  constructor(onFrame: (pcm: Int16Array) => void) {
    this.onFrame = onFrame;
  }

  async open() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream);
    const take = (f: Float32Array) => {
      if (!this.on) return;
      this.buf.push(f);
      this.bufLen += f.length;
      if (this.bufLen >= ctx.sampleRate * 0.1) this.flush();
    };
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, 'phi-mic');
      node.port.onmessage = (e) => take(e.data as Float32Array);
      src.connect(node);
      this.node = node;
    } else {
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => take(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(node);
      node.connect(ctx.destination);
      this.node = node;
    }
  }

  flush() {
    if (!this.ctx || !this.bufLen) return;
    const all = new Float32Array(this.bufLen);
    let o = 0;
    for (const b of this.buf) {
      all.set(b, o);
      o += b.length;
    }
    this.buf = [];
    this.bufLen = 0;
    this.onFrame(toPcm16k(all, this.ctx.sampleRate));
  }

  async start() {
    await this.open();
    await this.ctx?.resume();
    this.buf = [];
    this.bufLen = 0;
    this.on = true;
  }

  stop() {
    this.flush();
    this.on = false;
  }

  close() {
    this.on = false;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
  }
}

// ---------- playback ----------

class Player {
  private ctx: AudioContext | null = null;
  private next = 0;
  private live = new Set<AudioBufferSourceNode>();
  private onSpeaking: (on: boolean) => void;

  constructor(onSpeaking: (on: boolean) => void) {
    this.onSpeaking = onSpeaking;
  }

  /** Call from a click so the browser lets audio play. */
  unlock() {
    if (!this.ctx) this.ctx = new AudioContext();
    void this.ctx.resume();
  }

  play(bytes: ArrayBuffer) {
    if (!this.ctx) this.unlock();
    const ctx = this.ctx!;
    const f = pcm16ToFloat(bytes);
    if (!f.length) return;
    const buf = ctx.createBuffer(1, f.length, 24000);
    buf.copyToChannel(f as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.next);
    src.start(at);
    this.next = at + buf.duration;
    if (!this.live.size) this.onSpeaking(true);
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      if (!this.live.size) this.onSpeaking(false);
    };
  }

  interrupt() {
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
    this.next = 0;
    this.onSpeaking(false);
  }

  close() {
    this.interrupt();
    void this.ctx?.close();
    this.ctx = null;
  }
}

// ---------- the client ----------

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface LiveHandlers {
  status?(s: LiveStatus, detail?: string): void;
  ready?(m: Extract<ServerMsg, { type: 'ready' }>): void;
  transcript?(t: Extract<ServerMsg, { type: 'transcript' }>): void;
  /** answer a tool call; the return value goes back to the model */
  tool?(call: { id: string; name: string; args: Record<string, unknown> }): Record<string, unknown> | Promise<Record<string, unknown>>;
  turnComplete?(): void;
  limit?(reason: LimitReason, minutesLeft: number): void;
  error?(code: string, message: string): void;
  ended?(reason: string, seconds: number): void;
  /** the character's voice is playing */
  speaking?(on: boolean): void;
}

export interface LiveClientOptions {
  /** the server; default: the one set in Settings → Talk live */
  base?: string;
  /** the access code; default: the saved code, when base is the saved server */
  code?: string;
  handlers: LiveHandlers;
  /** false in tests: no microphone, no speakers */
  audio?: boolean;
  /** reconnect attempts after an unexpected drop */
  retries?: number;
}

export class LiveClient {
  status: LiveStatus = 'idle';
  sessionId: string | null = null;
  mock = false;
  private ws: WebSocket | null = null;
  private h: LiveHandlers;
  private base: string;
  private code: string;
  private audio: boolean;
  private retries: number;
  private tries = 0;
  private stopped = false;
  private mic: Mic | null = null;
  private player: Player | null = null;
  private talking = false;
  private startMsg: StartMsg | null = null;
  /** the character's audio since the learner last spoke, and the line before that */
  private npcNow: ArrayBuffer[] = [];
  private npcLast: ArrayBuffer[] = [];

  constructor(o: LiveClientOptions) {
    this.h = o.handlers;
    this.base = o.base ?? liveServer().url;
    this.code = o.code ?? codeFor(this.base);
    this.audio = o.audio ?? true;
    this.retries = o.retries ?? 4;
    if (this.audio) this.player = new Player((on) => this.h.speaking?.(on));
  }

  private set(s: LiveStatus, detail?: string) {
    this.status = s;
    this.h.status?.(s, detail);
  }

  /** Open the conversation. Resolves when the server is ready, rejects if it cannot start. */
  start(msg: StartMsg): Promise<void> {
    this.startMsg = msg;
    this.stopped = false;
    this.player?.unlock();
    this.set('connecting');
    return this.connect(false);
  }

  private connect(resume: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl(this.base), wsProtocols(this.code));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify(resume && this.sessionId ? { type: 'resume', sessionId: this.sessionId } : this.startMsg));
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          this.npcNow.push(e.data as ArrayBuffer);
          this.player?.play(e.data as ArrayBuffer);
          return;
        }
        let m: ServerMsg;
        try {
          m = JSON.parse(e.data) as ServerMsg;
        } catch {
          return;
        }
        if (m.type === 'ready') {
          settled = true;
          this.tries = 0;
          this.sessionId = m.sessionId;
          this.mock = m.mock;
          this.set('live');
          this.h.ready?.(m);
          resolve();
          return;
        }
        if (!settled && (m.type === 'limit' || m.type === 'error')) {
          settled = true;
          this.stopped = true;
          if (m.type === 'limit') this.h.limit?.(m.reason, m.minutesLeft);
          else this.h.error?.(m.code, m.message);
          this.set('error', m.type === 'limit' ? m.reason : m.code);
          reject(new Error(m.type === 'limit' ? `limit:${m.reason}` : m.code));
          return;
        }
        this.onMessage(m);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        if (!settled) {
          settled = true;
          if (resume) {
            void this.retry();
            resolve();
          } else {
            this.set('error', 'unreachable');
            reject(new Error('unreachable'));
          }
          return;
        }
        if (this.stopped) return;
        void this.retry();
      };
      ws.onerror = () => {
        /* followed by close */
      };
    });
  }

  private async retry() {
    if (this.stopped) return;
    if (this.tries >= this.retries || !this.sessionId) {
      this.set('error', 'connection lost');
      this.h.error?.('connection-lost', 'The live connection dropped.');
      return;
    }
    this.tries++;
    this.set('reconnecting');
    await new Promise((r) => setTimeout(r, 400 * 2 ** (this.tries - 1)));
    if (!this.stopped) await this.connect(true);
  }

  private async onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'transcript':
        this.h.transcript?.(m);
        return;
      case 'tool': {
        let response: Record<string, unknown> = { ok: true };
        try {
          response = (await this.h.tool?.({ id: m.id, name: m.name, args: m.args ?? {} })) ?? { ok: true };
        } catch {
          response = { ok: false };
        }
        this.send({ type: 'toolResult', id: m.id, name: m.name, response });
        return;
      }
      case 'turnComplete':
        this.h.turnComplete?.();
        return;
      case 'interrupted':
        this.player?.interrupt();
        return;
      case 'status':
        this.set(m.state === 'reconnecting' ? 'reconnecting' : 'live');
        return;
      case 'limit':
        this.h.limit?.(m.reason, m.minutesLeft);
        return;
      case 'error':
        this.h.error?.(m.code, m.message);
        return;
      case 'ended':
        this.stopped = true;
        this.set('ended', m.reason);
        this.h.ended?.(m.reason, m.seconds);
        return;
    }
  }

  private send(o: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  /** Push-to-talk. The microphone opens on the first press (the browser asks once). */
  async talk(on: boolean) {
    if (on === this.talking) return;
    this.talking = on;
    if (on) {
      this.player?.interrupt();
      this.learnerTurn();
      this.send({ type: 'talk', on: true });
      if (this.audio) {
        if (!this.mic) {
          this.mic = new Mic((pcm) => {
            if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer as ArrayBuffer);
          });
        }
        try {
          await this.mic.start();
        } catch (e) {
          this.talking = false;
          this.send({ type: 'talk', on: false });
          throw e;
        }
        // released while the microphone was opening
        if (!this.talking) this.mic.stop();
      }
    } else {
      this.mic?.stop();
      this.send({ type: 'talk', on: false });
    }
  }

  /** Raw PCM16 16 kHz, for tests and for callers with their own capture. */
  sendAudio(pcm: Int16Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer as ArrayBuffer);
  }

  sendText(text: string) {
    this.learnerTurn();
    this.send({ type: 'text', text });
  }

  /** The learner is about to speak: what the character said so far becomes "their last line". */
  private learnerTurn() {
    if (this.npcNow.length) {
      this.npcLast = this.npcNow;
      this.npcNow = [];
    }
  }

  /** There is a line of the character's to hear again. */
  get canReplay(): boolean {
    return !!this.player && (this.npcNow.length > 0 || this.npcLast.length > 0);
  }

  /** Play the character's latest line again, on this device only (nothing goes to the server). */
  replayLine(): boolean {
    const chunks = this.npcNow.length ? this.npcNow : this.npcLast;
    if (!this.player || !chunks.length) return false;
    this.player.interrupt();
    for (const c of chunks) this.player.play(c.slice(0));
    return true;
  }

  stop() {
    this.stopped = true;
    this.send({ type: 'stop' });
    try {
      this.ws?.close(1000);
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.mic?.close();
    this.mic = null;
    this.player?.close();
    if (this.status !== 'error') this.set('ended');
  }
}
