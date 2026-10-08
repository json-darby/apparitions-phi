// Settings → Sound: real audio or captions only, default speed, the voice that
// models your own speech, a microphone check that calibrates your pitch range,
// and an optional "download all audio" that fills the offline cache.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { myVoiceFor } from '../core/settings';
import { VOICES, type VoiceId } from '../content/types';
import { Seg, SectionHead } from '../ui/kit';
import { AudioSound, allAudioPaths, countCachedAudio, warmAudioCache } from './AudioSound';
import { MicError, openMic } from './recorder';
import { medianF0, trackPitch, voicedCount } from './pitch';

function Line({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="row" style={{ cursor: 'default', alignItems: 'center' }}>
      <span className="stack gap-1" style={{ minWidth: 0 }}>
        <span>{title}</span>
        {note && <span className="small">{note}</span>}
      </span>
      <span style={{ flex: 'none' }}>{children}</span>
    </div>
  );
}

const VOICE_NAME: Record<VoiceId, string> = { f1: 'Woman 1', f2: 'Woman 2', m1: 'Man 1', m2: 'Man 2' };

export function SoundSettings() {
  const { settings: s, updateSettings: set, sound, content } = useApp();
  const [, force] = useState(0);
  useEffect(() => sound.subscribe(() => force((n) => n + 1)), [sound]);
  const paths = content.hasAudio ? allAudioPaths(content) : [];
  const sample = content.items.find((it) => Object.values(it.media?.audio ?? {}).some(Boolean)) ?? content.items[0];

  const preview = (v: VoiceId) => {
    if (!sample) return;
    void sound.play({ ref: `item:${sample.id}`, thai: sample.thai, roman: sample.roman, en: sample.en, tones: sample.tones, voice: v, speaker: VOICE_NAME[v] });
  };

  return (
    <>
      <SectionHead title="Sound" note={sound.mode === 'audio' ? 'Real audio on' : content.hasAudio ? 'Captions only' : 'No course audio yet'} />
      <Line title="Sound" note="Auto plays the course’s recorded voices where they exist. Captions only keeps everything silent.">
        <Seg label="Sound" value={s.sound} onChange={(v) => set({ sound: v })} options={[{ v: 'auto', label: 'Auto' }, { v: 'captions', label: 'Captions only' }]} />
      </Line>
      <Line title="Default speed" note="Used when a screen does not ask for one. Slow clips are recorded slow, not stretched.">
        <Seg label="Default speed" value={s.speed} onChange={(v) => set({ speed: v })} options={[{ v: 'normal', label: 'Normal' }, { v: 'slow', label: 'Slow' }]} />
      </Line>
      <Line title="Your voice" note={`The voice that models your own speech on the record sheet. Listening still uses all four. Now: ${VOICE_NAME[myVoiceFor(s)]}.`}>
        <span className="hrow" style={{ gap: 6 }}>
          <select value={s.myVoice} onChange={(e) => set({ myVoice: e.target.value as VoiceId | 'auto' })} aria-label="Your voice" style={{ width: 'auto', minWidth: 0, padding: '10px 12px' }}>
            <option value="auto">Auto ({s.identity === 'f' ? 'woman' : 'man'})</option>
            {VOICES.map((v) => (
              <option key={v} value={v}>{VOICE_NAME[v]}</option>
            ))}
          </select>
          <button className="pill small" type="button" onClick={() => preview(myVoiceFor(s))}>Hear</button>
        </span>
      </Line>
      <MicCheck />
      {content.hasAudio && <OfflineAudio paths={paths} />}
      {import.meta.env.DEV && <DevFixture />}
    </>
  );
}

