// What the shared sound interface shows on screen.
// Captions mode (no course audio, or "Captions only"): the Thai as a caption
// while "audio" plays, and a tap-to-confirm sheet while recording.
// Audio mode: a small playing chip (text only when the screen asks for a
// subtitle; a full caption when no clip exists), and a real record sheet:
// microphone permission, live level, stop, then the pitch comparison and score.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import { useKeys } from '../input/keys';
import { myVoiceFor } from '../core/settings';
import { AudioSound } from './AudioSound';
import { PitchCompare } from './PitchCompare';
import type { SoundState } from './sound';
import './audio.css';

export function useSoundState() {
  const { sound } = useApp();
  return useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.getState(),
  );
}

export function SoundLayer() {
  const { sound, content, settings, store } = useApp();
  // keep the real sound service in step with content and settings
  useEffect(() => {
    if (sound instanceof AudioSound) sound.configure({ content, settings, store });
  }, [sound, content, settings, store]);
  const { caption, recording } = useSoundState();
  useKeys((a) => {
    if (!recording) return;
    if (a.type === 'confirm' || a.type === 'play') {
      sound.finishRecording();
      return true;
    }
    if (a.type === 'back') {
      sound.finishRecording(true);
      return true;
    }
    if (a.type === 'key' && a.down && a.key.toLowerCase() === 'r' && sound.retry) {
      sound.retry();
      return true;
    }
  }, !!recording);

  return (
    <>
      {caption && (caption.source === 'audio' ? <AudioChip caption={caption} /> : <Caption caption={caption} />)}
      {recording && (recording.phase ? <RecordSheet recording={recording} /> : <TapSheet recording={recording} />)}
    </>
  );
}

type Cap = NonNullable<SoundState['caption']>;
type Rec = NonNullable<SoundState['recording']>;

