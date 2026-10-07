// School of the Night: the lesson, chat style. The tutor's bubbles are on the
// left, yours on the right; each has the Thai, the romanisation and an English
// row that follows the line's training-wheels level. The current instruction
// is pinned above the mic ("Say: I'd like a beer"). Hold to talk (or Space);
// Skip, Repeat, Slower and Show answer under it. Tap a bubble to hear it again:
// the tutor's from the audio already received, yours from your own take, with
// the pitch line and score from the on-device scorer.
//
// One step at a time: the runner picks the step, the English shows (and the
// phone reads it aloud with the mic muted, if that is on), the app sends the
// model one directive, the bubble is drawn from the lesson data (never from the
// model's transcript), you speak, the model reports with lineHeard, the app
// backs that with its own transcript match, scores, records and moves on.
// A live session ends at 15 minutes, so a longer lesson opens a fresh one
// between steps. Then the summary: got, missed, sent to reviews, and one
// button to run only the missed lines again.
//
// Eyes-off: every instruction and result is read aloud (the mic stays muted
// while the phone speaks), the mic opens by itself once the tutor has finished
// and closes when you stop talking, and the screen is kept awake. Lines from
// your own custom sections carry a small "unchecked" mark.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { Link, navigate } from '../app/router';
import { MicIcon } from '../audio/SoundLayer';
import { PitchCompare } from '../audio/PitchCompare';
import type { SpeechScore } from '../audio/sound';
import type { Tone } from '../content/types';
import { bindLiveStore, LiveClient, liveUsable, type LimitReason, type LiveStatus } from '../live/client';
import { useLiveHealth } from '../live/LivePanel';
import { tutorTools, type Verdict } from '../live/tools';
import { buildTutorPersona, directiveFor } from '../live/tutor';
import { Label, RunRail, Screen, Seg, Toggle, TopBar } from '../ui/kit';
import { canSpeak, playFrames, quickTones, speakEnglish, stopSpeaking, toRecording } from './audio';
import { lineIndex, visibleSections, type SchoolFile } from './content';
import { SCHOOL, TUTOR, VOICE_SETUP } from './names';
import { loadPrefs, loadSession, loadWheels, savePrefs, saveLast, saveSession, saveWheels, type LastLesson, type SessionPlan } from './prefs';
import { recordTurn } from './reviews';
import { combineVerdict, isGot, isMissed, LessonRunner, type Result, type Shown, type Step, type They } from './runner';
import { isCustomSection } from './custom';
import { NoFile, SchoolTitle } from './SchoolMap';
import { useSchool } from './useSchool';
import './school.css';

export default function SchoolLesson() {
  const file = useSchool();
  const { store } = useApp();
  const [plan] = useState(() => loadSession(store));
  if (file === undefined) return <Screen top={<TopBar mid={SCHOOL.name} parent="/school" />}><p className="small">Loading…</p></Screen>;
  if (!file) return <NoFile />;
  if (!plan || !plan.lineIds.length) {
    return (
      <Screen top={<TopBar mid={SCHOOL.name} parent="/school" />} narrow>
        <SchoolTitle />
        <p className="body">No session chosen. Pick sections or lines on the map first.</p>
        <Link to="/school" className="pill" style={{ alignSelf: 'flex-start' }}>Open the map</Link>
      </Screen>
    );
  }
  return <Lesson key={plan.lineIds.join(',')} file={file} plan={plan} />;
}

// ---------------------------------------------------------------------------

interface Bubble {
  id: string;
  stepId: string;
  who: 'tutor' | 'other' | 'me' | 'answer' | 'sys';
  thai: string;
  roman: string;
  en: string;
  meaning: Shown['meaning'];
  revealed?: boolean;
  result?: Result;
  counted?: boolean;
  tones?: Tone[];
  score?: SpeechScore | null;
  overall?: number | null;
  /** generated Thai from a custom section */
  unchecked?: boolean;
}

interface Turn {
  step: Step;
  shown: Shown;
  helped: boolean;
  frames: Int16Array[];
  model: Verdict | null;
  heard: string | null;
  spoke: boolean;
  talking: boolean;
  cueEnd: number | null;
  talkStart: number | null;
  wait: ReturnType<typeof setTimeout> | null;
  done: boolean;
  cueBubble: string | null;
  /** eyes-off: the mic opened by itself; when, when your voice was first and last heard */
  auto?: { started: number; voiceAt: number | null; lastVoice: number; timer: ReturnType<typeof setInterval> | null };
}

const LIMIT_TEXT: Record<LimitReason, string> = {
  daily: "Today's live minutes are used up.",
  session: 'This live session reached its time limit.',
  budget: 'The spending cap is reached, so live is off.',
  rate: 'Too many sessions started in a minute. Try again shortly.',
  busy: 'Another live conversation is still open.',
};

