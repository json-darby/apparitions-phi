// Server settings. Nothing here is a secret. Credentials are read at run time
// from the environment, `server/.env.local`, or the pipeline's
// `pipeline/.env.local` (same keys, so the owner sets them once). On Cloud Run
// only the environment is read (there are no .env files in the container; the
// key arrives from Secret Manager as an env var).
//
//   PHI_API_KEY         the key for Gemini Live. With PHI_LIVE_API=gemini, a
//                       Gemini API key from Google AI Studio. With vertex, a
//                       Vertex API key (express mode; Google documents express
//                       mode for generateContent, not for Live).
//   PHI_LIVE_API        gemini | vertex. Default: gemini when PHI_API_KEY is set
//                       and either PHI_GCP_PROJECT is not set or this runs on
//                       Cloud Run; otherwise vertex (as before).
//   PHI_GCP_PROJECT     project for Application Default Credentials (gcloud
//                       auth application-default login on the PC, the service's
//                       own service account on Cloud Run). Needed for the
//                       speech check (STT) and for Live over Vertex.
//   PHI_ACCESS_CODE     the code the app must send. Required on a public
//                       address (Cloud Run, or PHI_SERVER_HOST not loopback):
//                       unset, or shorter than 12 characters, means live and
//                       stt are refused there. On this computer unset means no code.
//   PHI_ALLOWED_ORIGINS extra browser origins (the hosted app), separated by
//                       commas, semicolons or spaces
//   PHI_BUDGET_USD      hard spending cap, shared with the pipeline's ledger
//   PHI_LIVE_LOCATION   Vertex region for Gemini Live (default us-central1)
//   PHI_STT_LOCATION    region for Chirp 3 STT (default us)
//   PHI_STT_FALLBACK_LOCATION  region for Chirp 2 STT (default asia-southeast1)
//   PHI_LIVE_MINUTES_PER_DAY   default 20
//   PHI_LEDGER_PATH     usage ledger file (default <PHI_SERVER_WORK>/usage.jsonl)
//   PHI_TRUSTED_PROXY_HOPS  proxies in front that append to X-Forwarded-For
//                       (default 1 on Cloud Run, 0 elsewhere)
//   PHI_SERVER_HOST / PHI_SERVER_PORT  listen address (default 127.0.0.1:8787;
//                       on Cloud Run 0.0.0.0 and $PORT)
//   MOCK=1              no credentials, scripted replies, fake STT
//
// Prices are the list prices from the research report of 2 Oct 2026 and match
// pipeline/phi_pipeline/config.py.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_DIR = resolve(SERVER_DIR, '..');
export const PIPELINE_DIR = join(PROJECT_DIR, 'pipeline');

/** The shortest access code accepted on a public address. */
export const MIN_PUBLIC_CODE = 12;

export type LiveApi = 'gemini' | 'vertex';

export interface Config {
  host: string;
  port: number;
  mock: boolean;
  /** running on Cloud Run (Cloud Run sets K_SERVICE) */
  onCloudRun: boolean;
  /** Google credentials (never sent to the browser, never logged) */
  project: string | null;
  apiKey: string | null;
  /** which Google API carries Live: the Gemini API (AI Studio key) or Vertex AI */
  liveApi: LiveApi;
  liveLocation: string;
  liveModel: string;
  /** override the Live websocket URL (for a changed endpoint) */
  liveEndpoint: string | null;
  /** prebuilt Live voices by speaker sex */
  liveVoices: { f: string; m: string };
  /** send speechConfig.languageCode th-TH (some native-audio models ignore it) */
  liveLanguageCode: string | null;
  sttModel: string;
  sttLocation: string;
  sttFallbackModel: string;
  sttFallbackLocation: string;
  /** the access code the app must send (never logged, never in /health) */
  accessCode: string | null;
  /** a public address: a code is required, and without one live and stt are refused */
  requireCode: boolean;
  /** proxies in front of the server that each append one X-Forwarded-For entry */
  trustedProxyHops: number;
  /** limits */
  liveMinutesPerDay: number;
  maxSessionMinutes: number;
  maxConcurrentLive: number;
  liveStartsPerMinute: number;
  sttPerMinute: number;
  sttPerDay: number;
  sttMaxBytes: number;
  /** wrong access codes allowed from one address before it has to wait */
  codeFailures: number;
  /** minutes that address waits */
  codeLockMinutes: number;
  /** seconds a dropped browser has to reattach to its session */
  reattachSeconds: number;
  /** money */
  budgetUsd: number;
  prices: { liveMinute: number; sttSecond: number };
  /** files */
  workDir: string;
  ledgerFile: string;
  pipelineLedgerFile: string;
  allowedOrigins: string[];
}

