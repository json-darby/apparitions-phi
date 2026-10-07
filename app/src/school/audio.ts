// The lesson's own audio bits: your voice as captured by the live client
// (16 kHz PCM16, the same frames sent to the tutor) turned into a recording the
// app's scorer can measure, played back on a tap; and the English instructions
// read aloud by the phone's voice.

import { trackPitch } from '../audio/pitch';
import { analyseTones, DEFAULT_MID_HZ, rangeFromMid, type ToneAnalysis } from '../audio/score';
import type { Recording } from '../audio/sound';
import type { Tone } from '../content/types';
import { encodeWav } from '../live/segmental';

export const MIC_RATE = 16000;

export function framesToFloat(frames: Int16Array[]): Float32Array {
  const n = frames.reduce((s, f) => s + f.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) out[o + i] = f[i] / 0x8000;
    o += f.length;
  }
  return out;
}

/** A recording the shared scorer understands (sound.score), with its pitch track. */
export function toRecording(frames: Int16Array[]): Recording | null {
  const pcm = framesToFloat(frames);
  if (pcm.length < MIC_RATE * 0.2) return null;
  return {
    kind: 'audio',
    ms: Math.round((pcm.length / MIC_RATE) * 1000),
    blob: new Blob([encodeWav(pcm, MIC_RATE)], { type: 'audio/wav' }),
    track: trackPitch(pcm, MIC_RATE),
  };
}

/** The on-device tone score straight away (no network), for the review grade. */
export function quickTones(rec: Recording | null, tones: Tone[], o: { midHz: number | null; identity: 'm' | 'f' }): ToneAnalysis | null {
  if (!rec?.track || !tones.length) return null;
  return analyseTones(rec.track, tones, { range: rangeFromMid(o.midHz ?? DEFAULT_MID_HZ[o.identity]), identity: o.identity });
}

let playCtx: AudioContext | null = null;

/** Play your own take again, on this device. */
export function playFrames(frames: Int16Array[]) {
  const pcm = framesToFloat(frames);
  if (!pcm.length || typeof AudioContext === 'undefined') return;
  playCtx ??= new AudioContext();
  void playCtx.resume();
  const buf = playCtx.createBuffer(1, pcm.length, MIC_RATE);
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);
  src.start();
}

// ---------- read aloud ----------

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Say an English instruction with the phone's voice. Resolves when it has finished (or after a safe time). */
export function speakEnglish(text: string): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, '"'));
    u.lang = 'en-GB';
    u.rate = 1;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    };
    // some phones never fire onend: give up after the time the sentence could take
    const guard = setTimeout(end, 1500 + text.length * 90);
    u.onend = end;
    u.onerror = end;
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
