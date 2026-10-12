// Shared parts for The Tapes: the loaded pack and your marks, phrases drawn
// syllable by syllable in their tone colours, the tone line, play and say.

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { cachedPack, clipUrl, loadPack, loadState, saveState, type TapesState } from './db';
import { TONE_COLOURS, TONE_NAMES, romanOf, sylls, thaiOf, type Pack, type Syl, type ToneDigit, type Variant } from './pack';
import { PlayIcon, MicIcon } from '../audio/SoundLayer';
import { trackPitch } from '../audio/pitch';
import { speakerContours } from '../audio/score';
import type { Tone } from '../content/types';

// ---- data ----

const listeners = new Set<() => void>();
export const tapesChanged = () => listeners.forEach((f) => f());

/** The pack (null = none loaded, undefined = still opening) and your marks. */
export function useTapes() {
  const [pack, setPack] = useState<Pack | null | undefined>(cachedPack());
  const [state, setState] = useState<TapesState | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      void loadPack().then((p) => alive && setPack(p));
      void loadState().then((s) => alive && setState({ ...s }));
    };
    pull();
    listeners.add(pull);
    return () => {
      alive = false;
      listeners.delete(pull);
    };
  }, []);
  const update = useCallback((patch: Partial<TapesState> | ((s: TapesState) => Partial<TapesState>)) => {
    void loadState().then((s) => {
      const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) };
      void saveState(next);
      tapesChanged();
    });
  }, []);
  return { pack, state, update };
}

// ---- sound ----

let current: HTMLAudioElement | null = null;

export function stopTapes() {
  current?.pause();
  current = null;
  try {
    speechSynthesis.cancel();
  } catch {
    /* none */
  }
}

/** The course speaker's clip for unit item "n.i". */
export async function playClip(key: string): Promise<boolean> {
  stopTapes();
  const url = await clipUrl(key);
  if (!url) return false;
  const a = new Audio(url);
  current = a;
  try {
    await a.play();
    await new Promise<void>((r) => {
      a.onended = () => r();
      a.onpause = () => r();
    });
    return true;
  } catch {
    return false;
  }
}

