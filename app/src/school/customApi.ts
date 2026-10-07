// Talking to the server for School of the Night's extras: writing a custom
// section (POST /school/custom) and hearing a door phrase (the existing speech
// check, POST /stt). Both go to the server set in Settings → Talk live, with
// its access code, and both need a connection.

import { codeHeaders, serverReachable, type Health } from '../live/client';
import { checkSegmentalDetail } from '../live/segmental';
import { codeFor, liveServer } from '../live/serverConfig';
import type { CustomDraft, CustomRequest, DraftLine } from './custom';

export type CustomAnswer =
  | { ok: true; draft: CustomDraft }
  | { ok: true; line: DraftLine }
  | { ok: false; code: string; message: string };

/** Custom lessons can be asked for: online, and the server has them (or is the mock). */
export function customUsable(h: Health | null | undefined): boolean {
  return !!h && (h.custom?.available ?? false) && (h.mock || h.budget.ok) && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

/** Write a section for a scenario, or reword one line. Takes up to a minute or two on the real model. */
export async function requestCustom(body: CustomRequest, base = liveServer().url, timeoutMs = 150_000): Promise<CustomAnswer> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, code: 'offline', message: 'You are offline. Custom lessons are written on the server.' };
  if (!serverReachable(base)) return { ok: false, code: 'unreachable', message: 'This page cannot reach the server set in Settings → Talk live.' };
  try {
    const r = await fetch(`${base}/school/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...codeHeaders(codeFor(base)) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await r.json().catch(() => ({}))) as { draft?: CustomDraft; line?: DraftLine; error?: string; message?: string };
    if (r.ok && j.draft) return { ok: true, draft: j.draft };
    if (r.ok && j.line) return { ok: true, line: j.line };
    return { ok: false, code: j.error ?? `http-${r.status}`, message: j.message ?? 'The server could not write that lesson.' };
  } catch {
    return { ok: false, code: 'network', message: 'The server did not answer in time. Try again.' };
  }
}

/** What the server's speech-to-text heard (the door phrase), or null. */
export async function hearThai(blob: Blob, likely: string): Promise<string | null> {
  const r = await checkSegmentalDetail(blob, likely, liveServer().url, 12_000);
  return r ? r.transcript : null;
}
