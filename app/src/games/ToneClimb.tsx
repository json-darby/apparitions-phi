// Tone Climb: an upright tower. Hear a syllable, jump to the platform shaped
// like its tone. Five lanes, each platform drawn as one of the five tone
// contours, so the shape itself is the memory aid. A wrong landing crumbles
// and the tide climbs; if the tide reaches you, a life goes.
//
// What counts as a review (the rule for all games):
// - The answer is reported on the item's 'tone' skill. Items whose tone card
//   has not opened yet still appear (they are met), and the engine logs their
//   answers without scheduling them.
// - Captions mode (sound.mode === 'captions', Phases 1 to 3): the caption shows
//   the Thai script, and anyone who knows the tone rules could read the tone
//   off it instead of hearing it. So nothing counts in captions mode; answers
//   are logged only. Once real audio exists (sound.mode === 'audio') the
//   caption is gone and tone answers count.
// - Tier 3 speaking floors use sound.record. A tap ("I said it") proves
//   nothing, so it is logged with counts:false; a scored recording counts on
//   the 'say' skill.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { TONE_LABEL } from '../audio/sound';
import { TONES, VOICES, type Item, type Tone, type VoiceId } from '../content/types';
import type { GameItem } from '../engine/engine';
import { useKeys } from '../input/keys';
import { Label } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { PlayIcon } from '../audio/SoundLayer';
import { DrillShell, type DrillRunApi } from './shared/DrillShell';
import { pick, shuffle } from './shared/drill';
import { usePixi } from './shared/pixi';
import { ClimbScene, CHECKPOINT_FLOORS, LANES, METRES_PER_FLOOR } from './parts/climb-scene';
import { TONE_COLOUR, ToneContour, WordContour } from './parts/climb-contour';

const KEYS = ['a', 's', 'd', 'f', 'g'];
const TIDE_START = 1.8;
const TIDE_MAX = 2.4;
/** floors per second the tide rises at speed 1 */
const TIDE_RATE = 0.1;
/** on tier 3 and up, every this many climbs is a speaking floor */
const SPEAK_EVERY = 5;

// ---------- shared view between the tower and the side panel ----------

interface Result {
  item: Item;
  syl: number;
  heard: Tone;
  chosen: Tone | null;
  correct: boolean;
}

interface View {
  last: Result | null;
  history: Result[];
  lanes: Tone[];
  floor: number;
  prompt: { syl: number; of: number } | null;
  note: string | null;
  /** tone names beside the lanes (tiers 1 and 2; shapes only after) */
  names: boolean;
}

