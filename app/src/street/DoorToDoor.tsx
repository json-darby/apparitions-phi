// Door to Door: the whole trip as one continuous chain. Hotel, taxi, food,
// market, pharmacy, and a night out if you want one. Three lives for the run;
// a wrong reply costs one, a checkpoint gives one back. Turning the English on
// counts as a hint; the final-test target is two hints or fewer per scene.
// Scored against your last attempt only. Replayable any time.
//
// Baht and reputation do not move here: this is a scored run, not the street.
//
// A stop whose scene the loaded course lacks is skipped (shown dimmed on the
// route); with no stop ready the chapter says so and plays nothing.

import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { Link } from '../app/router';
import { taskById, type StreetNode } from '../content/street-seed';
import type { Expression } from '../anim';
import { FullscreenButton, Label, Logo, StepRail } from '../ui/kit';
import { DialogueRun, type ChoiceResult, type Outcome } from './dialogue';
import { DialoguePanel } from './parts/DialoguePanel';
import { Face } from './parts/Face';
import { HudStat, Lives, NotReady, SequenceOverlay, placeColour, useStreet } from './parts/common';
import { clarityFor, doorStops, repOf, type DoorStopState } from './state';
import './street.css';

const HINT_TARGET = 2;
type Phase = 'map' | 'scene' | 'choice' | 'end';

