// The frame every drill runs in: intro with tier choice, the round with HUD
// and pause, and the results. The drill itself only draws the game and calls
// answer() for each decision.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { back } from '../../app/router';
import type { Answer } from '../../engine/engine';
import type { GameItem } from '../../engine/engine';
import type { DrillId } from '../../path/pathway';
import { useKeys } from '../../input/keys';
import { Dots, KeyHints, Label, Note } from '../../ui/kit';
import { FitText } from '../../ui/FitText';
import { Link } from '../../app/router';
import { HitBurstLayer, type HitBurstHandle } from '../../anim';
import { Pace, TIER_INFO, applyRun, loadRecord, saveRecord, type Tier } from './drill';

export interface DrillRunApi {
  tier: Tier;
  pace: Pace;
  paused: boolean;
  items: GameItem[];
  /**
   * Report one decision. counts=false when it could be answered without
   * understanding the Thai (it is logged, not scheduled).
   */
  answer(a: Omit<Answer, 'source'> & { points?: number }): void;
  loseLife(): void;
  addScore(n: number): void;
  end(): void;
  burst: HitBurstHandle | null;
  /** seconds left in the round */
  timeLeft: number;
}

export interface DrillShellProps {
  id: DrillId;
  title: string;
  tag: string;
  howTo: string;
  /** one line per device kind */
  controls: { touch: string; keys: [string, string][] };
  /** what to ask the engine for */
  request: (tier: Tier) => Parameters<ReturnType<typeof useApp>['engine']['forGame']>[0];
  minItems?: number;
  seconds?: number;
  lives?: number;
  /** this drill's own words for each tier, where the shared ones do not fit */
  tierNotes?: Partial<Record<Tier, string>>;
  /** extra panel content during play on tablet and desktop */
  side?: (api: DrillRunApi) => ReactNode;
  children: (api: DrillRunApi) => ReactNode;
}

