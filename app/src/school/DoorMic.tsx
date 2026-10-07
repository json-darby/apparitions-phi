// Skipping by voice: on the map, hold the mic and say a section's door phrase
// in Thai. The server's speech-to-text (the same check the scorer uses) says
// what it heard; the app matches that against every door phrase you can see.
// A clear match opens that section at Branches with Teach marked done; anything
// else opens nothing, and you tap as usual. Hidden when offline or when the
// server has no speech check, since recognition needs it.

import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../app/context';
import { MicIcon } from '../audio/SoundLayer';
import { MicError, openMic, type MicSession } from '../audio/recorder';
import type { Health } from '../live/client';
import type { SchoolFile } from './content';
import { hearThai } from './customApi';
import { loadPrefs, loadWheels } from './prefs';
import { doorPlan, doors, matchDoor, startSession } from './session';

type State = 'idle' | 'listening' | 'hearing' | 'none' | 'error';

/** The door mic can be offered: online, and the server can hear Thai. */
export function doorMicUsable(h: Health | null | undefined): boolean {
  return !!h && h.stt.available && h.stt.callsLeftToday > 0 && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

let ctx: AudioContext | null = null;

export function DoorMic({ file }: { file: SchoolFile }) {
  const { store, settings } = useApp();
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const mic = useRef<MicSession | null>(null);
  const opening = useRef<Promise<void> | null>(null);
  const list = doors(file, settings.adult, settings.identity);
  if (!list.length) return null;

  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (mic.current || opening.current) return;
    setMsg(null);
    opening.current = (async () => {
      try {
        ctx ??= new AudioContext();
        mic.current = await openMic(ctx);
        setState('listening');
      } catch (err) {
        setState('error');
        setMsg(err instanceof MicError && err.problem === 'denied' ? 'The microphone is blocked. Allow it in the browser, or tap a section.' : 'No microphone here. Tap a section instead.');
      } finally {
        opening.current = null;
      }
    })();
  };

  const up = async () => {
    await opening.current;
    const m = mic.current;
    mic.current = null;
    if (!m) return;
    const got = await m.stop();
    if (!got.blob || got.ms < 400) {
      setState('idle');
      setMsg('Hold the button while you speak.');
      return;
    }
    setState('hearing');
    const heard = await hearThai(got.blob, list[0].thai);
    const hit = heard ? matchDoor(heard, list) : null;
    if (!hit) {
      setState('none');
      setMsg(heard == null ? 'The speech check did not answer. Tap a section instead.' : 'No door phrase recognised. Tap a section instead.');
      return;
    }
    setState('idle');
    const prefs = loadPrefs(store);
    startSession(store, doorPlan(file, hit.section, { adult: settings.adult, identity: settings.identity, minutes: prefs.minutes, wheels: loadWheels(store) }));
  };

  const busy = state === 'hearing';
  return (
    <div className="sn-door">
      <button
        type="button"
        className={`sn-door-btn ${state === 'listening' ? 'on' : ''}`}
        aria-label="Hold and say a door phrase"
        aria-pressed={state === 'listening'}
        disabled={busy}
        onPointerDown={down}
        onPointerUp={() => void up()}
        onPointerCancel={() => void up()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="iconbtn" aria-hidden><MicIcon size={22} /></span>
      </button>
      <div className="sn-door-text">
        <b>{state === 'listening' ? 'Listening… let go when done' : busy ? 'Hearing it…' : 'Skip ahead by voice'}</b>
        <span className="small" role="status">
          {msg ?? <>Hold and say a section’s opening line in Thai, such as <span className="thai" lang="th">{list[0].thai}</span>. It opens at the replies.</>}
        </span>
      </div>
    </div>
  );
}
