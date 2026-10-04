// Where the live server is, and the access code it wants. Set on the device in
// Settings → Talk live and kept in the local database (kv key `live_server`,
// value `{ url, code }`), so a phone can point at a server without a rebuild.
// The build-time default is VITE_PHI_SERVER (an address only, never a code).
//
// Who reads it: the live conversation, the health check, and the online
// consonant check (live/segmental.ts), which the sound service loads without a
// React context. So the setting is also mirrored into this origin's
// localStorage; the database stays the source of truth whenever a live screen
// or Settings has bound it (bindLiveStore).
//
// The code is the owner's own "login" for their server, typed on the device.
// It is not a Google credential: those stay on the server.

export interface LiveServerSetting {
  /** the server's base address, e.g. https://phi-server-xyz.a.run.app ('' = the build default) */
  url: string;
  code: string;
}

export const LIVE_SERVER_KEY = 'live_server';
/** Ask every live health check to run again (the setting changed, or live failed). */
export const LIVE_RECHECK = 'phi-live-recheck';
const MIRROR = 'phi.live_server';

export const BUILD_SERVER_URL: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PHI_SERVER) || 'http://127.0.0.1:8787';

/** The part of the app's Store this needs. */
export interface LiveKv {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

let kv: LiveKv | null = null;

const LOOPBACK_NAME = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i;

/**
 * Tidy what someone pasted into an address: adds https:// (http:// for this
 * computer), drops a trailing slash or a pasted /health, refuses anything that
 * is not http(s) or carries a user name or password. '' stays '' (the default).
 */
export function normalizeServerUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (LOOPBACK_NAME.test(s) ? 'http://' : 'https://') + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !u.hostname) return null;
  const path = u.pathname.replace(/\/+$/, '').replace(/\/(health|live|stt)$/i, '');
  return `${u.protocol}//${u.host}${path}`;
}

function clean(v: unknown): LiveServerSetting | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<LiveServerSetting>;
  const url = typeof o.url === 'string' ? normalizeServerUrl(o.url) ?? '' : '';
  const code = typeof o.code === 'string' ? o.code.trim() : '';
  return url || code ? { url, code } : null;
}

function readMirror(): unknown {
  try {
    const s = globalThis.localStorage?.getItem(MIRROR);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function writeMirror(v: LiveServerSetting | null) {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    if (v) ls.setItem(MIRROR, JSON.stringify(v));
    else ls.removeItem(MIRROR);
  } catch {
    /* private mode or storage blocked: the database still has it */
  }
}

/** Use the app's database for the setting (idempotent). Called by the live screens and Settings. */
export function bindLiveStore(store: LiveKv | null) {
  if (kv === store) return;
  kv = store;
  if (kv) writeMirror(clean(kv.get<unknown>(LIVE_SERVER_KEY, null)));
}

/** What the owner saved on this device, or null. */
export function savedLiveServer(): LiveServerSetting | null {
  return clean(kv ? kv.get<unknown>(LIVE_SERVER_KEY, null) : readMirror());
}

/** The server to use now: the saved address or the build default, and the saved code. */
export function liveServer(): LiveServerSetting {
  const s = savedLiveServer();
  return { url: s?.url || BUILD_SERVER_URL, code: s?.code ?? '' };
}

/** Save (or, with both empty, clear) the setting, then ask the health checks to run again. */
export function saveLiveServer(v: { url: string; code: string }): LiveServerSetting | null {
  const url = normalizeServerUrl(v.url);
  if (url == null) throw new Error('not a web address');
  const next = clean({ url, code: v.code });
  kv?.set(LIVE_SERVER_KEY, next);
  writeMirror(next);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIVE_RECHECK));
  return next;
}

/** Two addresses name the same server (so the saved code may be sent to it). */
export function sameServer(a: string, b: string): boolean {
  return (normalizeServerUrl(a) ?? a) === (normalizeServerUrl(b) ?? b);
}

/** The code for a base address: the saved code, only when the address is the saved server. */
export function codeFor(base: string): string {
  const s = liveServer();
  return s.code && sameServer(base, s.url) ? s.code : '';
}