function Caption({ caption }: { caption: Cap }) {
  return (
    <div className="caption-layer" aria-live="polite">
      <div className="caption" key={caption.id}>
        <div className="wave" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
        <div className="grow">
          <div className="label">
            {caption.speaker ?? 'Audio'} · {caption.speed === 'slow' ? 'slow' : 'caption'}
            {caption.voice ? ` · voice ${caption.voice}` : ''}
            {caption.noise ? ' · street noise' : ''}
          </div>
          <div className="thai-m">{caption.caption ?? caption.thai}</div>
          {!caption.hideRoman && caption.roman && <div className="roman">{caption.roman}</div>}
          <div className="bar">
            <i style={{ animationDuration: `${Math.max(0, caption.until - Date.now())}ms` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Audio is playing: a small chip; the text only as a subtitle when the screen asks. */
function AudioChip({ caption }: { caption: Cap }) {
  return (
    <div className={`caption-layer audio ${caption.subtitle ? 'with-sub' : ''}`} aria-live="off">
      {caption.subtitle ? (
        <div className="caption" key={caption.id}>
          <Wave />
          <div className="grow">
            <div className="label">{chipLabel(caption)}</div>
            <div className="thai-m">{caption.caption ?? caption.thai}</div>
            {!caption.hideRoman && caption.roman && <div className="roman">{caption.roman}</div>}
          </div>
        </div>
      ) : (
        <div className="cap-chip" key={caption.id} role="status" aria-label="Playing audio">
          <Wave />
          <span className="label">{chipLabel(caption)}</span>
        </div>
      )}
    </div>
  );
}

function chipLabel(c: Cap) {
  return `${c.speaker ?? 'Audio'}${c.speed === 'slow' ? ' · slow' : ''}${c.voice ? ` · ${c.voice}` : ''}${c.noise ? ' · street' : ''}`;
}

function Wave() {
  return (
    <div className="wave" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

function Prompt({ recording }: { recording: Rec }) {
  return recording.hideText ? (
    <div className="h-m" style={{ marginTop: 10 }}>{recording.en}</div>
  ) : (
    <>
      <div className="thai-l" style={{ marginTop: 10 }}>{recording.thai}</div>
      {recording.roman && <div className="roman">{recording.roman}</div>}
      {recording.en && <div className="small" style={{ marginTop: 4 }}>{recording.en}</div>}
    </>
  );
}

/** Captions mode: say it aloud and tap. */
function TapSheet({ recording }: { recording: Rec }) {
  const { sound } = useApp();
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Say it out loud">
      <div className="sheet record-sheet">
        <div className="label">Say it out loud</div>
        <Prompt recording={recording} />
        <button className="mic-ring" onClick={() => sound.finishRecording()} aria-label="I said it">
          <MicIcon />
        </button>
        <p className="small" style={{ margin: '0 0 16px' }}>
          Captions only: say it aloud and tap when you have.
        </p>
        <div className="hrow" style={{ justifyContent: 'center' }}>
          <button className="pill" onClick={() => sound.finishRecording(true)}>Skip</button>
          <button className="pill solid" onClick={() => sound.finishRecording()}>I said it</button>
        </div>
      </div>
    </div>
  );
}

/** Live microphone level, drawn without React re-renders. */
function useLevel(on: boolean) {
  const { sound } = useApp();
  const ring = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!on || !sound.inputLevel) return;
    let raf = 0;
    const tick = () => {
      const lv = sound.inputLevel?.() ?? 0;
      ring.current?.style.setProperty('--lv', String(1 + Math.min(1, lv) * 0.35));
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, lv)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, sound]);
  return { ring, bar };
}

const PROBLEM: Record<string, string> = {
  denied: 'The microphone is blocked for this app. Allow it in the browser’s site settings (the icon left of the address), then try again.',
  unavailable: 'No microphone was found on this device.',
  insecure: 'The microphone only works on a secure page (https or this computer).',
  error: 'The microphone could not start.',
};

/** Audio mode: the real record sheet. */
function RecordSheet({ recording }: { recording: Rec }) {
  const { sound, settings } = useApp();
  const phase = recording.phase!;
  const { ring, bar } = useLevel(phase === 'listening');
  const review = recording.review;
  const hold = () => {
    if (sound instanceof AudioSound) sound.holdReview();
  };
  const hear = () => {
    hold();
    void sound.play({ ref: recording.ref, thai: recording.thai, roman: recording.roman, tones: recording.tones, voice: myVoiceFor(settings), speaker: 'You, modelled' });
  };
  const sylls = recording.roman?.split(/[\s-]+/).filter(Boolean);

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Say it out loud">
      <div className="sheet record-sheet" onPointerDown={phase === 'review' ? hold : undefined}>
        <div className="label">
          {phase === 'review' ? 'Your pitch line' : phase === 'listening' ? 'Listening' : phase === 'analysing' ? 'Measuring' : 'Say it out loud'}
        </div>
        {phase !== 'review' && <Prompt recording={recording} />}

        {(phase === 'asking' || phase === 'listening' || phase === 'analysing') && (
          <>
            <button
              className={`rec-ring ${phase === 'listening' ? '' : 'idle'}`}
              onClick={() => sound.finishRecording()}
              aria-label={phase === 'listening' ? 'Stop' : 'Waiting for the microphone'}
              disabled={phase === 'analysing'}
            >
              {phase === 'listening' && <span className="halo" ref={ring} />}
              {phase === 'listening' ? <StopIcon /> : <MicIcon />}
            </button>
            <div className="rec-level" aria-hidden>
              <i ref={bar} />
            </div>
            <p className="small" style={{ margin: '0 0 16px' }}>
              {phase === 'asking' && 'Waiting for the microphone…'}
              {phase === 'listening' && 'Speak now. It stops when you do, or tap the square.'}
              {phase === 'analysing' && 'Measuring your pitch on this device…'}
            </p>
            <div className="hrow" style={{ justifyContent: 'center' }}>
              <button className="pill" onClick={() => sound.finishRecording(true)}>Skip</button>
              {phase === 'asking' && <button className="pill" onClick={() => sound.finishRecording()}>I said it</button>}
              {phase === 'listening' && <button className="pill solid" onClick={() => sound.finishRecording()}>Done</button>}
            </div>
          </>
        )}

        {phase === 'denied' && (
          <>
            <div className="rec-problem small" role="alert">
              {PROBLEM[recording.problem ?? 'error'] ?? PROBLEM.error} You can still say it aloud and tap.
            </div>
            <div className="hrow" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="pill" onClick={() => sound.finishRecording(true)}>Skip</button>
              <button className="pill" onClick={() => sound.retry?.()}>Try again</button>
              <button className="pill solid" onClick={() => sound.finishRecording()}>I said it</button>
            </div>
          </>
        )}

        {phase === 'review' && review && (
          <>
            <div className="rec-review">
              <div className="hrow between" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
                <div className="stack gap-1" style={{ minWidth: 0 }}>
                  <div className="thai-m">{recording.thai}</div>
                  {recording.roman && <div className="roman">{recording.roman}</div>}
                </div>
                <div className="stack" style={{ alignItems: 'flex-end', flex: 'none' }}>
                  {review.tone != null ? (
                    <>
                      <span className="big">{Math.round(review.tone * 100)}</span>
                      <span className="label">Tone match</span>
                    </>
                  ) : (
                    <span className="label">{review.tones.length ? 'No voice heard' : 'Recorded'}</span>
                  )}
                </div>
              </div>
              {review.tones.length > 0 && (
                <PitchCompare
                  tones={review.tones}
                  reference={review.reference.length ? review.reference : null}
                  learner={review.tone != null ? review.syllables : null}
                  scores={review.tone != null ? review.scores : null}
                  heard={review.heard}
                  sylls={sylls && sylls.length === review.tones.length ? sylls : undefined}
                  w={480}
                  h={120}
                />
              )}
              {review.tone == null && review.tones.length > 0 && (
                <p className="small" style={{ margin: '10px 0 0' }}>Nothing voiced came through. Move closer, speak up, and try again.</p>
              )}
              <p className="small" style={{ margin: '10px 0 0' }}>
                Blue is you; the soft band is the target. Measured on this device{navigator.onLine ? '' : ', tone only while offline'}.
              </p>
            </div>
            {review.autoMs != null && (
              <div className="rec-auto" aria-hidden>
                <i key={recording.id} style={{ animationDuration: `${review.autoMs}ms` }} />
              </div>
            )}
            <div className="hrow" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="pill" onClick={() => sound.retry?.()}>Again</button>
              <button className="pill" onClick={hear}>Hear it</button>
              <button className="pill solid" onClick={() => sound.finishRecording()}>Next</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MicIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}
