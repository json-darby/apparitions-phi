// Heat Check, service. Diners sit at the table and state a dish and how hot
// they want it. Build the plate (dish, then heat) and get it to the right
// diner before their patience ring runs out. Tap and drag on touch; number
// keys, arrows and Enter on desktop.
//
// What counts as a review (the rule for all games):
// - The order is heard ('hear'; captions stand in until Phase 4). The tray
//   shows dishes as dot pictures and heat as chili dots, never Thai, so
//   choosing needs the meaning of the Thai: these answers count.
// - The dish answer counts only when the tray offers two or more dishes; the
//   heat answer only when two or more heat levels are in play.
// - A diner who leaves unserved is logged as a blank with counts:false: with
//   several diners waiting it says more about juggling than about the Thai.
//   A wrong plate is a miss that counts (with the confusion noted).
// - Tier 3 and up: some right plates are followed by reading the order back
//   (sound.record). That reports 'say' and counts only once speech is scored.

import { useMemo, useRef, useState } from 'react';
import { Container, Graphics, type Text } from 'pixi.js';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { useKeys } from '../input/keys';
import { KeyHints, Label, Meter } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { PlayIcon } from '../audio/SoundLayer';
import type { Item, VoiceId } from '../content/types';
import { VOICES } from '../content/types';
import type { GameItem } from '../engine/engine';
import { DrillShell, type DrillRunApi } from './shared/DrillShell';
import { usePixi } from './shared/pixi';
import { pick, type Tier } from './shared/drill';
import { COL, GLYPH_COLOUR, chiliDots, dinerDots, glyphDots, type GlyphId } from './parts/dots-glyphs';
import { css, dotGraphics, drawDotRing, followSize, loadGameFonts, uiLabel } from './parts/dots-pixi';
import { DotGlyph, useLatest } from './parts/dots-svg';

const DISH_IDS: GlyphId[] = ['fried-rice', 'pad-thai', 'papaya-salad', 'tom-yum', 'rice', 'water', 'beer', 'coffee'];
/** dishes that are ordered with a heat level */
const SPICED = new Set<string>(['fried-rice', 'pad-thai', 'papaya-salad', 'tom-yum']);
const HEAT_IDS = ['not-spicy', 'little-spicy', 'spicy', 'very-spicy'];
/** look-alike pairs for tier 3 */
const LOOKALIKE: [string, string][] = [['rice', 'fried-rice'], ['fried-rice', 'pad-thai']];
const SEATS = [
  { name: 'Kit', ang: Math.PI, colour: COL.amber },
  { name: 'Sam', ang: -Math.PI / 2, colour: COL.cyan },
  { name: 'Jo', ang: 0, colour: COL.pink },
];
const PATIENCE_MS = 19000;
const ARRIVE_MS = 6500;

interface Dish { id: GlyphId; ref: string; item: Item }
interface Heat { level: number; ref: string; item: Item }

interface Order { dish: Dish; heat: Heat | null; thai: string; roman: string; en: string }

interface DinerView {
  seat: number;
  name: string;
  order: Order;
  patience: number; // 0..1
  heard: boolean;
}

interface Plate { dish: Dish | null; heat: Heat | null }

interface View {
  diners: DinerView[];
  selected: number | null; // seat
  served: number;
  plate: Plate;
  status: { kind: 'idle' | 'right' | 'wrong' | 'left' | 'say'; text: string; sub?: string };
}

const VIEW0: View = { diners: [], selected: null, served: 0, plate: { dish: null, heat: null }, status: { kind: 'idle', text: 'Table open' } };

export default function HeatCheck() {
  const [view, setView] = useState<View>(VIEW0);
  const ctl = useRef<Ctl | null>(null);
  return (
    <DrillShell
      id="heat-check"
      title="Heat Check"
      tag="Service"
      howTo="Each diner asks for a dish and a heat level. Put the dish on the plate, set the heat, and get it to them before their ring runs out. A wrong plate or an empty ring costs a life."
      controls={{
        touch: 'Tap a dish, tap the heat, then drag the plate to the diner. Tap a diner to hear them again.',
        keys: [['1–6', 'dish, then heat'], ['← →', 'choose diner'], ['Enter', 'serve'], ['⌫', 'clear plate'], ['Space', 'hear again']],
      }}
      request={() => ({
        skills: ['hear'],
        kinds: ['item'],
        filter: (e) => {
          const id = e.ref.slice(5);
          return (DISH_IDS as string[]).includes(id) || HEAT_IDS.includes(id) || id === 'khaw';
        },
        count: 200,
      })}
      minItems={3}
      seconds={210}
      lives={3}
      side={(api) => <Side api={api} view={view} ctl={ctl} />}
    >
      {(api) => <Game api={api} view={view} setView={setView} ctl={ctl} />}
    </DrillShell>
  );
}

