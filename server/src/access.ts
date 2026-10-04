// The access code: the simple "login" that keeps strangers from spending the
// owner's money once the server is on the internet. The app sends the code
// with every request:
//
//   HTTP       header `x-phi-code: <code>`
//   WS /live   browsers cannot set headers on a websocket, so the code goes in
//              the Sec-WebSocket-Protocol list as `phi-code.<base64url(code)>`
//              next to the plain protocol `phi`, which the server selects. A
//              query parameter would end up in Cloud Run's request logs; this
//              header does not. (`x-phi-code` also works for non-browser clients.)
//
// Codes are compared in constant time. An address that sends too many wrong
// codes waits (default 5 wrong in 15 minutes, then 15 minutes). The code is
// never logged and never appears in /health.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { accessMode, type Config } from './config.ts';

export const CODE_HEADER = 'x-phi-code';
export const WS_PROTOCOL = 'phi';
export const WS_CODE_PREFIX = 'phi-code.';

export type AccessResult = 'open' | 'ok' | 'missing' | 'wrong' | 'throttled' | 'locked';

/** The caller's address. Behind Cloud Run the socket is Google's front end, so the
 * address comes from X-Forwarded-For, counted from the right (the left part can be
 * written by anyone). */
export function clientIp(req: IncomingMessage, trustedHops: number): string {
  const raw = req.headers['x-forwarded-for'];
  if (trustedHops > 0 && raw) {
    const parts = (Array.isArray(raw) ? raw.join(',') : raw).split(',').map((s) => s.trim()).filter(Boolean);
    const ip = parts[parts.length - trustedHops] ?? parts[0];
    if (ip) return ip;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** The websocket subprotocol entry that carries a code (base64url, no padding: a valid token). */
export function codeProtocol(code: string): string {
  return WS_CODE_PREFIX + Buffer.from(code, 'utf8').toString('base64url');
}

/** The code a request carries: the header, or (websocket) the subprotocol entry. */
export function suppliedCode(req: IncomingMessage): string | null {
  const h = req.headers[CODE_HEADER];
  const fromHeader = Array.isArray(h) ? h[0] : h;
  if (fromHeader) return fromHeader;
  const p = req.headers['sec-websocket-protocol'];
  if (!p) return null;
  for (const entry of (Array.isArray(p) ? p.join(',') : p).split(',')) {
    const t = entry.trim();
    if (t.startsWith(WS_CODE_PREFIX)) {
      try {
        return Buffer.from(t.slice(WS_CODE_PREFIX.length), 'base64url').toString('utf8') || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Constant-time comparison (both sides hashed first, so lengths do not leak either). */
export function sameCode(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export class AccessGuard {
  private fails = new Map<string, { n: number; first: number; until: number }>();
  private c: Config;
  private now: () => number;

  constructor(c: Config, now: () => number = Date.now) {
    this.c = c;
    this.now = now;
  }

  get mode() {
    return accessMode(this.c);
  }

  /** Is this address waiting after too many wrong codes? */
  throttled(ip: string): boolean {
    const f = this.fails.get(ip);
    return !!f && f.until > this.now();
  }

  /**
   * Check a request's code. 'missing' (no code sent) is not counted as a wrong
   * try. A right code clears the address's wrong tries.
   */
  check(ip: string, code: string | null | undefined): AccessResult {
    const mode = this.mode;
    if (mode === 'open') return 'open';
    if (mode === 'locked') return 'locked';
    if (code == null || code === '') return 'missing';
    if (this.throttled(ip)) return 'throttled';
    if (sameCode(code, this.c.accessCode ?? '')) {
      this.fails.delete(ip);
      return 'ok';
    }
    this.fail(ip);
    return 'wrong';
  }

  private fail(ip: string) {
    const t = this.now();
    const window = this.c.codeLockMinutes * 60_000;
    let f = this.fails.get(ip);
    if (!f || t - f.first > window) f = { n: 0, first: t, until: 0 };
    f.n++;
    if (f.n >= this.c.codeFailures) f.until = t + window;
    this.fails.set(ip, f);
    if (this.fails.size > 5000) this.prune(t, window);
  }

  private prune(t: number, window: number) {
    for (const [k, f] of this.fails) if (f.until <= t && t - f.first > window) this.fails.delete(k);
  }
}
