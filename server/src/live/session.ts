// Live sessions. One per conversation. The session owns the upstream (Gemini
// Live or the mock), relays audio both ways, gathers transcription chunks into
// turns, forwards tool calls to the app and their results back, meters the
// minutes, and survives a dropped browser for a short time so the app can
// reattach with { type: 'resume', sessionId }.

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Config } from '../config.ts';
import type { Ledger } from '../ledger.ts';
import { localDay } from '../ledger.ts';
import { RateLimiter } from '../limits.ts';
import { log } from '../log.ts';
import { composeInstruction } from './guard.ts';
import { MockTutor, MockUpstream } from './mock.ts';
import { cleanDirective, isScript, type ClientMsg, type LimitReason, type ServerMsg } from './protocol.ts';
import { VertexUpstream, type Upstream, type UpstreamEvents } from './upstream.ts';

const TOOL_NAMES = new Set(['slotFilled', 'questComplete', 'flagUnsafe', 'lineHeard', 'repeatAsked']);
const MAX_FLAGS = 3;

export class LiveSession {
  readonly id = randomUUID();
  browser: WebSocket | null = null;
  upstream: Upstream | null = null;
  seconds = 0;
  /** seconds already written to the ledger (written every minute, so a crash loses at most one) */
  recorded = 0;
  ended = false;
  private turn = 0;
  private inBuf = '';
  private outBuf = '';
  private ticker: ReturnType<typeof setInterval> | null = null;
  private reattach: ReturnType<typeof setTimeout> | null = null;
  private talking = false;
  /** a learner turn is open upstream: opened by the first audio of a press, not by the press itself */
  private activityOpen = false;
  /** set when a talk turn ends, so an empty transcription is still reported once */
  private heardEmpty = false;
  private flags = 0;
  private hub: LiveHub;
  private startMs = 0;

  constructor(hub: LiveHub) {
    this.hub = hub;
  }

  send(m: ServerMsg) {
    if (this.browser?.readyState === WebSocket.OPEN) this.browser.send(JSON.stringify(m));
  }

  sendAudio(pcm: Buffer) {
    if (this.browser?.readyState === WebSocket.OPEN) this.browser.send(pcm, { binary: true });
  }

  attach(ws: WebSocket) {
    if (this.reattach) clearTimeout(this.reattach);
    this.reattach = null;
    if (this.browser && this.browser !== ws) {
      try {
        this.browser.close(4000, 'replaced');
      } catch {
        /* ignore */
      }
    }
    this.browser = ws;
  }

  /** The browser went away: keep the session for a little while. */
  detach(ws: WebSocket) {
    if (this.browser !== ws || this.ended) return;
    this.browser = null;
    if (this.talking) {
      this.talking = false;
      this.upstream?.activity(false);
    }
    this.reattach = setTimeout(() => this.end('browser gone'), this.hub.config.reattachSeconds * 1000);
  }

  async start(m: Extract<ClientMsg, { type: 'start' }>) {
    const c = this.hub.config;
    const events: UpstreamEvents = {
      audio: (pcm) => this.sendAudio(pcm),
      inputText: (t, fin) => this.chunk('learner', t, fin),
      outputText: (t, fin) => this.chunk('npc', t, fin),
      toolCall: (calls) => {
        for (const call of calls) {
          if (!TOOL_NAMES.has(call.name)) {
            this.upstream?.toolResponse(call.id, call.name, { ok: false, error: 'unknown tool' });
            continue;
          }
          this.flush('learner');
          if (call.name === 'flagUnsafe') {
            this.flags++;
            log('live.flag', { category: String(call.args.category ?? 'other'), n: this.flags });
          }
          this.send({ type: 'tool', id: call.id, name: call.name, args: call.args });
          if (call.name === 'flagUnsafe' && this.flags >= MAX_FLAGS) {
            this.end('flagged');
            return;
          }
        }
      },
      turnComplete: () => {
        this.flush('learner');
        this.flush('npc');
        this.turn++;
        this.send({ type: 'turnComplete' });
      },
      interrupted: () => this.send({ type: 'interrupted' }),
      state: (s) => this.send({ type: 'status', state: s }),
      closed: (reason) => this.end(reason),
    };
    const adultScene = m.adultTask && m.adult;
    const setup = {
      systemInstruction: composeInstruction(String(m.systemInstruction ?? ''), adultScene),
      tools: Array.isArray(m.tools) ? m.tools.filter((t) => TOOL_NAMES.has(t?.name)) : [],
      voice: m.voice === 'm' ? ('m' as const) : ('f' as const),
      tutor: m.tutor === true,
    };
    this.upstream = c.mock
      ? setup.tutor
        ? new MockTutor(setup.voice, events, this.hub.mockDelayMs)
        : new MockUpstream(isScript(m.script) ? m.script : undefined, setup.voice, events, this.hub.mockDelayMs)
      : new VertexUpstream(c, setup, events);
    await this.upstream.open();
    this.startMs = Date.now();
    this.ticker = setInterval(() => this.tick(), 1000);
    log('live.start', { session: this.id.slice(0, 8), mock: c.mock, task: m.taskId, tutor: setup.tutor });
  }