function MicCheck() {
  const { settings: s, updateSettings: set } = useApp();
  const [state, setState] = useState<'idle' | 'listening' | 'done' | 'problem'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);

  const run = async () => {
    setMsg(null);
    setState('listening');
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const mic = await openMic(ctx);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const lv = Math.min(1, mic.level() * 6);
          if (bar.current) bar.current.style.transform = `scaleX(${lv})`;
          if (performance.now() - t0 > 3000) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const cap = await mic.stop();
      const tr = trackPitch(cap.pcm, cap.sampleRate);
      const voiced = voicedCount(tr);
      if (voiced < 25) {
        setState('problem');
        setMsg('The microphone works, but no steady voice came through. Hold an “aa” for two seconds, a little louder.');
        return;
      }
      const mid = Math.round(medianF0(tr));
      set({ voiceMidHz: mid });
      setState('done');
      setMsg(`Heard you at about ${mid} Hz. Saved as your mid-tone level, so tones are judged on your own range.`);
    } catch (e) {
      setState('problem');
      setMsg(e instanceof MicError ? ({ denied: 'The microphone is blocked. Allow it in the browser’s site settings and try again.', unavailable: 'No microphone was found.', insecure: 'The microphone needs a secure page (https or this computer).', error: e.message } as Record<string, string>)[e.problem] : String(e));
    } finally {
      if (bar.current) bar.current.style.transform = 'scaleX(0)';
      void ctx?.close().catch(() => undefined);
    }
  };

  return (
    <>
      <Line
        title="Microphone check"
        note={state === 'listening' ? 'Say “aa” at your normal speaking pitch and hold it…' : s.voiceMidHz ? `Your mid level: ${s.voiceMidHz} Hz.` : 'Checks the microphone and measures your normal pitch. Say a steady “aa”.'}
      >
        <span className="hrow" style={{ gap: 6 }}>
          {s.voiceMidHz != null && state !== 'listening' && (
            <button className="pill small" type="button" onClick={() => { set({ voiceMidHz: null }); setMsg(null); setState('idle'); }}>Clear</button>
          )}
          <button className="pill small" type="button" disabled={state === 'listening'} onClick={() => void run()}>
            {state === 'listening' ? 'Listening' : 'Check'}
          </button>
        </span>
      </Line>
      {state === 'listening' && (
        <div className="rec-level" style={{ margin: '0 0 12px', width: '100%' }} aria-hidden>
          <i ref={bar} />
        </div>
      )}
      {msg && <p className="small" role="status" style={{ margin: '0 0 12px', color: state === 'problem' ? 'var(--amber)' : undefined }}>{msg}</p>}
    </>
  );
}

function OfflineAudio({ paths }: { paths: string[] }) {
  const [cached, setCached] = useState<number | null>(null);
  const [prog, setProg] = useState<{ done: number; failed: number } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    countCachedAudio(paths).then((n) => alive && setCached(n)).catch(() => undefined);
    return () => {
      alive = false;
      ctl.current?.abort();
    };
  }, [paths.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    ctl.current = new AbortController();
    setProg({ done: 0, failed: 0 });
    try {
      const r = await warmAudioCache(paths, (done, _total, failed) => setProg({ done, failed }), ctl.current.signal);
      setProg(r);
      setCached(await countCachedAudio(paths));
    } catch {
      setProg(null);
    }
    ctl.current = null;
  };
  const busy = !!ctl.current;
  const total = paths.length;
  return (
    <>
      <Line
        title="Download all audio"
        note={
          busy && prog
            ? `Saving ${prog.done} of ${total} clips…`
            : `${cached ?? '…'} of ${total} clips saved for offline. Clips you play are saved anyway.${prog?.failed ? ` ${prog.failed} failed; run again to retry.` : ''}`
        }
      >
        {busy ? (
          <button className="pill small" type="button" onClick={() => ctl.current?.abort()}>Stop</button>
        ) : (
          <button className="pill small" type="button" disabled={cached === total} onClick={() => void start()}>
            {cached === total ? 'Saved' : 'Download'}
          </button>
        )}
      </Line>
      {busy && prog && (
        <div className="meter" style={{ margin: '0 0 12px' }} aria-hidden>
          <i style={{ width: `${(prog.done / Math.max(1, total)) * 100}%` }} />
        </div>
      )}
    </>
  );
}

function DevFixture() {
  const { sound, content } = useApp();
  const [on, setOn] = useState(sound instanceof AudioSound && sound.fixtureOn);
  if (!(sound instanceof AudioSound)) return null;
  const toggle = async () => {
    if (on) {
      sound.useFixture(null);
      setOn(false);
      return;
    }
    const { buildDevFixture } = await import('./devFixture');
    sound.useFixture(buildDevFixture(content));
    setOn(true);
  };
  return (
    <Line title="Test sounds (dev only)" note="Code-made buzz clips with the right tone shapes for 12 items, held in memory. Not Thai speech; not shipped.">
      <button className="pill small" type="button" onClick={() => void toggle()}>{on ? 'Remove' : 'Load'}</button>
    </Line>
  );
}
