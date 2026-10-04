// Night Market, the slicer. You hear an item (tier 1) or an item, a number and
// a classifier (tier 2 up), and slice the matching lot among the ones thrown
// up from the stall. Swipe on touch; click, or keys 1 to 6, on desktop.
//
// What counts as a review (the rule for all games):
// - Each slice reports the target item's 'hear' skill. In captions mode the
//   "audio" is a Thai caption, so when the lots also carry Thai labels the
//   learner could match script to script without knowing the word. Those
//   labelled waves are practice: logged with counts:false. Labels only show at
//   tiers 1 and 2, and only while an item is weak (never reviewed, or recall
//   under 0.6) and until it has been sliced right twice under labels in the
//   run. Unlabelled lots are pictures, so picture <-> Thai needs the meaning
//   and counts. With real audio (Phase 4) labels can't be shape-matched, so
//   labelled waves count too.
// - The item answer only counts if another item was on the field.
// - The number ('hear') is reported only when a lot of the same item with a
//   different count was on the field, so the count had to be understood.
//   Numbers are never labelled, so this always counts.
// - The classifier ('hear') is reported only at tiers 3 and 4, when the same
//   drink came in both a bottle and a glass with the same count.
// - 'read' is not reported: labels are a support, never the thing tested.
// - A target that falls unsliced is a blank under the same rule.
// - Tier 3 and up: after some right slices you say the order (sound.record).
//   It reports 'say' and counts only when the speech is scored (Phase 4).

import { useMemo, useRef, useState } from 'react';
import { Container, Graphics, type Text } from 'pixi.js';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { useKeys } from '../input/keys';
import { KeyHints, Label } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { PlayIcon } from '../audio/SoundLayer';
import type { Item, VoiceId } from '../content/types';
import { VOICES } from '../content/types';
import type { GameItem } from '../engine/engine';
import { DrillShell, type DrillRunApi } from './shared/DrillShell';
import { usePixi } from './shared/pixi';
import { pick, shuffle, type Tier } from './shared/drill';
import {
  CONTAINER_CLASSIFIER, DEFAULT_CONTAINER, GLYPH_COLOUR, clusterDots, glyphDots, isGlyphId,
  type Container as Vessel, type GlyphId,
} from './parts/dots-glyphs';
import { css, dotGraphics, followSize, loadGameFonts, pillBehind, thaiLabel, uiLabel } from './parts/dots-pixi';
import { useLatest } from './parts/dots-svg';

const NUMBER_IDS = ['n1', 'n2', 'n3', 'n4', 'n5'];
const LOTS_PER_TIER: Record<Tier, number> = { 1: 3, 2: 4, 3: 5, 4: 5 };
const FLIGHT_MS = 5600;

interface Lot {
  id: GlyphId;
  ref: string;
  n: number;
  vessel: Vessel;
}
const lotKey = (l: Lot) => `${l.id}|${l.n}|${l.vessel}`;

interface Prompt {
  thai: string;
  roman: string;
  en: string;
  numberRef: string | null;
  clRef: string | null;
}

interface Info {
  wave: number;
  right: number;
  streak: number;
  labelled: boolean;
  status: 'wait' | 'go' | 'right' | 'wrong' | 'miss' | 'say';
  /** shown after a wave: what it was */
  reveal: { thai: string; roman: string; en: string } | null;
}

const INFO0: Info = { wave: 0, right: 0, streak: 0, labelled: false, status: 'wait', reveal: null };