  /** Transcription arrives in pieces: gather them into one line per speaker per turn. */
  private chunk(who: 'npc' | 'learner', text: string, finished: boolean) {
    if (who === 'learner') this.inBuf += text;
    else this.outBuf += text;
    const buf = who === 'learner' ? this.inBuf : this.outBuf;
    if (finished) this.flush(who);
    else if (buf.trim()) this.send({ type: 'transcript', who, text: buf.trim(), final: false, turn: this.turn });
  }

  private flush(who: 'npc' | 'learner') {
    if (who === 'npc') {
      const buf = this.outBuf.trim();
      this.outBuf = '';
      if (buf) this.send({ type: 'transcript', who, text: buf, final: true, turn: this.turn });
      return;
    }
    const buf = this.inBuf.trim();
    this.inBuf = '';
    // an empty learner line still matters once after a talk turn: they were heard saying nothing
    if (buf || this.heardEmpty) this.send({ type: 'transcript', who, text: buf, final: true, turn: this.turn });
    this.heardEmpty = false;
  }

  handle(m: ClientMsg) {
    if (this.ended || !this.upstream) return;
    switch (m.type) {
      case 'talk':
        // Google ends the whole session on an empty turn (start, then end, no audio:
        // a press released while the browser was still asking for the microphone).
        // So the turn opens with its first audio, and a press with none is "heard nothing".
        if (m.on === this.talking) return;
        this.talking = m.on;
        if (m.on) return;
        if (this.activityOpen) {
          this.activityOpen = false;
          this.heardEmpty = true;
          this.upstream.activity(false);
        } else {
          this.send({ type: 'transcript', who: 'learner', text: '', final: true, turn: this.turn });
        }
        return;
      case 'text':
        if (typeof m.text === 'string' && m.text.trim()) this.upstream.text(m.text.slice(0, 500));
        return;
      case 'directive': {
        const d = cleanDirective(m.directive);
        if (d) this.upstream.directive(d);
        return;
      }
      case 'toolResult':
        if (typeof m.id === 'string' && TOOL_NAMES.has(m.name)) this.upstream.toolResponse(m.id, m.name, m.response ?? {});
        return;
      case 'stop':
        this.end('stopped');
        return;
    }
  }

  audio(pcm: Buffer) {
    if (!this.talking || this.ended || !this.upstream) return;
    if (pcm.length > 64_000 || pcm.length < 2) return; // 2 s per frame at most
    if (!this.activityOpen) {
      this.activityOpen = true;
      this.upstream.activity(true);
    }
    this.upstream.audio(pcm);
  }

  private tick() {
    if (this.ended) return;
    this.seconds = (Date.now() - this.startMs) / 1000;
    const c = this.hub.config;
    if (this.seconds - this.recorded >= 60) this.record('running');
    if (this.seconds >= c.maxSessionMinutes * 60) return this.limit('session');
    if (this.hub.liveSecondsToday() >= c.liveMinutesPerDay * 60) return this.limit('daily');
    if (!c.mock && this.hub.ledger.spent() + this.hub.activeUsd() > this.hub.ledger.cap()) return this.limit('budget');
  }

  private limit(reason: LimitReason) {
    this.send({ type: 'limit', reason, minutesLeft: this.hub.minutesLeft() });
    this.end(`limit:${reason}`);
  }

