// "Talk live": a spoken conversation with the character through the app's local
// server. Hold the mic (or Space) to talk. Bubbles show the Thai, with English
// on a toggle. Anything the character says about tones is marked unverified.
// "Hear it again" (R) replays the character's latest line on the device;
// "Try again" (T) goes back to the line just answered (or stays on the current
// one) so the learner can say it again, as often as they like, until it is right.
// If the server or network goes, a banner offers the scripted conversation,
// which is always there.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../app/context';
import { MicIcon } from '../audio/SoundLayer';
import { PLACES } from '../content/seed';
import { NPC_SEX, type StreetTaskBuilt } from '../content/street-seed';
import { bindLiveStore, checkHealth, LIVE_RECHECK, LiveClient, liveUsable, type Health, type LimitReason, type LiveStatus } from './client';
import { buildPersona, knownItems, newWordsFor } from './persona';
import { glossFor, liveTools, mentionsTones, scriptFor, similarity, slotOf, type LiveRun } from './tools';
import './live.css';

export type LiveEnd = 'done' | 'failed' | 'left' | 'quit';

/** Ask every useLiveHealth to check again (after live fails, so the switch hides if the server is gone;
 * Settings → Talk live sends it too when the address or code changes). */
const RECHECK = LIVE_RECHECK;

/** The server's health: undefined while checking, null when it is not there. Rechecked when the network returns. */
export function useLiveHealth(): Health | null | undefined {
  const { store } = useApp();
  const [h, setH] = useState<Health | null | undefined>(undefined);
  useEffect(() => {
    // the server address and access code saved on this device (Settings → Talk live)
    bindLiveStore(store);
    let alive = true;
    const check = () => void checkHealth().then((x) => alive && setH(x));
    check();
    const iv = setInterval(check, 60_000);
    window.addEventListener('online', check);
    window.addEventListener(RECHECK, check);
    const off = () => setH(null);
    window.addEventListener('offline', off);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener('online', check);
      window.removeEventListener(RECHECK, check);
      window.removeEventListener('offline', off);
    };
  }, [store]);
  return h;
}

/** Live may be offered for this task: the server answers, and an 18+ task needs the 18+ setting. */
export function liveOffered(h: Health | null | undefined, task: StreetTaskBuilt, adult: boolean): boolean {
  return liveUsable(h ?? null) && (!task.adult || adult);
}

interface Bubble {
  id: string;
  who: 'npc' | 'learner' | 'system';
  text: string;
  en?: string;
  final: boolean;
  unverified?: boolean;
  hint?: boolean;
  typed?: boolean;
  /** learner: matched a right reply */
  right?: boolean;
  /** learner: reviews that moved the schedule */
  counted?: number;
}

export interface LivePanelProps {
  run: LiveRun;
  onEnd: (o: LiveEnd) => void;
  /** go back to the scripted conversation */
  onFallback: () => void;
  /** something changed in the run (step, comfort, rapport): re-render */
  onChange?: () => void;
  onSpeaking?: (on: boolean) => void;
}

const LIMIT_TEXT: Record<LimitReason, string> = {
  daily: "Today's live minutes are used up.",
  session: 'This live conversation reached its time limit.',
  budget: 'The spending cap is reached, so live is off.',
  rate: 'Too many conversations started in a minute. Try again shortly.',
  busy: 'Another live conversation is still open.',
};

const ERROR_TEXT: Record<string, string> = {
  'connection-lost': 'The live connection dropped.',
  access: 'The live server did not accept the access code. Check Settings → Talk live.',
  'too-many-tries': 'Too many wrong access codes. Try again in 15 minutes.',
  locked: 'The live server has no access code set, so it is switched off.',
};