export function DrillShell(p: DrillShellProps) {
  const { engine, store, sound } = useApp();
  const { device } = useDevice();
  const [phase, setPhase] = useState<'intro' | 'play' | 'done'>('intro');
  const [record, setRecord] = useState(() => loadRecord(store, p.id));
  const [tier, setTier] = useState<Tier>(record.unlocked);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(p.lives ?? 3);
  const [paused, setPaused] = useState(false);
  const [timeLeft, setTimeLeft] = useState(p.seconds ?? 180);
  const [run, setRun] = useState(0);
  const answers = useRef<boolean[]>([]);
  const counted = useRef(0);
  const pace = useMemo(() => new Pace(tier), [tier, run]);
  const burst = useRef<HitBurstHandle>(null);
  const [unlockedNow, setUnlockedNow] = useState<Tier | null>(null);

  const items = useMemo(() => engine.forGame(p.request(tier)), [engine, tier, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const enough = items.length >= (p.minItems ?? 4);

  const end = useCallback(() => {
    setPhase((ph) => {
      if (ph !== 'play') return ph;
      const { record: r, unlockedNow: u } = applyRun(loadRecord(store, p.id), tier, answers.current, scoreRef.current);
      saveRecord(store, p.id, r);
      setRecord(r);
      setUnlockedNow(u);
      return 'done';
    });
  }, [store, p.id, tier]);
  const scoreRef = useRef(0);
  scoreRef.current = score;

  // a hidden tab pauses the round (games run on animation frames, which stop when hidden)
  useEffect(() => {
    if (phase !== 'play') return;
    const on = () => {
      if (document.visibilityState === 'hidden') setPaused(true);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [phase]);

  // round clock
  useEffect(() => {
    if (phase !== 'play' || paused) return;
    const iv = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(iv);
  }, [phase, paused]);
  useEffect(() => {
    if (phase === 'play' && (timeLeft <= 0 || lives <= 0)) end();
  }, [timeLeft, lives, phase, end]);

  const start = () => {
    answers.current = [];
    counted.current = 0;
    setScore(0);
    setLives(p.lives ?? 3);
    setTimeLeft(p.seconds ?? 180);
    setPaused(false);
    setUnlockedNow(null);
    setRun((r) => r + 1);
    setPhase('play');
  };

  const api: DrillRunApi = {
    tier, pace, paused, items, timeLeft,
    get burst() {
      return burst.current;
    },
    answer: ({ points, ...a }) => {
      const res = engine.report({ ...a, source: `drill:${p.id}` });
      if (res.counted) counted.current++;
      if (a.correct != null) {
        answers.current.push(a.correct);
        pace.record(a.correct);
        if (a.correct) setScore((s) => s + (points ?? 10));
      }
    },
    loseLife: () => setLives((l) => l - 1),
    addScore: (n) => setScore((s) => s + n),
    end,
  };

  useKeys((a) => {
    if (phase === 'intro' && a.type === 'confirm' && enough) {
      start();
      return true;
    }
    // Escape on the record sheet skips the recording; it must not also pause
    if (phase === 'play' && a.type === 'back' && !sound.getState().recording) {
      setPaused((x) => !x);
      return true;
    }
    if (phase === 'done' && a.type === 'confirm') {
      start();
      return true;
    }
  });

  const hud = (
    <div className="game-hud">
      <div>
        <Label>Score</Label>
        <div className="v num">{score.toLocaleString('en-GB')}</div>
      </div>
      <div className="center">
        <Label>Time</Label>
        <div className="v num">
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <Label>Lives</Label>
        <div style={{ marginTop: 10 }}>
          <Dots n={lives} of={p.lives ?? 3} />
        </div>
      </div>
    </div>
  );

  const top = (
    <header className="topbar">
      {device !== 'desktop' ? <span className="logo">APPARITIONS: PHI</span> : <span />}
      <div className="mid label fg">
        {p.title} · {p.tag}
      </div>
      <div className="right">
        {phase === 'play' ? (
          <button className="pill small" style={{ minWidth: 96 }} onClick={() => setPaused((x) => !x)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        ) : (
          <button className="pill small" style={{ minWidth: 96 }} onClick={() => back('/')}>Back</button>
        )}
      </div>
    </header>
  );

  if (phase === 'intro')
    return (
      <div className="screen">
        {top}
        <div className="stage narrow" style={{ paddingTop: 12 }}>
          <Label>Drill · {p.tag}</Label>
          <FitText as="h1" className="h-xl" min={30} style={{ margin: '10px 0 18px' }}>{p.title}</FitText>
          <p className="body" style={{ maxWidth: '50ch', margin: 0 }}>{p.howTo}</p>
          <p className="small" style={{ marginTop: 10 }}>{device === 'desktop' ? 'Keys below.' : p.controls.touch}</p>
          <KeyHints hints={p.controls.keys} />
          <div className="stack gap-2" style={{ margin: '28px 0' }}>
            {([1, 2, 3, 4] as Tier[]).map((t) => (
              <button key={t} className="row" disabled={t > record.unlocked} onClick={() => setTier(t)} aria-pressed={tier === t}>
                <span className="hrow">
                  <span className={`radio ${tier === t ? 'on' : ''}`}><i /></span>
                  {TIER_INFO[t].name} <span className="small">{p.tierNotes?.[t] ?? TIER_INFO[t].note}</span>
                </span>
                <span className="row-right">{t > record.unlocked ? 'Locked' : record.best[t] ? `Best ${record.best[t]}` : ''}</span>
              </button>
            ))}
            <p className="small" style={{ margin: 0 }}>The next tier opens at 85% over 30 answers. Speed adapts to keep you near 80 to 85%.</p>
          </div>
          {enough ? (
            <button className="pill solid big wide" onClick={start}>Play</button>
          ) : (
            <Note>
              This drill uses only items you have already met. Meet a few more first. <Link to="/new">New items</Link>
            </Note>
          )}
        </div>
      </div>
    );

  if (phase === 'done') {
    const n = answers.current.length;
    const acc = n ? answers.current.filter(Boolean).length / n : 0;
    return (
      <div className="screen">
        {top}
        <div className="stage narrow fade-in" style={{ paddingTop: 12 }}>
          <Label>{p.title} · {TIER_INFO[tier].name}</Label>
          <h1 className="h-xl num" style={{ margin: '10px 0 24px' }}>{score.toLocaleString('en-GB')}</h1>
          <div className="stats">
            <div className="stat"><div className="label">Accuracy</div><div className="v num">{Math.round(acc * 100)}%</div></div>
            <div className="stat"><div className="label">Answers</div><div className="v num">{n}</div></div>
            <div className="stat"><div className="label">Reviews logged</div><div className="v num">{counted.current}</div></div>
          </div>
          {unlockedNow && <p className="body" style={{ marginTop: 20 }}>{TIER_INFO[unlockedNow].name} is open: {TIER_INFO[unlockedNow].note.toLowerCase()}.</p>}
          <p className="small" style={{ marginTop: 16 }}>Best at this tier: {record.best[tier] ?? score}</p>
          <div className="hrow" style={{ marginTop: 28 }}>
            <button className="pill" onClick={() => back('/')}>Done</button>
            <button className="pill solid grow" onClick={start}>Again</button>
          </div>
        </div>
      </div>
    );
  }

  const side = p.side && device !== 'phone' ? p.side(api) : null;
  return (
    <div className="screen" style={{ height: '100dvh' }}>
      {top}
      {hud}
      <div className={`screen-body ${side ? 'has-panel' : ''}`} style={{ flex: 1, minHeight: 0 }}>
        <div className="game-surface" key={run}>
          {p.children(api)}
          <HitBurstLayer ref={burst} />
          {paused && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,5,.86)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
              <div className="stack gap-3 center">
                <h2 className="h-l">Paused</h2>
                <button className="pill solid" onClick={() => setPaused(false)}>Resume</button>
                <button className="pill" onClick={end}>End round</button>
              </div>
            </div>
          )}
        </div>
        {side && <aside className="panel">{side}</aside>}
      </div>
    </div>
  );
}
