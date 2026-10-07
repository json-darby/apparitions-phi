// The connection to Gemini Live (BidiGenerateContent), held by the server,
// over either Google API (PHI_LIVE_API):
//
//  gemini  the Gemini API with a key from Google AI Studio (the Cloud Run path).
//          wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=KEY
//          model models/gemini-3.8-live. Both are as shown in Google's "Get started
//          with Live API using WebSockets" (ai.google.dev, checked 4 Oct 2026).
//          The key travels in the URL as Google documents it, so this URL is never logged.
//  vertex  Vertex AI with Application Default Credentials (or an express-mode key).
//          wss://{location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent
//          model projects/{project}/locations/{location}/publishers/google/models/gemini-3.8-live
//
// It handles session resumption itself: Live connections last about 10
// minutes, the server announces the end with goAway, and a resumption handle
// (valid about 2 hours) lets a new connection carry on the same conversation.
// The browser only sees "reconnecting" and then "live".
//
// UNVERIFIED until the first real call (none has been made):
//  - which Vertex location serves gemini-3.8-live (us-central1 by default;
//    some reports say Gemini 3 models are served only at `global`)
//  - express-mode API keys for Live on Vertex (Google documents express mode
//    for generateContent only)
//  - realtimeInput.audio (vs the older mediaChunks) on Vertex v1
// Override the URL with PHI_LIVE_ENDPOINT if Google's path differs.

import WebSocket from 'ws';
import type { Config } from '../config.ts';
import { authHeaders, getAuth, type Auth } from '../auth.ts';
import { log } from '../log.ts';
import type { Directive, FunctionDeclaration } from './protocol.ts';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface UpstreamEvents {
  audio(pcm24k: Buffer): void;
  /** the learner's words, as transcribed by Live */
  inputText(text: string, finished: boolean): void;
  /** the character's words */
  outputText(text: string, finished: boolean): void;
  toolCall(calls: ToolCall[]): void;
  turnComplete(): void;
  interrupted(): void;
  state(s: 'live' | 'reconnecting'): void;
  closed(reason: string): void;
}

export interface Upstream {
  open(): Promise<void>;
  /** push-to-talk: the learner started or stopped speaking */
  activity(on: boolean): void;
  audio(pcm16k: Buffer): void;
  text(t: string): void;
  /** a School of the Night step: a text turn for the model */
  directive(d: Directive): void;
  toolResponse(id: string, name: string, response: Record<string, unknown>): void;
  close(): void;
  /** connections opened, including resumptions */
  readonly connections: number;
}

export interface UpstreamSetup {
  systemInstruction: string;
  tools: FunctionDeclaration[];
  voice: 'f' | 'm';
  /** School of the Night's tutor: its own voice setting */
  tutor?: boolean;
}

/** The prebuilt voice for a session, or null for the model's default voice. */
export function voiceFor(c: Config, s: UpstreamSetup): string | null {
  if (!s.tutor) return c.liveVoices[s.voice];
  if (!c.liveTutorVoice) return null;
  return c.liveTutorVoice === 'by-sex' ? c.liveVoices[s.voice] : c.liveTutorVoice;
}

