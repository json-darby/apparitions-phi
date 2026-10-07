// The Street: one night street, side-on, from the street photograph drawn in
// dots. Six places with Thai signs on their boards, the people who work there,
// and you, at life scale. Phone: stick plus Talk and Read sign. Tablet: a wider
// street. Desktop: the widest view, WASD or arrows to walk, E to talk, R to
// read a sign, and a task panel.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { Link, navigate } from '../app/router';
import { hexToRgb } from '../anim/core/math';
import { loadManifest, loadPair } from '../anim/packs';
import { CAST, PLACES } from '../content/seed';
import { STREET_SIGNS, taskById, tasksFor, type StreetTaskBuilt } from '../content/street-seed';
import type { PlaceId } from '../content/types';
import { shuffle } from '../games/shared/drill';
import { useKeys } from '../input/keys';
import { KeyHints, Label, Logo, Row, Sheet } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { GROUND_Y, KERB_Y, PX_PER_M, SHOP_LIGHTS, smooth, SIGN_BOARDS, STREET_W, THEO_SHOP, WALK_MAX, WALK_MIN, heightPx, layoutLabels, paceTo, viewFor, worldX } from './geometry';
import { HudStat, placeColour, useStreet, useToast } from './parts/common';
import { figureCanvas, hashStr } from './parts/dots';
import { Street2D, StreetGL, figureRows, type FigureDraw, type LightDraw, type SignDef, type StreetRenderer, type View } from './parts/streetGL';
import { clarityFor, repOf, totalRep, updateStreet, REP_MAX } from './state';
import { BodyRaster, WALK_TILE, type Look } from './body/body';
import { Gait } from './body/gait';
import { FRAME } from './body/skeleton';
import { WALKS } from './body/walkData';
import { atlasKey, atlasRect, idleLife, loadAtlas, loadBodies, mirrorFor, newCast, stepCast, type BodiesIndex, type CastState } from './bodies';
import './street.css';

const W0 = STREET_W;
const NEAR = 100; // about 1.3 m either side of a place; the nearest place wins
const PERSON_DX = 60; // people stand 0.8 m right of the middle of their shop, so you never stand on them
const THEO_LINE = "Theo's shop opens later in the course.";

/** Heights in metres: every adult between 1.65 and 1.80. */
const HEIGHT_M: Record<string, number> = { you: 1.73, nok: 1.65, ploy: 1.67, mai: 1.68, fah: 1.69, ton: 1.75, lek: 1.76, bank: 1.79, theo: 1.8 };
const BROAD = new Set(['lek', 'ton', 'bank', 'theo']);
const YOU_LOOK: Record<'m' | 'f', Look> = { m: { sex: 'm', build: 1, hair: 'short' }, f: { sex: 'f', build: 0.96, hair: 'bob' } };

const ORDER = [...PLACES].sort((a, b) => a.x - b.x);
const placeX = (id: PlaceId) => PLACES.find((p) => p.id === id)!.x * W0;
const THEO_X = THEO_SHOP.x * W0;

/**
 * Where each cast member stands: on the lit patch in front of their place. Lek
 * stands left of the market's middle (to the right is the taxi rank), Ton by
 * his taxi, Bank beside Fah, Theo at his shop.
 */
const STANDS: { who: string; place: PlaceId | 'theo'; x: number }[] = [
  ...PLACES.map((p) => ({ who: p.person, place: p.id as PlaceId | 'theo', x: p.x * W0 + (p.id === 'market' ? -56 : p.id === 'taxi' ? 55 : PERSON_DX) })),
  { who: 'bank', place: 'bar', x: placeX('bar') + PERSON_DX + 56 },
  { who: 'theo', place: 'theo', x: THEO_X + PERSON_DX },
];
/** The person you talk to at each place (Bank stands with Fah but has no tag of his own). */
const TAGGED = STANDS.filter((s) => s.who !== 'bank');
/** Where you stop to talk to each person (the walk-to point of their place): they turn to face it. */
const STOP_X: Record<string, number> = Object.fromEntries(STANDS.map((s) => [s.who, s.place === 'theo' ? THEO_X : placeX(s.place)]));

