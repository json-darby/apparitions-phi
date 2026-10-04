// The one shared play, record and score interface. Every screen and game goes
// through this. Until Phase 4 the captions implementation shows the Thai as a
// caption and accepts a tap for "I said it". Phase 4 swaps in real playback,
// recording and pitch scoring behind the same interface; no screen changes.

import type { Speed, Tone, VoiceId } from '../content/types';
import type { PitchTrack } from './pitch';

export interface PlayRequest {
  ref?: string;
  thai: string;
  roman?: string;
  en?: string;
  tones?: Tone[];
  voice?: VoiceId;
  /** a character's own voice (course line audio key, e.g. "ploy"): used first when that clip exists, else `voice` */
  castVoice?: string;
  speed?: Speed;
  /** street noise underneath (drill tier 4) */
  noise?: boolean;
  /** who is speaking, for the caption label */
  speaker?: string;
  /** captions only: hide the romanisation (later tiers) */
  hideRoman?: boolean;
  /** captions only: show this instead of the Thai (e.g. a letter's name, where the Thai would give the answer away) */
  caption?: string;
  /** audio mode: also show the text as a small subtitle while the clip plays */
  subtitle?: boolean;
}

export interface RecordTarget {
  ref?: string;
  thai: string;
  roman?: string;
  en?: string;
  tones?: Tone[];
  maxMs?: number;
  /** show only the English prompt on the record sheet (the Thai is the answer) */
  hideText?: boolean;
}

export interface Recording {
  kind: 'tap' | 'audio';
  ms: number;
  blob?: Blob;
  /** measured pitch track, normalised 0..1, when real audio exists */
  pitch?: number[];
  /** raw F0 track the score is computed from (audio mode) */
  track?: PitchTrack;
}

export interface SpeechScore {
  /** 0..1 */
  overall: number;
  /** per syllable 0..1 tone match */
  tones: number[];
  /** learner pitch line for drawing over the target */
  pitch: number[];
  /** consonant and vowel check from online transcription, when available */
  phonemes?: number;
  /** true when no online check was available: overall is the tone score alone */
  toneOnly?: boolean;
  /** the tone the classifier heard per syllable (null = not voiced) */
  heard?: (Tone | null)[];
  /** learner contour per syllable, 16 points 0..1 (null = not voiced) */
  syllables?: (number[] | null)[];
  /** reference contour per syllable, 16 points 0..1 */
  reference?: number[][];
}

/** What the record sheet shows after a take (audio mode). */
export interface RecordReview {
  /** tone score 0..1, null when no voice was heard */
  tone: number | null;
  tones: Tone[];
  syllables: (number[] | null)[];
  reference: number[][];
  heard: (Tone | null)[];
  scores: number[];
  /** auto-continue after this many ms (null = wait for a tap) */
  autoMs: number | null;
}

export type RecordPhase = 'asking' | 'denied' | 'listening' | 'analysing' | 'review';

export interface SoundState {
  /** `source` (audio mode): what is playing; absent or 'caption' = a caption stands in for audio */
  caption: (PlayRequest & { id: number; until: number; source?: 'caption' | 'audio' }) | null;
  /** `phase` and the rest are set in audio mode only */
  recording: (RecordTarget & { id: number; started: number; phase?: RecordPhase; problem?: string; review?: RecordReview }) | null;
}

export interface SoundService {
  readonly mode: 'captions' | 'audio';
  play(req: PlayRequest): Promise<void>;
  stop(): void;
  /** Resolves with the recording, or null if the learner skipped. */
  record(target: RecordTarget): Promise<Recording | null>;
  /** Null when nothing could be measured (always null in captions mode). */
  score(rec: Recording, target: RecordTarget): Promise<SpeechScore | null>;
  /** Ends a recording in progress (the "I said it" tap). */
  finishRecording(skipped?: boolean): void;
  getState(): SoundState;
  subscribe(fn: () => void): () => void;
  /** audio mode: record the same target again from the review */
  retry?(): void;
  /** audio mode: live microphone level 0..1 while listening */
  inputLevel?(): number;
}

/** How long a caption stays up, standing in for the length of the audio. */
export function captionMs(req: PlayRequest): number {
  const syl = req.tones?.length ?? Math.max(1, Math.round(req.thai.length / 3));
  return (900 + syl * 320) * (req.speed === 'slow' ? 1.6 : 1);
}

export class CaptionSound implements SoundService {
  readonly mode = 'captions' as const;
  private state: SoundState = { caption: null, recording: null };
  private listeners = new Set<() => void>();
  private seq = 0;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private playDone: (() => void) | null = null;
  private recDone: ((r: Recording | null) => void) | null = null;

  getState() {
    return this.state;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private set(s: Partial<SoundState>) {
    this.state = { ...this.state, ...s };
    for (const fn of this.listeners) fn();
  }

  play(req: PlayRequest): Promise<void> {
    this.stop();
    const ms = captionMs(req);
    const id = ++this.seq;
    this.set({ caption: { ...req, id, until: Date.now() + ms } });
    return new Promise((resolve) => {
      this.playDone = resolve;
      this.playTimer = setTimeout(() => {
        if (this.state.caption?.id === id) this.set({ caption: null });
        this.playTimer = null;
        this.playDone = null;
        resolve();
      }, ms);
    });
  }

  stop() {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    this.playDone?.();
    this.playDone = null;
    if (this.state.caption) this.set({ caption: null });
  }

  record(target: RecordTarget): Promise<Recording | null> {
    this.recDone?.(null);
    const id = ++this.seq;
    this.set({ recording: { ...target, id, started: Date.now() } });
    return new Promise((resolve) => {
      this.recDone = resolve;
    });
  }

  finishRecording(skipped = false) {
    const r = this.state.recording;
    const done = this.recDone;
    this.recDone = null;
    this.set({ recording: null });
    if (!done) return;
    done(skipped || !r ? null : { kind: 'tap', ms: Date.now() - r.started });
  }

  async score(): Promise<SpeechScore | null> {
    return null;
  }
}

// ---- tone shapes (code, not audio) ----

/**
 * Textbook pitch shapes for the five tones, normalised 0 (low) to 1 (high),
 * sampled at 16 points. Used for drawings, the voice-tear animation and Tone
 * Climb platforms. Phase 4 replaces these with measured curves per clip.
 */
export function toneShape(tone: Tone, n = 16): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v: number;
    switch (tone) {
      case 'mid': v = 0.52 - 0.06 * t; break;
      case 'low': v = 0.38 - 0.18 * t; break;
      case 'falling': v = 0.68 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.5 * t * t; break;
      case 'high': v = 0.58 + 0.3 * t - 0.08 * t * t; break;
      case 'rising': v = 0.36 - 0.12 * Math.sin(Math.PI * Math.min(1, t * 1.4)) + 0.52 * t * t; break;
    }
    out.push(Math.max(0, Math.min(1, v)));
  }
  return out;
}

export function pitchCurve(tones: Tone[], perSyllable = 16): number[] {
  return tones.flatMap((t) => toneShape(t, perSyllable));
}

export const TONE_LABEL: Record<Tone, string> = {
  mid: 'Mid', low: 'Low', falling: 'Falling', high: 'High', rising: 'Rising',
};