export const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** The Live websocket URL without any credential. */
export function liveUrl(c: Config): string {
  if (c.liveEndpoint) return c.liveEndpoint;
  if (c.liveApi === 'gemini') return GEMINI_LIVE_URL;
  const host = c.liveLocation === 'global' ? 'aiplatform.googleapis.com' : `${c.liveLocation}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
}

export function liveModelPath(c: Config): string {
  if (c.liveApi === 'gemini') return c.liveModel.startsWith('models/') ? c.liveModel : `models/${c.liveModel}`;
  return c.project
    ? `projects/${c.project}/locations/${c.liveLocation}/publishers/google/models/${c.liveModel}`
    : `publishers/google/models/${c.liveModel}`;
}

/** Where and how to connect. Holds the credential: never log the result. */
export function liveConnection(c: Config, auth: Auth): { url: string; headers: Record<string, string> } {
  if (c.liveApi === 'gemini' && auth.kind === 'key') {
    const u = new URL(liveUrl(c));
    if (!u.searchParams.has('key')) u.searchParams.set('key', auth.key);
    return { url: u.toString(), headers: {} };
  }
  return { url: liveUrl(c), headers: authHeaders(auth, c) };
}

/** The first message on every connection. Exported for tests. */
export function setupMessage(c: Config, s: UpstreamSetup, handle: string | null) {
  const voiceName = voiceFor(c, s);
  return {
    setup: {
      model: liveModelPath(c),
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          ...(voiceName ? { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } : {}),
          ...(c.liveLanguageCode ? { languageCode: c.liveLanguageCode } : {}),
        },
        temperature: 0.7,
      },
      systemInstruction: { parts: [{ text: s.systemInstruction }] },
      tools: s.tools.length ? [{ functionDeclarations: s.tools }] : [],
      // push-to-talk: the app marks the start and end of each learner turn
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: handle ? { handle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

const MAX_RESUMES = 6;

interface LiveServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string }; text?: string }[] };
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  goAway?: { timeLeft?: string };
}

export class VertexUpstream implements Upstream {
  connections = 0;
  private ws: WebSocket | null = null;
  private handle: string | null = null;
  private closing = false;
  private resumes = 0;
  private reconnecting = false;
  private c: Config;
  private setup: UpstreamSetup;
  private ev: UpstreamEvents;

  constructor(c: Config, setup: UpstreamSetup, ev: UpstreamEvents) {
    this.c = c;
    this.setup = setup;
    this.ev = ev;
  }

  async open(): Promise<void> {
    this.ws = await this.connect();
  }

  private async connect(): Promise<WebSocket> {
    const { url, headers } = liveConnection(this.c, await getAuth(this.c, 'live'));
    const ws = new WebSocket(url, { headers, handshakeTimeout: 15000 });
    this.connections++;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const fail = (e: unknown) => reject(e instanceof Error ? e : new Error('live connection failed'));
      ws.once('error', fail);
      ws.once('unexpected-response', (req, res) => {
        reject(new Error(`live handshake http ${res.statusCode}`));
        req.destroy();
      });
      // Google refuses a bad setup (an unknown model, no access) by closing the
      // socket before setupComplete; without this the start would wait forever.
      ws.once('close', (code, reason) => {
        if (!ready) reject(new Error(`live closed ${code} ${reason.toString('utf8').slice(0, 60)}`.trim()));
      });
      ws.once('open', () => {
        ws.send(JSON.stringify(setupMessage(this.c, this.setup, this.handle)));
      });
      ws.on('message', (data) => {
        let m: LiveServerMessage;
        try {
          m = JSON.parse(data.toString()) as LiveServerMessage;
        } catch {
          return;
        }
        if (m.setupComplete !== undefined && !ready) {
          ready = true;
          ws.off('error', fail);
          resolve();
        }
        this.onMessage(ws, m);
      });
      ws.on('close', (code, reason) => this.onClose(ws, code, reason.toString('utf8')));
      ws.on('error', () => {
        /* reported through close */
      });
    });
    return ws;
  }

  private onMessage(ws: WebSocket, m: LiveServerMessage) {
    if (ws !== this.ws && this.ws) return; // an old connection draining
    const sc = m.serverContent;
    if (sc) {
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('audio/pcm')) this.ev.audio(Buffer.from(p.inlineData.data, 'base64'));
      }
      if (sc.inputTranscription?.text != null) this.ev.inputText(sc.inputTranscription.text, !!sc.inputTranscription.finished);
      if (sc.outputTranscription?.text != null) this.ev.outputText(sc.outputTranscription.text, !!sc.outputTranscription.finished);
      if (sc.interrupted) this.ev.interrupted();
      if (sc.turnComplete) this.ev.turnComplete();
    }
    if (m.toolCall?.functionCalls?.length) {
      this.ev.toolCall(m.toolCall.functionCalls.map((f, i) => ({ id: f.id ?? `call-${Date.now()}-${i}`, name: f.name ?? '', args: f.args ?? {} })));
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) {
      log('live.goaway', { left: m.goAway.timeLeft ?? '' });
      void this.resume();
    }
  }

  private onClose(ws: WebSocket, code: number, reason = '') {
    if (ws !== this.ws) return;
    if (this.closing) return;
    // Google's reason names what it refused (never the key: the URL is not part of it)
    log('live.upstream-closed', { code, reason: reason.slice(0, 160) });
    void this.resume();
  }

  /** Open a new connection with the last resumption handle and swap it in. */
  private async resume() {
    if (this.reconnecting || this.closing) return;
    if (!this.handle || this.resumes >= MAX_RESUMES) {
      this.ev.closed(this.handle ? 'too many reconnects' : 'connection lost');
      return;
    }
    this.reconnecting = true;
    this.resumes++;
    this.ev.state('reconnecting');
    const old = this.ws;
    try {
      const next = await this.connect();
      this.ws = next;
      try {
        old?.close(1000);
      } catch {
        /* already gone */
      }
      this.ev.state('live');
      log('live.resumed', { n: this.resumes });
    } catch {
      this.ev.closed('resume failed');
    } finally {
      this.reconnecting = false;
    }
  }

  private send(o: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.reconnecting) this.ws.send(JSON.stringify(o));
  }

  activity(on: boolean) {
    this.send({ realtimeInput: on ? { activityStart: {} } : { activityEnd: {} } });
  }

  audio(pcm: Buffer) {
    this.send({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
  }

  text(t: string) {
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true } });
  }

  directive(d: Directive) {
    this.text(d.text);
  }

  toolResponse(id: string, name: string, response: Record<string, unknown>) {
    this.send({ toolResponse: { functionResponses: [{ id, name, response }] } });
  }

  close() {
    this.closing = true;
    try {
      this.ws?.close(1000);
    } catch {
      /* ignore */
    }
  }
}