export function LivePanel({ run, onEnd, onFallback, onChange, onSpeaking }: LivePanelProps) {
  const { engine, content, settings, store } = useApp();
  // the conversation uses the server saved on this device
  bindLiveStore(store);
  const task = run.task;
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [banner, setBanner] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gloss, setGloss] = useState(false);
  const [talking, setTalking] = useState(false);
  const [mock, setMock] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const client = useRef<LiveClient | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const glossRef = useRef(gloss);
  glossRef.current = gloss;
  const ended = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, redraw] = useState(0);
  const cb = useRef({ onEnd, onChange, onSpeaking });
  cb.current = { onEnd, onChange, onSpeaking };

  const person = content.person(task.person)!;
  const place = PLACES.find((p) => p.id === task.place)!;

  const setup = useMemo(() => {
    const refs = engine.introducedRefs();
    const known = knownItems(refs, (id) => content.item(id));
    const newItems = newWordsFor(task, new Set(known.map((i) => i.id)), (id) => content.item(id));
    return {
      systemInstruction: buildPersona({ task, person, place, identity: settings.identity, learnerName: settings.name, adult: settings.adult, known, newItems, day: engine.day() }),
      tools: liveTools(task.steps),
      script: scriptFor(task),
    };
    // built once per conversation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const npcEnglish = (text: string): string => {
    let best = { score: 0, en: '' };
    for (const n of Object.values(task.nodes)) {
      const s = similarity(text, n.thai);
      if (s > best.score) best = { score: s, en: n.en };
    }
    if (best.score >= 0.7) return best.en;
    const g = glossFor(text, content.items);
    return g ? `≈ ${g}` : '';
  };

  const finish = (o: LiveEnd, delay = 1400) => {
    if (ended.current) return;
    ended.current = true;
    finishTimer.current = setTimeout(() => {
      finishTimer.current = null;
      cb.current.onEnd(o);
    }, delay);
  };

  const upsert = (b: Bubble) =>
    setBubbles((list) => {
      const i = list.findIndex((x) => x.id === b.id);
      if (i < 0) return [...list, b];
      const next = list.slice();
      next[i] = { ...list[i], ...b };
      return next;
    });

  useEffect(() => {
    const c = new LiveClient({
      handlers: {
        status: (s) => setStatus(s),
        ready: (m) => {
          setMock(m.mock);
          setMinutes(m.minutesLeft);
          setBanner(null);
        },
        speaking: (on) => {
          cb.current.onSpeaking?.(on);
          redraw((n) => n + 1);
        },
        transcript: (t) => {
          if (t.who === 'npc') {
            const hint = /\bhint\b/i.test(t.text);
            if (t.final) {
              if (hint) run.hinted();
              if (glossRef.current) run.glossShown();
            }
            upsert({ id: `npc-${t.turn}`, who: 'npc', text: t.text, final: t.final, en: t.final ? npcEnglish(t.text) : undefined, unverified: mentionsTones(t.text), hint });
            return;
          }
          if (!t.final) {
            upsert({ id: `me-${t.turn}`, who: 'learner', text: t.text, final: false });
            return;
          }
          const u = run.learnerSaid(t.text, false);
          if (!t.text.trim()) {
            upsert({ id: `me-${t.turn}`, who: 'system', text: 'Nothing heard. Hold the button while you speak.', final: true });
          } else {
            upsert({ id: `me-${t.turn}`, who: 'learner', text: t.text, final: true, en: u.match?.option.en ?? (glossFor(t.text, content.items) || undefined), right: u.right, counted: u.counted.length });
          }
          cb.current.onChange?.();
          if (run.outcome === 'left') finish('left');
        },
        tool: ({ name, args }) => {
          const r = run.onTool(name, args);
          if (r.kind === 'unsafe') {
            setNote('That is outside this conversation. The character has changed the subject.');
            if (run.flags >= 2) {
              setBanner('Live stopped after an off-limits request.');
              finish('quit', 600);
            }
          }
          if (r.kind === 'slot' && r.counted.length) {
            setBubbles((list) => {
              const i = [...list].reverse().findIndex((b) => b.who === 'learner');
              if (i < 0) return list;
              const at = list.length - 1 - i;
              const next = list.slice();
              next[at] = { ...list[at], right: true, counted: (list[at].counted ?? 0) + r.counted.length };
              return next;
            });
          }
          cb.current.onChange?.();
          if (r.kind === 'complete') finish('done', 2600);
          return r.response;
        },
        turnComplete: () => {
          if (run.outcome === 'done') finish('done', 2600);
        },
        limit: (reason, left) => {
          setMinutes(left);
          setBanner(LIMIT_TEXT[reason]);
        },
        error: (code, message) => {
          setBanner(ERROR_TEXT[code] ?? (code === 'adult-off' ? message : 'Live is not available right now.'));
        },
        ended: (reason) => {
          if (!run.outcome && !reason.startsWith('limit')) setBanner('The live conversation ended.');
        },
      },
    });
    client.current = c;
    c.start({
      type: 'start', taskId: task.id, systemInstruction: setup.systemInstruction, tools: setup.tools,
      voice: NPC_SEX[task.person] === 'm' ? 'm' : 'f', adult: settings.adult, adultTask: !!task.adult, script: setup.script,
    }).catch(() => setBanner((b) => b ?? 'Live is not available right now.'));
    const offline = () => setBanner('You are offline.');
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('offline', offline);
      if (finishTimer.current) clearTimeout(finishTimer.current);
      c.stop();
      client.current = null;
    };
    // one conversation per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (banner) window.dispatchEvent(new Event(RECHECK));
  }, [banner]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  const talk = async (on: boolean) => {
    const c = client.current;
    if (!c || c.status !== 'live') return;
    if (on === talking) return;
    setTalking(on);
    try {
      await c.talk(on);
    } catch {
      setTalking(false);
      setNote('The microphone is blocked. Allow it in the browser, or type below.');
    }
  };

  /** The character's latest line again, on this device. */
  const hearAgain = () => {
    if (talking) return;
    client.current?.replayLine();
  };

  /** Say the line just answered (or the current one) again, as many times as wanted. */
  const tryAgain = () => {
    const c = client.current;
    if (!c || c.status !== 'live' || talking || banner) return;
    if (ended.current) {
      // the last step was just answered: stay in the conversation instead of ending it
      if (run.outcome !== 'done' || !finishTimer.current) return;
      clearTimeout(finishTimer.current);
      finishTimer.current = null;
      ended.current = false;
    }
    const node = run.retry();
    if (!node) return;
    const slot = slotOf(task, node);
    upsert({ id: `again-${Date.now()}`, who: 'system', text: `Again: ${slot}. Listen, then say your reply.`, final: true });
    c.sendText(`[App: the learner wants to practise the "${slot}" step again. Say your line for it again, word for word: "${node.thai}". Then stop and wait for their reply. When they answer it correctly, call slotFilled for "${slot}" again and carry on from there.]`);
    cb.current.onChange?.();
  };

  // hold Space to talk, G for English, R to hear the line again, T to try again
  useEffect(() => {
    const field = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest('input, textarea');
    const down = (e: KeyboardEvent) => {
      if (field(e)) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) void talk(true);
      } else if (k === 'g' && !e.repeat) toggleGloss();
      else if (k === 'r' && !e.repeat) hearAgain();
      else if (k === 't' && !e.repeat) tryAgain();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !field(e)) {
        e.preventDefault();
        void talk(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const toggleGloss = () => {
    setGloss((g) => {
      if (!g) run.glossShown();
      return !g;
    });
  };

  const sendTyped = () => {
    const text = typed.trim();
    const c = client.current;
    if (!text || !c || c.status !== 'live') return;
    const u = run.learnerSaid(text, true);
    upsert({ id: `typed-${Date.now()}`, who: 'learner', text, final: true, typed: true, en: u.match?.option.en ?? (glossFor(text, content.items) || undefined), right: u.right, counted: 0 });
    c.sendText(text);
    setTyped('');
    cb.current.onChange?.();
    if (run.outcome === 'left') finish('left');
  };

  const ready = status === 'live';
  const holdProps = {
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      void talk(true);
    },
    onPointerUp: () => void talk(false),
    onPointerCancel: () => void talk(false),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };

  return (
    <div className="live">
      <div className="hrow between" style={{ alignItems: 'flex-start' }}>
        <div className="label">
          Talk live · {person.name} · {mock ? 'mock server, no Google' : 'Gemini Live'}
          {minutes != null && <span className="mut"> · {minutes} min left today</span>}
        </div>
        <div className="hrow" style={{ gap: 8 }}>
          <button type="button" className="pill small" aria-pressed={gloss} onClick={toggleGloss} title="English (G)">EN</button>
        </div>
      </div>

      {banner && (
        <div className="live-banner" role="status">
          <span>{banner} The scripted conversation always works offline.</span>
          <button type="button" className="pill small solid" onClick={onFallback}>Use scripted</button>
        </div>
      )}

      <div className="live-log" ref={logRef} aria-live="polite">
        {status === 'connecting' && !bubbles.length && <p className="small mut">Connecting…</p>}
        {bubbles.map((b) =>
          b.who === 'system' ? (
            <p key={b.id} className="small mut live-sys">{b.text}</p>
          ) : (
            <div key={b.id} className={`live-b ${b.who === 'learner' ? 'me' : ''} ${b.final ? '' : 'partial'}`}>
              <div className="thai-m" lang="th">{b.text}</div>
              {gloss && b.en && <div className="small mut">{b.en}</div>}
              {b.unverified && <div className="live-unv">Unverified: Live cannot judge tones. The pitch check does.</div>}
              {b.who === 'learner' && b.final && (
                <div className="live-tag">
                  {b.typed ? 'typed · logged, not counted' : b.right ? (b.counted ? `matched · ${b.counted} counted` : 'matched · logged') : 'logged'}
                </div>
              )}
            </div>
          ),
        )}
        {status === 'reconnecting' && <p className="small mut live-sys">Reconnecting…</p>}
      </div>

      {note && <p className="small live-note">{note}</p>}

      <div className="live-practice">
        <button type="button" className="pill small" onClick={hearAgain} disabled={!ready || talking || !client.current?.canReplay} title="Hear the line again (R)">
          Hear it again
        </button>
        <button type="button" className="pill small" onClick={tryAgain} disabled={!ready || talking || !!banner || !run.current} title="Say your reply again (T)">
          Try again
        </button>
      </div>

      <button
        type="button"
        className={`live-mic ${talking ? 'on' : ''}`}
        disabled={!ready || !!banner}
        aria-pressed={talking}
        aria-label="Hold to talk"
        {...holdProps}
      >
        <span className="iconbtn" aria-hidden><MicIcon size={24} /></span>
        <span className="grow">
          <b>{talking ? 'Listening… release to send' : 'Hold to talk'}</b>
          <span className="small">Hold the button or Space while you speak Thai.</span>
        </span>
      </button>

      <form
        className="live-type"
        onSubmit={(e) => {
          e.preventDefault();
          sendTyped();
        }}
      >
        <input lang="th" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type Thai" aria-label="Type Thai" disabled={!ready || !!banner} />
        <button type="submit" className="pill small" disabled={!ready || !!banner || !typed.trim()}>Send</button>
      </form>

      <p className="small mut" style={{ margin: 0 }}>
        Live is a conversation partner, not a judge. Anything it says about your tones is unverified. Spoken replies that match the step count as speaking reviews; typed ones are logged only.
      </p>
    </div>
  );
}