export const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  // the second dev server on this PC
  'http://localhost:5175',
  'http://127.0.0.1:5175',
];

export function isLoopbackHost(h: string): boolean {
  const x = h.toLowerCase();
  return x === 'localhost' || x === '::1' || x === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(x);
}

/** KEY=VALUE lines into a map (does not touch process.env). A missing or unreadable file is an empty map. */
export function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function num(v: string | undefined, d: number): number {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

/** "https://X.web.app/" is the origin "https://x.web.app" (what the browser sends). */
export function normalizeOrigin(o: string): string {
  const s = o.trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    return new URL(s).origin;
  } catch {
    return s;
  }
}

/**
 * Build the config. Precedence: explicit overrides, then process.env, then
 * server/.env.local, then pipeline/.env.local (no files are read on Cloud Run).
 */
export function loadConfig(overrides: Partial<Config> = {}, env: Record<string, string | undefined> = process.env): Config {
  const onCloudRun = !!env.K_SERVICE;
  const files: Record<string, string> = onCloudRun
    ? {}
    : { ...readEnvFile(join(PIPELINE_DIR, '.env.local')), ...readEnvFile(join(SERVER_DIR, '.env.local')) };
  // trimmed: a key pasted into Secret Manager often carries a trailing newline
  const get = (k: string) => {
    const v = (env[k] ?? files[k])?.trim();
    return v == null || v === '' ? undefined : v;
  };
  const mock = /^(1|true|yes)$/i.test(get('MOCK') ?? '') || process.argv.includes('--mock');
  const workDir = get('PHI_SERVER_WORK') ?? join(SERVER_DIR, 'work');
  // commas, semicolons or spaces between origins (gcloud --set-env-vars splits on commas)
  const extra = (get('PHI_ALLOWED_ORIGINS') ?? '').split(/[,;\s]+/).map(normalizeOrigin).filter(Boolean);
  const host = get('PHI_SERVER_HOST') ?? (onCloudRun ? '0.0.0.0' : '127.0.0.1');
  // Cloud Run says which port to listen on, so PORT wins there
  const port = onCloudRun ? num(get('PORT'), 8080) : num(get('PHI_SERVER_PORT') ?? get('PORT'), 8787);
  const project = get('PHI_GCP_PROJECT') ?? null;
  const apiKey = get('PHI_API_KEY') ?? null;
  const api = (get('PHI_LIVE_API') ?? '').toLowerCase();
  const liveApi: LiveApi = api === 'gemini' || api === 'vertex' ? api : apiKey && (!project || onCloudRun) ? 'gemini' : 'vertex';
  const cfg: Config = {
    host,
    port,
    mock,
    onCloudRun,
    project,
    apiKey,
    liveApi,
    liveLocation: get('PHI_LIVE_LOCATION') ?? 'us-central1',
    liveModel: get('PHI_LIVE_MODEL') ?? 'gemini-3.8-live',
    liveEndpoint: get('PHI_LIVE_ENDPOINT') ?? null,
    liveVoices: { f: get('PHI_LIVE_VOICE_F') ?? 'Kore', m: get('PHI_LIVE_VOICE_M') ?? 'Charon' },
    liveLanguageCode: get('PHI_LIVE_LANGUAGE_CODE') === 'none' ? null : get('PHI_LIVE_LANGUAGE_CODE') ?? 'th-TH',
    sttModel: get('PHI_STT_MODEL') ?? 'chirp_3',
    sttLocation: get('PHI_STT_LOCATION') ?? 'us',
    sttFallbackModel: get('PHI_STT_FALLBACK_MODEL') ?? 'chirp_2',
    sttFallbackLocation: get('PHI_STT_FALLBACK_LOCATION') ?? 'asia-southeast1',
    accessCode: get('PHI_ACCESS_CODE') ?? null,
    requireCode: onCloudRun || !isLoopbackHost(host),
    trustedProxyHops: Math.max(0, Math.floor(num(get('PHI_TRUSTED_PROXY_HOPS'), onCloudRun ? 1 : 0))),
    liveMinutesPerDay: num(get('PHI_LIVE_MINUTES_PER_DAY'), 20),
    maxSessionMinutes: num(get('PHI_LIVE_MAX_SESSION_MINUTES'), 15),
    maxConcurrentLive: num(get('PHI_LIVE_MAX_CONCURRENT'), 2),
    liveStartsPerMinute: num(get('PHI_LIVE_STARTS_PER_MINUTE'), 6),
    sttPerMinute: num(get('PHI_STT_PER_MINUTE'), 30),
    sttPerDay: num(get('PHI_STT_PER_DAY'), 400),
    sttMaxBytes: num(get('PHI_STT_MAX_BYTES'), 2_000_000),
    codeFailures: num(get('PHI_CODE_FAILURES'), 5),
    codeLockMinutes: num(get('PHI_CODE_LOCK_MINUTES'), 15),
    reattachSeconds: num(get('PHI_LIVE_REATTACH_SECONDS'), 45),
    budgetUsd: num(get('PHI_BUDGET_USD'), 30),
    prices: { liveMinute: 0.023, sttSecond: 0.016 / 60 },
    workDir,
    ledgerFile: get('PHI_LEDGER_PATH') ?? join(workDir, 'usage.jsonl'),
    pipelineLedgerFile: join(PIPELINE_DIR, 'work', 'ledger.jsonl'),
    allowedOrigins: [...new Set([...DEFAULT_ORIGINS, ...extra])],
    ...overrides,
  };
  return cfg;
}

