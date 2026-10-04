// The Street: one night street, side-on. Six places with Thai signs, the people
// who work there (faint until you know them), and you. Phone: stick plus Talk
// and Read sign. Tablet: a wider street. Desktop: the widest view, WASD or
// arrows to walk, E to talk, R to read a sign, and a task panel.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Container, Graphics } from 'pixi.js';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { Link, navigate } from '../app/router';
import { StreetScene } from '../anim';
import { PLACES } from '../content/seed';
import { STREET_SIGNS, taskById, tasksFor, type StreetTaskBuilt } from '../content/street-seed';
import type { PlaceId } from '../content/types';
import { usePixi } from '../games/shared/pixi';
import { shuffle } from '../games/shared/drill';
import { useKeys } from '../input/keys';
import { KeyHints, Label, Logo, Row, Sheet } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { HudStat, placeColour, useStreet, useToast } from './parts/common';
import { dotFigure, hashStr, rng } from './parts/dots';
import { clarityFor, repOf, totalRep, updateStreet, REP_MAX } from './state';
import './street.css';

const BH = 600; // world units, baseline height
const W0 = 2300; // world width
const GROUND = 520;
const SPEED = 330; // units per second
const NEAR = 120;
const PERSON_DX = 70; // people stand a little right of their sign, so you do not stand on them

const ORDER = [...PLACES].sort((a, b) => a.x - b.x);
const placeX = (id: PlaceId) => PLACES.find((p) => p.id === id)!.x * W0;

