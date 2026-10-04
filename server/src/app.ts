// The HTTP side: GET /health, POST /stt, and the /live websocket upgrade.
// CORS and websocket origins are limited to the app's own origins. When an
// access code is set (always on a public address) /stt and /live need it and
// /health without it says only that a code is needed. Request bodies, audio,
// transcripts and codes are never logged.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { AccessGuard, clientIp, suppliedCode, WS_PROTOCOL, type AccessResult } from './access.ts';
import { describeConfig, liveCredentials, loadConfig, sttCredentials, type Config } from './config.ts';
import { BudgetExceeded, Ledger } from './ledger.ts';
import { RateLimiter } from './limits.ts';
import { log, setQuiet } from './log.ts';
import { LiveHub } from './live/session.ts';
import { audioSeconds, sttMock, sttReal, type SttRequest } from './stt.ts';

export const VERSION = '0.1.0';

export interface PhiServer {
  config: Config;
  ledger: Ledger;
  hub: LiveHub;
  access: AccessGuard;
  server: Server;
  listen(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
}

function originOk(c: Config, origin: string | undefined): boolean {
  // no Origin header: not a browser page (curl, tests, the app's own Node tools)
  if (origin == null) return true;
  return c.allowedOrigins.includes(origin);
}

function cors(c: Config, req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && c.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Phi-Code');
    res.setHeader('Access-Control-Max-Age', '600');
    // Chrome's private network access preflight
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > max) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** What an access refusal says, for HTTP and the websocket alike. */
const REFUSAL: Record<Exclude<AccessResult, 'open' | 'ok'>, { status: number; code: string; message: string }> = {
  missing: { status: 401, code: 'access', message: 'This server needs the access code.' },
  wrong: { status: 401, code: 'access', message: 'The access code is wrong.' },
  throttled: { status: 429, code: 'too-many-tries', message: 'Too many wrong codes. Try again later.' },
  locked: { status: 503, code: 'locked', message: 'This server has no access code set, so it refuses live and speech checks.' },
};

export function createPhiServer(overrides: Partial<Config> = {}, opts: { quiet?: boolean; tempDir?: boolean } = {}): PhiServer {
  if (opts.quiet) setQuiet(true);
  if (opts.tempDir) {
    // tests: a throwaway ledger, and no pipeline spend
    const dir = mkdtempSync(join(tmpdir(), 'phi-server-'));
    overrides = { workDir: dir, ledgerFile: join(dir, 'usage.jsonl'), pipelineLedgerFile: join(dir, 'pipeline-ledger.jsonl'), ...overrides };
  }
  const config = loadConfig(overrides);
  const ledger = new Ledger(config.ledgerFile, config.pipelineLedgerFile, config.budgetUsd);
  const hub = new LiveHub(config, ledger);
  const access = new AccessGuard(config);
  const sttLimiter = new RateLimiter(config.sttPerMinute);
  const liveReady = config.mock || liveCredentials(config);
  const sttReady = config.mock || sttCredentials(config);
  const ipOf = (req: IncomingMessage) => clientIp(req, config.trustedProxyHops);
  const clientKey = (req: IncomingMessage) => `${req.headers.origin ?? 'none'}|${ipOf(req)}`;
  const retryAfter = () => String(Math.round(config.codeLockMinutes * 60));

  const health = () => {
    const spent = config.mock ? 0 : ledger.spent();
    return {
      ok: true,
      service: 'phi-server',
      version: VERSION,
      needsCode: access.mode !== 'open',
      mock: config.mock,
      live: {
        available: liveReady,
        model: config.mock ? 'mock' : config.liveModel,
        minutesPerDay: config.liveMinutesPerDay,
        minutesLeft: hub.minutesLeft(),
        active: hub.sessions.size,
      },
      stt: {
        available: sttReady,
        model: config.mock ? 'mock' : config.sttModel,
        callsLeftToday: Math.max(0, config.sttPerDay - ledger.sttCallsOn()),
      },
      budget: { ok: spent < config.budgetUsd, spentUsd: Math.round(spent * 100) / 100, capUsd: config.budgetUsd },
    };
  };

  function healthRoute(req: IncomingMessage, res: ServerResponse) {
    const r = access.check(ipOf(req), suppliedCode(req));
    if (r === 'open' || r === 'ok') return json(res, 200, health());
    // without a valid code: only that the server is there and wants one (no minutes, no spend)
    const base = { service: 'phi-server', needsCode: true };
    if (r === 'missing') return json(res, 200, { ok: true, ...base });
    if (r === 'locked') return json(res, 200, { ok: true, ...base, locked: true });
    if (r === 'wrong') return json(res, 401, { ok: false, ...base, error: 'wrong-code' });
    return json(res, 429, { ok: false, ...base, error: 'too-many-tries' }, { 'Retry-After': retryAfter() });
  }

  async function stt(req: IncomingMessage, res: ServerResponse) {
    const a = access.check(ipOf(req), suppliedCode(req));
    if (a !== 'open' && a !== 'ok') {
      const x = REFUSAL[a];
      return json(res, x.status, { error: x.code, message: x.message }, a === 'throttled' ? { 'Retry-After': retryAfter() } : {});
    }
    if (!(req.headers['content-type'] ?? '').includes('application/json')) return json(res, 415, { error: 'send JSON' });
    if (!sttLimiter.take(clientKey(req))) return json(res, 429, { error: 'rate', message: 'Too many checks a minute.' });
    if (ledger.sttCallsOn() >= config.sttPerDay) return json(res, 429, { error: 'daily', message: 'Daily speech-check cap reached.' });
    const raw = await readBody(req, Math.ceil(config.sttMaxBytes * 1.4) + 4096);
    if (!raw) return json(res, 413, { error: 'too-large' });
    let body: SttRequest;
    try {
      body = JSON.parse(raw.toString('utf8')) as SttRequest;
    } catch {
      return json(res, 400, { error: 'bad-json' });
    }
    if (typeof body.thai !== 'string' || !body.thai.trim() || typeof body.audio !== 'string') return json(res, 400, { error: 'need thai and audio' });
    const bytes = Buffer.from(body.audio, 'base64');
    if (bytes.length > config.sttMaxBytes) return json(res, 413, { error: 'too-large' });
    if (config.mock) {
      const r = sttMock(body, bytes);
      ledger.record({ kind: 'stt', model: 'mock', units: { seconds: Math.round(r.seconds * 10) / 10, bytes: bytes.length }, usd: 0, mock: true });
      return json(res, 200, r);
    }
    if (!sttReady) return json(res, 503, { error: 'unavailable', message: 'Speech check needs PHI_GCP_PROJECT.' });
    const est = Math.max(1, audioSeconds(bytes, body.mime));
    try {
      ledger.reserve(est * config.prices.sttSecond, 'stt');
    } catch (e) {
      if (e instanceof BudgetExceeded) return json(res, 402, { error: 'budget', message: 'Spending cap reached.' });
      throw e;
    }
    try {
      const r = await sttReal(config, { ...body, mockTranscript: undefined }, bytes);
      const secs = Math.max(1, Math.ceil(r.seconds));
      ledger.record({ kind: 'stt', model: r.model, units: { seconds: secs, bytes: bytes.length }, usd: secs * config.prices.sttSecond, mock: false });
      return json(res, 200, r);
    } catch (e) {
      log('stt.failed', { reason: e instanceof Error ? e.message.slice(0, 60) : 'error' });
      return json(res, 502, { error: 'upstream', message: 'Speech check unavailable.' });
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!originOk(config, req.headers.origin)) return json(res, 403, { error: 'origin' });
    cors(config, req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') return healthRoute(req, res);
    if (req.method === 'POST' && url.pathname === '/stt') {
      stt(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'server' });
      });
      return;
    }
    json(res, 404, { error: 'not found' });
  });

  // The browser offers ['phi', 'phi-code.<code>']; the answer names only 'phi',
  // so the code is never echoed back.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1 << 20,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  const refuseWs = (ws: WebSocket, a: Exclude<AccessResult, 'open' | 'ok'>) => {
    const x = REFUSAL[a];
    ws.send(JSON.stringify({ type: 'error', code: x.code, message: x.message }));
    ws.close(4000 + x.status, x.code);
  };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/live' || !originOk(config, req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const a = access.check(ipOf(req), suppliedCode(req));
    wss.handleUpgrade(req, socket, head, (ws) => {
      // accepted then told why, so the app can say "wrong code" rather than "unreachable"
      if (a !== 'open' && a !== 'ok') return refuseWs(ws, a);
      hub.accept(ws, clientKey(req));
    });
  });

  return {
    config,
    ledger,
    hub,
    access,
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          const port = (server.address() as AddressInfo).port;
          log('listening', { url: `http://${config.host}:${port}`, mock: config.mock });
          resolve({ port, url: `http://${config.host}:${port}` });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        hub.closeAll();
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

export { describeConfig };