/** Open a fresh live session after this long (Live sessions end at 15 minutes). */
const RENEW_AFTER_MS = 13 * 60_000;
/** Eyes-off listening: the level that counts as your voice, the pause that ends a turn, the longest wait for you to start. */
const VOICE_RMS = 0.02;
const END_PAUSE_MS = 1000;
const START_WAIT_MS = 7000;
const MAX_TURN_MS = 12000;

/** RMS of a PCM16 frame, 0..1. */
function rms(pcm: Int16Array): number {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += (pcm[i] / 0x8000) ** 2;
  return pcm.length ? Math.sqrt(s / pcm.length) : 0;
}

/** After you let go: how long to wait for the tutor's report before judging on the transcript alone. */
const WAIT_TOOL_MS = 2500;
const WAIT_ANY_MS = 8000;

let bubbleSeq = 0;

function Lesson({ file, plan }: { file: SchoolFile; plan: SessionPlan }) {
  const { store, engine, settings, sound } = useApp();
  bindLiveStore(store);
  const health = useLiveHealth();
  const [prefs, setPrefs] = useState(() => loadPrefs(store));
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [step, setStep] = useState<Step | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [banner, setBanner] = useState<string | null>(null);
  const [talking, setTalking] = useState(false);
  const [reading, setReading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [judging, setJudging] = useState(false);
  const [timer, setTimer] = useState<{ start: number; ms: number } | null>(null);
  const [mock, setMock] = useState(false);
  const [summary, setSummary] = useState<LastLesson | null>(null);
  const [, tick] = useState(0);

  const runner = useRef<LessonRunner | null>(null);
  const client = useRef<LiveClient | null>(null);
  const sessionAt = useRef(0);
  const turn = useRef<Turn | null>(null);
  const audio = useRef(new Map<string, ArrayBuffer[]>());
  const takes = useRef(new Map<string, Int16Array[]>());
  const movedItems = useRef(new Set<string>());
  const advancing = useRef(false);
  const slotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const speakingRef = useRef(false);
  const wake = useRef<{ release(): Promise<void> } | null>(null);

  const index = useMemo(() => lineIndex(file), [file]);
  const visible = useMemo(() => new Set(visibleSections(file, settings.adult).flatMap((s) => s.lines.map((l) => l.id))), [file, settings.adult]);
  const lineIds = plan.lineIds.filter((id) => visible.has(id));
  const night = lineIds.some((id) => file.groups.find((g) => g.id === index.get(id)?.section.group)?.adult);
  const unchecked = (lineId: string | null) => {
    const r = lineId ? index.get(lineId) : undefined;
    return !!r && (isCustomSection(r.section) || !!r.line.unverified);
  };
  const online = liveUsable(health ?? null);

  const upsert = (b: Bubble) =>
    setBubbles((list) => {
      const i = list.findIndex((x) => x.id === b.id);
      if (i < 0) return [...list, b];
      const next = list.slice();
      next[i] = { ...list[i], ...b };
      return next;
    });
  const patch = (id: string, p: Partial<Bubble>) => setBubbles((list) => list.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const sys = (text: string, stepId = '') => upsert({ id: `b${++bubbleSeq}`, stepId, who: 'sys', thai: '', roman: '', en: text, meaning: 'shown' });

  useEffect(() => {
    // after layout, so a bubble with a pitch line is fully in view
    const el = logRef.current;
    const id = requestAnimationFrame(() => el?.scrollTo({ top: el.scrollHeight }));
    return () => cancelAnimationFrame(id);
  }, [bubbles]);

  // ---------- the live session ----------

  // handlers read the latest state through this ref
  const live = useRef({
    toolCall: (_name: string, _args: Record<string, unknown>): Record<string, unknown> => ({ ok: true }),
    transcript: (_text: string) => {},
    turnComplete: () => {},
    ended: (_reason: string) => {},
  });

  const connect = (): Promise<void> => {
    client.current?.stop();
    const lines = lineIds.map((id) => index.get(id)!.line).map((l) => ({ id: l.id, thai: l[settings.identity].thai, en: l.en }));
    const c = new LiveClient({
      handlers: {
        status: (s) => setStatus(s),
        ready: (m) => {
          setMock(m.mock);
          setBanner(null);
        },
        speaking: (on) => {
          speakingRef.current = on;
          setSpeaking(on);
        },
        npcAudio: (chunk) => {
          const id = turn.current?.cueBubble;
          if (id) audio.current.set(id, [...(audio.current.get(id) ?? []), chunk]);
        },
        learnerAudio: (pcm) => {
          const t = turn.current;
          if (t?.talking) {
            t.frames.push(pcm.slice());
            if (t.auto && rms(pcm) > VOICE_RMS) {
              const now = Date.now();
              t.auto.voiceAt ??= now;
              t.auto.lastVoice = now;
            }
          }
        },
        transcript: (t) => {
          if (t.who === 'learner' && t.final) live.current.transcript(t.text);
        },
        tool: ({ name, args }) => live.current.toolCall(name, args),
        turnComplete: () => live.current.turnComplete(),
        limit: (reason) => setBanner(LIMIT_TEXT[reason]),
        error: (code, message) => setBanner(code === 'adult-off' ? message : code === 'connection-lost' ? 'The live connection dropped.' : 'Live is not available right now.'),
        ended: (reason) => live.current.ended(reason),
      },
    });
    client.current = c;
    sessionAt.current = Date.now();
    return c.start({
      type: 'start', taskId: 'school', tutor: true,
      systemInstruction: buildTutorPersona({ setup: VOICE_SETUP, identity: settings.identity, adult: settings.adult, night, learnerName: settings.name, lines }),
      tools: tutorTools(),
      // "they speak as": the tutor's voice (mixed: a man or a woman, chosen per live session)
      voice: prefsRef.current.they === 'mixed' ? (Math.random() < 0.5 ? 'm' : 'f') : prefsRef.current.they,
      adult: settings.adult, adultTask: night,
    });
  };

  // ---------- one step ----------

  const clearWait = (t: Turn | null) => {
    if (t?.wait) clearTimeout(t.wait);
    if (t) t.wait = null;
  };

  const startSlotTimer = (t: Turn) => {
    if (!t.step.timerMs || slotTimer.current || t.spoke) return;
    setTimer({ start: Date.now(), ms: t.step.timerMs });
    slotTimer.current = setTimeout(() => {
      slotTimer.current = null;
      if (turn.current === t && !t.spoke && !t.done) finish(t, 'none');
    }, t.step.timerMs);
  };

  const advance = async () => {
    const r = runner.current;
    if (!r || advancing.current || gone.current) return;
    advancing.current = true;
    try {
      const s = r.next();
      if (!s) return end();
      if (Date.now() - sessionAt.current > RENEW_AFTER_MS || client.current?.status !== 'live') {
        sys('Opening a fresh live session…', s.id);
        try {
          await connect();
        } catch {
          r.requeue();
          setBanner((b) => b ?? 'Live is not available right now.');
          return;
        }
      }
      const sh = r.shown(s);
      const t: Turn = { step: s, shown: sh, helped: false, frames: [], model: null, heard: null, spoke: false, talking: false, cueEnd: null, talkStart: null, wait: null, done: false, cueBubble: null };
      turn.current = t;
      setStep(s);
      setShown(sh);
      setTimer(null);
      const eyesOff = prefsRef.current.eyesOff;
      const readIt = eyesOff ? sh.instruction ?? s.bare : prefsRef.current.readAloud && sh.speak ? sh.instruction : null;
      if (readIt && VOICE_SETUP === 'B') {
        setReading(true);
        await speakEnglish(readIt);
        setReading(false);
      }
      if (gone.current || turn.current !== t) return;
      if (s.cue) {
        const id = `b${++bubbleSeq}`;
        t.cueBubble = id;
        audio.current.set(id, []);
        upsert({ id, stepId: s.id, who: s.cue.who, thai: s.cue.thai, roman: s.cue.roman, en: s.cue.en, meaning: sh.meaning, tones: s.cue.tones, unchecked: unchecked(s.lineId) });
      } else {
        t.cueEnd = Date.now();
        startSlotTimer(t);
        if (eyesOff) void autoListen(t);
      }
      client.current?.sendDirective(directiveFor(s, { setup: VOICE_SETUP, instruction: sh.instruction }));
    } finally {
      advancing.current = false;
    }
  };

  const finish = (t: Turn, override?: Result) => {
    if (t.done) return;
    t.done = true;
    clearWait(t);
    if (slotTimer.current) clearTimeout(slotTimer.current);
    slotTimer.current = null;
    setTimer(null);
    setJudging(false);
    const r = runner.current!;
    const s = t.step;
    const result: Result = override ?? combineVerdict(t.model, t.heard, s.target.thai);
    const rec = toRecording(t.frames);
    const quick = quickTones(rec, s.target.tones, { midHz: settings.voiceMidHz, identity: settings.identity });
    const out = r.report(result, t.helped);
    saveWheels(store, r.wheels);
    const ms = t.talkStart != null && t.cueEnd != null ? Math.max(0, t.talkStart - t.cueEnd) : null;
    const moved = recordTurn(store, engine, {
      lineId: s.lineId, key: s.key, kind: s.kind, result, counted: out.counted, level: out.before, items: s.items,
      speech: out.before === 3 ? quick?.tone ?? null : null, ms, helped: t.helped,
    });
    if (result !== 'right') for (const id of moved.items) movedItems.current.add(id);
    if (result === 'skip') sys('Skipped.', s.id);
    else {
      const id = `b${++bubbleSeq}`;
      takes.current.set(id, t.frames);
      const score: SpeechScore | null = quick
        ? { overall: quick.tone, tones: quick.syllables.map((x) => x.score), pitch: quick.pitch, toneOnly: true, heard: quick.syllables.map((x) => x.heard), syllables: quick.syllables.map((x) => x.contour), reference: quick.syllables.map((x) => x.reference) }
        : null;
      upsert({ id, stepId: s.id, who: 'me', thai: s.target.thai, roman: s.target.roman, en: s.target.en, meaning: t.shown.meaning, result, counted: out.counted, tones: s.target.tones, score, overall: score?.overall ?? null, unchecked: unchecked(s.lineId) });
      // the full score (with the consonant and vowel check, when the server has one) arrives later
      if (rec) {
        void sound.score(rec, { thai: s.target.thai, roman: s.target.roman, tones: s.target.tones }).then((full) => {
          if (full && !gone.current) patch(id, { score: full, overall: full.overall });
        });
      }
      if (result !== 'right' && !t.helped) upsert({ id: `b${++bubbleSeq}`, stepId: s.id, who: 'answer', thai: s.target.thai, roman: s.target.roman, en: s.target.en, meaning: 'shown' });
    }
    tick((n) => n + 1);
    if (prefsRef.current.eyesOff && result !== 'skip' && VOICE_SETUP === 'B') {
      // eyes-off: say how it went, then the next step
      const said = result === 'right' ? 'Good.' : `${result === 'none' ? 'Nothing heard.' : 'Not quite.'} It was: ${s.target.en}`;
      setReading(true);
      void speakEnglish(said).then(() => {
        setReading(false);
        setTimeout(() => void advance(), 500);
      });
      return;
    }
    setTimeout(() => void advance(), result === 'right' ? 900 : 1900);
  };

  /** Eyes-off: open the mic once the tutor has finished, close it when you stop talking (or never start). */
  const autoListen = async (t: Turn) => {
    // let the tutor's voice finish playing, so the mic does not hear it
    for (let i = 0; i < 80 && speakingRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 250));
    if (gone.current || turn.current !== t || t.done || t.talking || t.spoke || !prefsRef.current.eyesOff) return;
    const started = Date.now();
    t.auto = { started, voiceAt: null, lastVoice: started, timer: null };
    await talk(true);
    if (!t.talking) {
      t.auto = undefined;
      return;
    }
    const a = t.auto;
    a.timer = setInterval(() => {
      const now = Date.now();
      const stop = !t.talking || (a.voiceAt != null ? now - a.lastVoice > END_PAUSE_MS : now - a.started > START_WAIT_MS) || now - a.started > MAX_TURN_MS;
      if (!stop) return;
      if (a.timer) clearInterval(a.timer);
      a.timer = null;
      if (t.talking) void talk(false);
    }, 100);
  };

  const settle = (t: Turn) => {
    if (t.done || t.heard === null) return;
    if (t.model !== null) return finish(t);
    clearWait(t);
    t.wait = setTimeout(() => finish(t), WAIT_TOOL_MS);
  };

  live.current = {
    toolCall: (name, args) => {
      const t = turn.current;
      if (name === 'flagUnsafe') {
        sys(`${TUTOR.name} kept to the lesson.`);
        return { ok: true, instruction: 'Do not continue that topic. Go back to the lesson and wait for the next instruction.' };
      }
      if (!t || t.done) return { ok: true, instruction: 'Wait for the next instruction.' };
      if (name === 'repeatAsked') {
        // the escape line is itself the answer in an escape step
        if (t.step.kind === 'escape') {
          t.model = 'right';
          settle(t);
          return { ok: true };
        }
        t.heard = null;
        t.model = null;
        t.spoke = false;
        clearWait(t);
        setJudging(false);
        sys(`${TUTOR.name} says it again.`, t.step.id);
        if (t.cueBubble) audio.current.set(t.cueBubble, []);
        return { ok: true, instruction: 'Say your last line again, then wait.' };
      }
      if (name === 'lineHeard') {
        const v = String(args.verdict ?? '') as Verdict;
        t.model = ['right', 'close', 'wrong', 'none'].includes(v) ? v : 'wrong';
        // the report came before the transcript: give the transcript a moment
        if (t.heard === null) {
          clearWait(t);
          t.wait = setTimeout(() => finish(t), WAIT_TOOL_MS);
        } else settle(t);
        return { ok: true, instruction: 'Say nothing. Wait for the next instruction.' };
      }
      return { ok: false, error: 'unknown tool' };
    },
    transcript: (text) => {
      const t = turn.current;
      if (!t || t.done || !t.spoke) return;
      t.heard = text;
      settle(t);
    },
    turnComplete: () => {
      const t = turn.current;
      if (!t || t.done || t.cueEnd != null || t.spoke) return;
      t.cueEnd = Date.now();
      startSlotTimer(t);
      if (prefsRef.current.eyesOff) void autoListen(t);
    },
    ended: (reason) => {
      if (gone.current || phase === 'done') return;
      if (reason === 'limit:session' || reason === 'stopped') return; // a fresh session opens before the next step
      setBanner((b) => b ?? 'The live session ended.');
    },
  };

  // ---------- controls ----------

  const begin = async () => {
    if (!lineIds.length) return;
    stopSpeaking();
    runner.current = new LessonRunner({
      file, lineIds, identity: settings.identity, they: prefs.they, wheels: loadWheels(store), minutes: plan.minutes, slots: plan.slots, tutor: TUTOR.name, startAt: plan.startAt,
    });
    setPhase('running');
    setBubbles([]);
    sys(`${TUTOR.name} is joining…`);
    try {
      await connect();
    } catch {
      setBanner('Live is not available right now. The map and line lists still work offline.');
      return;
    }
    void advance();
  };

  const end = () => {
    const r = runner.current;
    turn.current = null;
    setStep(null);
    setShown(null);
    client.current?.stop();
    client.current = null;
    stopSpeaking();
    if (!r) return;
    const results = r.lineResults().filter((x) => x.taught || x.right || x.misses);
    const last: LastLesson = { at: Date.now(), title: plan.title, results, missed: r.missedLineIds(), items: [...movedItems.current] };
    saveLast(store, last);
    setSummary(last);
    setPhase('done');
  };

  const talk = async (on: boolean) => {
    const t = turn.current;
    const c = client.current;
    if (!c || c.status !== 'live') return;
    if (on) {
      if (!t || t.done || reading || t.talking) return;
      t.talking = true;
      t.spoke = true;
      t.frames = [];
      t.heard = null;
      t.model = null;
      t.talkStart ??= Date.now();
      clearWait(t);
      if (slotTimer.current) clearTimeout(slotTimer.current);
      slotTimer.current = null;
      setTimer(null);
      setTalking(true);
      try {
        await c.talk(true);
      } catch {
        // no microphone: this press was not a turn
        t.talking = false;
        t.spoke = false;
        t.talkStart = null;
        setTalking(false);
        setBanner('The microphone is blocked. Allow it in the browser, then try again.');
      }
      return;
    }
    if (!t?.talking) return;
    t.talking = false;
    setTalking(false);
    await c.talk(false);
    setJudging(true);
    clearWait(t);
    t.wait = setTimeout(() => finish(t), WAIT_ANY_MS);
  };

  const skip = () => {
    const t = turn.current;
    if (!t || t.done) return;
    if (t.talking) void talk(false);
    finish(t, 'skip');
  };

  /** Hear the tutor's line again: from the audio already here, or ask again. */
  const repeat = (slower = false) => {
    const t = turn.current;
    if (!t || t.done || !t.step.cue) return;
    const chunks = t.cueBubble ? audio.current.get(t.cueBubble) ?? [] : [];
    if (!slower && chunks.length && client.current?.playChunks(chunks)) return;
    if (t.cueBubble) audio.current.set(t.cueBubble, []);
    client.current?.sendDirective(directiveFor(t.step, { setup: VOICE_SETUP, instruction: null, slower, again: true }));
  };

  const showAnswer = () => {
    const t = turn.current;
    if (!t || t.done || t.helped) return;
    t.helped = true;
    upsert({ id: `b${++bubbleSeq}`, stepId: t.step.id, who: 'answer', thai: t.step.target.thai, roman: t.step.target.roman, en: t.step.target.en, meaning: 'shown' });
  };

  const reveal = (b: Bubble) => {
    patch(b.id, { revealed: true });
    const t = turn.current;
    if (t && !t.done && t.step.id === b.stepId) t.helped = true;
  };

  const replay = (b: Bubble) => {
    if (b.who === 'me') {
      const f = takes.current.get(b.id);
      if (f?.length) playFrames(f);
      return;
    }
    const chunks = audio.current.get(b.id);
    if (chunks?.length) client.current?.playChunks(chunks);
  };

  const setReadAloud = (on: boolean) => {
    if (!on) stopSpeaking();
    setPrefs(savePrefs(store, { readAloud: on }));
  };
  const setEyesOff = (on: boolean) => {
    if (!on) stopSpeaking();
    setPrefs(savePrefs(store, { eyesOff: on }));
  };
  const setThey = (they: They) => setPrefs(savePrefs(store, { they }));

  const rerunMissed = () => {
    if (!summary?.missed.length) return;
    saveSession(store, { title: 'Missed lines', lineIds: summary.missed, minutes: plan.minutes, slots: false });
    // a new query opens a fresh lesson screen
    navigate(`/school/lesson?run=${Date.now().toString(36)}`, true);
  };

  useEffect(() => {
    gone.current = false;
    const offline = () => setBanner('You are offline. The lesson needs a connection.');
    window.addEventListener('offline', offline);
    return () => {
      gone.current = true;
      window.removeEventListener('offline', offline);
      if (slotTimer.current) clearTimeout(slotTimer.current);
      clearWait(turn.current);
      client.current?.stop();
      client.current = null;
      stopSpeaking();
    };
  }, []);

  // hold Space to talk; R repeat, A show answer, N skip
  useEffect(() => {
    if (phase !== 'running') return;
    const field = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return typeof el?.closest === 'function' && !!el.closest('input, textarea'); };
    const down = (e: KeyboardEvent) => {
      if (field(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) void talk(true);
      } else if (e.repeat) return;
      else if (k === 'r') repeat();
      else if (k === 'a') showAnswer();
      else if (k === 'n') skip();
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

  // eyes-off: keep the screen awake while the lesson runs
  useEffect(() => {
    if (phase !== 'running' || !prefs.eyesOff) return;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    let alive = true;
    const get = () => {
      nav.wakeLock?.request('screen').then((l) => {
        if (alive) wake.current = l;
        else void l.release();
      }).catch(() => undefined);
    };
    get();
    const vis = () => {
      if (document.visibilityState === 'visible') get();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', vis);
      void wake.current?.release().catch(() => undefined);
      wake.current = null;
    };
  }, [phase, prefs.eyesOff]);

  // the slot timer's bar
  useEffect(() => {
    if (!timer) return;
    const iv = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(iv);
  }, [timer]);

  // ---------- views ----------

  const top = <TopBar mid={SCHOOL.name} parent="/school" />;

  if (phase === 'done' && summary) return <Summary file={file} last={summary} onRerun={rerunMissed} top={top} identity={settings.identity} />;

  if (phase === 'ready') {
    return (
      <Screen top={top} narrow>
        <SchoolTitle sub={`${plan.title} · ${plan.minutes} min · ${TUTOR.name}`} />
        <ul className="sn-sum-list" style={{ marginTop: 20 }}>
          {lineIds.map((id) => {
            const l = index.get(id)!.line;
            return (
              <li key={id}>
                <span className="thai" lang="th">{l[settings.identity].thai}</span>
                <span className="small">{l.en}</span>
              </li>
            );
          })}
        </ul>
        {lineIds.length < plan.lineIds.length && <p className="small">Some lines are 18+ and the 18+ setting is off, so they are left out.</p>}
        {plan.startAt === 'branch' && <p className="small sn-door-note">Opened by its door phrase: Teach is marked done, so the lesson starts at the replies.</p>}
        <section className="card sn-setup" aria-label="Lesson settings">
          <div className="sn-field">
            <Label>They speak as</Label>
            <Seg label="They speak as" value={prefs.they} options={[{ v: 'f', label: 'Women' }, { v: 'm', label: 'Men' }, { v: 'mixed', label: 'Mixed' }]} onChange={setThey} />
          </div>
          <div className="sn-field">
            <Label>I speak as</Label>
            <span className="small">{settings.identity === 'm' ? 'A man (ครับ, ผม)' : 'A woman (ค่ะ, ฉัน)'} · <Link to="/settings">Settings</Link></span>
          </div>
          <div className="sn-switch">
            <span>
              <b>Read instructions aloud</b>
              <span className="small">{canSpeak() ? 'The phone reads the English; the mic is muted while it speaks.' : 'This browser has no voice to read with.'}</span>
            </span>
            <Toggle on={prefs.readAloud} onChange={setReadAloud} label="Read instructions aloud" />
          </div>
          <div className="sn-switch">
            <span>
              <b>Eyes-off</b>
              <span className="small">Everything is read aloud, the mic opens by itself after {TUTOR.name} and closes when you stop, and the screen stays on. For the phone face down.</span>
            </span>
            <Toggle on={prefs.eyesOff} onChange={setEyesOff} label="Eyes-off mode" />
          </div>
        </section>
        {!online && (
          <p className="small" role="status" style={{ color: 'var(--amber)' }}>
            {health === undefined ? 'Checking the live server…' : 'A lesson needs the live server (Settings → Talk live). The map and line lists work offline.'}
          </p>
        )}
        <div className="hrow wrap" style={{ gap: 10, marginTop: 8 }}>
          <button type="button" className="pill solid big" style={{ background: 'var(--violet)', borderColor: 'var(--violet)' }} disabled={!online || !lineIds.length} onClick={() => void begin()}>
            Start the lesson
          </button>
          <Link to="/school" className="pill big" style={{ textDecoration: 'none' }}>Map</Link>
        </div>
        <p className="small" style={{ maxWidth: '56ch' }}>
          {TUTOR.name} speaks Thai{VOICE_SETUP === 'A' ? ' and reads the English in a Thai accent' : ''}. Hold the mic (or Space) while you speak. Your pitch line is measured on this device against the line’s own tones, never by the tutor.
          {plan.minutes > 13 ? ' A live session lasts at most 15 minutes, so this lesson opens a second one partway through, between steps.' : ''}
        </p>
      </Screen>
    );
  }

  const r = runner.current;
  const done = r ? r.history.length - (step ? 1 : 0) : 0;
  const total = r ? done + (step ? 1 : 0) + r.left : 1;
  const isLive = status === 'live';
  const canTalk = isLive && !!step && !reading && !judging && !banner;
  const holdProps = {
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      void talk(true);
    },
    onPointerUp: () => void talk(false),
    onPointerCancel: () => void talk(false),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
  const timeLeft = timer ? Math.max(0, 1 - (Date.now() - timer.start) / timer.ms) : null;

  return (
    <Screen top={top} narrow>
      <div className="sn-lesson">
        <RunRail n={done} total={total} left={`${plan.title} · ${step ? KIND_LABEL[step.kind] : '…'}`} right={mock ? 'Practice server, no cost' : `${TUTOR.name} · Live`} />
        {banner && (
          <div className="live-banner" role="status">
            <span>{banner}</span>
            <span className="hrow" style={{ gap: 8 }}>
              <button type="button" className="pill small" onClick={() => { setBanner(null); runner.current?.requeue(); void advance(); }}>Try again</button>
              <button type="button" className="pill small solid" onClick={end}>End lesson</button>
            </span>
          </div>
        )}
        <div className="sn-log" ref={logRef} aria-live="polite">
          {bubbles.map((b) => (b.who === 'sys' ? <p key={b.id} className="sn-sys">{b.en}</p> : <BubbleView key={b.id} b={b} onReplay={() => replay(b)} onReveal={() => reveal(b)} />))}
          {status === 'reconnecting' && <p className="sn-sys">Reconnecting…</p>}
        </div>

        <div className="sn-pin" aria-live="polite">
          <span className="label">{reading ? 'Reading aloud · mic muted' : speaking ? `${TUTOR.name} is speaking` : judging ? 'Listening back…' : talking && prefs.eyesOff ? 'Listening · eyes-off' : step ? 'Your turn' : ' '}</span>
          {shown?.instruction ? <span className="h-s" lang={/[฀-๿]/.test(shown.instruction) ? 'th' : undefined}>{shown.instruction}</span> : <span className="h-s mut">{step ? ' ' : 'Done'}</span>}
          {timeLeft != null && <div className="meter" aria-label="Time to answer"><i style={{ width: `${timeLeft * 100}%` }} /></div>}
        </div>

        <button type="button" className={`sn-mic ${talking ? 'on' : ''}`} disabled={!canTalk && !talking} aria-pressed={talking} aria-label="Hold to talk" {...holdProps}>
          <span className="iconbtn" aria-hidden><MicIcon size={24} /></span>
          <span className="grow">
            <b>{talking ? (prefs.eyesOff ? 'Listening… stop talking to send' : 'Listening… let go to send') : reading ? 'Mic muted while the phone speaks' : prefs.eyesOff ? 'Eyes-off: the mic opens by itself' : 'Hold to talk'}</b>
            <span className="small">{prefs.eyesOff ? 'Or hold the button, or Space, to talk now.' : 'Hold the button or Space while you speak Thai.'}</span>
          </span>
        </button>

        <div className="sn-controls">
          <button type="button" className="pill small" onClick={skip} disabled={!step} title="Skip (N)">Skip</button>
          <button type="button" className="pill small" onClick={() => repeat()} disabled={!step?.cue || talking} title="Repeat (R)">Repeat</button>
          <button type="button" className="pill small" onClick={() => repeat(true)} disabled={!step?.cue || talking || !isLive} title="Slower">Slower</button>
          <button type="button" className="pill small" onClick={showAnswer} disabled={!step || talking} title="Show answer (A)">Show answer</button>
        </div>

        <div className="sn-run-foot">
          <span className="sn-mini-switch">
            <Toggle on={prefs.readAloud} onChange={setReadAloud} label="Read instructions aloud" />
            <span className="small">Read aloud</span>
          </span>
          <span className="sn-mini-switch">
            <Toggle on={prefs.eyesOff} onChange={setEyesOff} label="Eyes-off mode" />
            <span className="small">Eyes-off</span>
          </span>
          <button type="button" className="pill small" onClick={end}>End lesson</button>
        </div>
        <p className="small" style={{ margin: 0 }}>
          A turn counts as a review only once a line needs no English, and only if you did not reveal anything. {TUTOR.name} never judges your tones; the pitch line does.
        </p>
      </div>
    </Screen>
  );
}

const KIND_LABEL: Record<Step['kind'], string> = {
  teach: 'Teach', chunk: 'Teach · from the end', branch: 'Branches', escape: 'Escape line', slot: 'Slots', recall: 'Recall',
};

function BubbleView({ b, onReplay, onReveal }: { b: Bubble; onReplay: () => void; onReveal: () => void }) {
  const who = b.who === 'me' ? 'You' : b.who === 'answer' ? 'Answer' : b.who === 'tutor' ? TUTOR.name : 'They say';
  const cls = `sn-b ${b.who === 'answer' ? 'me hint' : b.who} ${b.who === 'me' ? (b.result === 'right' ? 'right' : 'miss') : ''}`;
  return (
    <div className={cls} role="button" tabIndex={0} onClick={onReplay} onKeyDown={(e) => e.key === 'Enter' && onReplay()} aria-label={`${who}: ${b.thai}. Tap to hear it again.`}>
      <div className="sn-who">{who}{b.unchecked ? <span className="sn-unchecked" title="Generated Thai: not built from the course" aria-label="unchecked" /> : null}</div>
      <div className="thai-m" lang="th">{b.thai}</div>
      <span className="roman">{b.roman}</span>
      {b.meaning === 'shown' || b.revealed ? (
        <div className="sn-en">{b.en}</div>
      ) : b.meaning === 'tap' ? (
        <button type="button" className="sn-tap" onClick={(e) => { e.stopPropagation(); onReveal(); }}>English</button>
      ) : null}
      {b.who === 'me' && (
        <>
          <div className={`sn-tag ${b.result === 'right' ? 'good' : 'bad'}`}>
            {b.result === 'right' ? 'Said it' : b.result === 'none' ? 'Nothing heard' : 'Not quite'}
            {b.overall != null ? ` · tones ${Math.round(b.overall * 100)}%` : ''}
            {b.counted ? ' · review' : ''}
          </div>
          {b.score && b.tones && <PitchCompare tones={b.tones} score={b.score} w={260} h={70} bare learnerColour="var(--violet)" />}
        </>
      )}
    </div>
  );
}

function Summary({ file, last, onRerun, top, identity }: { file: SchoolFile; last: LastLesson; onRerun: () => void; top: ReactNode; identity: 'm' | 'f' }) {
  const index = lineIndex(file);
  const got = last.results.filter(isGot);
  const missed = last.results.filter(isMissed);
  const toReviews = last.results.filter((r) => r.countedMisses > 0);
  const row = (id: string, note?: string) => {
    const l = index.get(id)?.line;
    if (!l) return null;
    return (
      <li key={id}>
        <span className="thai" lang="th">{l[identity].thai}</span>
        <span className="small">{l.en}{note ? ` · ${note}` : ''}</span>
      </li>
    );
  };
  return (
    <Screen top={top} narrow>
      <Label>After the lesson · {last.title}</Label>
      <h1 className="h-l" style={{ marginTop: 10 }}>{missed.length ? 'Done.' : got.length ? 'All got.' : 'Ended early.'}</h1>
      {!got.length && !missed.length && <p className="body" style={{ margin: '12px 0 0', maxWidth: '52ch' }}>No line was finished, so nothing changed. Start again from the map whenever you like.</p>}
      <div className="stats" style={{ margin: '20px 0 8px' }}>
        <div className="stat"><div className="label">Got</div><div className="v num">{got.length}</div></div>
        <div className="stat"><div className="label">Missed</div><div className="v num">{missed.length}</div></div>
        <div className="stat"><div className="label">To reviews</div><div className="v num">{toReviews.length}</div></div>
      </div>
      <div className="hrow wrap" style={{ gap: 10, margin: '8px 0 4px' }}>
        <button type="button" className="pill solid" style={{ background: 'var(--violet)', borderColor: 'var(--violet)' }} disabled={!missed.length} onClick={onRerun}>
          Rerun the missed lines
        </button>
        <Link to="/school" className="pill" style={{ textDecoration: 'none' }}>Map</Link>
        <Link to="/" className="pill" style={{ textDecoration: 'none' }}>Today</Link>
      </div>
      {got.length > 0 && (
        <section>
          <h2 className="h-s" style={{ margin: '24px 0 8px' }}>Got</h2>
          <ul className="sn-sum-list">{got.map((r) => row(r.lineId))}</ul>
        </section>
      )}
      {missed.length > 0 && (
        <section>
          <h2 className="h-s" style={{ margin: '24px 0 8px' }}>Missed</h2>
          <ul className="sn-sum-list">{missed.map((r) => row(r.lineId, r.misses ? `${r.misses} miss${r.misses === 1 ? '' : 'es'}` : 'not said yet'))}</ul>
        </section>
      )}
      <section>
        <h2 className="h-s" style={{ margin: '24px 0 8px' }}>Sent to reviews</h2>
        {toReviews.length ? (
          <ul className="sn-sum-list">{toReviews.map((r) => row(r.lineId, 'back soon'))}</ul>
        ) : (
          <p className="small" style={{ margin: 0 }}>Nothing. Lines go to reviews when you miss them once they need no English.</p>
        )}
        {last.items.length > 0 && (
          <p className="small">{last.items.length} word{last.items.length === 1 ? '' : 's'} from those lines also went back into your daily Review.</p>
        )}
        {missed.length > toReviews.length && (
          <p className="small">The other missed lines still have English help, so they stay in the School: “Pick for me” brings them back first.</p>
        )}
      </section>
    </Screen>
  );
}