export default function Street() {
  const { store, engine, settings, content } = useApp();
  const { device, touch } = useDevice();
  const [street] = useStreet();
  const day = engine.day();
  const tasks = useMemo(() => tasksFor(settings.identity).filter((t) => !t.chapter), [settings.identity]);
  const open = tasks.filter((t) => t.day <= day && (!t.adult || settings.adult));
  const next = open.find((t) => !street.done.includes(t.id)) ?? null;
  const [near, setNear] = useState<PlaceId | null>(null);
  const [toast, say] = useToast();
  const [sign, setSign] = useState<PlaceId | null>(null);

  const px = useRef((street.at ?? 0.03) * W0);
  const target = useRef<number | null>(null);
  const keys = useRef({ left: false, right: false });
  const stick = useRef(0);
  const nearRef = useRef<PlaceId | null>(null);
  const worldDom = useRef<HTMLDivElement>(null);
  const cam = useRef({ x: 0, s: 1 });

  // reputation snapshot for the figures (the street rebuilds on return from a talk)
  const reps = useMemo(() => Object.fromEntries(PLACES.map((p) => [p.id, repOf(street, p.person)])), [street]);

  const { host } = usePixi((app, el) => {
    const far = new Container();
    const world = new Container();
    app.stage.addChild(far, world);

    // far: dark buildings with a few lit windows, moving at half speed
    const r = rng(7);
    const fb = new Graphics();
    for (let x = -200; x < W0 * 0.6 + 1400; x += 60 + r() * 90) {
      const w = 50 + r() * 110;
      const h = 160 + r() * 260;
      fb.rect(x, GROUND - 80 - h, w, h).fill({ color: '#0b0b12', alpha: 0.9 });
      for (let k = 0; k < 6; k++) {
        if (r() < 0.5) continue;
        fb.rect(x + 8 + r() * (w - 16), GROUND - 80 - h + 10 + r() * (h - 30), 3, 4).fill({ color: r() < 0.5 ? '#FFB03A' : '#2E9BFF', alpha: 0.25 + r() * 0.35 });
      }
    }
    far.addChild(fb);

    // floor
    const floor = new Graphics();
    floor.rect(-400, GROUND, W0 + 800, BH - GROUND + 200).fill({ color: '#07070a' });
    floor.moveTo(-400, GROUND).lineTo(W0 + 400, GROUND).stroke({ color: '#ffffff', alpha: 0.18, width: 1 });
    for (let i = 1; i < 6; i++) {
      const y = GROUND + i * i * 5;
      floor.moveTo(-400, y).lineTo(W0 + 400, y).stroke({ color: '#ffffff', alpha: 0.05, width: 1 });
    }
    world.addChild(floor);

    // each place: light falling from the sign, a pool on the floor, the person
    const people: { c: Container; seed: number }[] = [];
    for (const p of PLACES) {
      const x = p.x * W0;
      const col = placeColour(p.id);
      const light = new Graphics();
      light.poly([x - 90, 112, x + 90, 112, x + 150, GROUND, x - 150, GROUND]).fill({ color: col, alpha: 0.07 });
      light.poly([x - 60, 112, x + 60, 112, x + 90, GROUND, x - 90, GROUND]).fill({ color: col, alpha: 0.06 });
      light.ellipse(x, GROUND + 26, 190, 26).fill({ color: col, alpha: 0.1 });
      light.blendMode = 'add';
      world.addChild(light);
      const seed = hashStr(p.person);
      const fig = dotFigure({ colour: col, clarity: clarityFor(reps[p.id] ?? 0), seed, height: 240, build: p.person === 'lek' || p.person === 'ton' || p.person === 'bank' ? 1.08 : 0.94 });
      fig.x = x + PERSON_DX;
      fig.y = GROUND + 6;
      world.addChild(fig);
      people.push({ c: fig, seed });
    }
    // a second figure at the bar: Bank beside Fah
    {
      const x = placeX('bar') + PERSON_DX + 78;
      const fig = dotFigure({ colour: placeColour('bar'), clarity: clarityFor(repOf(street, 'bank')), seed: hashStr('bank'), height: 236, build: 1.08 });
      fig.x = x;
      fig.y = GROUND + 2;
      fig.alpha = 0.85;
      world.addChild(fig);
      people.push({ c: fig, seed: 99 });
    }

    // you
    const you = dotFigure({ colour: '#E8E8E8', clarity: 1, seed: 1234, height: 230 });
    const ring = new Graphics().ellipse(0, 0, 40, 9).stroke({ color: '#ffffff', alpha: 0.8, width: 2 });
    ring.y = GROUND + 34;
    world.addChild(ring, you);

    let t = 0;
    let facing = 1;
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
      // input
      let dx = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0) + stick.current;
      if (dx !== 0) target.current = null;
      if (target.current != null) {
        const d = target.current - px.current;
        if (Math.abs(d) < 6) target.current = null;
        else dx = Math.sign(d);
      }
      dx = Math.max(-1, Math.min(1, dx));
      px.current = Math.max(60, Math.min(W0 - 60, px.current + dx * SPEED * dt));
      if (dx !== 0) facing = dx > 0 ? 1 : -1;

      // camera
      const H = app.screen.height;
      const W = app.screen.width;
      const s = H / BH;
      const view = W / s;
      let cx = view >= W0 ? (W0 - view) / 2 : Math.max(0, Math.min(W0 - view, px.current - view / 2));
      cx = Number.isFinite(cx) ? cx : 0;
      cam.current = { x: cx, s };
      world.scale.set(s);
      world.x = -cx * s;
      far.scale.set(s);
      far.x = -cx * s * 0.5;
      if (worldDom.current) worldDom.current.style.transform = `translate(${-cx * s}px, 0) scale(${s})`;

      // figures breathe
      for (const p of people) {
        p.c.scale.y = 1 + Math.sin(t * 1.4 + p.seed) * 0.008;
        p.c.alpha = 0.92 + Math.sin(t * 2.1 + p.seed) * 0.06;
      }
      you.x = px.current;
      you.y = GROUND + 30 - (dx !== 0 ? Math.abs(Math.sin(t * 9)) * 5 : 0);
      you.scale.x = facing;
      ring.x = px.current;
      if (worldDom.current) {
        const tag = worldDom.current.querySelector<HTMLElement>('.street-you');
        if (tag) tag.style.left = `${px.current}px`;
      }

      // who is near
      let best: PlaceId | null = null;
      let bd = NEAR;
      for (const p of PLACES) {
        const d = Math.abs(p.x * W0 - px.current);
        if (d < bd) {
          bd = d;
          best = p.id;
        }
      }
      if (best !== nearRef.current) {
        nearRef.current = best;
        setNear(best);
      }
    };
    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
    };
  }, []);

  // remember where you stood
  useEffect(
    () => () => {
      updateStreet(store, (s) => ({ ...s, at: px.current / W0 }));
    },
    [store],
  );

  const talk = () => {
    const at = nearRef.current;
    if (!at) {
      say('Walk up to someone first.');
      return;
    }
    const t = open.find((x) => x.place === at && !street.done.includes(x.id));
    const id = t ? t.id : `smalltalk-${at}`;
    // small talk needs its words in the loaded course
    if (!t && !taskById(id, settings.identity)) {
      say('Nobody has anything for you here today.');
      return;
    }
    navigate(`/street/talk/${id}`);
  };
  const read = () => {
    const at = nearRef.current;
    if (!at) {
      say('Stand under a sign to read it.');
      return;
    }
    setSign(at);
  };
  const walkTo = (id: PlaceId) => {
    target.current = placeX(id);
  };

  useKeys(
    (a) => {
      if (a.type === 'move' && a.dx !== 0) {
        keys.current[a.dx < 0 ? 'left' : 'right'] = a.down;
        return true;
      }
      if (a.type === 'talk' || a.type === 'confirm') {
        talk();
        return true;
      }
      if (a.type === 'key' && a.down && a.key.toLowerCase() === 'r') {
        read();
        return true;
      }
      if (a.type === 'back') {
        navigate('/');
        return true;
      }
    },
    !sign,
  );
  useEffect(() => {
    const up = () => (keys.current = { left: false, right: false });
    window.addEventListener('blur', up);
    return () => window.removeEventListener('blur', up);
  }, []);

  const onStagePointer = (e: RPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = cam.current.x + (e.clientX - rect.left) / cam.current.s;
    target.current = Math.max(60, Math.min(W0 - 60, x));
  };

  const nearPlace = near ? PLACES.find((p) => p.id === near)! : null;
  const placeDone = (id: PlaceId) => {
    const here = open.filter((t) => t.place === id);
    return here.length > 0 && here.every((t) => street.done.includes(t.id));
  };
  const nIndex = next ? open.indexOf(next) + 1 : open.length;

  const head = (
    <div className="street-head">
      <div className="topbar" style={{ paddingBottom: 0 }}>
        {device !== 'desktop' ? <Logo /> : <span />}
        <div className="mid label fg">The Street · Walk</div>
        <div className="right">
          <Link to="/" className="pill small">Leave</Link>
        </div>
      </div>
      <div className="street-hud">
        <HudStat label="Baht" value={`฿ ${street.baht}`} />
        <HudStat label="Day" value={day} align="center" />
        <HudStat label="Reputation" value={totalRep(street)} align="right" />
      </div>
      {/* one card size for every task (and for none): the street below never resizes */}
      <div className="task-card">
        <Label>{next ? `Task ${nIndex} of ${open.length}` : open.length ? `All ${open.length} open tasks done` : 'No tasks open yet'}</Label>
        <div className="t">
          <FitText as="span" min={12}>{next ? next.title : 'Nothing open. Talk to anyone, or come back tomorrow.'}</FitText>
          {next && <span className="rw">+฿{next.reward.baht} · +{next.reward.rep} rep</span>}
        </div>
        <button type="button" className={`small task-walk ${next ? '' : 'keep'}`} onClick={() => next && walkTo(next.place)} tabIndex={next ? 0 : -1} aria-hidden={!next}>
          <FitText as="span" min={10}>{next ? `${PLACES.find((p) => p.id === next.place)!.name}, with ${content.person(next.person)?.name}. Tap to walk there.` : ' '}</FitText>
        </button>
      </div>
      <div className="place-rail" role="group" aria-label="Places on the street">
        {ORDER.map((p) => (
          <button key={p.id} type="button" className={`${near === p.id ? 'on' : ''} ${placeDone(p.id) ? 'done' : ''}`} onClick={() => walkTo(p.id)} aria-label={`Walk to the ${p.name}`}>
            <i />
            {p.name.split(' ')[0]}
          </button>
        ))}
      </div>
    </div>
  );

  const stage = (
    <div className="street-stage" onPointerDown={onStagePointer}>
      <StreetScene place={near ?? 'street'} camera={px.current / W0} colour={near ? placeColour(near) : undefined} style={{ position: 'absolute', inset: 0 }} />
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div className="street-world" ref={worldDom} style={{ width: W0, height: BH }} aria-hidden>
        {PLACES.map((p) => {
          const x = p.x * W0;
          const col = placeColour(p.id);
          const person = content.person(p.person)!;
          const sub = content.item(STREET_SIGNS[p.id].item);
          return (
            <div key={p.id}>
              <div className="street-sign" lang="th" style={{ left: x, top: 34, color: col, borderColor: col }}>{p.thaiSign}</div>
              {sub && <div className="street-sub" lang="th" style={{ left: x - 100, top: 126, color: col, borderColor: col }}>{sub.thai}</div>}
              <div className="street-name" style={{ left: x + PERSON_DX, top: 240, color: col, opacity: 0.65 + clarityFor(reps[p.id]) * 0.35 }}>
                {person.name} · {person.role}
              </div>
              {near === p.id && (
                <div className="street-bubble" style={{ left: x + PERSON_DX, top: 186 }}>
                  <span lang="th">คุย</span> · Talk
                </div>
              )}
            </div>
          );
        })}
        <div className="street-you" style={{ left: px.current, top: 574 }}>YOU</div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <span className="sr-only" aria-live="polite">{nearPlace ? `You are at the ${nearPlace.name}.` : ''}</span>
    </div>
  );

  const controls = (
    <div className="street-controls">
      {touch || device !== 'desktop' ? <Stick onMove={(v) => (stick.current = v)} /> : null}
      <div className="hint">
        {device === 'desktop' && !touch ? (
          <KeyHints hints={[['A D', 'walk'], ['E', 'talk'], ['R', 'read sign'], ['Esc', 'leave']]} />
        ) : (
          // a fixed box: walking past a place changes the words, never the controls' height
          <FitText lines={0} min={10} valign="center">
            {nearPlace ? `At the ${nearPlace.name.toLowerCase()}. Talk, or read the sign.` : 'Walk the street. Talk to people, read the signs, finish tasks you would really face.'}
          </FitText>
        )}
      </div>
      <div className="btns">
        <button type="button" className="pill solid" onClick={talk} disabled={!near}>Talk</button>
        <button type="button" className="pill" onClick={read} disabled={!near}>Read sign</button>
      </div>
    </div>
  );

  return (
    <div className="street-view">
      <div className="street-col">
        {head}
        {stage}
        {controls}
      </div>
      {device === 'desktop' && <StreetPanel open={open} done={street.done} reps={street.rep} onWalk={walkTo} />}
      {sign && <SignCheck place={sign} onClose={() => setSign(null)} />}
    </div>
  );
}