let thVoice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  try {
    thVoice = speechSynthesis.getVoices().find((v) => /^th/i.test(v.lang)) ?? null;
  } catch {
    thVoice = null;
  }
}
if (typeof speechSynthesis !== 'undefined') {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
export const hasThaiVoice = () => thVoice != null;

/** The device's own Thai voice, for lines with no speaker clip (reading lessons, letters). */
export function speak(thai: string, rate = 0.8): boolean {
  stopTapes();
  if (typeof speechSynthesis === 'undefined') return false;
  const u = new SpeechSynthesisUtterance(thai);
  u.lang = 'th-TH';
  if (thVoice) u.voice = thVoice;
  u.rate = rate;
  speechSynthesis.speak(u);
  return true;
}

// ---- drawing ----

const CONTOURS = ['M2 7 L24 7', 'M2 9.5 L24 11', 'M2 6 Q9 1.5 13 4 T24 12', 'M2 8 Q14 8 24 2', 'M2 7 Q9 13 14 10 T24 2'];

/** The tone's shape as a small line. */
export function ToneLine({ t, size = 26 }: { t: ToneDigit; size?: number }) {
  return (
    <svg className="tp-line" width={size} height={size * 0.54} viewBox="0 0 26 14" aria-hidden="true">
      <path d={CONTOURS[t]} stroke={TONE_COLOURS[t]} />
    </svg>
  );
}

/** A phrase, syllable by syllable: the Thai, its romanisation in its tone colour, and the tone line. */
export function Phrase({ v, size = 'm', hideRoman, lines = true }: { v: Variant; size?: 'l' | 'm'; hideRoman?: boolean; lines?: boolean }) {
  return (
    <span className={`tp-phrase ${size}`} lang="th">
      {v.map((w, wi) => (
        <span className="tp-word" key={wi}>
          <span className="tp-th">{w.map((s) => s.th).join('')}</span>
          {!hideRoman && (
            <span className="tp-ros" lang="en">
              {w.map((s, si) => (
                <span key={si} className="tp-ro" style={{ color: TONE_COLOURS[s.t] }} title={`${TONE_NAMES[s.t]}: ${s.why}`}>
                  {s.ro}
                  {lines && <ToneLine t={s.t} size={18} />}
                </span>
              ))}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** Each syllable's tone worked out from its letters (the "why"). */
export function WhyList({ variants }: { variants: Variant[] }) {
  const seen = new Set<string>();
  const rows: Syl[] = [];
  variants.forEach((v) => sylls(v).forEach((s) => {
    const k = s.th + s.ro;
    if (!seen.has(k)) {
      seen.add(k);
      rows.push(s);
    }
  }));
  return (
    <div className="tp-why">
      {rows.map((s, i) => (
        <div key={i} className="tp-why-row">
          <span className="thai" lang="th">{s.th}</span>
          <b style={{ color: TONE_COLOURS[s.t] }}>{s.ro}</b>
          <span className="small">
            <i className={`tp-cls ${s.cls}`} aria-hidden="true" />
            {s.why}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A grammar note: plain text with the study file's bold and italic kept, nothing else. */
export function NoteText({ html }: { html: string }) {
  const parts = html.split(/(<\/?(?:b|i)>)/g);
  const out: ReactNode[] = [];
  let b = false;
  let it = false;
  parts.forEach((p, k) => {
    if (p === '<b>') b = true;
    else if (p === '</b>') b = false;
    else if (p === '<i>') it = true;
    else if (p === '</i>') it = false;
    else if (p) {
      const text = p.replace(/<[^>]+>/g, '');
      let node: ReactNode = text;
      if (it) node = <em>{node}</em>;
      if (b) node = <b className="tp-b">{node}</b>;
      out.push(<Fragment key={k}>{node}</Fragment>);
    }
  });
  return <>{out}</>;
}

export function PlayButton({ clip, thai, label = 'Play the speaker', big }: { clip?: string | null; thai: string; label?: string; big?: boolean }) {
  const [on, setOn] = useState(false);
  const go = async () => {
    setOn(true);
    if (clip) {
      const ok = await playClip(clip);
      if (!ok) speak(thai);
    } else speak(thai);
    setOn(false);
  };
  return (
    <button type="button" className={`tp-round ${big ? 'big' : ''} ${on ? 'on' : ''}`} onClick={() => void go()} aria-label={clip ? label : 'Play (device voice)'} title={clip ? label : 'Device voice'}>
      {clip ? <PlayIcon size={big ? 22 : 18} /> : <SpeakerIcon size={big ? 22 : 18} />}
    </button>
  );
}

// the speaker's pitch line per clip, measured once
const refCache = new Map<string, Promise<(number | null)[][] | null>>();

/** The course speaker's own contour per syllable, from their clip; null if it can't be measured. */
export function clipReference(key: string, tones: Tone[]): Promise<(number | null)[][] | null> {
  const k = `${key}/${tones.join(',')}`;
  let p = refCache.get(k);
  if (!p) {
    p = (async () => {
      try {
        const url = await clipUrl(key);
        if (!url) return null;
        const buf = await (await fetch(url)).arrayBuffer();
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        try {
          const audio = await ctx.decodeAudioData(buf);
          return speakerContours(trackPitch(audio.getChannelData(0), audio.sampleRate), tones.length, tones);
        } finally {
          void ctx.close();
        }
      } catch {
        return null;
      }
    })();
    refCache.set(k, p);
  }
  return p;
}

/**
 * Say it yourself: the app's own record sheet draws your pitch line over the
 * tones. With the speaker's clip, your tones are measured against how that
 * speaker said it (the pack's measured pitch when it has it, else measured
 * here from the clip); without one, against the textbook tone shapes. With the
 * speaker's measured melody, the whole phrase's pitch line is compared too.
 */
export function SayButton({ v, en, big, clip, pitch, melody }: { v: Variant; en?: string; big?: boolean; clip?: string | null; pitch?: number[][] | null; melody?: number[] | null }) {
  const { sound } = useApp();
  const go = async () => {
    stopTapes();
    const tones = sylls(v).map((s) => TONE_NAMES[s.t]);
    const reference = pitch && pitch.length === tones.length ? pitch : clip ? await clipReference(clip, tones) : null;
    const target = { thai: thaiOf(v).replace(/ /g, ''), roman: romanOf(v), en, tones, reference, melody: melody ?? null };
    const rec = await sound.record(target);
    if (rec) await sound.score(rec, target);
  };
  return (
    <button type="button" className={`tp-round ${big ? 'big' : ''}`} onClick={() => void go()} aria-label="Say it yourself" title="Say it yourself">
      <MicIcon size={big ? 22 : 18} />
    </button>
  );
}

export function SpeakerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />
    </svg>
  );
}

/** The five tones, colour and shape, as a key. */
export function ToneKey() {
  return (
    <div className="tp-key" aria-label="Tone colours">
      {TONE_NAMES.map((n, t) => (
        <span key={n} style={{ color: TONE_COLOURS[t] }}>
          <ToneLine t={t as ToneDigit} size={20} />
          {n}
        </span>
      ))}
    </div>
  );
}

export const WHO_LABEL = { m: 'man', f: 'woman' } as const;
