// Meter's Running: the taxi chapter. The driver glances back, there is a word
// about the fare (in part 2 he refuses the meter), then you steer by ear: he
// says the way in Thai and you turn before the junction. A seven-segment meter
// runs the whole time. You call the stop yourself by picking the right line.
//
// Counting: each steer is a 'hear' answer for the direction item (the cue is
// Thai only; no arrow lights until you have answered). The stop is a 'read'
// answer for "stop here". Items you have not met are logged, not scheduled.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Container, Graphics } from 'pixi.js';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { Link, useRoute } from '../app/router';
import { sayForm } from '../content/repo';
import { METERS_PARTS, taskById, type MeterPart } from '../content/street-seed';
import { PLACE_COLOURS } from '../content/types';
import { usePixi } from '../games/shared/pixi';
import { shuffle } from '../games/shared/drill';
import { useKeys } from '../input/keys';
import { FullscreenButton, KeyHints, Label, Logo, Note, Row } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { DialogueRun, type Outcome } from './dialogue';
import { DialoguePanel } from './parts/DialoguePanel';
import { Face } from './parts/Face';
import { HudStat, Lives, NotReady, SequenceOverlay, SevenSeg, useStreet } from './parts/common';
import { applyRun, clarityFor, meterItem, meterPartReady, repOf } from './state';
import './street.css';

type Dir = 'turn-left' | 'turn-right' | 'straight' | 'stop-here';
type Phase = 'pick' | 'glance' | 'talk' | 'drive' | 'end';
const TAXI = PLACE_COLOURS.taxi;
const AMBER = '#FFB03A';

export default function MetersRunning() {
  const { settings, content } = useApp();
  const { device } = useDevice();
  const route = useRoute();
  const q = Number(route.query.get('part'));
  const [street] = useStreet();
  const [part, setPart] = useState<MeterPart | null>(() => METERS_PARTS.find((p) => p.part === q) ?? null);
  const [phase, setPhase] = useState<Phase>(part ? 'glance' : 'pick');
  const [runKey, setRunKey] = useState(0);
  const ch = street.chapters['meters-running'] ?? {};
  // a part needs its talk in the loaded scripts and the direction words in the content
  const ready = (p: MeterPart) => meterPartReady(p, content);

  const start = (p: MeterPart) => {
    setPart(p);
    setPhase('glance');
    setRunKey((k) => k + 1);
  };
  const pick = () => {
    setPart(null);
    setPhase('pick');
  };

  if (part && phase !== 'pick' && !ready(part)) return <NotReady chapter="Meter's Running" onParts={pick} />;

  if (phase === 'pick' || !part)
    return (
      <div className="screen">
        <div className="topbar">
          <Logo />
          <div className="mid label fg">Meter's Running</div>
          <div className="right">
            {device !== 'desktop' && <FullscreenButton />}
            <Link to="/street" className="pill small">Back</Link>
          </div>
        </div>
        <div className="stage narrow">
          <Label>Street chapter · Taxi</Label>
          <h1 className="h-l" style={{ margin: '10px 0 12px' }}>Meter's Running</h1>
          <p className="body" style={{ maxWidth: '54ch', marginTop: 0 }}>
            The taxi chapter. Steer by ear while the fare runs. Best {ch.best ?? 0}. Parts stay open to replay.
          </p>
          {METERS_PARTS.map((p) => (
            <Row
              key={p.part}
              onClick={() => start(p)}
              disabled={!ready(p)}
              right={!ready(p) ? 'Not ready yet' : (ch.part ?? 0) >= p.part ? 'Replay' : `Day ${p.day}`}
              done={ready(p) && (ch.part ?? 0) >= p.part}
            >
              {p.title}
            </Row>
          ))}
          <p className="small" style={{ marginTop: 18 }}>
            Speaking: {settings.identity === 'm' ? 'male forms, ending ครับ' : 'female forms, ending ค่ะ / คะ'}.
          </p>
        </div>
      </div>
    );

  return <Ride key={runKey} part={part} phase={phase} setPhase={setPhase} onAgain={() => start(part)} onPick={() => setPhase('pick')} />;
}

interface Leg {
  dir: Dir;
  /** answer given, or null for a miss on time */
  answer?: Dir | null;
  correct?: boolean;
}