export default function DoorToDoor() {
  const { device } = useDevice();
  const [street, update] = useStreet();
  const ch = street.chapters['door-to-door'] ?? {};
  const [runNo, setRunNo] = useState(0);
  const [phase, setPhase] = useState<Phase>('map');
  const [i, setI] = useState(0);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [hints, setHints] = useState<Record<string, number>>({});
  const [cleared, setCleared] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; prevLast: number | null; prevBest: number } | null>(null);
  const [walk, setWalk] = useState(false);
  const started = runNo > 0;
  const route = useMemo(() => doorStops(), []);
  const stops = useMemo(() => route.filter((d) => d.ready), [route]);

  const restart = () => {
    setRunNo((n) => n + 1);
    setPhase('scene');
    setI(0);
    setLives(3);
    setScore(0);
    setHints({});
    setCleared([]);
    setResult(null);
  };

  const endRun = (ok: boolean, finalScore: number, finalHints: Record<string, number>) => {
    setResult({ ok, prevLast: ch.last ?? null, prevBest: ch.best ?? 0 });
    update((s) => {
      const prev = s.chapters['door-to-door'] ?? {};
      return {
        ...s,
        chapters: {
          ...s.chapters,
          'door-to-door': { ...prev, best: Math.max(prev.best ?? 0, finalScore), last: finalScore, runs: (prev.runs ?? 0) + 1, hints: finalHints, done: prev.done || ok },
        },
      };
    });
    setPhase('end');
    if (!ok) setWalk(true);
  };

  const sceneDone = (gained: number, sceneHints: number) => {
    const stop = stops[i];
    const h = { ...hints, [stop.task]: sceneHints };
    const total = score + gained + (sceneHints <= HINT_TARGET ? 200 : 0);
    setHints(h);
    setScore(total);
    setCleared((c) => [...c, stop.task]);
    if (stop.checkpoint) setLives((l) => Math.min(3, l + 1));
    const next = i + 1;
    if (next >= stops.length) return endRun(true, total, h);
    setI(next);
    setPhase(stops[next].optional ? 'choice' : 'map');
  };

  const loseLife = (gainedSoFar: number) => {
    const l = lives - 1;
    setLives(l);
    if (l <= 0) endRun(false, score + gainedSoFar, hints);
  };

  if (!stops.length) return <NotReady chapter="Door to Door" />;

  const stop = stops[i];
  const map = (
    <RouteMap route={route} current={started && phase !== 'end' ? stop.task : null} cleared={cleared} />
  );

  const intro = (
    <div className="stack gap-4">
      <Label>{started ? `Next: ${stop.label}` : 'The whole trip'}</Label>
      {phase === 'choice' ? (
        <>
          <h2 className="h-m">One more stop?</h2>
          <p className="body" style={{ margin: 0 }}>The night out is optional. Finish here and the run is scored as it stands.</p>
          <div className="hrow wrap">
            <button type="button" className="pill solid" onClick={() => setPhase('scene')}>Night out</button>
            <button type="button" className="pill" onClick={() => endRun(true, score, hints)}>Finish</button>
          </div>
        </>
      ) : (
        <>
          <p className="body" style={{ margin: 0, maxWidth: '50ch' }}>
            One scene per stop. A wrong reply costs a life; a checkpoint gives one back. Turning the English on is a hint. Aim for two or fewer per scene.
          </p>
          <p className="small" style={{ margin: 0 }}>
            {ch.last != null ? `Last attempt ${ch.last.toLocaleString()} · best ${(ch.best ?? 0).toLocaleString()}` : 'No attempt yet.'}
          </p>
          <div>
            <button type="button" className="pill solid big" onClick={() => (started ? setPhase('scene') : restart())}>
              {started ? 'Start' : 'Start the run'}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const hud = (
    <div className="game-hud d2d-hud">
      <HudStat label="Score" value={score.toLocaleString()} />
      <HudStat label="Run" value={(ch.runs ?? 0) + (phase === 'end' ? 0 : 1)} align="center" />
      <div className="street-stat" style={{ textAlign: 'right' }}>
        <div className="label">Lives</div>
        <div style={{ marginTop: 10 }}><Lives n={lives} /></div>
      </div>
    </div>
  );

  const endView = result && (
    <div className="stack gap-4 fade-in">
      <Label>{result.ok ? 'Run complete' : 'Out of lives'}</Label>
      <h2 className="h-l">{score.toLocaleString()}</h2>
      <p className="body" style={{ margin: 0 }}>
        {result.prevLast == null
          ? 'Your first run. Next time you play against this.'
          : score > result.prevLast
            ? `Up ${(score - result.prevLast).toLocaleString()} on your last attempt.`
            : score === result.prevLast
              ? 'Level with your last attempt.'
              : `Down ${(result.prevLast - score).toLocaleString()} on your last attempt.`}
        {score > result.prevBest ? ' A new best.' : ''}
      </p>
      <div className="stack gap-1">
        {stops.filter((d) => hints[d.task] != null).map((d) => (
          <div key={d.task} className="hrow between small">
            <span>{d.label}</span>
            <span className={hints[d.task] <= HINT_TARGET ? 'good' : 'bad'}>{hints[d.task]} hint{hints[d.task] === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
      <div className="hrow wrap">
        <button type="button" className="pill solid" onClick={restart}>Run it again</button>
        <Link to="/street" className="pill">Street</Link>
      </div>
    </div>
  );

  const scene = phase === 'scene' && (
    <Scene key={`${runNo}-${i}`} taskId={stop.task} lives={lives} onLose={loseLife} onDone={sceneDone} />
  );

  const right = phase === 'end' ? endView : phase === 'scene' ? scene : intro;

  return (
    <div className="screen">
      <div className="topbar">
        {device !== 'desktop' ? <Logo /> : <span />}
        <div className="mid label fg">Door to Door · Campaign</div>
        <div className="right">
          {device !== 'desktop' && <FullscreenButton />}
          <Link to="/street" className="pill small">Leave</Link>
        </div>
      </div>
      <div className={device === 'phone' ? 'stage' : 'stage narrow'}>
        {device === 'phone' ? (
          <>
            {hud}
            {phase === 'scene' ? scene : (
              <>
                {map}
                {right}
              </>
            )}
          </>
        ) : (
          <>
            {/* tablet and desktop: named like the other chapters, the score across the top, the route beside what comes next */}
            {phase !== 'scene' && (
              <div className="d2d-head">
                <Label className="lead-label">Street chapter · Campaign</Label>
                <h1 className="h-l">Door to Door</h1>
              </div>
            )}
            {phase !== 'scene' && hud}
            <div className={`d2d ${phase === 'scene' ? 'playing' : ''}`}>
              <div>
                {phase === 'scene' && hud}
                {map}
              </div>
              <div style={{ minWidth: 0 }}>{right}</div>
            </div>
          </>
        )}
      </div>
      {walk && <SequenceOverlay name="walkaway" caption="Out of lives. The trip ends here, for now." onDone={() => setWalk(false)} />}
    </div>
  );
}

/** The whole route. Stops the course cannot play yet are dimmed and left out of the numbering. */
function RouteMap({ route, current, cleared }: { route: DoorStopState[]; current: string | null; cleared: string[] }) {
  const numbers = new Map<string, number>();
  for (const d of route) if (d.ready && !d.optional) numbers.set(d.task, numbers.size + 1);
  return (
    <div className="d2d-map" role="list" aria-label="Route">
      {route.map((d) => {
        const done = cleared.includes(d.task);
        const now = d.task === current;
        return (
          <div key={d.task} role="listitem" className={`d2d-stop ${done ? 'done' : ''} ${now ? 'now' : ''} ${d.ready ? '' : 'off'}`}>
            <span className="dot" aria-hidden>{done ? '✓' : !d.ready ? '–' : d.optional ? '·' : numbers.get(d.task)}</span>
            <span>
              <b>{d.label}</b>
              <span className="small">{!d.ready ? 'Not ready yet' : d.checkpoint ? 'Checkpoint · +1 life' : d.optional ? 'Optional' : ' '}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Scene({ taskId, lives, onLose, onDone }: { taskId: string; lives: number; onLose: (gained: number) => void; onDone: (gained: number, hints: number) => void }) {
  const { engine, settings, content } = useApp();
  const [street] = useStreet();
  const task = useMemo(() => taskById(taskId, settings.identity)!, [taskId, settings.identity]);
  const [run] = useState(() => new DialogueRun(task, engine, { patience: Infinity }));
  const [t0] = useState(() => Date.now());
  const [gained, setGained] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [node, setNode] = useState<StreetNode | null>(null);
  const [expr, setExpr] = useState<Expression>('neutral');
  const [, force] = useState(0);
  const colour = placeColour(task.place);
  const person = content.person(task.person)!;

  const onResult = (r: ChoiceResult) => {
    setExpr(r.expression);
    force((n) => n + 1);
    if (!r.correct) onLose(gained);
    else if (r.first && r.test) setGained((g) => g + 100);
  };
  const onEnd = (o: Outcome) => {
    if (o !== 'done' || lives <= 0) return;
    const secs = (Date.now() - t0) / 1000;
    onDone(gained + Math.max(0, Math.round(300 - secs * 8)), run.hints);
  };

  return (
    <div className="stack gap-4">
      <div style={{ position: 'relative', minHeight: 200 }}>
        <Face who={task.person} colour={colour} clarity={clarityFor(repOf(street, task.person))} speaking={speaking} tones={node?.tones} expression={expr} style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', left: 0, bottom: 0 }}>
          <Label>{task.title}</Label>
          <h2 className="h-l" style={{ marginTop: 4 }}>{person.name}</h2>
        </div>
      </div>
      <div className="hrow between wrap">
        <StepRail steps={task.steps} at={run.step} />
        <span className={`label ${run.hints > HINT_TARGET ? 'bad' : ''}`}>Hints {run.hints} · target {HINT_TARGET} or fewer</span>
      </div>
      <hr className="rule" />
      <DialoguePanel
        run={run}
        onResult={onResult}
        onEnd={onEnd}
        onSpeaking={setSpeaking}
        hintOnGloss
        onHint={() => force((k) => k + 1)}
        onNode={(n) => {
          setNode(n);
          setExpr(n.expression ?? 'neutral');
          force((k) => k + 1);
        }}
        beat={800}
      />
    </div>
  );
}