/** Can real Live calls be made? (Says nothing about whether they will succeed.) */
export function liveCredentials(c: Config): boolean {
  return c.liveApi === 'gemini' ? !!c.apiKey : !!(c.project || c.apiKey);
}

/** Can the speech check be made? Speech-to-Text v2 names the project in its path. */
export function sttCredentials(c: Config): boolean {
  return !!c.project;
}

/** Any credentials at all. */
export function hasCredentials(c: Config): boolean {
  return liveCredentials(c) || sttCredentials(c);
}

export type AccessMode = 'open' | 'code' | 'locked';

/**
 * open: no code needed (this computer, none set). code: the app must send it.
 * locked: a public address without a usable code, so live and stt are refused
 * for everyone (an open endpoint on the internet would let strangers spend money).
 */
export function accessMode(c: Config): AccessMode {
  const code = c.accessCode ?? '';
  if (c.requireCode) return code.length >= MIN_PUBLIC_CODE ? 'code' : 'locked';
  return code ? 'code' : 'open';
}

/** A copy safe to print: no key, no code, no project id. */
export function describeConfig(c: Config) {
  return {
    host: c.host, port: c.port, mock: c.mock, cloudRun: c.onCloudRun,
    auth: c.mock ? 'none (mock)' : c.project ? 'adc' : c.apiKey ? 'api-key' : 'missing',
    liveVia: c.mock ? 'mock' : !liveCredentials(c) ? 'missing' : c.liveApi === 'gemini' ? 'gemini-api-key' : c.project ? 'vertex-adc' : 'vertex-api-key',
    sttVia: c.mock ? 'mock' : sttCredentials(c) ? 'adc' : 'off',
    access: accessMode(c),
    liveModel: c.liveModel, liveLocation: c.liveApi === 'gemini' ? 'gemini-api' : c.liveLocation,
    stt: `${c.sttModel}@${c.sttLocation} -> ${c.sttFallbackModel}@${c.sttFallbackLocation}`,
    liveMinutesPerDay: c.liveMinutesPerDay, budgetUsd: c.budgetUsd,
    origins: c.allowedOrigins,
  };
}
