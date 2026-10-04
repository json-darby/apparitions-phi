// Microphone capture: raw PCM for the on-device pitch measurement (AudioWorklet,
// ScriptProcessor fallback) and a compressed blob for the optional online
// consonant/vowel check (MediaRecorder, WAV fallback). Nothing leaves the
// device from here.

import { encodeWav } from './synth';
import { resample } from './pitch';

export type MicProblem = 'denied' | 'unavailable' | 'insecure' | 'error';

export class MicError extends Error {
  constructor(readonly problem: MicProblem, message: string) {
    super(message);
  }
}

export interface Captured {
  pcm: Float32Array;
  sampleRate: number;
  blob: Blob | null;
  ms: number;
}

export interface MicSession {
  readonly sampleRate: number;
  /** recent input level, RMS 0..1 */
  level(): number;
  /** ms since capture began */
  elapsed(): number;
  stop(): Promise<Captured>;
  cancel(): void;
}

/** Longest capture kept in memory (seconds). */
const MAX_SECONDS = 15;

const WORKLET = `
class PhiCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(1024); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('phi-capture', PhiCapture);
`;

const workletReady = new WeakMap<BaseAudioContext, Promise<boolean>>();

function loadWorklet(ctx: AudioContext): Promise<boolean> {
  let p = workletReady.get(ctx);
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletReady.set(ctx, p);
  }
  return p;
}

export async function micPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return (st?.state as 'granted' | 'denied' | 'prompt') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Open the microphone and start capturing. Throws MicError. */
export async function openMic(ctx: AudioContext): Promise<MicSession> {
  if (typeof window !== 'undefined' && !window.isSecureContext) throw new MicError('insecure', 'The microphone needs a secure (https or localhost) page.');
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unavailable', 'This browser has no microphone access.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied', 'Microphone access is blocked.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('unavailable', 'No microphone found.');
    throw new MicError('error', e instanceof Error ? e.message : String(e));
  }
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);

  const sr = ctx.sampleRate;
  const maxChunks = Math.ceil((MAX_SECONDS * sr) / 1024);
  const chunks: Float32Array[] = [];
  // the last few chunk levels (~20 ms each); level() reads, never mutates
  const recent = [0, 0, 0, 0];
  let ri = 0;
  const onChunk = (c: Float32Array) => {
    if (chunks.length < maxChunks) chunks.push(c);
    let s = 0;
    for (let i = 0; i < c.length; i++) s += c[i] * c[i];
    recent[ri++ % recent.length] = Math.sqrt(s / c.length);
  };

  const source = ctx.createMediaStreamSource(stream);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);
  let node: AudioNode;
  if (await loadWorklet(ctx)) {
    const w = new AudioWorkletNode(ctx, 'phi-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    w.port.onmessage = (ev: MessageEvent<Float32Array>) => onChunk(ev.data);
    node = w;
  } else {
    const sp = ctx.createScriptProcessor(1024, 1, 1);
    sp.onaudioprocess = (ev) => onChunk(Float32Array.from(ev.inputBuffer.getChannelData(0)));
    node = sp;
  }
  source.connect(node);
  node.connect(sink);

  const mime = pickMime();
  let rec: MediaRecorder | null = null;
  const parts: Blob[] = [];
  if (typeof MediaRecorder !== 'undefined') {
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.start();
    } catch {
      rec = null;
    }
  }

  const t0 = performance.now();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { source.disconnect(); } catch { /* */ }
    try { node.disconnect(); } catch { /* */ }
    try { sink.disconnect(); } catch { /* */ }
    if (node instanceof AudioWorkletNode) node.port.onmessage = null;
    for (const t of stream.getTracks()) t.stop();
  };

  return {
    sampleRate: sr,
    level: () => Math.max(...recent),
    elapsed: () => performance.now() - t0,
    cancel: () => {
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* */ }
      close();
    },
    stop: async () => {
      const ms = Math.round(performance.now() - t0);
      const blobP = new Promise<Blob | null>((resolve) => {
        if (!rec || rec.state === 'inactive') return resolve(null);
        rec.onstop = () => resolve(parts.length ? new Blob(parts, { type: rec!.mimeType || mime || 'audio/webm' }) : null);
        try { rec.stop(); } catch { resolve(null); }
        setTimeout(() => resolve(parts.length ? new Blob(parts, { type: mime || 'audio/webm' }) : null), 1500);
      });
      // let the last worklet messages land
      await new Promise((r) => setTimeout(r, 60));
      close();
      let n = 0;
      for (const c of chunks) n += c.length;
      const pcm = new Float32Array(n);
      let o = 0;
      for (const c of chunks) { pcm.set(c, o); o += c.length; }
      let blob = await blobP;
      if (!blob && pcm.length) {
        const r16 = resample(pcm, sr, 16000);
        blob = new Blob([encodeWav(r16, 16000)], { type: 'audio/wav' });
      }
      return { pcm, sampleRate: sr, blob, ms };
    },
  };
}