export default function NightMarket() {
  const [info, setInfo] = useState<Info>(INFO0);
  const ctl = useRef<{ replay(): void } | null>(null);
  return (
    <DrillShell
      id="night-market"
      title="Night Market"
      tag="Slicer"
      howTo="Hear the order, slice the lot that matches. From tier 2 the vendor calls a number and a classifier too, so count before you cut. A wrong slice costs a life."
      controls={{ touch: 'Swipe through a lot to slice it. Tap the play button to hear it again.', keys: [['1–6', 'slice lot'], ['Click', 'cut'], ['Space', 'hear again'], ['Esc', 'pause']] }}
      request={() => ({
        skills: ['hear'],
        kinds: ['item'],
        filter: (e) => {
          const id = e.ref.slice(5);
          return isGlyphId(id) || NUMBER_IDS.includes(id) || id.startsWith('cl-') || id === 'khaw';
        },
        count: 200,
      })}
      minItems={3}
      seconds={180}
      lives={3}
      side={(api) => <Side api={api} info={info} onReplay={() => ctl.current?.replay()} />}
    >
      {(api) => <Game api={api} setInfo={setInfo} ctl={ctl} />}
    </DrillShell>
  );
}

function Side({ api, info, onReplay }: { api: DrillRunApi; info: Info; onReplay: () => void }) {
  return (
    <div className="stack gap-4" style={{ paddingTop: 8 }}>
      <div>
        <Label>Lot</Label>
        <div className="h-m num" style={{ marginTop: 6 }}>{info.wave}</div>
      </div>
      <div className="hrow" style={{ gap: 28 }}>
        <div><Label>Right</Label><div className="h-s num" style={{ marginTop: 4 }}>{info.right}</div></div>
        <div><Label>Streak</Label><div className="h-s num" style={{ marginTop: 4 }}>{info.streak}</div></div>
        <div><Label>Speed</Label><div className="h-s num" style={{ marginTop: 4 }}>{api.pace.speed.toFixed(2)}×</div></div>
      </div>
      <hr className="rule" />
      <button className="pill" onClick={onReplay} disabled={api.paused}>
        <PlayIcon size={14} /> Hear it again
      </button>
      {info.reveal && (
        <div>
          <Label>Last order</Label>
          <div className="thai-m" lang="th" style={{ marginTop: 6 }}>{info.reveal.thai}</div>
          <div className="roman">{info.reveal.roman} <span className="mut">· {info.reveal.en}</span></div>
        </div>
      )}
      <p className="small" style={{ margin: 0 }}>
        {api.tier <= 2
          ? 'Weak items come with Thai labels. While captions stand in for sound, labelled lots are practice and are not scheduled.'
          : 'No labels. Captions drop the romanisation.'}
      </p>
      <KeyHints hints={[['1–6', 'slice'], ['Space', 'again'], ['Esc', 'pause']]} />
    </div>
  );
}

// ---------- the pool: what this run can use ----------

interface Pool {
  glyphs: { gi: GameItem; id: GlyphId; item: Item }[];
  numbers: { n: number; item: Item; ref: string }[];
  /** met classifier ids */
  classifiers: Set<string>;
  khaw: Item | null;
}

function buildPool(items: GameItem[], getItem: (id: string) => Item | undefined): Pool {
  const met = new Set(items.map((g) => g.ref.slice(5)));
  const glyphs: Pool['glyphs'] = [];
  const numbers: Pool['numbers'] = [];
  for (const gi of items) {
    const id = gi.ref.slice(5);
    const item = getItem(id);
    if (!item) continue;
    if (isGlyphId(id)) glyphs.push({ gi, id, item });
    const ni = NUMBER_IDS.indexOf(id);
    if (ni >= 0) numbers.push({ n: ni + 1, item, ref: gi.ref });
  }
  numbers.sort((a, b) => a.n - b.n);
  const classifiers = new Set([...met].filter((id) => id.startsWith('cl-')));
  return { glyphs, numbers, classifiers, khaw: met.has('khaw') ? getItem('khaw') ?? null : null };
}

/** Vessels an item can come in, given the classifiers met. */
function vesselsFor(id: GlyphId, item: Item, pool: Pool): { vessel: Vessel; cl: string | null }[] {
  const out: { vessel: Vessel; cl: string | null }[] = [];
  if (id === 'beer' || id === 'water' || id === 'coffee') {
    for (const v of ['bottle', 'glass'] as Vessel[]) {
      const cl = CONTAINER_CLASSIFIER[v]!;
      if (pool.classifiers.has(cl)) out.push({ vessel: v, cl });
    }
  } else if (item.classifier && pool.classifiers.has(item.classifier)) {
    out.push({ vessel: DEFAULT_CONTAINER[id], cl: item.classifier });
  }
  return out;
}