function Ride({ part, phase, setPhase, onAgain, onPick }: { part: MeterPart; phase: Phase; setPhase: (p: Phase) => void; onAgain: () => void; onPick: () => void }) {
  const { engine, settings, sound, content } = useApp();
  const { device, touch } = useDevice();
  const [street, update] = useStreet();
  const task = useMemo(() => taskById(part.task, settings.identity)!, [part.task, settings.identity]);
  const [run] = useState(() => new DialogueRun(task, engine));
  const [speaking, setSpeaking] = useState(false);
  const [legs, setLegs] = useState<Leg[]>(() => part.legs.map((l) => ({ dir: l.dir })));
  const [i, setI] = useState(0);
  const [lives, setLivesState] = useState(3);
  const livesRef = useRef(3);
  const setLives = (n: number) => {
    livesRef.current = n;
    setLivesState(n);
  };
  const [score, setScoreState] = useState(0);
  const scoreRef = useRef(0);
  const setScore = (f: (s: number) => number) => {
    scoreRef.current = f(scoreRef.current);
    setScoreState(scoreRef.current);
  };
  const [fare, setFare] = useState(35);
  const [flat, setFlat] = useState<number | null>(null);
  const [lit, setLit] = useState<{ dir: Dir; ok: boolean } | null>(null);
  const [talking, setTalking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; paid: number; best: boolean; prevBest: number } | null>(null);
  const legStart = useRef(0);
  const progress = useRef(0); // 0..1 toward the junction
  const steer = useRef(0); // -1 left, 1 right, for the road animation
  const answered = useRef(false);
  const replays = useRef(0);
  const ended = useRef(false);
  const leg = legs[i];

  // the word a direction is said with (course: ซ้าย / ขวา; seed: เลี้ยวซ้าย / เลี้ยวขวา)
  const dirItem = (dir: Dir) => meterItem(content, dir)!;
  // Ton says the word as its clip says it: a polite item with his ending, a bare word bare
  const driverLine = (dir: Dir) => {
    const it = dirItem(dir);
    return it.polite ? sayForm(it, 'm') : { thai: it.thai, roman: it.roman };
  };
  const sayLeg = (dir: Dir) => {
    const it = dirItem(dir);
    const l = driverLine(dir);
    setTalking(true);
    sound.play({ ref: `item:${it.id}`, thai: l.thai, roman: l.roman, tones: it.polite ? [...it.tones, 'high'] : it.tones, speaker: 'Ton', voice: 'm1' }).then(() => setTalking(false));
  };

  // ---- the talk before the drive ----
  const onTalkEnd = (o: Outcome) => {
    // part 2: took the flat fare, or never got the meter on: the drive goes on at a fixed price
    if (o === 'failed' && part.part === 2) setFlat(300);
    setPhase('drive');
  };

  // ---- driving ----
  useEffect(() => {
    if (phase !== 'drive' || !leg || ended.current) return;
    answered.current = false;
    progress.current = 0;
    steer.current = 0;
    setLit(null);
    legStart.current = Date.now();
    if (leg.dir !== 'stop-here') sayLeg(leg.dir);
    const window = part.window * 1000 * (leg.dir === 'stop-here' ? 1.8 : 1);
    const iv = setInterval(() => {
      const p = (Date.now() - legStart.current) / window;
      progress.current = Math.min(1, p);
      if (p >= 1 && !answered.current) {
        clearInterval(iv);
        answer(null);
      }
    }, 50);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, i]);

  // the meter ticks while you drive
  useEffect(() => {
    if (phase !== 'drive' || flat != null) return;
    const iv = setInterval(() => setFare((f) => f + 2), 1500);
    return () => clearInterval(iv);
  }, [phase, flat]);

  const answer = (a: Dir | null) => {
    if (answered.current || !leg || phase !== 'drive') return;
    answered.current = true;
    const ms = Date.now() - legStart.current;
    const ok = a === leg.dir;
    engine.answer({
      ref: `item:${dirItem(leg.dir).id}`, skill: leg.dir === 'stop-here' ? 'read' : 'hear', source: `street:${part.task}`,
      correct: ok, blank: a == null, ms, replays: replays.current,
      confusedWith: a && !ok ? `item:${dirItem(a).id}` : undefined, data: { leg: i, part: part.part },
    });
    replays.current = 0;
    setLegs((ls) => ls.map((l, k) => (k === i ? { ...l, answer: a, correct: ok } : l)));
    setLit({ dir: a ?? leg.dir, ok });
    steer.current = a === 'turn-left' ? -1 : a === 'turn-right' ? 1 : 0;
    let lv = livesRef.current;
    if (ok) setScore((s) => s + 100 + Math.max(0, Math.round((part.window * 1000 - ms) / 25)));
    else {
      lv = livesRef.current - 1;
      setLives(lv);
      if (flat == null) setFare((f) => f + 20);
    }
    setTimeout(() => {
      if (lv <= 0) finish(false);
      else if (i + 1 >= legs.length) finish(true);
      else setI(i + 1);
    }, 900);
  };

  const finish = (ok: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const ch = loadCh();
    const firstClear = ok && (ch.part ?? 0) < part.part;
    const paidFare = flat ?? fare;
    const final = scoreRef.current + (ok ? livesRef.current * 150 : 0);
    let paid = 0;
    update((s) => {
      // the fare comes out of your baht the first time you finish a part; replays are practice
      const res = applyRun(s, {
        taskId: part.task, person: 'ton', outcome: ok ? 'done' : 'failed',
        baht: firstClear ? -paidFare : 0, rep: run.rep, reward: task.reward,
      });
      paid = res.paid.baht;
      const prev = s.chapters['meters-running'] ?? {};
      res.state.chapters = {
        ...s.chapters,
        'meters-running': {
          ...prev,
          best: Math.max(prev.best ?? 0, final),
          last: final,
          runs: (prev.runs ?? 0) + 1,
          part: ok ? Math.max(prev.part ?? 0, part.part) : prev.part,
          done: (ok ? Math.max(prev.part ?? 0, part.part) : prev.part ?? 0) >= METERS_PARTS.length,
        },
      };
      return res.state;
    });
    setScore(() => final);
    setResult({ ok, paid, best: final > (ch.best ?? 0), prevBest: ch.best ?? 0 });
    setPhase('end');
  };
  const loadCh = () => street.chapters['meters-running'] ?? {};

  // keys: arrows steer; space replays
  useKeys(
    (a) => {
      if (phase !== 'drive' || !leg) return;
      if (leg.dir === 'stop-here') return;
      if (a.type === 'move' && a.down) {
        answer(a.dx < 0 ? 'turn-left' : a.dx > 0 ? 'turn-right' : a.dy < 0 ? 'straight' : 'stop-here');
        return true;
      }
      if (a.type === 'play') {
        replays.current++;
        sayLeg(leg.dir);
        return true;
      }
    },
    phase === 'drive',
  );

  // swipe on the road
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: RPointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY });
  const onUp = (e: RPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || phase !== 'drive' || leg?.dir === 'stop-here') return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 36) return;
    if (Math.abs(dx) > Math.abs(dy)) answer(dx < 0 ? 'turn-left' : 'turn-right');
    else answer(dy < 0 ? 'straight' : 'stop-here');
  };

  // ---- the road (Pixi) ----
  const { host } = usePixi((app, el) => {
    const sky = new Graphics();
    const road = new Graphics();
    const cross = new Graphics();
    const lights = new Container();
    const car = new Container();
    app.stage.addChild(sky, lights, road, cross, car);
    const body = new Graphics();
    body.roundRect(-62, -34, 124, 56, 14).fill({ color: TAXI });
    body.roundRect(-44, -58, 88, 30, 10).fill({ color: TAXI, alpha: 0.85 });
    body.roundRect(-36, -52, 72, 20, 6).fill({ color: '#050505', alpha: 0.85 });
    body.rect(-52, -20, 18, 8).fill({ color: '#FF3B3B' });
    body.rect(34, -20, 18, 8).fill({ color: '#FF3B3B' });
    body.roundRect(-24, -74, 48, 14, 3).fill({ color: '#F2F2F2' });
    body.rect(-14, 4, 28, 8).fill({ color: '#F2F2F2' });
    car.addChild(body);
    let t = 0;
    let carX = 0;
    const streaks: { x: number; side: number; colour: string; speed: number; h: number }[] = [];
    const cols = [AMBER, '#2E9BFF', '#FF3C96', AMBER];
    for (let k = 0; k < 18; k++) streaks.push({ x: Math.random(), side: k % 2 ? 1 : -1, colour: cols[k % 4], speed: 0.25 + Math.random() * 0.4, h: 0.2 + Math.random() * 0.5 });
    let lastW = 0;
    let lastH = 0;
    const tick = () => {
      if (el.clientWidth !== lastW || el.clientHeight !== lastH) {
        lastW = el.clientWidth;
        lastH = el.clientHeight;
        app.resize();
      }
      const dt = Math.min(0.05, app.ticker.deltaMS / 1000);
      t += dt;
      const W = app.screen.width;
      const H = app.screen.height;
      const hz = H * 0.3;
      const cx = W / 2 - steer.current * progress.current * W * 0.18;
      sky.clear();
      sky.rect(0, 0, W, hz).fill({ color: '#0a0910' });
      sky.rect(0, hz, W, H - hz).fill({ color: '#0c0c10' });
      // light streaks on both sides, moving outward
      lights.removeChildren();
      const lg = new Graphics();
      for (const s of streaks) {
        s.x = (s.x + s.speed * dt) % 1;
        const e = s.x * s.x;
        const x = cx + s.side * (40 + e * W * 0.7);
        const h = (20 + e * H * 0.9) * s.h;
        lg.rect(x - (3 + e * 14) / 2, hz - h * 0.6, 3 + e * 14, h).fill({ color: s.colour, alpha: 0.12 + e * 0.25 });
      }
      lg.blendMode = 'add';
      lights.addChild(lg);
      // road
      road.clear();
      const topW = W * 0.03;
      const botW = W * 0.95;
      road.poly([cx - topW, hz, cx + topW, hz, W / 2 + botW / 2, H, W / 2 - botW / 2, H]).fill({ color: '#121218' });
      road.moveTo(cx - topW, hz).lineTo(W / 2 - botW / 2, H).stroke({ color: AMBER, width: 3, alpha: 0.9 });
      road.moveTo(cx + topW, hz).lineTo(W / 2 + botW / 2, H).stroke({ color: AMBER, width: 3, alpha: 0.9 });
      // centre dashes, perspective
      for (let k = 0; k < 12; k++) {
        const z = ((k / 12 + t * 0.9) % 1);
        const z2 = Math.min(1, z + 0.035);
        const y1 = hz + (H - hz) * z * z;
        const y2 = hz + (H - hz) * z2 * z2;
        const x1 = cx + (W / 2 - cx) * z * z;
        const x2 = cx + (W / 2 - cx) * z2 * z2;
        road.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: '#E8E8E8', width: 1 + z * 6, alpha: 0.75 });
      }
      // the junction coming toward you
      cross.clear();
      const p = progress.current;
      if (p > 0) {
        const y = hz + (H - hz) * p * p;
        const band = 6 + p * p * 70;
        cross.rect(0, y - band, W, band).fill({ color: '#16161e' });
        cross.moveTo(0, y - band).lineTo(W, y - band).stroke({ color: AMBER, width: 1 + p * 2, alpha: 0.6 });
        cross.moveTo(0, y).lineTo(W, y).stroke({ color: AMBER, width: 1 + p * 2, alpha: 0.6 });
        for (let k = -3; k <= 3; k++) cross.circle(cx + k * (8 + p * 60), y - band - 6 - p * 14, 2 + p * 4).fill({ color: '#FF3B3B', alpha: 0.4 + p * 0.5 });
      }
      // the car
      carX += (W / 2 + steer.current * W * 0.12 - carX) * Math.min(1, dt * 4);
      car.x = carX || W / 2;
      car.y = H - 110 + Math.sin(t * 14) * 0.8;
      car.rotation = steer.current * 0.08;
      const sc = Math.min(1.2, W / 420);
      car.scale.set(sc);
    };
    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
    };
  }, []);

  // ---- the stop: pick the line ----
  const stopOptions = useMemo(() => {
    const ids: Dir[] = shuffle(['stop-here', 'straight', 'turn-left'] as Dir[]);
    return ids.map((id) => {
      const it = meterItem(content, id)!;
      return { id, ...sayForm(it.polite ? it : { ...it, polite: 'statement' }, settings.identity) };
    });
  }, [content, settings.identity]);

  const panel = (
    <aside className="mr-panel">
      <Label>Route</Label>
      <RouteMap legs={legs} at={i} />
      <SevenSeg value={flat ?? fare} label={flat != null ? 'Flat fare' : 'Fare'} />
      <p className="small" style={{ margin: 0 }}>
        The map fills in behind you. Ahead is by ear.
      </p>
      <KeyHints hints={[['← →', 'turn'], ['↑', 'straight on'], ['Space', 'hear again']]} />
    </aside>
  );

  const wide = device !== 'phone';
  return (
    <div className={`mr ${phase === 'drive' ? 'playing' : ''}`}>
      <div className="mr-col">
        <div className="topbar">
          <Logo />
          <div className="mid label fg">Meter's Running · {part.part === 1 ? 'Part 1' : 'Part 2'}</div>
          <div className="right">
            {device !== 'desktop' && <FullscreenButton />}
            <button type="button" className="pill small" onClick={onPick}>Parts</button>
          </div>
        </div>
        <div className="game-hud">
          <HudStat label="Score" value={score.toLocaleString()} />
          <HudStat label="Stop" value={`${Math.min(i + (phase === 'end' ? 1 : 0), legs.length)}/${legs.length}`} align="center" />
          <div className="street-stat" style={{ textAlign: 'right' }}>
            <div className="label">Lives</div>
            <div style={{ marginTop: 10 }}><Lives n={lives} /></div>
          </div>
        </div>

        {phase === 'talk' || phase === 'glance' ? (
          <div className="stage narrow" style={{ paddingTop: 16 }}>
            <div className="ah-face" style={{ minHeight: 220, position: 'relative' }}>
              <Face who="ton" colour={TAXI} clarity={clarityFor(repOf(street, 'ton'))} speaking={speaking} tones={run.current?.tones} style={{ position: 'absolute', inset: 0 }} />
            </div>
            <p className="body">{part.intro}</p>
            {phase === 'talk' && (
              <DialoguePanel run={run} onEnd={onTalkEnd} onSpeaking={setSpeaking} beat={900} />
            )}
            {task.note && phase === 'talk' && <Note>{task.note}</Note>}
          </div>
        ) : phase === 'end' && result ? (
          <div className="stage narrow" style={{ paddingTop: 24 }}>
            <h2 className="h-l">{result.ok ? 'You are there.' : 'Lost.'}</h2>
            <p className="body">
              {result.ok
                ? `Score ${score.toLocaleString()}${result.best ? ', a new best' : `. Best ${result.prevBest.toLocaleString()}`}.`
                : 'Three wrong turns. Ton drops you somewhere that is not your hotel.'}
            </p>
            <p className="small">
              {flat != null ? `Flat fare ฿${flat}.` : `Meter ฿${fare}.`} {result.paid ? `Paid ฿${Math.abs(result.paid)}.` : 'Replay: no baht changes hands.'}
            </p>
            <div className="stack gap-1" style={{ margin: '12px 0 20px' }}>
              {legs.map((l, k) => (
                <div key={k} className="hrow between small">
                  <span lang="th">{meterItem(content, l.dir)?.thai} <span className="mut">· {meterItem(content, l.dir)?.en}</span></span>
                  <span className={l.correct ? 'good' : 'bad'}>{l.correct ? 'Right' : l.answer === undefined ? '—' : 'Missed'}</span>
                </div>
              ))}
            </div>
            <div className="hrow wrap">
              <button type="button" className="pill solid" onClick={onAgain}>Drive again</button>
              <button type="button" className="pill" onClick={onPick}>Parts</button>
              <Link to="/street" className="pill">Street</Link>
            </div>
          </div>
        ) : null}

        <div className="mr-road" style={{ display: phase === 'drive' ? undefined : 'none' }} onPointerDown={onDown} onPointerUp={onUp}>
          <div ref={host} style={{ position: 'absolute', inset: 0 }} />
          <div className="mr-top">
            {leg && leg.dir !== 'stop-here' ? <span className="mr-cue" lang="th">{driverLine(leg.dir).thai}</span> : <span />}
            {!wide && <SevenSeg value={flat ?? fare} label={flat != null ? 'Flat' : 'Fare'} />}
          </div>
          {leg?.dir === 'stop-here' ? (
            <div className="mr-stop">
              <div className="street-sign" lang="th" style={{ position: 'static', transform: 'none', color: TAXI, borderColor: TAXI, alignSelf: 'center' }}>โรงแรม</div>
              <p className="small center" style={{ margin: 0 }}>Your hotel. Tell him.</p>
              <div className="dlg-replies">
                {stopOptions.map((o, k) => (
                  <button key={o.id} type="button" className={`dlg-reply ${lit && lit.dir === o.id ? (lit.ok ? 'right' : 'wrong') : ''}`} onClick={() => answer(o.id)} disabled={!!lit}>
                    <span className="kbd">{k + 1}</span>
                    <span className="grow">
                      <span className="thai-m" lang="th">{o.thai}</span>
                      <span className="roman">{o.roman}</span>
                    </span>
                  </button>
                ))}
              </div>
              <StopKeys n={stopOptions.length} onPick={(k) => answer(stopOptions[k].id)} enabled={!lit} />
            </div>
          ) : (
            <div className="mr-arrows">
              <button type="button" aria-label="Turn left" className={lit?.dir === 'turn-left' ? (lit.ok ? 'lit' : 'miss') : ''} onClick={() => answer('turn-left')}>←</button>
              <button type="button" aria-label="Straight on" className={lit?.dir === 'straight' ? (lit.ok ? 'lit' : 'miss') : ''} onClick={() => answer('straight')}>↑</button>
              <button type="button" aria-label="Turn right" className={lit?.dir === 'turn-right' ? (lit.ok ? 'lit' : 'miss') : ''} onClick={() => answer('turn-right')}>→</button>
            </div>
          )}
        </div>
        {phase === 'drive' && (
          <div className="mr-talking">
            <span className={`mr-wave ${talking ? 'on' : ''}`} aria-hidden>
              {[0, 1, 2, 3, 4, 5, 6].map((k) => <i key={k} style={{ animationDelay: `${k * 0.1}s` }} />)}
            </span>
            {/* one bar height: the words fit their lines, and Again keeps its place (hidden at the stop) */}
            <span className="grow" style={{ minWidth: 0 }}>
              <FitText as="b" className="mr-talk-title" min={11}>{talking ? 'Ton is talking' : leg?.dir === 'stop-here' ? 'Call the stop' : 'Steer before the junction'}</FitText>
              <FitText as="span" className="small" lines={2} min={10} valign="top">
                {touch ? 'Swipe or tap an arrow. Up is straight on.' : 'Arrow keys to steer, up for straight on. Space to hear it again.'}
              </FitText>
            </span>
            <button
              type="button"
              className={`pill small ${leg && leg.dir !== 'stop-here' ? '' : 'keep'}`}
              onClick={() => { if (leg && leg.dir !== 'stop-here') { replays.current++; sayLeg(leg.dir); } }}
              tabIndex={leg && leg.dir !== 'stop-here' ? 0 : -1}
              aria-hidden={!(leg && leg.dir !== 'stop-here')}
            >
              Again
            </button>
          </div>
        )}
      </div>
      {phase === 'drive' && wide && panel}
      {phase === 'glance' && (
        <SequenceOverlay name="glance" who="ton" colour={TAXI} onDone={() => setPhase('talk')} />
      )}
    </div>
  );
}