const base = () => {
  try {
    return (import.meta.env?.BASE_URL as string | undefined) ?? './';
  } catch {
    return './';
  }
};

export default function Street() {
  const { store, engine, settings, content, reducedMotion } = useApp();
  const { device, touch } = useDevice();
  const [street] = useStreet();
  const day = engine.day();
  const tasks = useMemo(() => tasksFor(settings.identity).filter((t) => !t.chapter), [settings.identity]);
  const open = tasks.filter((t) => t.day <= day && (!t.adult || settings.adult));
  const next = open.find((t) => !street.done.includes(t.id)) ?? null;
  const [near, setNear] = useState<PlaceId | null>(null);
  const [atTheo, setAtTheo] = useState(false);
  const [toast, say] = useToast();
  const [sign, setSign] = useState<PlaceId | null>(null);

  const px = useRef(Math.max(WALK_MIN, Math.min(WALK_MAX, (street.at ?? 0.03) * W0)));
  const target = useRef<number | null>(null);
  const keys = useRef({ left: false, right: false });
  const stick = useRef(0);
  const nearRef = useRef<PlaceId | null>(null);
  const theoRef = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const tags = useRef(new Map<string, HTMLDivElement>());
  const youTag = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ s: 1, left: 0, top: 0, w: 1, h: 1 });

  // reputation and the 18+ setting, read live by the frame loop
  const reps = useMemo(() => Object.fromEntries(CAST.map((c) => [c.id, repOf(street, c.id)])), [street]);
  const live = useRef({ reps, adult: settings.adult, motion: !reducedMotion, identity: settings.identity });
  live.current = { reps, adult: settings.adult, motion: !reducedMotion, identity: settings.identity };

  // the sign words: each place's name on its board, and the small sign in its shopfront
  const signs = useMemo<SignDef[]>(
    () =>
      PLACES.flatMap((p) => {
        const sub = content.item(STREET_SIGNS[p.id].item);
        const col = placeColour(p.id);
        return [{ text: p.thaiSign, rect: SIGN_BOARDS[p.id].main, colour: col }, ...(sub ? [{ text: sub.thai, rect: SIGN_BOARDS[p.id].sub, colour: col }] : [])];
      }),
    [content],
  );
  const signsRef = useRef(signs);
  signsRef.current = signs;
  const renderer = useRef<StreetRenderer | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let canvas = document.createElement('canvas');
    const fit = (c: HTMLCanvasElement) => {
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      el.appendChild(c);
    };
    fit(canvas);
    let r: StreetRenderer | null = StreetGL.create(canvas);
    if (!r) {
      // a canvas that tried WebGL cannot give a 2D context: start again with a fresh one
      canvas.remove();
      canvas = document.createElement('canvas');
      fit(canvas);
      r = new Street2D(canvas);
    }
    const R = r;
    renderer.current = R;
    let dead = false;

    // the street photograph (brightness + depth); the 2D fallback draws the plain picture
    loadManifest().then((m) => {
      const ref = m.scenes.street ?? { image: 'scenes/street.webp', depth: 'scenes/street.depth.webp' };
      if (R.kind === 'gl')
        loadPair(ref).then((c) => {
          if (c && !dead) R.setStreet(c, null);
        });
      else {
        const im = new Image();
        im.onload = () => !dead && R.setStreet({ canvas, px: new Uint8ClampedArray(0), w: 0, h: 0 }, im);
        im.src = `${base()}packs/${ref.image}`;
      }
    });
    R.setTexture('fig:f', figureCanvas(0.94));
    R.setTexture('fig:m', figureCanvas(1.08));

    // the people from their photos: until a person's atlas is in, they keep the stand-in figure
    let bodies: BodiesIndex | null = null;
    const atlasReady = new Set<string>();
    loadBodies().then(async (ix) => {
      if (dead) return;
      bodies = ix;
      // nearest first, one at a time, so loading never stalls a frame
      const order = STANDS.filter((s) => ix.people[s.who]).sort((a, b) => Math.abs(a.x - px.current) - Math.abs(b.x - px.current));
      for (const s of order) {
        const a = ix.people[s.who];
        for (const [key, rel] of [[`photo:${s.who}`, a.image], ...Object.entries(a.alt).map(([n, v]) => [`photo:${s.who}-${n}`, v.image])] as [string, string][]) {
          const im = await loadAtlas(rel);
          if (dead) return;
          if (im) {
            R.setTexture(key, im, true);
            atlasReady.add(key);
          }
        }
      }
    });
    const cast = new Map<string, { st: CastState; ready: number }>(STANDS.map((s) => [s.who, { st: newCast(), ready: 0 }]));

    const size = () => R.resize(el.clientWidth, el.clientHeight, Math.min(2, window.devicePixelRatio || 1));
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    const youH = heightPx(HEIGHT_M.you);
    // you: a body walked by the stride tracked from the reference video (m or f by speaking identity)
    let who: 'm' | 'f' = live.current.identity === 'f' ? 'f' : 'm';
    let gait = new Gait(WALKS[who], FRAME[who], px.current);
    const youRaster = new BodyRaster(WALK_TILE);
    const T = WALK_TILE;
    const tileFr = { head: (T.y1 - 1) / (T.y1 - T.y0), feet: T.y1 / (T.y1 - T.y0), centre: -T.x0 / (T.x1 - T.x0) };
    let camC = px.current;
    // the camera moves in (up to 1.6x) when you stop with someone, so they are big enough to read
    let push = 0;
    let pushX = 0;
    let t = 0;
    let last = performance.now();
    let raf = 0;
    const full: [number, number, number, number] = [0, 0, 1, 1];
    const white = hexToRgb('#E8E8E8');

    const perf = { n: 0, ms: 0, worst: 0 };
    // one step of the street's life: your walk, the camera, where you are, how the people react
    const tick = (dt: number) => {
      const L = live.current;
      if (L.motion) t += dt;

      // walking: the wanted pace goes to the gait, which moves you by what your feet push
      const nowWho: 'm' | 'f' = L.identity === 'f' ? 'f' : 'm';
      if (nowWho !== who && gait.standing) {
        who = nowWho;
        gait = new Gait(WALKS[who], FRAME[who], px.current);
      }
      const step = (gait.stride / 2) * youH; // one step, world px
      let want = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0) + stick.current;
      if (want !== 0) target.current = null;
      if (target.current != null) {
        const d = target.current - px.current;
        // close enough: stop on the next step (a stop takes about half a step)
        want = Math.abs(d) < step * 0.55 ? 0 : paceTo(d, 120);
        if (want === 0 && gait.standing) target.current = null;
      }
      want = Math.max(-1, Math.min(1, want));
      if ((want > 0 && px.current > WALK_MAX - step * 0.6) || (want < 0 && px.current < WALK_MIN + step * 0.6)) want = 0;
      gait.x = px.current;
      gait.update(dt, want, youH, L.motion);
      px.current = Math.max(WALK_MIN, Math.min(WALK_MAX, gait.x));

      // camera: follows you gently; while it is in, it frames you and the person you are with
      camC += (px.current + pushX * push - camC) * (1 - Math.exp(-dt * 3.5));

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
      const theo = !best && Math.abs(THEO_X - px.current) < NEAR;
      if (best !== nearRef.current) {
        nearRef.current = best;
        setNear(best);
      }
      if (theo !== theoRef.current) {
        theoRef.current = theo;
        setAtTheo(theo);
      }
      const withWho = best ? STANDS.find((x) => x.place === best) : theo && L.adult ? STANDS.find((x) => x.place === 'theo') : undefined;
      const atStop = !!withWho && gait.standing && L.motion;
      if (withWho) pushX = (withWho.x - px.current) * 0.5;
      push += ((atStop ? 1 : 0) - push) * (1 - Math.exp(-dt * 2.4));

      // the people: they notice you as you come near and greet you when you stop at their place
      for (const s of STANDS) {
        const atlas = bodies?.people[s.who];
        if (!atlas) continue;
        const stop = STOP_X[s.who];
        const atPlace = s.place === 'theo' ? theoRef.current : nearRef.current === s.place;
        stepCast(cast.get(s.who)!.st, { dxM: (px.current - s.x) / PX_PER_M, gaze: stop >= s.x ? 1 : -1, atPlace, stopped: gait.standing, motion: L.motion }, dt, atlas);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t0 = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      tick(dt);
      // development only: jump somewhere or run the street forward (for checking it frame by frame)
      if (import.meta.env.DEV) {
        const ds = document.documentElement.dataset;
        if (ds.streetGoto) {
          px.current = gait.x = camC = Number(ds.streetGoto);
          target.current = null;
          delete ds.streetGoto;
        }
        if (ds.streetWarp) {
          const n = Math.min(1200, Math.round(Number(ds.streetWarp) * 60));
          delete ds.streetWarp;
          for (let k = 0; k < n; k++) tick(1 / 60);
        }
      }
      const L = live.current;

      // the view onto the street
      const w = el.clientWidth;
      const h = el.clientHeight;
      const vw = viewFor(w, h, camC, youH, 74, push);
      view.current = { ...vw, w, h };

      // labels: one row of names on the road under the kerb, the YOU tag below it;
      // read every width first, then place them (no layout thrash), never overlapping
      const row = (KERB_Y - vw.top) * vw.s + 16;
      const items = TAGGED.map((s) => {
        const el2 = tags.current.get(s.who);
        const x = (s.x - vw.left) * vw.s;
        return { el: el2, x, w: el2 ? el2.offsetWidth : 0, prio: el2?.dataset.on === '1' ? 2 : 1 };
      });
      const shown = layoutLabels(items, w);
      items.forEach((it, i) => {
        if (!it.el) return;
        it.el.style.transform = `translate(${it.x}px, ${row}px) translateX(-50%)`;
        it.el.style.opacity = String(shown[i]);
      });
      if (youTag.current) {
        const yx = (px.current - vw.left) * vw.s;
        youTag.current.style.transform = `translate(${yx}px, ${row + 38}px) translateX(-50%)`;
      }

      // the lights: a slow flicker in the bar's neon, Theo's shop dim while 18+ is off
      const flick = L.motion ? 1 - 0.1 * Math.max(0, Math.sin(t * 23) * Math.sin(t * 2.3 + 1) * Math.sin(t * 0.7)) : 1;
      const lights: LightDraw[] = SHOP_LIGHTS.map((l) => {
        const colour = l.id === 'theo' ? THEO_SHOP.colour : l.id === 'lamp' ? '#8FC2FF' : placeColour(l.id);
        let level = 1;
        if (l.id === 'bar') level = flick;
        if (l.id === 'pharmacy' && L.motion) level = 0.97 + 0.03 * Math.sin(t * 1.9);
        if (l.id === 'theo') level = L.adult ? 1 : 0.3;
        if (l.id === 'taxi') level = 0.7;
        return { rect: l.rect, reach: l.reach, colour: hexToRgb(colour), level };
      });
      const signLevels = signsRef.current.map((s) => (s.colour === placeColour('bar') ? flick : 1));

      // the people: from their photos (idle, notice as you come near, a greeting when you stop
      // at their place), or the stand-in figure until their photo has loaded
      const figures: FigureDraw[] = [];
      for (const s of STANDS) {
        if (s.who === 'theo' && !L.adult) continue;
        const seed = hashStr(s.who) % 1000;
        const hPx = heightPx(HEIGHT_M[s.who] ?? 1.7);
        // the light of their place: a slight wash on their photo (and the stand-in's tint)
        const colour = hexToRgb(s.place === 'theo' ? THEO_SHOP.colour : placeColour(s.place));
        const clarity = clarityFor(L.reps[s.who] ?? 0);
        const alpha = L.motion ? 0.93 + Math.sin(t * 2.1 + seed) * 0.05 : 0.96;
        const c = cast.get(s.who)!;
        const atlas = bodies?.people[s.who];
        // Fah's photos without the jacket are 18+; with 18+ off only the jacket set will do
        const key = atlasKey(s.who, atlas, L.adult);
        const ok = !!key && atlasReady.has(key);
        c.ready = ok ? Math.min(1, c.ready + dt * 2.5) : 0;
        if (atlas) {
          const flip = mirrorFor(atlas.looks, s.x, STOP_X[s.who]);
          if (ok) {
            const f = Math.max(0, Math.min(atlas.frames - 1, Number.isFinite(c.st.f) ? c.st.f : atlas.keys.idle));
            const i = Math.min(atlas.frames - 1, Math.floor(f));
            const p = f - i;
            // a re-form join (the greeting): the figure re-forms as an apparition rather than cross-fading
            // (with reduced motion, a plain quick cross-fade)
            const reform = atlas.reform.includes(i) && p > 0;
            const life = L.motion ? idleLife(t, seed, f, atlas.keys.idle) : { sway: 0, breath: 0 };
            figures.push({
              // RIFE in-betweens cross-fade over the middle half of each step only, so a turning head is
              // never seen twice for long, yet nothing snaps
              tex: key!, a: atlasRect(atlas, i), b: atlasRect(atlas, Math.min(atlas.frames - 1, i + 1)),
              mix: reform ? p : smooth(0.25, 0.75, p), reform: reform && L.motion,
              x: s.x, foot: GROUND_Y, h: hPx,
              head: atlas.head, feet: atlas.feet, centre: atlas.centre, aspect: atlas.tile[0] / atlas.tile[1], flip,
              colour, clarity, alpha: alpha * c.ready, soft: true, photo: true,
              sway: life.sway * hPx, breath: life.breath * hPx,
            });
          }
        }
        if (c.ready < 1) {
          const breathe = L.motion ? 1 + Math.sin(t * 1.4 + seed) * 0.005 : 1;
          figures.push({
            tex: BROAD.has(s.who) ? 'fig:m' : 'fig:f',
            a: full, b: full, mix: 0,
            x: s.x, foot: GROUND_Y, h: hPx * breathe,
            head: 0, feet: 1, centre: 0.5, aspect: 0.4, flip: false,
            colour, clarity, alpha: alpha * (1 - c.ready),
          });
        }
      }
      // you: the walking body, drawn into a small image each frame at the dot grid's resolution
      const gridRows = figureRows(youH * (T.y1 - T.y0), vw.s, Math.min(2, window.devicePixelRatio || 1));
      youRaster.resize(Math.min(300, Math.max(48, Math.round(gridRows * 1.3))));
      youRaster.render(gait.pose, YOU_LOOK[who], gait.theta);
      R.setPixels('body:you', youRaster.w, youRaster.h, youRaster.data);
      figures.push({
        tex: 'body:you', a: full, b: full, mix: 0,
        x: px.current, foot: GROUND_Y, h: youH,
        head: tileFr.head, feet: tileFr.feet, centre: tileFr.centre, aspect: youRaster.aspect, flip: false,
        colour: white, clarity: 1, alpha: 1, ring: 1, soft: true,
      });

      R.render({ view: view.current, t, motion: L.motion, lights, signs: signLevels, figures });
      // development only: the frame's script time, for checking the street stays well inside a 60 fps budget
      if (import.meta.env.DEV) {
        const ms = performance.now() - t0;
        perf.n++;
        perf.ms += ms;
        perf.worst = Math.max(perf.worst, ms);
        if (perf.n === 60) {
          document.documentElement.dataset.streetFrameMs = `${(perf.ms / 60).toFixed(2)} avg, ${perf.worst.toFixed(2)} worst, ${figures.length} figures`;
          perf.n = perf.ms = perf.worst = 0;
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      renderer.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      R.dispose();
      canvas.remove();
    };
  }, []);

  // the small signs come from the loaded course: redraw them when it changes
  useEffect(() => {
    renderer.current?.setSigns(signs);
  }, [signs]);

  // remember where you stood
  useEffect(
    () => () => {
      updateStreet(store, (s) => ({ ...s, at: px.current / W0 }));
    },
    [store],
  );

  const talk = () => {
    if (theoRef.current) {
      say(THEO_LINE);
      return;
    }
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
    const x = worldX(e.clientX - rect.left, view.current);
    target.current = Math.max(WALK_MIN, Math.min(WALK_MAX, x));
    // a tap on Theo's shopfront
    const [x0, , x1] = THEO_SHOP.front;
    if (x >= x0 && x <= x1) say(THEO_LINE);
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
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {/* name tags on the road under each person, placed by the frame loop so they never overlap */}
      <div className="street-tags" aria-hidden>
        {TAGGED.map((s) => {
          const isTheo = s.who === 'theo';
          const on = isTheo ? atTheo : near === s.place;
          if (isTheo && !settings.adult && !atTheo) return null;
          const name = content.person(s.who)?.name ?? s.who;
          const col = isTheo ? THEO_SHOP.colour : placeColour(s.place as PlaceId);
          return (
            <div
              key={s.who}
              ref={(e) => {
                if (e) tags.current.set(s.who, e);
                else tags.current.delete(s.who);
              }}
              data-on={on ? '1' : '0'}
              className={`street-tag ${on ? 'on' : ''} ${isTheo && on ? 'later' : ''}`}
              style={{ color: col, opacity: 0 }}
            >
              {isTheo && on ? (
                <>{settings.adult ? 'Theo' : "Theo's shop"} · opens later</>
              ) : (
                <>
                  {name}
                  {on && (
                    <>
                      {' · '}
                      <span lang="th">คุย</span> Talk
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div className="street-tag you" ref={youTag}>You</div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <span className="sr-only" aria-live="polite">{nearPlace ? `You are at the ${nearPlace.name}.` : atTheo ? THEO_LINE : ''}</span>
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
          // on a phone the column between the stick and the buttons is narrow: the buttons already say what to do
          <FitText lines={0} min={10} valign="center">
            {device === 'phone'
              ? nearPlace ? `At the ${nearPlace.name.toLowerCase()}.` : atTheo ? "Theo's shop. Opens later in the course." : 'Walk the street.'
              : nearPlace ? `At the ${nearPlace.name.toLowerCase()}. Talk, or read the sign.` : atTheo ? THEO_LINE : 'Walk the street. Talk to people, read the signs, finish tasks you would really face.'}
          </FitText>
        )}
      </div>
      <div className="btns">
        <button type="button" className="pill solid" onClick={talk} disabled={!near && !atTheo}>Talk</button>
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
      <Row to="/cast" right="9 people">Cast</Row>
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
  // let go however the touch ends: a lost capture, the app losing focus or going to the background
  // (a notification, switching apps) must never leave you walking with nobody holding the stick
  useEffect(() => {
    const off = () => id.current != null && end();
    const hide = () => document.hidden && off();
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('blur', off);
      document.removeEventListener('visibilitychange', hide);
    };
  });
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
      onLostPointerCapture={end}
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
