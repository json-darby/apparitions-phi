// The online consonant and vowel check: Speech-to-Text v2, Chirp 3 first, then
// Chirp 2, Thai. It always signs in with Application Default Credentials and
// PHI_GCP_PROJECT (on Cloud Run: the service account, which needs the
// roles/speech.client role); without a project /stt answers 503 and the app
// scores tones only. Returns the transcript, the model's confidence, and a 0..1
// similarity to the target Thai with tone marks removed (see thai.ts). The
// transcript is returned to the caller and never logged or stored.

import type { Config } from './config.ts';
import { authHeaders, getAuth } from './auth.ts';
import { similarity } from './thai.ts';

export interface SttRequest {
  /** target Thai the learner meant to say */
  thai: string;
  /** base64 audio: WAV 16 kHz mono preferred; WEBM/OGG Opus also sent as-is */
  audio: string;
  mime?: string;
  /** mock mode only: what the fake recogniser "hears" */
  mockTranscript?: string;
}

export interface SttResult {
  transcript: string;
  confidence: number | null;
  similarity: number;
  model: string;
  mock: boolean;
  /** billed or estimated seconds */
  seconds: number;
}

/** Seconds of audio: exact for 16-bit WAV, estimated for compressed audio. */
export function audioSeconds(bytes: Buffer, mime?: string): number {
  if ((mime?.includes('wav') || bytes.subarray(0, 4).toString('latin1') === 'RIFF') && bytes.length > 44) {
    const rate = bytes.readUInt32LE(24) || 16000;
    const channels = bytes.readUInt16LE(22) || 1;
    const bits = bytes.readUInt16LE(34) || 16;
    return (bytes.length - 44) / (rate * channels * (bits / 8));
  }
  return bytes.length / 4000; // Opus at about 32 kbit/s
}

export function sttMock(req: SttRequest, bytes: Buffer): SttResult {
  const seconds = audioSeconds(bytes, req.mime);
  const silent = bytes.length < 800;
  const transcript = silent ? '' : req.mockTranscript ?? req.thai;
  return {
    transcript,
    confidence: silent ? 0 : 0.9,
    similarity: Math.round(similarity(transcript, req.thai) * 1000) / 1000,
    model: 'mock',
    mock: true,
    seconds,
  };
}

class SttHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function recognize(c: Config, model: string, location: string, audioB64: string, signal: AbortSignal) {
  if (!c.project) throw new SttHttpError(400, 'Speech-to-Text v2 needs PHI_GCP_PROJECT (the recognizer path names the project)');
  const auth = await getAuth(c, 'stt');
  const host = location === 'global' ? 'speech.googleapis.com' : `${location}-speech.googleapis.com`;
  const url = `https://${host}/v2/projects/${encodeURIComponent(c.project)}/locations/${location}/recognizers/_:recognize`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders(auth, c) },
    body: JSON.stringify({
      config: { autoDecodingConfig: {}, languageCodes: ['th-TH'], model, features: { enableWordConfidence: true } },
      content: audioB64,
    }),
  });
  if (!res.ok) throw new SttHttpError(res.status, `stt ${model}@${location} http ${res.status}`);
  const j = (await res.json()) as {
    results?: { alternatives?: { transcript?: string; confidence?: number }[] }[];
    metadata?: { totalBilledDuration?: string };
  };
  const alts = (j.results ?? []).map((r) => r.alternatives?.[0]).filter(Boolean) as { transcript?: string; confidence?: number }[];
  const transcript = alts.map((a) => a.transcript ?? '').join(' ').trim();
  const confs = alts.map((a) => a.confidence).filter((x): x is number => typeof x === 'number');
  const billed = j.metadata?.totalBilledDuration ? parseFloat(j.metadata.totalBilledDuration) : NaN;
  return { transcript, confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null, billed };
}

/** Real recognition: chirp_3, then chirp_2 if chirp_3 is not available for Thai in that region. */
export async function sttReal(c: Config, req: SttRequest, bytes: Buffer, timeoutMs = 15000): Promise<SttResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  const est = audioSeconds(bytes, req.mime);
  const tries: [string, string][] = [[c.sttModel, c.sttLocation], [c.sttFallbackModel, c.sttFallbackLocation]];
  let last: unknown = null;
  for (const [model, loc] of tries) {
    try {
      const r = await recognize(c, model, loc, req.audio, signal);
      return {
        transcript: r.transcript,
        confidence: r.confidence,
        similarity: Math.round(similarity(r.transcript, req.thai) * 1000) / 1000,
        model,
        mock: false,
        seconds: Number.isFinite(r.billed) ? r.billed : est,
      };
    } catch (e) {
      last = e;
      // credentials or quota problems will not be fixed by the other model
      if (e instanceof SttHttpError && (e.status === 401 || e.status === 403 || e.status === 429)) break;
    }
  }
  throw last instanceof Error ? last : new Error('stt failed');
}