function createFeed(initial: View) {
  let v = initial;
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set(patch: Partial<View>) {
      v = { ...v, ...patch };
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}
type Feed = ReturnType<typeof createFeed>;

function useFeed(feed: Feed) {
  return useSyncExternalStore(feed.subscribe, feed.get);
}

// ---------- the drill ----------

export default function ToneClimb() {
  const feed = useMemo(() => createFeed({ last: null, history: [], lanes: TONES, floor: 0, prompt: null, note: null, names: true }), []);
  return (
    <DrillShell
      id="tone-climb"
      title="Tone Climb"
      tag="Platformer"
      howTo="Hear a syllable, then jump to the platform shaped like its tone. A wrong landing crumbles and the tide climbs. If the tide reaches you, a life goes."
      controls={{
        touch: 'Tap a lane or the shape under it.',
        keys: [['A S D F G', 'Jump to a lane'], ['Space', 'Hear it again'], ['Esc', 'Pause']],
      }}
      request={() => ({
        skills: ['tone', 'hear'],
        kinds: ['item'],
        filter: (e) => e.skills.includes('tone'),
        count: 120,
      })}
      minItems={4}
      lives={3}
      side={() => <ClimbPanel feed={feed} />}
    >
      {(api) => <ClimbGame api={api} feed={feed} />}
    </DrillShell>
  );
}

interface Prompt {
  item: Item;
  ref: string;
  syl: number;
  tone: Tone;
  startedAt: number;
  replays: number;
  voice: VoiceId;
}

type Phase = 'starting' | 'asking' | 'busy' | 'speaking';

function ClimbGame({ api, feed }: { api: DrillRunApi; feed: Feed }) {
  const { content, sound, engine, reducedMotion } = useApp();
  const { touch, device } = useDevice();
  const apiRef = useRef(api);
  apiRef.current = api;
  const tier = api.tier;
  const counts = sound.mode !== 'captions';

  // distinct words, weakest and due first (the engine's order)
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: { ref: string; item: Item }[] = [];
    for (const g of api.items as GameItem[]) {
      if (seen.has(g.ref)) continue;
      seen.add(g.ref);
      const item = content.item(g.ref);
      if (item && item.tones.length) out.push({ ref: g.ref, item });
    }
    return out;
  }, [api.items, content]);

  const sceneRef = useRef<ClimbScene | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const st = useRef({
    phase: 'starting' as Phase,
    prompt: null as Prompt | null,
    retest: [] as { ref: string; item: Item; after: number }[],
    asked: 0,
    climbs: 0,
    lastRef: '',
    streak: 0,
  });
  const [ui, setUi] = useState<{ phase: Phase; prompt: { syl: number; of: number } | null; msg: string | null; good: boolean | null; lanes: Tone[]; floor: number }>({
    phase: 'starting', prompt: null, msg: null, good: null, lanes: TONES, floor: 0,
  });

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };

  const lanesFor = (): Tone[] => (tier >= 3 ? shuffle(TONES) : [...TONES]);

  const ensureFloors = (scene: ClimbScene) => {
    while (scene.floors.length < scene.cur + 4) scene.floors.push(lanesFor());
  };

  const sync = (patch: Partial<typeof ui> = {}) => {
    const scene = sceneRef.current;
    const lanes = scene ? (scene.floors[scene.cur + 1] ?? TONES) : TONES;
    const floor = scene?.cur ?? 0;
    setUi((u) => ({ ...u, lanes, floor, phase: st.current.phase, ...patch }));
    feed.set({ lanes, floor, names: tier <= 2 });
  };

  const pickWord = (): { ref: string; item: Item } => {
    const s = st.current;
    const due = s.retest.find((r) => r.after <= s.asked && r.ref !== s.lastRef);
    if (due) {
      s.retest = s.retest.filter((r) => r !== due);
      return due;
    }
    const single = pool.filter((p) => p.item.tones.length === 1);
    // tier 1 keeps to one-syllable words when there are enough of them
    const useSingle = single.length >= 4 && (tier === 1 || Math.random() < 0.7);
    const from = (useSingle ? single : pool).filter((p) => p.ref !== s.lastRef);
    const list = from.length ? from : pool;
    // bias toward the front: due and weak first
    return list[Math.floor(Math.pow(Math.random(), 1.6) * list.length)];
  };

  const play = (p: Prompt) => {
    void sound.play({
      ref: p.ref,
      thai: p.item.thai,
      tones: p.item.tones,
      voice: p.voice,
      speed: tier === 1 ? 'slow' : 'normal',
      noise: tier === 4,
      hideRoman: true,
    });
  };

  const nextPrompt = () => {
    const scene = sceneRef.current;
    if (!scene || !pool.length) return;
    const s = st.current;
    ensureFloors(scene);
    const w = pickWord();
    const syl = Math.floor(Math.random() * w.item.tones.length);
    const voice: VoiceId = tier === 1 ? (s.asked % 2 ? 'm1' : 'f1') : pick(VOICES);
    const p: Prompt = { item: w.item, ref: w.ref, syl, tone: w.item.tones[syl], startedAt: performance.now(), replays: 0, voice };
    s.prompt = p;
    s.lastRef = w.ref;
    s.asked++;
    s.phase = 'asking';
    const pr = { syl, of: w.item.tones.length };
    sync({ prompt: pr, msg: null, good: null });
    feed.set({ prompt: pr, note: null });
    play(p);
  };

  const replay = () => {
    const p = st.current.prompt;
    if (!p || st.current.phase !== 'asking') return;
    p.replays++;
    play(p);
  };

  const burstAt = (f: number, lane: number, good: boolean, colour?: string) => {
    if (reducedMotion) return;
    const scene = sceneRef.current;
    const b = apiRef.current.burst;
    if (!scene || !b) return;
    const { x, y } = scene.platformScreen(f, lane);
    if (good) b.burst(x, y, colour);
    else b.pull(x, y, colour);
  };

  const record = (r: Result) => {
    const h = [r, ...feed.get().history].slice(0, 8);
    feed.set({ last: r, history: h });
  };

  const choose = (lane: number) => {
    const s = st.current;
    const scene = sceneRef.current;
    const p = s.prompt;
    if (s.phase !== 'asking' || !scene || !p || apiRef.current.paused) return;
    const target = scene.cur + 1;
    const lanes = scene.floors[target];
    if (!lanes) return;
    const chosen = lanes[lane];
    const correct = chosen === p.tone;
    const ms = Math.round(performance.now() - p.startedAt);
    s.phase = 'busy';
    s.prompt = null;
    sound.stop();
    const speed = apiRef.current.pace.speed;
    apiRef.current.answer({
      ref: p.ref, skill: 'tone', correct, ms, replays: p.replays, counts,
      points: correct ? 10 + Math.round(10 * speed) + Math.min(20, s.streak * 2) : 0,
      data: { syllable: p.syl, heard: p.tone, chosen, tier, captions: !counts },
    });
    record({ item: p.item, syl: p.syl, heard: p.tone, chosen, correct });
    const word = `${p.item.thai} ${p.item.roman}`;
    if (correct) {
      s.streak++;
      s.climbs++;
      burstAt(target, lane, true, TONE_COLOUR[chosen]);
      scene.tide = Math.min(TIDE_MAX, scene.tide + 1);
      // a contrast partner soon after, on the look-alike tiers
      if (tier >= 3 && p.item.contrasts?.length) {
        const partner = pool.find((x) => p.item.contrasts!.includes(x.item.id));
        if (partner && Math.random() < 0.6) s.retest.push({ ...partner, after: s.asked + 1 });
      }
      sync({ msg: `${TONE_LABEL[p.tone]}. ${word}`, good: true, prompt: null });
      scene.jump(lane, () => {
        const f = scene.cur;
        if (f % CHECKPOINT_FLOORS === 0) {
          apiRef.current.addScore(50);
          scene.tide = TIDE_MAX;
          feed.set({ note: `Checkpoint, ${f * METRES_PER_FLOOR} m. The tide falls back.` });
        }
        ensureFloors(scene);
        sync();
        later(reducedMotion ? 450 : 350, () => {
          if (tier >= 3 && s.climbs % SPEAK_EVERY === 0) speak(p);
          else nextPrompt();
        });
      });
    } else {
      s.streak = 0;
      const right = lanes.indexOf(p.tone);
      scene.crumble(target, lane, right);
      burstAt(target, lane, false, TONE_COLOUR[chosen]);
      scene.tide -= 0.5;
      s.retest.push({ ref: p.ref, item: p.item, after: s.asked + 3 });
      sync({ msg: `${TONE_LABEL[p.tone]}, not ${TONE_LABEL[chosen].toLowerCase()}. ${word}`, good: false, prompt: null });
      if (scene.tide <= 0) {
        caught(false);
        return;
      }
      later(1400, () => {
        scene.restore(target);
        nextPrompt();
      });
    }
  };

  /** The tide reached the player. */
  const caught = (pending: boolean) => {
    const s = st.current;
    const scene = sceneRef.current;
    if (!scene) return;
    const p = s.prompt;
    if (pending && p) {
      apiRef.current.answer({
        ref: p.ref, skill: 'tone', correct: false, blank: true, ms: Math.round(performance.now() - p.startedAt),
        replays: p.replays, counts, data: { syllable: p.syl, heard: p.tone, tier, captions: !counts },
      });
      record({ item: p.item, syl: p.syl, heard: p.tone, chosen: null, correct: false });
      s.retest.push({ ref: p.ref, item: p.item, after: s.asked + 3 });
    }
    s.phase = 'busy';
    s.prompt = null;
    s.streak = 0;
    sound.stop();
    apiRef.current.loseLife();
    scene.tide = TIDE_START;
    const msg = pending && p ? `The tide caught you. It was ${TONE_LABEL[p.tone].toLowerCase()}: ${p.item.thai} ${p.item.roman}` : 'The tide caught you.';
    sync({ msg, good: false, prompt: null });
    later(1600, () => {
      scene.restore(scene.cur + 1);
      nextPrompt();
    });
  };

  /** Tier 3 and up: say the word you just climbed on. */
  const speak = async (p: Prompt) => {
    const s = st.current;
    s.phase = 'speaking';
    sync({ msg: 'Say the word.', good: null, prompt: null });
    const target = { ref: p.ref, thai: p.item.thai, en: p.item.en, tones: p.item.tones };
    const rec = await sound.record(target);
    if (!sceneRef.current) return;
    if (rec) {
      const score = await sound.score(rec, target);
      if (score) {
        const ok = score.overall >= 0.6;
        apiRef.current.answer({
          ref: p.ref, skill: 'say', correct: ok, speechScore: score.overall, ms: rec.ms, counts: true,
          points: ok ? 30 : 0, data: { tier, tones: score.tones },
        });
      } else {
        // a tap in captions mode: logged, not scheduled
        engine.report({ ref: p.ref, skill: 'say', source: 'drill:tone-climb', counts: false, ms: rec.ms, data: { tap: true, tier } });
        apiRef.current.addScore(10);
      }
    }
    nextPrompt();
  };

  // ---------- Pixi ----------

  const { host } = usePixi((app) => {
    const scene = new ClimbScene(app, reducedMotion);
    sceneRef.current = scene;
    scene.tide = TIDE_START;
    scene.tideMax = TIDE_MAX;
    ensureFloors(scene);
    sync();
    const tick = () => {
      const dt = Math.min(64, app.ticker.deltaMS);
      if (controlsRef.current) scene.bottomInset = controlsRef.current.offsetHeight;
      const s = st.current;
      if (!apiRef.current.paused && s.phase === 'asking') {
        scene.tide -= (TIDE_RATE * apiRef.current.pace.speed * dt) / 1000;
        if (scene.tide <= 0) caught(true);
      }
      scene.update(dt);
    };
    app.ticker.add(tick);
    later(500, nextPrompt);
    return () => {
      app.ticker.remove(tick);
      scene.destroy();
      sceneRef.current = null;
    };
  });

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const x of t) clearTimeout(x);
      t.clear();
      sound.stop();
      // a speaking floor still open when the round ends
      if (sound.getState().recording) sound.finishRecording(true);
    };
  }, [sound]);

  useKeys((a, e) => {
    if (api.paused || sound.getState().recording) return;
    if (a.type === 'play') {
      replay();
      return true;
    }
    if ((a.type === 'move' || a.type === 'key') && a.down && !e.repeat) {
      const i = KEYS.indexOf(e.key.toLowerCase());
      if (i >= 0) {
        choose(i);
        return true;
      }
    }
  });

  const onTowerTap = (ev: React.PointerEvent<HTMLDivElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const lane = scene.laneAt(ev.clientX - r.left, ev.clientY - r.top);
    if (lane != null) choose(lane);
  };

  const showNames = tier <= 2;
  const showKeys = !touch;
  const asking = ui.phase === 'asking';

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} onPointerDown={onTowerTap} aria-hidden />
      <div className="label" style={{ position: 'absolute', top: 6, left: 'var(--gutter)', pointerEvents: 'none' }}>
        Height <span className="fg num" style={{ color: 'var(--fg)', marginLeft: 6 }}>{ui.floor * METRES_PER_FLOOR} m</span>
      </div>
      <div
        ref={controlsRef}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(to bottom, rgba(5,5,5,0), rgba(5,5,5,.92) 22px)',
          paddingTop: 18,
        }}
      >
        <div
          role="group"
          aria-label="Lanes"
          style={{ width: 'min(calc(100% - 24px), 520px)', margin: '0 auto', display: 'grid', gridTemplateColumns: `repeat(${LANES}, 1fr)`, gap: 6 }}
        >
          {ui.lanes.map((tone, i) => (
            <button
              key={i}
              type="button"
              onClick={() => choose(i)}
              disabled={!asking}
              aria-label={`Lane ${i + 1}${showNames ? `, ${TONE_LABEL[tone]}` : ''}`}
              style={{
                minHeight: 60, border: '1px solid var(--rule-strong)', borderRadius: 8, background: 'rgba(255,255,255,.02)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 2px',
                opacity: asking ? 1 : 0.55,
              }}
            >
              <ToneContour tone={tone} w={44} h={20} />
              {(showNames || showKeys) && (
                <span style={{ fontSize: device === 'phone' ? 9 : 10, fontWeight: 600, letterSpacing: device === 'phone' ? '0.04em' : '0.12em', textTransform: 'uppercase', color: 'var(--mut)', display: 'flex', gap: 5, alignItems: 'center' }}>
                  {showKeys && <span className="kbd">{KEYS[i].toUpperCase()}</span>}
                  {showNames && <span>{TONE_LABEL[tone]}</span>}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* a fixed bar: label, two kept lines of message, the captions note; the tower above never moves */}
        <div className="hrow" style={{ height: 'calc(116px + env(safe-area-inset-bottom))', padding: '12px var(--gutter) calc(14px + env(safe-area-inset-bottom))', width: 'min(100%, 640px)', margin: '0 auto', alignItems: 'flex-start' }}>
          <button className="iconbtn" type="button" onClick={replay} disabled={!asking} aria-label="Hear it again" style={{ opacity: asking ? 1 : 0.4 }}>
            <PlayIcon />
          </button>
          <div className="grow" aria-live="polite">
            <Label fg={!!ui.prompt}>{ui.prompt ? 'Listen and jump' : ui.msg ? (ui.good == null ? 'Speak' : ui.good ? 'Right' : 'Missed') : 'Get ready'}</Label>
            <FitText
              className="body"
              lines={!counts && device === 'phone' ? 1 : 2}
              min={11}
              valign="top"
              style={{ marginTop: 4, color: !ui.prompt && ui.msg ? (ui.good === false ? 'var(--bad)' : ui.good ? 'var(--fg)' : undefined) : undefined }}
            >
              {ui.prompt ? (
                ui.prompt.of > 1 ? `Syllable ${ui.prompt.syl + 1} of ${ui.prompt.of}. Which tone?` : 'Which tone?'
              ) : ui.msg ? (
                <span lang="th">{ui.msg}</span>
              ) : (
                ''
              )}
            </FitText>
            {!counts && device === 'phone' && <div className="small" style={{ marginTop: 4 }}>Captions mode: logged, not scheduled.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- side panel: the pitch panel ----------

function ClimbPanel({ feed }: { feed: Feed }) {
  const v = useFeed(feed);
  const { sound } = useApp();
  const { touch } = useDevice();
  const last = v.last;
  return (
    <PanelScroll>
    <div className="stack gap-4" style={{ paddingTop: 8 }}>
      <div>
        <Label>Pitch</Label>
        {last ? (
          <div className="stack gap-2" style={{ marginTop: 10 }}>
            <WordContour tones={last.item.tones} focus={last.syl} />
            <div className="thai-l" lang="th">{last.item.thai}</div>
            <div className="roman">
              {romanParts(last.item).map((r, i, a) => (
                <span key={i} style={{ color: i === last.syl ? 'var(--fg)' : 'var(--mut)', fontWeight: i === last.syl ? 600 : 400 }}>
                  {r}
                  {i < a.length - 1 ? ' ' : ''}
                </span>
              ))}
              <span className="mut"> · {last.item.en}</span>
            </div>
            <div className="small">
              Heard <span style={{ color: TONE_COLOUR[last.heard] }}>{TONE_LABEL[last.heard].toLowerCase()}</span>
              {last.item.tones.length > 1 ? ` on syllable ${last.syl + 1}` : ''}.{' '}
              {last.chosen ? (
                <span className={last.correct ? 'good' : 'bad'}>You jumped to {TONE_LABEL[last.chosen].toLowerCase()}.</span>
              ) : (
                <span className="bad">No jump.</span>
              )}
            </div>
          </div>
        ) : (
          <p className="small" style={{ marginTop: 10 }}>The pitch line of each word shows here after you jump.</p>
        )}
      </div>
      {v.note && <p className="small" style={{ margin: 0, color: 'var(--cyan)' }}>{v.note}</p>}
      <hr className="rule" />
      <div>
        <Label>Next floor</Label>
        <div className="stack" style={{ marginTop: 8 }}>
          {v.lanes.map((t, i) => (
            <div key={i} className="hrow" style={{ padding: '5px 0' }}>
              {!touch && <span className="kbd">{KEYS[i].toUpperCase()}</span>}
              <ToneContour tone={t} w={50} h={20} />
              {v.names && <span className="small" style={{ color: 'var(--fg-2)' }}>{TONE_LABEL[t]}</span>}
            </div>
          ))}
        </div>
      </div>
      {v.history.length > 0 && (
        <>
          <hr className="rule" />
          <div>
            <Label>This round</Label>
            <div className="stack" style={{ marginTop: 6 }}>
              {v.history.map((h, i) => (
                <div key={i} className="hrow between" style={{ padding: '4px 0', borderTop: i ? '1px solid var(--rule)' : 0 }}>
                  <span lang="th" className="thai" style={{ fontSize: 17 }}>{h.item.thai}</span>
                  <span className="small">
                    {TONE_LABEL[h.heard]} <span className={h.correct ? 'good' : 'bad'}>{h.correct ? 'right' : 'missed'}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {sound.mode === 'captions' && (
        <p className="small" style={{ margin: 0 }}>
          Captions mode. The caption shows the Thai, which gives the tone away to anyone who knows the rules, so these answers are logged, not scheduled. They count once real audio arrives.
        </p>
      )}
    </div>
    </PanelScroll>
  );
}

function romanParts(it: Item): string[] {
  const parts = it.roman.split(/[- ]/);
  return parts.length === it.tones.length ? parts : [it.roman];
}


/** The side panel scrolls inside the row instead of stretching the game. */
function PanelScroll({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 200 }}>
      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingRight: 4 }}>{children}</div>
    </div>
  );
}