interface Ctl {
  replay(seat: number): void;
  select(seat: number): void;
  serve(seat?: number): void;
  setDish(i: number): void;
  setHeat(i: number): void;
  clear(): void;
}

function Side({ api, view, ctl }: { api: DrillRunApi; view: View; ctl: React.MutableRefObject<Ctl | null> }) {
  return (
    <div className="stack gap-4" style={{ paddingTop: 8 }}>
      <div className="hrow" style={{ gap: 28 }}>
        <div><Label>Served</Label><div className="h-m num" style={{ marginTop: 6 }}>{view.served}</div></div>
        <div><Label>Speed</Label><div className="h-m num" style={{ marginTop: 6 }}>{api.pace.speed.toFixed(2)}×</div></div>
      </div>
      <div>
        <Label>Orders, in arrival order</Label>
        <div className="stack" style={{ marginTop: 8 }}>
          {view.diners.length === 0 && <p className="small" style={{ margin: '8px 0' }}>Nobody waiting.</p>}
          {view.diners.map((d) => (
            <div key={d.seat} className="row" style={{ alignItems: 'center', gap: 12, cursor: 'pointer', outline: view.selected === d.seat ? '1px solid var(--rule-strong)' : undefined, outlineOffset: 2, borderRadius: 4, padding: '10px 6px' }} onClick={() => ctl.current?.select(d.seat)}>
              <span style={{ width: 44, fontWeight: 600, color: css(SEATS[d.seat].colour) }}>{d.name}</span>
              <span className="grow"><Meter value={d.patience} colour={d.patience < 0.3 ? 'var(--bad)' : undefined} /></span>
              <button className="pill small" onClick={(e) => { e.stopPropagation(); ctl.current?.replay(d.seat); }} aria-label={`Hear ${d.name} again`} disabled={api.paused}>
                <PlayIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <hr className="rule" />
      <div>
        <Label>On the plate</Label>
        <div className="hrow" style={{ marginTop: 8, minHeight: 64 }}>
          {view.plate.dish ? <DotGlyph dots={glyphDots(view.plate.dish.id)} size={60} /> : <span className="small">Empty</span>}
          {view.plate.heat && <DotGlyph dots={chiliDots(view.plate.heat.level)} size={44} />}
        </div>
      </div>
      <p className="small" style={{ margin: 0 }}>Serve the oldest order first. The ring empties faster as you get it right.</p>
      <KeyHints hints={[['1–6', 'dish, heat'], ['← →', 'diner'], ['Enter', 'serve'], ['⌫', 'clear'], ['Space', 'again']]} />
    </div>
  );
}

// ---------- pool ----------

interface Pool {
  dishes: Dish[];
  heats: Heat[];
  khaw: Item | null;
}

function buildPool(items: GameItem[], getItem: (id: string) => Item | undefined, tier: Tier): Pool {
  const dishes: Dish[] = [];
  const heats: Heat[] = [];
  let khaw: Item | null = null;
  for (const gi of items) {
    const id = gi.ref.slice(5);
    const item = getItem(id);
    if (!item) continue;
    if ((DISH_IDS as string[]).includes(id)) dishes.push({ id: id as GlyphId, ref: gi.ref, item });
    const h = HEAT_IDS.indexOf(id);
    if (h >= 0) heats.push({ level: h, ref: gi.ref, item });
    if (id === 'khaw') khaw = item;
  }
  heats.sort((a, b) => a.level - b.level);
  // the tray holds at most six dishes (keys 1 to 6); due and weak first, and at
  // tier 3 keep look-alike pairs together
  let tray = dishes.slice(0, 6);
  if (tier >= 3) {
    for (const [a, b] of LOOKALIKE) {
      const da = dishes.find((d) => d.id === a);
      const db = dishes.find((d) => d.id === b);
      if (da && db && !tray.includes(da)) tray = [...tray.slice(0, 5), da];
      if (da && db && !tray.includes(db)) tray = [...tray.slice(0, 5), db];
    }
  }
  tray.sort((a, b) => DISH_IDS.indexOf(a.id) - DISH_IDS.indexOf(b.id));
  return { dishes: tray, heats, khaw };
}

// ---------- the game ----------

interface Diner {
  seat: number;
  order: Order;
  patience: number; // ms left
  total: number;
  heard: boolean;
  arrived: number;
  replays: number;
  voice: VoiceId;
  node: Container;
  body: Graphics;
  ring: Graphics;
}

function Game({ api, view, setView, ctl }: { api: DrillRunApi; view: View; setView: React.Dispatch<React.SetStateAction<View>>; ctl: React.MutableRefObject<Ctl | null> }) {
  const { content, sound, reducedMotion } = useApp();
  const { device, touch } = useDevice();
  const apiRef = useLatest(api);
  const showKeys = device === 'desktop' || !touch;
  const pool = useMemo(() => buildPool(api.items, (id) => content.item(id), api.tier), [api.items, content, api.tier]);
  const heatsInPlay = pool.heats.length >= 2;
  const actions = useRef<Ctl>({ replay() {}, select() {}, serve() {}, setDish() {}, setHeat() {}, clear() {} });
  const step: 'dish' | 'heat' | 'ready' = !view.plate.dish ? 'dish' : heatsInPlay && SPICED.has(view.plate.dish.id) && !view.plate.heat ? 'heat' : 'ready';

  useKeys((a) => {
    if (apiRef.current.paused || sound.getState().recording) return;
    const c = actions.current;
    if (a.type === 'rate') {
      if (step === 'heat') c.setHeat(a.n - 1);
      else c.setDish(a.n - 1);
      return true;
    }
    if (a.type === 'move' && a.down && a.dx !== 0) {
      const seats = view.diners.map((d) => d.seat);
      if (!seats.length) return true;
      const i = view.selected == null ? -1 : seats.indexOf(view.selected);
      const next = seats[(i + a.dx + seats.length) % seats.length];
      c.select(next);
      return true;
    }
    if (a.type === 'confirm') {
      c.serve();
      return true;
    }
    if (a.type === 'play') {
      if (view.selected != null) c.replay(view.selected);
      return true;
    }
    if (a.type === 'key' && a.down && (a.key === 'Backspace' || a.key === 'Delete')) {
      c.clear();
      return true;
    }
  });

  const { host } = usePixi((app, el) => {
    void loadGameFonts();
    const unfollow = followSize(app, el);
    const tier = apiRef.current.tier;
    const glow = !reducedMotion;
    const density = reducedMotion ? 0.45 : 1;
    const maxDiners = tier === 1 ? 2 : 3;

    const tableG = new Graphics();
    const dinersLayer = new Container();
    const plateNode = new Container();
    app.stage.addChild(tableG, dinersLayer, plateNode);

    let destroyed = false;
    let gt = 0;
    let hold = false;
    let nextArrive = 500;
    let served = 0;
    let sayCountdown = 3;
    let speaking = false;
    let selected: number | null = null;
    const queue: Diner[] = []; // waiting to speak
    const diners: Diner[] = [];
    const plate: Plate = { dish: null, heat: null };
    let plateBuilt = '';
    let status: View['status'] = { kind: 'idle', text: 'Table open' };
    let lastSync = 0;

    const geo = () => {
      const w = app.screen.width, h = app.screen.height;
      const tableR = Math.max(60, Math.min(w * 0.22, h * 0.24, 170));
      const dinerR = Math.max(26, Math.min(48, tableR * 0.36));
      const cx = w / 2;
      const cy = h / 2 + Math.min(30, h * 0.04);
      return { w, h, tableR, dinerR, cx, cy };
    };
    const seatPos = (seat: number) => {
      const { tableR, dinerR, cx, cy } = geo();
      const d = tableR + dinerR * 1.45;
      return { x: cx + Math.cos(SEATS[seat].ang) * d, y: cy + Math.sin(SEATS[seat].ang) * d };
    };

    // ---- drawing ----

    let lastGeo = '';
    function drawTable() {
      const g = geo();
      const key = `${g.w}x${g.h}`;
      if (key === lastGeo) return;
      lastGeo = key;
      tableG.clear();
      // the table: a disc of faint dots with a dotted rim
      const n = Math.round(g.tableR / 9);
      for (let i = -n; i <= n; i++)
        for (let j = -n; j <= n; j++) {
          const x = i * 9 + (j % 2 ? 4.5 : 0), y = j * 7.8;
          const d = Math.hypot(x, y);
          if (d > g.tableR - 4) continue;
          tableG.circle(g.cx + x, g.cy + y, 1.1).fill({ color: 0xffffff, alpha: 0.07 + 0.05 * (1 - d / g.tableR) });
        }
      tableG.circle(g.cx, g.cy, g.tableR).stroke({ color: 0xffffff, alpha: 0.22, width: 1 });
      plateBuilt = ''; // re-layout the plate too
    }

    function drawPlate() {
      const key = `${plate.dish?.id ?? '-'}|${plate.heat?.level ?? '-'}|${lastGeo}`;
      if (key === plateBuilt) return;
      plateBuilt = key;
      plateNode.removeChildren().forEach((c) => c.destroy({ children: true }));
      const g = geo();
      const s = g.tableR * 0.5;
      const ring = new Graphics().circle(0, 0, s * 1.15).stroke({ color: 0xffffff, alpha: plate.dish ? 0.5 : 0.2, width: 1 });
      plateNode.addChild(ring);
      if (plate.dish) plateNode.addChild(dotGraphics(glyphDots(plate.dish.id, undefined, density), s * 0.85, glow));
      else {
        const t = uiLabel('PLATE', 10, 0x5e5e5e);
        plateNode.addChild(t);
      }
      if (plate.heat) {
        const ch = dotGraphics(chiliDots(plate.heat.level), s * 0.32, glow);
        ch.y = s * 0.9;
        plateNode.addChild(ch);
      }
      plateNode.position.set(g.cx, g.cy);
    }

    function makeDinerNode(seat: number): { node: Container; body: Graphics; ring: Graphics } {
      const { dinerR } = geo();
      const node = new Container();
      const body = dotGraphics(dinerDots(0.11, 0.035, seat + 3).map((d) => ({ ...d, c: SEATS[seat].colour, a: (d.a ?? 1) * 0.85 })), dinerR * 0.62, glow);
      const ring = new Graphics();
      const name: Text = uiLabel(SEATS[seat].name.toUpperCase(), 11, SEATS[seat].colour);
      name.y = dinerR + 16;
      node.addChild(ring, body, name);
      node.position.copyFrom(seatPos(seat));
      dinersLayer.addChild(node);
      return { node, body, ring };
    }

    function drawDiners() {
      const { dinerR } = geo();
      for (const d of diners) {
        d.node.position.copyFrom(seatPos(d.seat));
        d.ring.clear();
        const frac = d.patience / d.total;
        const col = frac < 0.3 ? 0xff5a4f : SEATS[d.seat].colour;
        drawDotRing(d.ring, dinerR, d.heard ? frac : 1, col, 0x2a2a2a, 44, 2);
        if (selected === d.seat && showKeys) d.ring.circle(0, 0, dinerR + 9).stroke({ color: 0xffffff, alpha: 0.6, width: 1 });
      }
    }

    // ---- state out to React ----

    function sync(force = false) {
      if (!force && gt - lastSync < 200) return;
      lastSync = gt;
      setView({
        diners: diners.map((d) => ({ seat: d.seat, name: SEATS[d.seat].name, order: d.order, patience: d.heard ? d.patience / d.total : 1, heard: d.heard })),
        selected,
        served,
        plate: { ...plate },
        status,
      });
    }

    // ---- orders ----

    function makeOrder(): Order {
      let dish: Dish;
      const busy = new Set(diners.map((d) => d.order.dish.id));
      const free = pool.dishes.filter((d) => !busy.has(d.id));
      const from = free.length ? free : pool.dishes;
      if (tier >= 3 && Math.random() < 0.4) {
        const pairs = LOOKALIKE.flat().map((id) => from.find((d) => d.id === id)).filter(Boolean) as Dish[];
        dish = pairs.length ? pick(pairs) : pick(from.slice(0, 4));
      } else dish = pick(from.slice(0, Math.max(2, Math.min(from.length, 4 + Math.floor(Math.random() * 3)))));
      const heat = heatsInPlay && SPICED.has(dish.id) ? pick(pool.heats) : null;
      const lead = pool.khaw && Math.random() < 0.5 ? pool.khaw : null;
      const parts = [lead, dish.item, heat?.item].filter(Boolean) as Item[];
      return {
        dish, heat,
        thai: parts.map((p) => p.thai).join(' '),
        roman: parts.map((p) => p.roman).join(' '),
        en: [dish.item.en, heat?.item.en].filter(Boolean).join(', '),
      };
    }

    function arrive() {
      const taken = new Set(diners.map((d) => d.seat));
      const free = [0, 1, 2].filter((s) => !taken.has(s) && (tier > 1 || s !== 1));
      if (!free.length) return;
      const seat = pick(free);
      const total = PATIENCE_MS / Math.max(0.45, apiRef.current.pace.speed);
      const nodes = makeDinerNode(seat);
      const d: Diner = {
        seat, order: makeOrder(), patience: total, total, heard: false, arrived: gt, replays: 0,
        voice: tier === 1 ? pick(['f1', 'm1'] as VoiceId[]) : pick(VOICES), ...nodes,
      };
      diners.push(d);
      queue.push(d);
      if (selected == null) selected = seat;
      sync(true);
    }

    function speak(d: Diner) {
      speaking = true;
      d.heard = true;
      void sound
        .play({
          ref: d.order.dish.ref, thai: d.order.thai, roman: d.order.roman, voice: d.voice,
          speed: tier === 1 ? 'slow' : 'normal', noise: tier === 4, speaker: SEATS[d.seat].name, hideRoman: tier >= 3,
        })
        .then(() => {
          speaking = false;
        });
    }

    function leave(d: Diner) {
      const i = diners.indexOf(d);
      if (i >= 0) diners.splice(i, 1);
      const q = queue.indexOf(d);
      if (q >= 0) queue.splice(q, 1);
      d.node.destroy({ children: true });
      if (selected === d.seat) selected = diners[0]?.seat ?? null;
      nextArrive = Math.max(nextArrive, gt + 1800); // an empty seat stays empty for a moment
    }

    // ---- serving ----

    const needsHeat = (dish: Dish | null) => !!dish && heatsInPlay && SPICED.has(dish.id);
    const plateReady = () => !!plate.dish && (!needsHeat(plate.dish) || !!plate.heat);

    function serve(seat: number) {
      const d = diners.find((x) => x.seat === seat);
      if (!d || !plateReady() || hold) return;
      const a = apiRef.current;
      const o = d.order;
      const ms = Math.round(gt - d.arrived);
      const dishRight = plate.dish!.id === o.dish.id;
      const heatRight = !o.heat || plate.heat?.level === o.heat.level;
      const right = dishRight && heatRight && !(plate.heat && !o.heat);
      const pts = Math.round((15 + 10 * tier) * Math.max(0.6, a.pace.speed) * (0.5 + d.patience / d.total));
      a.answer({
        ref: o.dish.ref, skill: 'hear', correct: dishRight, ms, replays: d.replays, counts: pool.dishes.length >= 2,
        confusedWith: dishRight ? undefined : plate.dish!.ref, points: right ? pts : 0, data: { tier, order: o.thai },
      });
      if (o.heat && heatsInPlay) {
        a.answer({
          ref: o.heat.ref, skill: 'hear', correct: heatRight, ms, replays: d.replays, counts: true,
          confusedWith: heatRight ? undefined : plate.heat?.ref, points: 0, data: { tier, order: o.thai },
        });
      }
      const pos = seatPos(d.seat);
      if (right) {
        served++;
        a.burst?.burst(pos.x, pos.y, css(GLYPH_COLOUR[o.dish.id]));
        status = { kind: 'right', text: `Served. +${pts}`, sub: `${o.thai} · ${o.en}` };
      } else {
        a.loseLife();
        a.burst?.pull(pos.x, pos.y, '#ff5a4f');
        status = { kind: 'wrong', text: `Wrong plate for ${SEATS[d.seat].name}`, sub: `${o.thai} · ${o.en}` };
      }
      leave(d);
      plate.dish = null;
      plate.heat = null;
      sync(true);
      if (right && tier >= 3 && --sayCountdown <= 0) {
        sayCountdown = 3;
        void readBack(o);
      }
    }

    async function readBack(o: Order) {
      hold = true;
      status = { kind: 'say', text: 'Read the order back' };
      sync(true);
      const target = { ref: o.dish.ref, thai: o.thai, roman: o.roman };
      const rec = await sound.record(target);
      if (destroyed) return;
      if (rec) {
        const sc = await sound.score(rec, target);
        if (destroyed) return;
        apiRef.current.answer({
          ref: o.dish.ref, skill: 'say', correct: sc ? sc.overall >= 0.6 : undefined, speechScore: sc?.overall ?? null,
          ms: rec.ms, counts: !!sc, points: 0, data: { tier, line: o.thai },
        });
        apiRef.current.addScore(10);
      }
      hold = false;
      status = { kind: 'idle', text: '' };
      sync(true);
    }

    actions.current = {
      replay(seat) {
        const d = diners.find((x) => x.seat === seat);
        if (!d || hold || apiRef.current.paused) return;
        d.replays++;
        selected = seat;
        speak(d);
        sync(true);
      },
      select(seat) {
        selected = seat;
        sync(true);
      },
      serve(seat) {
        const s = seat ?? selected;
        if (s != null) serve(s);
      },
      setDish(i) {
        if (hold) return;
        const dish = pool.dishes[i];
        if (!dish) return;
        plate.dish = dish;
        if (!needsHeat(dish)) plate.heat = null;
        sync(true);
      },
      setHeat(i) {
        if (hold || !needsHeat(plate.dish)) return;
        const h = pool.heats[i];
        if (!h) return;
        plate.heat = h;
        sync(true);
      },
      clear() {
        plate.dish = null;
        plate.heat = null;
        sync(true);
      },
    };
    ctl.current = actions.current;

    // ---- pointer: tap a diner, drag the plate ----

    let drag: { id: number; ox: number; oy: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const dinerAt = (x: number, y: number) => {
      const { dinerR } = geo();
      return diners.find((d) => {
        const p = seatPos(d.seat);
        return Math.hypot(p.x - x, p.y - y) < dinerR * 1.25;
      });
    };
    const onDown = (e: PointerEvent) => {
      if (apiRef.current.paused || hold) return;
      const p = local(e);
      const g = geo();
      if (plateReady() && Math.hypot(p.x - g.cx, p.y - g.cy) < g.tableR * 0.62) {
        drag = { id: e.pointerId, ox: p.x - g.cx, oy: p.y - g.cy };
        el.setPointerCapture?.(e.pointerId);
        return;
      }
      const d = dinerAt(p.x, p.y);
      if (d) {
        if (plateReady()) serve(d.seat);
        else actions.current.replay(d.seat);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const p = local(e);
      plateNode.position.set(p.x - drag.ox, p.y - drag.oy);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      const p = local(e);
      const d = dinerAt(p.x, p.y);
      const g = geo();
      plateNode.position.set(g.cx, g.cy);
      if (d) serve(d.seat);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);

    // ---- loop ----

    let wasPaused = false;
    const tick = () => {
      const a = apiRef.current;
      drawTable();
      drawPlate();
      if (a.paused) {
        if (!wasPaused) {
          sound.stop();
          speaking = false;
        }
        wasPaused = true;
        return;
      }
      wasPaused = false;
      if (hold) return;
      const dt = app.ticker.deltaMS;
      gt += dt;

      if (gt >= nextArrive && pool.dishes.length) {
        if (diners.length < maxDiners) arrive();
        nextArrive = gt + ARRIVE_MS / Math.max(0.45, a.pace.speed) * (diners.length ? 1 : 0.4);
      }
      if (!speaking && queue.length) speak(queue.shift()!);

      for (const d of [...diners]) {
        if (!d.heard) continue;
        d.patience -= dt;
        if (d.patience <= 0) {
          const pos = seatPos(d.seat);
          a.answer({ ref: d.order.dish.ref, skill: 'hear', correct: false, blank: true, counts: false, data: { tier, order: d.order.thai, left: true } });
          a.loseLife();
          a.burst?.pull(pos.x, pos.y, '#ff5a4f');
          status = { kind: 'left', text: `${SEATS[d.seat].name} left`, sub: `${d.order.thai} · ${d.order.en}` };
          leave(d);
          sync(true);
        }
      }
      if (!drag) plateNode.position.set(geo().cx, geo().cy);
      drawDiners();
      sync();
    };
    app.ticker.add(tick);

    return () => {
      unfollow();
      destroyed = true;
      app.ticker.remove(tick);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      sound.stop();
      if (sound.getState().recording) sound.finishRecording(true);
      ctl.current = null;
    };
  }, []);

  const s = view.status;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={host} style={{ position: 'relative', flex: 1, minHeight: 0 }} />
      {pool.dishes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(5,5,5,.9)', zIndex: 4 }}>
          <p className="body center" style={{ maxWidth: '36ch' }}>Heat Check needs dishes you have met. Meet the food words first, then come back.</p>
        </div>
      )}
      <div style={{ padding: '10px var(--gutter) calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--rule)' }}>
        {/* one line, always: a long message gets smaller type so the tray and the street above never move */}
        <div className="hrow between" style={{ height: 22, marginBottom: 8 }}>
          <FitText as="span" className={`small ${s.kind === 'right' ? 'good' : s.kind === 'wrong' || s.kind === 'left' ? 'bad' : ''}`} min={9} style={{ fontWeight: 600, flex: '1 1 0' }}>
            {s.text}
            {s.sub && <span className="mut" lang="th" style={{ fontWeight: 400 }}> · {s.sub}</span>}
          </FitText>
          <span className="label" style={{ whiteSpace: 'nowrap', flex: 'none' }}>{step === 'dish' ? 'Pick the dish' : step === 'heat' ? 'Set the heat' : touch ? 'Drag to the diner' : 'Enter to serve'}</span>
        </div>
        <div className="hc-tray" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, pool.dishes.length)}, minmax(0, 1fr))`, gap: 6 }}>
          {pool.dishes.map((d, i) => (
            <button
              key={d.id}
              className="rating"
              style={{ minHeight: 64, padding: '6px 2px', position: 'relative', opacity: step === 'dish' || view.plate.dish?.id === d.id ? 1 : 0.55, borderColor: view.plate.dish?.id === d.id ? 'var(--fg)' : undefined, background: view.plate.dish?.id === d.id ? 'var(--chip)' : undefined }}
              aria-pressed={view.plate.dish?.id === d.id}
              onClick={() => actions.current.setDish(i)}
              aria-label={`Dish ${i + 1}`}
              disabled={api.paused}
            >
              <DotGlyph dots={glyphDots(d.id, undefined, 0.6)} size={46} glow={false} />
              {showKeys && <span className="kbd" style={{ position: 'absolute', top: 4, left: 4 }}>{i + 1}</span>}
            </button>
          ))}
        </div>
        {heatsInPlay && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${pool.heats.length}, minmax(0, 1fr))`, gap: 6, marginTop: 6 }}>
            {pool.heats.map((h, i) => (
              <button
                key={h.level}
                className="rating"
                aria-pressed={view.plate.heat?.level === h.level}
                style={{ minHeight: 44, padding: '4px 2px', position: 'relative', opacity: step === 'heat' || view.plate.heat?.level === h.level ? 1 : 0.45, borderColor: view.plate.heat?.level === h.level ? 'var(--fg)' : undefined, background: view.plate.heat?.level === h.level ? 'var(--chip)' : undefined }}
                onClick={() => actions.current.setHeat(i)}
                aria-label={`Heat ${h.level} of 3`}
                disabled={api.paused || !view.plate.dish || !SPICED.has(view.plate.dish.id)}
              >
                <DotGlyph dots={chiliDots(h.level)} size={40} glow={false} />
                {showKeys && step === 'heat' && <span className="kbd" style={{ position: 'absolute', top: 4, left: 4 }}>{i + 1}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
