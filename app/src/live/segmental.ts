// The online consonant and vowel check (Phase 4 Step 6). The recording goes to
// the app's server (the one set in Settings → Talk live, with its access code),
// which asks Chirp speech-to-text what it heard and compares that with the
// target Thai, tone marks removed. Tones are never judged here: the on-device
// pitch measurement does that.
//
// The sound builder imports this lazily:
//   const { checkSegmental } = await import('../live/segmental');
//   const phonemes = await checkSegmental(blob, thai); // 0..1, or null

import { codeHeaders, noteSttAvailable, serverReachable, sttMayWork } from './client';
import { codeFor, liveServer } from './serverConfig';

export interface SegmentalResult {
  transcript: string;
  confidence: number | null;
  /** 0..1, consonants and vowels only */
  similarity: number;
  model: string;
  mock: boolean;
}

/** 0..1 consonant-and-vowel similarity, or null when offline, the server is off or has no
 * speech check, or anything fails. Tones are then scored on the device alone. */
export async function checkSegmental(blob: Blob, thai: string): Promise<number | null> {
  const r = await checkSegmentalDetail(blob, thai);
  return r ? r.similarity : null;
}

export async function checkSegmentalDetail(blob: Blob, thai: string, base = liveServer().url, timeoutMs = 10000, code = codeFor(base)): Promise<SegmentalResult | null> {
  if (!thai.trim() || !blob.size) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  // a server this page cannot call, or one that recently said no: do not send the recording
  if (!serverReachable(base) || !sttMayWork(base)) return null;
  try {
    const { bytes, mime } = await toWav16k(blob);
    const r = await fetch(`${base}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...codeHeaders(code) },
      body: JSON.stringify({ thai, audio: toBase64(bytes), mime }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // no speech check there (503), or the code is not accepted (401, 403): stop asking for a while
    if (r.status === 503 || r.status === 401 || r.status === 403) noteSttAvailable(base, false);
    if (!r.ok) return null;
    const j = (await r.json()) as SegmentalResult;
    return typeof j.similarity === 'number' ? j : null;
  } catch {
    return null;
  }
}

/** Decode and resample to 16 kHz mono WAV where the browser can; otherwise send the original. */
export async function toWav16k(blob: Blob): Promise<{ bytes: Uint8Array; mime: string }> {
  const raw = new Uint8Array(await blob.arrayBuffer());
  const OAC = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!OAC) return { bytes: raw, mime: blob.type || 'application/octet-stream' };
  try {
    const ctx = new OAC(1, 1, 16000);
    const buf = await ctx.decodeAudioData(raw.slice().buffer);
    const ch = buf.getChannelData(0);
    let mono = ch;
    if (buf.numberOfChannels > 1) {
      const b = buf.getChannelData(1);
      mono = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) mono[i] = (ch[i] + b[i]) / 2;
    }
    return { bytes: encodeWav(mono, buf.sampleRate), mime: 'audio/wav' };
  } catch {
    return { bytes: raw, mime: blob.type || 'application/octet-stream' };
  }
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