function StopKeys({ n, onPick, enabled }: { n: number; onPick: (k: number) => void; enabled: boolean }) {
  useKeys((a) => {
    if (a.type === 'rate' && a.n <= n) {
      onPick(a.n - 1);
      return true;
    }
  }, enabled);
  return null;
}

/** The route so far, drawn as you drive it. Legs ahead stay dark. */
function RouteMap({ legs, at }: { legs: Leg[]; at: number }) {
  const pts: [number, number][] = [[0, 0]];
  let hx = 0;
  let hy = -1;
  let x = 0;
  let y = 0;
  for (const l of legs) {
    if (l.dir === 'turn-left') [hx, hy] = [hy, -hx];
    else if (l.dir === 'turn-right') [hx, hy] = [-hy, hx];
    x += hx;
    y += hy;
    pts.push([x, y]);
  }
  // frame only what has been driven, so the map never hints at the way ahead
  const seen = pts.slice(0, Math.min(pts.length, at + 1));
  const xs = seen.map((p) => p[0]);
  const ys = seen.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 4);
  const minX = (Math.max(...xs) + Math.min(...xs)) / 2 - span / 2;
  const minY = (Math.max(...ys) + Math.min(...ys)) / 2 - span / 2;
  const P = (p: [number, number]) => [10 + ((p[0] - minX) / span) * 80, 10 + ((p[1] - minY) / span) * 80];
  const seg = (k: number) => {
    const [x1, y1] = P(pts[k]);
    const [x2, y2] = P(pts[k + 1]);
    const l = legs[k];
    const done = k < at || l.answer !== undefined;
    if (!done) return null;
    return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={l.correct ? '#E8E8E8' : '#FF5A4F'} strokeWidth={2.5} strokeLinecap="round" />;
  };
  const [cx, cy] = P(pts[Math.min(at, pts.length - 1)]);

  return (
    <svg className="mr-map" viewBox="0 0 100 100" role="img" aria-label={`Route, leg ${at + 1} of ${legs.length}`}>
      {legs.map((_, k) => seg(k))}
      <circle cx={cx} cy={cy} r={3.2} fill={TAXI} />
    </svg>
  );
}