function StreetPanel({ open, done, reps, onWalk }: { open: StreetTaskBuilt[]; done: string[]; reps: Record<string, number>; onWalk: (p: PlaceId) => void }) {
  const { content, settings } = useApp();
  return (
    <aside className="street-panel" aria-label="Tasks and people">
      <Label>Tasks open today</Label>
      {open.length === 0 && <p className="small">None yet.</p>}
      {open.map((t) => (
        <Row key={t.id} onClick={() => onWalk(t.place)} right={done.includes(t.id) ? 'Done' : content.person(t.person)?.name} done={done.includes(t.id)}>
          <span style={{ fontSize: 15 }}>{t.title}</span>
        </Row>
      ))}
      <Label>People</Label>
      {content.cast.filter((c) => c.place).map((c) => (
        <Row key={c.id} onClick={() => onWalk(c.place!)} right={`${Math.min(REP_MAX, reps[c.id] ?? 0)} / ${REP_MAX}`}>
          <span style={{ fontSize: 15 }}>{c.name} <span className="mut">· {c.role}</span></span>
        </Row>
      ))}
      <Label>Chapters</Label>
      <Row to="/street/meters-running" right="Taxi">Meter's Running</Row>
      <Row to="/street/after-hours" right={settings.adult ? '18+' : '18+ off'}>After Hours</Row>
      <Row to="/street/door-to-door" right="The trip">Door to Door</Row>
      <Row to="/cast" right="8 people">Cast</Row>
    </aside>
  );
}