// ---------- the game ----------

interface LotView {
  lot: Lot;
  node: Container;
  label: Container | null;
  badge: Container | null;
  x0: number;
  drift: number;
  apex: number;
  delay: number;
  x: number;
  y: number;
  t: number;
  alive: boolean;
}

interface Wave {
  target: Lot;
  prompt: Prompt;
  views: LotView[];
  labelled: boolean;
  itemTested: boolean;
  needNumber: boolean;
  needClassifier: boolean;
  start: number;
  replays: number;
  voice: VoiceId;
}

function Game({ api, setInfo, ctl }: { api: DrillRunApi; setInfo: (f: (i: Info) => Info) => void; ctl: React.MutableRefObject<{ replay(): void } | null> }) {
  const { content, sound, reducedMotion } = useApp();
  const { device, touch } = useDevice();
  const apiRef = useLatest(api);
  const showKeys = device === 'desktop' || !touch;
  const pool = useMemo(() => buildPool(api.items, (id) => content.item(id)), [api.items, content]);
  const [bar, setBar] = useState<{ status: Info['status']; text: string; sub?: string; labelled: boolean }>({ status: 'wait', text: 'Ready', labelled: false });
  const actions = useRef<{ sliceKey(n: number): void; replay(): void }>({ sliceKey() {}, replay() {} });

  useKeys((a) => {
    if (apiRef.current.paused) return;
    if (sound.getState().recording) return;
    if (a.type === 'rate') {
      actions.current.sliceKey(a.n);
      return true;
    }
    if (a.type === 'play') {
      actions.current.replay();
      return true;
    }
  });

  const { host } = usePixi((app, el) => {
    void loadGameFonts();
    const unfollow = followSize(app, el);
    const tier = apiRef.current.tier;
    const captions = sound.mode === 'captions';
    const density = reducedMotion ? 0.45 : 1;
    const glow = !reducedMotion;

    const field = new Container();
    const trailG = new Graphics();
    const ringG = new Graphics();
    app.stage.addChild(field, ringG, trailG);

    let destroyed = false;
    let gt = 0; // game clock, frozen while paused or holding
    let hold = false; // recording or feedback freeze
    let wave: Wave | null = null;
    let nextAt = 600; // when the next wave starts
    let feedbackUntil = 0;
    let waveNo = 0;
    let streak = 0;
    let rightCount = 0;
    let sayCountdown = 3;
    const labelHits = new Map<string, number>();
    let lastTargetId: string | null = null;
    let bag: Pool['glyphs'] = [];

    const size = () => ({ w: app.screen.width, h: app.screen.height });
    const lotR = () => {
      const { w, h } = size();
      const lanes = wave ? wave.views.length : LOTS_PER_TIER[tier];
      return Math.max(30, Math.min(72, (w / lanes) * 0.46, h * 0.11));
    };

    // ---- choosing what to ask ----

    function nextTarget(): Pool['glyphs'][number] {
      if (!bag.length) {
        // due and weak first (api.items order), lightly shuffled in threes
        const ordered = [...pool.glyphs];
        bag = [];
        for (let i = 0; i < ordered.length; i += 3) bag.push(...shuffle(ordered.slice(i, i + 3)));
      }
      let i = bag.findIndex((g) => g.id !== lastTargetId);
      if (i < 0) i = 0;
      const [g] = bag.splice(i, 1);
      lastTargetId = g.id;
      return g;
    }

    function makeWave(): Wave {
      const g = nextTarget();
      const vessels = vesselsFor(g.id, g.item, pool);
      const quantity = tier >= 2 && vessels.length > 0 && pool.numbers.length >= 2;
      const K = Math.min(6, LOTS_PER_TIER[tier]);
      let target: Lot;
      let prompt: Prompt;
      const lots: Lot[] = [];
      const seen = new Set<string>();
      const add = (l: Lot) => {
        if (seen.has(lotKey(l)) || lots.length >= K) return false;
        seen.add(lotKey(l));
        lots.push(l);
        return true;
      };
      let needNumber = false;
      let needClassifier = false;

      if (quantity) {
        const v = pick(vessels);
        const num = pick(pool.numbers);
        target = { id: g.id, ref: g.gi.ref, n: num.n, vessel: v.vessel };
        const cl = content.item(v.cl!)!;
        prompt = {
          thai: `${g.item.thai} ${num.item.thai} ${cl.thai}`,
          roman: `${g.item.roman} ${num.item.roman} ${cl.roman}`,
          en: `${num.item.en} ${g.item.en} (${cl.en.replace('classifier: ', '')})`,
          numberRef: num.ref,
          clRef: `item:${cl.id}`,
        };
        add(target);
        // same item, another count: the number has to be understood
        const others = shuffle(pool.numbers.filter((x) => x.n !== num.n));
        if (others.length && add({ ...target, n: others[0].n })) needNumber = true;
        // tier 3+: same drink, same count, other vessel: the classifier has to be understood
        if (tier >= 3) {
          const alt = vessels.find((x) => x.vessel !== v.vessel);
          if (alt && add({ ...target, vessel: alt.vessel })) needClassifier = true;
          if (others.length > 1) add({ ...target, n: others[1].n });
        }
      } else {
        target = { id: g.id, ref: g.gi.ref, n: 1, vessel: DEFAULT_CONTAINER[g.id] };
        prompt = { thai: g.item.thai, roman: g.item.roman, en: g.item.en, numberRef: null, clRef: null };
        add(target);
      }
      // other items fill the rest; at tier 3+ they share the target's count, so
      // the item still has to be understood
      const otherItems = shuffle(pool.glyphs.filter((x) => x.id !== g.id));
      for (const o of otherItems) {
        if (lots.length >= K) break;
        const ov = vesselsFor(o.id, o.item, pool);
        let n = 1;
        let vessel = DEFAULT_CONTAINER[o.id];
        if (quantity) {
          n = tier >= 3 && Math.random() < 0.6 ? target.n : pick(pool.numbers).n;
          if (ov.length) vessel = pick(ov).vessel;
        }
        add({ id: o.id, ref: o.gi.ref, n, vessel });
      }
      // a small pool: pad with more counts of the target item
      if (quantity) for (const num of shuffle(pool.numbers)) if (lots.length < K) add({ ...target, n: num.n });

      const itemTested = lots.some((l) => l.id !== target.id);
      const weak = g.gi.retrievability < 0.6 && (labelHits.get(g.id) ?? 0) < 2;
      const labelled = tier <= 2 && weak;
      const voice: VoiceId = tier === 1 ? 'f1' : pick(VOICES);

      // lanes, left to right, so keys 1 to K read across the field
      const order = shuffle(lots);
      const views: LotView[] = order.map((lot, i) => {
        const node = new Container();
        const base = 60;
        const gfx = dotGraphics(clusterDots(glyphDots(lot.id, lot.vessel, density), lot.n), base, glow);
        node.addChild(gfx);
        let label: Container | null = null;
        if (labelled) {
          const it = content.item(lot.id)!;
          label = pillBehind(thaiLabel(it.thai, 17), 10, 3);
          label.y = base + 18;
          node.addChild(label);
        }
        let badge: Container | null = null;
        if (showKeys) {
          const t: Text = uiLabel(String(i + 1), 12, 0xf2f2f2, '700', 0);
          badge = new Container();
          const bg = new Graphics().roundRect(-11, -11, 22, 22, 5).fill({ color: 0x050505, alpha: 0.85 }).stroke({ color: 0xffffff, alpha: 0.34, width: 1 });
          badge.addChild(bg, t);
          badge.position.set(-base * 0.95, -base * 0.95);
          node.addChild(badge);
        }
        node.visible = false;
        field.addChild(node);
        const lane = (i + 0.5) / order.length;
        return {
          lot, node, label, badge,
          x0: Math.min(0.9, Math.max(0.1, lane + (Math.random() - 0.5) * 0.06)),
          drift: (Math.random() - 0.5) * 0.08,
          // neighbours peak at different heights so they never overlap
          apex: (i % 2 ? 0.66 : 0.44) + Math.random() * 0.1,
          delay: i * 160 + Math.random() * 120,
          x: 0, y: 0, t: 0, alive: true,
        };
      });

      return { target, prompt, views, labelled, itemTested, needNumber, needClassifier, start: gt, replays: 0, voice };
    }

    function speak(w: Wave) {
      void sound.play({
        ref: w.target.ref,
        thai: w.prompt.thai,
        roman: w.prompt.roman,
        voice: w.voice,
        speed: tier === 1 ? 'slow' : 'normal',
        noise: tier === 4,
        speaker: 'Vendor',
        hideRoman: tier >= 3,
      });
    }

    function startWave() {
      wave = makeWave();
      waveNo++;
      speak(wave);
      const labelled = wave.labelled;
      setBar({ status: 'go', text: 'Slice it', labelled: labelled && captions });
      setInfo((i) => ({ ...i, wave: waveNo, labelled, status: 'go' }));
    }

    function clearWave() {
      if (!wave) return;
      for (const v of wave.views) v.node.destroy({ children: true });
      wave = null;
      ringG.clear();
    }

    const flightMs = () => FLIGHT_MS / Math.max(0.4, apiRef.current.pace.speed);

    // ---- answers ----

    function finish(w: Wave, sliced: LotView | null) {
      const a = apiRef.current;
      const t = w.target;
      const ms = Math.round(gt - w.start);
      const itemCounts = w.itemTested && !(captions && w.labelled);
      const right = !!sliced && lotKey(sliced.lot) === lotKey(t);
      const reveal = { thai: w.prompt.thai, roman: w.prompt.roman, en: w.prompt.en };
      const pts = Math.round((10 + 10 * tier) * (1 + Math.min(streak, 10) * 0.1) * Math.max(0.6, a.pace.speed));

      if (!sliced) {
        a.answer({ ref: t.ref, skill: 'hear', correct: false, blank: true, ms, replays: w.replays, counts: itemCounts, data: { tier, labelled: w.labelled, missed: true } });
        streak = 0;
        setBar({ status: 'miss', text: 'Missed', sub: `${reveal.thai} · ${reveal.en}`, labelled: false });
      } else {
        const s = sliced.lot;
        const itemRight = s.id === t.id;
        a.answer({
          ref: t.ref, skill: 'hear', correct: itemRight, ms, replays: w.replays, counts: itemCounts,
          confusedWith: itemRight ? undefined : s.ref, points: right ? pts : 0,
          data: { tier, labelled: w.labelled, lot: lotKey(s), want: lotKey(t) },
        });
        if (itemRight && w.needNumber && w.prompt.numberRef) {
          const got = pool.numbers.find((x) => x.n === s.n);
          a.answer({
            ref: w.prompt.numberRef, skill: 'hear', correct: s.n === t.n, ms, replays: w.replays, counts: true,
            confusedWith: s.n === t.n ? undefined : got?.ref, points: 0, data: { tier, inPhrase: w.prompt.thai },
          });
        }
        if (itemRight && s.n === t.n && w.needClassifier && w.prompt.clRef) {
          const gotCl = CONTAINER_CLASSIFIER[s.vessel];
          a.answer({
            ref: w.prompt.clRef, skill: 'hear', correct: s.vessel === t.vessel, ms, replays: w.replays, counts: true,
            confusedWith: s.vessel === t.vessel || !gotCl ? undefined : `item:${gotCl}`, points: 0, data: { tier, inPhrase: w.prompt.thai },
          });
        }
        const colour = css(GLYPH_COLOUR[s.id]);
        if (right) {
          streak++;
          rightCount++;
          if (w.labelled) labelHits.set(t.id, (labelHits.get(t.id) ?? 0) + 1);
          a.burst?.burst(sliced.x, sliced.y, colour);
          setBar({ status: 'right', text: `+${pts}`, sub: `${reveal.thai} · ${reveal.en}`, labelled: false });
        } else {
          streak = 0;
          a.loseLife();
          a.burst?.pull(sliced.x, sliced.y, colour);
          setBar({ status: 'wrong', text: 'Wrong lot', sub: `${reveal.thai} · ${reveal.en}`, labelled: false });
        }
      }
      setInfo((i) => ({ ...i, right: rightCount, streak, status: right ? 'right' : sliced ? 'wrong' : 'miss', reveal }));

      // show the right lot, ringed, for a moment; everything else goes
      const tv = w.views.find((v) => lotKey(v.lot) === lotKey(t));
      for (const v of w.views) {
        if (v === sliced && right) v.node.visible = false;
        else if (v !== tv) v.node.visible = false;
      }
      ringG.clear();
      if (tv && !right && tv.t > 0 && tv.t < 1) {
        ringG.circle(tv.x, tv.y, lotR() * 1.15).stroke({ color: 0xf2f2f2, width: 1.5, alpha: 0.9 });
        tv.alive = false;
      } else if (tv) tv.node.visible = false;
      feedbackUntil = gt + (right ? 450 : 1500);

      // tier 3+: say the order now and then, after a right slice
      if (right && tier >= 3 && --sayCountdown <= 0) {
        sayCountdown = 3 + Math.floor(Math.random() * 2);
        void sayIt(w);
      }
    }

    async function sayIt(w: Wave) {
      hold = true;
      setBar({ status: 'say', text: 'Say the order', labelled: false });
      const lead = pool.khaw ? `${pool.khaw.thai} ` : '';
      const leadR = pool.khaw ? `${pool.khaw.roman} ` : '';
      const target = { ref: w.target.ref, thai: lead + w.prompt.thai, roman: leadR + w.prompt.roman };
      const rec = await sound.record(target);
      if (destroyed) return;
      if (rec) {
        const sc = await sound.score(rec, target);
        if (destroyed) return;
        apiRef.current.answer({
          ref: w.target.ref, skill: 'say', correct: sc ? sc.overall >= 0.6 : undefined, speechScore: sc?.overall ?? null,
          ms: rec.ms, counts: !!sc, points: sc && sc.overall >= 0.6 ? 20 : 0, data: { tier, line: target.thai },
        });
        if (!sc) apiRef.current.addScore(10);
      }
      hold = false;
    }

    function trySlice(v: LotView) {
      if (!wave || !v.alive || !v.node.visible || gt < feedbackUntil) return;
      const w = wave;
      for (const x of w.views) x.alive = false;
      finish(w, v);
    }

    // ---- input ----

    let down = false;
    const trail: { x: number; y: number; at: number }[] = [];
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hitSegment = (ax: number, ay: number, bx: number, by: number) => {
      if (!wave) return;
      const R = lotR() * 0.9;
      for (const v of wave.views) {
        if (!v.alive || !v.node.visible) continue;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((v.x - ax) * dx + (v.y - ay) * dy) / len2));
        const px = ax + dx * k, py = ay + dy * k;
        if (Math.hypot(v.x - px, v.y - py) < R) {
          trySlice(v);
          return;
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      if (apiRef.current.paused || hold) return;
      down = true;
      el.setPointerCapture?.(e.pointerId);
      const p = local(e);
      trail.length = 0;
      trail.push({ ...p, at: performance.now() });
      hitSegment(p.x, p.y, p.x, p.y);
    };
    const onMove = (e: PointerEvent) => {
      if (!down || apiRef.current.paused || hold) return;
      const p = local(e);
      const last = trail[trail.length - 1];
      trail.push({ ...p, at: performance.now() });
      if (last) hitSegment(last.x, last.y, p.x, p.y);
    };
    const onUp = () => {
      down = false;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);

    actions.current = {
      sliceKey(n: number) {
        if (!wave || hold) return;
        const v = wave.views[n - 1];
        if (v) trySlice(v);
      },
      replay() {
        if (!wave || hold || gt < feedbackUntil) return;
        wave.replays++;
        speak(wave);
      },
    };
    ctl.current = { replay: () => actions.current.replay() };

    // ---- the loop ----

    let wasPaused = false;
    const tick = () => {
      const a = apiRef.current;
      const dt = app.ticker.deltaMS;
      if (a.paused) {
        if (!wasPaused) sound.stop();
        wasPaused = true;
        return;
      }
      wasPaused = false;
      // trail fades on its own clock
      const now = performance.now();
      while (trail.length && now - trail[0].at > 140) trail.shift();
      trailG.clear();
      if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
          const k = 1 - (now - trail[i].at) / 140;
          trailG.moveTo(trail[i - 1].x, trail[i - 1].y).lineTo(trail[i].x, trail[i].y).stroke({ color: 0xffffff, width: 1 + 3 * k, alpha: 0.85 * k });
        }
      }
      if (hold) return;
      gt += dt;

      if (!wave) {
        if (gt >= nextAt && pool.glyphs.length >= 2) startWave();
        return;
      }
      if (feedbackUntil && gt < feedbackUntil) return;
      if (feedbackUntil && gt >= feedbackUntil) {
        feedbackUntil = 0;
        clearWave();
        nextAt = gt + 350;
        return;
      }

      const { w, h } = size();
      const R = lotR();
      const T = flightMs();
      const scale = R / 60;
      let anyUp = false;
      for (const v of wave.views) {
        const t = (gt - wave.start - v.delay) / T;
        v.t = t;
        if (t < 0) {
          v.node.visible = false;
          anyUp = true;
          continue;
        }
        if (t > 1) {
          v.node.visible = false;
          continue;
        }
        anyUp = true;
        const height = 4 * (v.apex * h + R) * t * (1 - t);
        v.x = Math.max(R * 1.05, Math.min(w - R * 1.05, (v.x0 + v.drift * t) * w));
        v.y = h + R * 1.1 - height;
        v.node.position.set(v.x, v.y);
        v.node.scale.set(scale);
        v.node.visible = v.alive;
      }
      if (!anyUp) {
        const w0 = wave;
        for (const v of w0.views) v.alive = false;
        finish(w0, null);
      }
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

  const noLots = pool.glyphs.length < 2;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={host} style={{ position: 'relative', flex: 1, minHeight: 0, cursor: 'crosshair' }} />
      {noLots && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(5,5,5,.9)', zIndex: 4 }}>
          <p className="body center" style={{ maxWidth: '36ch' }}>
            Night Market needs at least two fruits or dishes you have met. Meet the market words first, then come back.
          </p>
        </div>
      )}
      {/* a fixed bar: two fixed lines of text, so the stall above never resizes as the messages change */}
      <div className="hrow" style={{ padding: '12px var(--gutter) calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--rule)', height: 'calc(84px + env(safe-area-inset-bottom))', flex: 'none' }}>
        <button className="iconbtn" onClick={() => actions.current.replay()} aria-label="Hear it again" disabled={api.paused}>
          <PlayIcon />
        </button>
        <div className="grow">
          <FitText className={`h-s ${bar.status === 'right' ? 'good' : bar.status === 'wrong' || bar.status === 'miss' ? 'bad' : ''}`} min={12}>{bar.text}</FitText>
          {bar.sub ? (
            <FitText className="small" lang="th" min={9}>{bar.sub}</FitText>
          ) : bar.labelled ? (
            <FitText className="small" min={9}>Labelled: practice, not scheduled.</FitText>
          ) : (
            <FitText className="small" min={9}>{api.tier === 1 ? 'Slice the item you hear.' : 'Item, number, classifier. Count before you cut.'}</FitText>
          )}
        </div>
        <div className="label" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Slice it</div>
      </div>
    </div>
  );
}
