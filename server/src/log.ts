// The only logger. It prints event names and small numbers. It never prints
// audio, transcripts, request bodies, headers, tokens, keys or project ids:
// callers pass a fixed event name and a few scalar fields, and anything that
// looks like a secret is dropped here as a second line of defence.

const SECRETISH = /(key|token|secret|auth|password|bearer|credential|project|audio|data|transcript|text|body)/i;

/** Cut anything shaped like a credential out of a value (an error message can quote a URL). */
export function scrub(s: string): string {
  return s
    .replace(/([?&#](key|access_token|token|code)=)[^&#\s]*/gi, '$1redacted')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'redacted')
    .replace(/ya29\.[0-9A-Za-z_.-]+/g, 'redacted');
}

export type LogFields =Record<string, string | number | boolean | null | undefined>;

let quiet = false;
export function setQuiet(q: boolean) {
  quiet = q;
}

export function log(event: string, fields: LogFields = {}) {
  if (quiet) return;
  const safe: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || SECRETISH.test(k)) continue;
    const s = typeof v === 'string' ? scrub(v).slice(0, 80).replace(/[^\w.:/@ -]/g, '') : String(v);
    safe.push(`${k}=${s}`);
  }
  console.log(`[phi-server] ${new Date().toISOString().slice(11, 19)} ${event}${safe.length ? ' ' + safe.join(' ') : ''}`);
}