/** A virtual stick: horizontal only, the street is side-on. */
function Stick({ onMove }: { onMove: (dx: number) => void }) {
  const [k, setK] = useState(0);
  const base = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const move = (e: RPointerEvent) => {
    const el = base.current;
    if (!el || id.current !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 10)));
    setK(v);
    onMove(Math.abs(v) < 0.15 ? 0 : v);
  };
  const end = () => {
    id.current = null;
    setK(0);
    onMove(0);
  };
  return (
    <div
      ref={base}
      className="stick"
      role="slider"
      aria-label="Walk"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Math.round(k * 10) / 10}
      onPointerDown={(e) => {
        e.stopPropagation();
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <i style={{ transform: `translateX(${k * 30}px)` }} />
    </div>
  );
}

/**
 * Read a sign: pick its meaning. The small sign is built from an item; if you
 * have met that item, the answer goes to the engine as a 'read' review. Signs
 * you have not met yet (or whose words the course lacks) fall back to the
 * place's name sign, which is practice only.
 */
function SignCheck({ place, onClose }: { place: PlaceId; onClose: () => void }) {
  const { engine, content } = useApp();
  const p = PLACES.find((x) => x.id === place)!;
  const itemId = STREET_SIGNS[place].item;
  const item = content.item(itemId);
  // wrong answers come from the other signs' items, where the course has them
  const others = useMemo(() => Object.values(STREET_SIGNS).map((s) => s.item).filter((id) => id !== itemId && !!content.item(id)), [content, itemId]);
  const useItem = !!item && others.length >= 2 && engine.isIntroduced(`item:${itemId}`);
  const t0 = useRef(Date.now());
  const q = useMemo(() => {
    if (useItem && item) {
      const picked = shuffle(others).slice(0, 3);
      return { thai: item.thai, roman: item.roman, answer: item.en, options: shuffle([item.en, ...picked.map((id) => content.item(id)!.en)]) };
    }
    const places = shuffle(PLACES.filter((x) => x.id !== place)).slice(0, 3);
    return { thai: p.thaiSign, roman: p.signRoman, answer: p.name, options: shuffle([p.name, ...places.map((x) => x.name)]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place]);
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = (o: string) => {
    if (chosen) return;
    setChosen(o);
    if (useItem) {
      const wrong = o !== q.answer ? others.find((id) => content.item(id)?.en === o) : undefined;
      engine.answer({
        ref: `item:${itemId}`, skill: 'read', source: 'street:sign', correct: o === q.answer, ms: Date.now() - t0.current,
        confusedWith: wrong ? `item:${wrong}` : undefined, data: { place },
      });
    }
  };
  useKeys((a) => {
    if (a.type === 'rate' && a.n <= q.options.length) {
      pick(q.options[a.n - 1]);
      return true;
    }
    if (chosen && (a.type === 'confirm' || a.type === 'talk')) {
      onClose();
      return true;
    }
  });
  const col = placeColour(place);
  return (
    <Sheet onClose={onClose} label="Read the sign">
      <div className="stack gap-4">
        <Label>Read the sign · {useItem ? 'counts as a review' : 'practice'}</Label>
        <div className="street-sign" lang="th" style={{ position: 'static', transform: 'none', alignSelf: 'flex-start', color: col, borderColor: col }}>{q.thai}</div>
        {/* the sign's reading and the verdict keep their places (hidden) until you answer */}
        <div className={`roman ${chosen ? '' : 'keep'}`} aria-hidden={!chosen}>{q.roman}</div>
        <div className="dlg-replies">
          {q.options.map((o, i) => (
            <button
              key={o}
              type="button"
              className={`dlg-reply ${chosen && o === q.answer ? 'right' : chosen === o ? 'wrong' : ''}`}
              onClick={() => pick(o)}
              disabled={!!chosen}
            >
              <span className="kbd">{i + 1}</span>
              <span className="grow" style={{ fontSize: 17, fontWeight: 500 }}>{o}</span>
            </button>
          ))}
        </div>
        <div className={`hrow between ${chosen ? '' : 'keep'}`} aria-hidden={!chosen}>
          <span className={chosen === q.answer ? 'good' : 'bad'}>{chosen ? (chosen === q.answer ? 'Right.' : `It says ${q.answer.toLowerCase()}.`) : ' '}</span>
          <button type="button" className="pill solid" onClick={onClose} tabIndex={chosen ? 0 : -1}>Done</button>
        </div>
      </div>
    </Sheet>
  );
}