  /** Write the seconds not yet in the ledger. */
  private record(note: string) {
    const c = this.hub.config;
    const secs = this.seconds - this.recorded;
    if (secs <= 0) return;
    this.recorded = this.seconds;
    this.hub.ledger.record({
      kind: 'live', model: c.mock ? 'mock' : c.liveModel,
      units: { seconds: Math.round(secs * 10) / 10, connections: this.upstream?.connections ?? 0 },
      usd: (secs / 60) * c.prices.liveMinute, mock: c.mock, note: note.slice(0, 40),
    });
  }

  end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.reattach) clearTimeout(this.reattach);
    if (this.startMs) this.seconds = (Date.now() - this.startMs) / 1000;
    this.upstream?.close();
    if (this.startMs) this.record(reason);
    this.send({ type: 'ended', reason, seconds: Math.round(this.seconds) });
    try {
      this.browser?.close(1000, 'ended');
    } catch {
      /* ignore */
    }
    this.hub.forget(this);
    log('live.end', { session: this.id.slice(0, 8), reason, seconds: Math.round(this.seconds) });
  }
}

export class LiveHub {
  readonly sessions = new Map<string, LiveSession>();
  readonly config: Config;
  readonly ledger: Ledger;
  /** mock reply delay, shortened in tests */
  mockDelayMs = 30;
  private starts: RateLimiter;

  constructor(config: Config, ledger: Ledger) {
    this.config = config;
    this.ledger = ledger;
    this.starts = new RateLimiter(config.liveStartsPerMinute);
  }

  liveSecondsToday(): number {
    let s = this.ledger.liveSecondsOn(localDay());
    for (const x of this.sessions.values()) s += x.seconds - x.recorded;
    return s;
  }

  minutesLeft(): number {
    return Math.max(0, Math.round((this.config.liveMinutesPerDay - this.liveSecondsToday() / 60) * 100) / 100);
  }

  activeUsd(): number {
    let s = 0;
    for (const x of this.sessions.values()) s += ((x.seconds - x.recorded) / 60) * this.config.prices.liveMinute;
    return s;
  }

  forget(s: LiveSession) {
    this.sessions.delete(s.id);
  }

  closeAll() {
    for (const s of [...this.sessions.values()]) s.end('server closing');
  }

  /** A new browser connection on /live. */
  accept(ws: WebSocket, key: string) {
    let session: LiveSession | null = null;
    const err = (code: string, message: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', code, message } satisfies ServerMsg));
    };
    const refuse = (reason: LimitReason) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'limit', reason, minutesLeft: this.minutesLeft() } satisfies ServerMsg));
      ws.close(1000, reason);
    };

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        session?.audio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        return;
      }
      let m: ClientMsg;
      try {
        m = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return err('bad-message', 'not JSON');
      }
      if (m.type === 'start' || m.type === 'resume') {
        if (session) return err('bad-message', 'already started');
        if (m.type === 'resume') {
          const s = this.sessions.get(String(m.sessionId));
          if (!s || s.ended) return err('no-session', 'that session has ended');
          session = s;
          s.attach(ws);
          s.send({ type: 'ready', sessionId: s.id, mock: this.config.mock, minutesLeft: this.minutesLeft(), resumed: true });
          return;
        }
        if (m.adultTask && !m.adult) return err('adult-off', 'This scene is 18+ and the 18+ setting is off.');
        if (!this.starts.take(key)) return refuse('rate');
        if (this.sessions.size >= this.config.maxConcurrentLive) return refuse('busy');
        if (this.liveSecondsToday() >= this.config.liveMinutesPerDay * 60) return refuse('daily');
        if (!this.config.mock) {
          try {
            this.ledger.reserve(this.config.prices.liveMinute, 'live');
          } catch {
            return refuse('budget');
          }
        }
        const s = new LiveSession(this);
        session = s;
        this.sessions.set(s.id, s);
        s.attach(ws);
        try {
          await s.start(m);
          s.send({ type: 'ready', sessionId: s.id, mock: this.config.mock, minutesLeft: this.minutesLeft() });
        } catch (e) {
          log('live.start-failed', { reason: e instanceof Error ? e.message.slice(0, 60) : 'error' });
          err('upstream', 'Could not open the live conversation.');
          s.end('start failed');
        }
        return;
      }
      session?.handle(m);
    });
    ws.on('close', () => session?.detach(ws));
    ws.on('error', () => {
      /* handled by close */
    });
  }
}
