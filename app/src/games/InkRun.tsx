// Ink Run: letter rain. Consonants fall; one letter's name is called; write
// that letter before it lands. On touch devices you draw (pad at the bottom on
// phone, rain above and pad below on tablet). With a mouse you choose the
// letter from four (keys 1 to 4), and the side panel shows the letter forming
// from dots between letters.
//
// What counts as a review (the rule for all games):
// - Drawing, tier 1: the falling letters are visible, so the drawing can be a
//   copy. Picking which one to draw still needs you to know which letter has
//   the called name, so the answer counts on 'read'. The drawing itself is
//   logged on 'write' with its handwriting score, counts:false.
// - Drawing, tiers 2 to 4: the drops are veiled (no letter shown until it is
//   answered or lands), so you write from memory. Counts on 'write', with the
//   handwriting score; correct means the recogniser ranks the called letter
//   first among all consonants.
// - Choosing (mouse): counts on 'read'. Four options, look-alikes first from
//   tier 3.
// - The call is the letter's name. There is no Thai-script name field yet, so
//   the caption shows the romanised name (e.g. "dor dèk"); it never shows the
//   letter itself, which would give the answer away.
// - Tier 3 runs look-alike rounds: four calls in ten come from one pair
//   (บ/ป, ด/ต, น/ม) when both letters have been met.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { LetterFromDots } from '../anim';
import { PlayIcon } from '../audio/SoundLayer';
import { VOICES, type Letter, type Skill, type VoiceId } from '../content/types';
import type { GameItem } from '../engine/engine';
import { useKeys } from '../input/keys';
import { Label } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { handwritingScore, recognise, type Ink } from '../writing/recognise';
import { DrillShell, type DrillRunApi } from './shared/DrillShell';
import { pick, shuffle } from './shared/drill';
import { THAI_FONT, usePixi } from './shared/pixi';
import { RainScene, type Drop } from './parts/ink-rain';
import { InkPad } from './parts/ink-pad';

/** seconds for a drop to fall at speed 1 */
const FALL_SECONDS = 10;
const CALL_GAP_MS = 550;

type Mode = 'draw' | 'choose';

interface Result {
  letter: Letter;
  correct: boolean;
  /** what the drawing read as, or what was chosen, when wrong */
  as: Letter | null;
  how: 'drawn' | 'chosen' | 'landed';
}

interface View {
  last: Result | null;
  cue: number;
  hits: number;
  misses: number;
  mode: Mode;
  seen: boolean;
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

const isConsonant = (l: Letter | undefined) => !!l && l.cls !== 'vowel' && l.cls !== 'tonemark';

export default function InkRun() {
  const { content } = useApp();
  const { touch } = useDevice();
  const mode: Mode = touch ? 'draw' : 'choose';
  const feed = useMemo(() => createFeed({ last: null, cue: 0, hits: 0, misses: 0, mode, seen: false }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <DrillShell
      id="ink-run"
      title="Ink Run"
      tag="Letter rain"
      howTo={
        mode === 'draw'
          ? 'Letters fall. A letter’s name is called. Write that letter on the pad before it lands. From tier 2 the drops are veiled, so you write from memory.'
          : 'Letters fall. A letter’s name is called. Choose that letter before it lands. Drawing is on touch devices.'
      }
      controls={{
        touch: 'Write on the pad with a finger or pen.',
        keys: [['1 to 4', 'Choose a letter'], ['Space', 'Hear it again'], ['Esc', 'Pause']],
      }}
      request={() => ({
        skills: ['read', 'hear', 'write'],
        kinds: ['letter'],
        filter: (e) => isConsonant(content.letter(e.ref)),
        count: 90,
      })}
      minItems={6}
      lives={5}
      side={() => <InkPanel feed={feed} />}
    >
      {(api) => <InkGame api={api} feed={feed} mode={mode} />}
    </DrillShell>
  );
}

interface Call {
  drop: Drop;
  at: number;
  replays: number;
  voice: VoiceId;
  reported: boolean;
  options: Letter[];
}

function InkGame({ api, feed, mode }: { api: DrillRunApi; feed: Feed; mode: Mode }) {
  const { content, sound, engine, reducedMotion } = useApp();
  const { device, touch } = useDevice();
  const apiRef = useRef(api);
  apiRef.current = api;
  const tier = api.tier;
  const seen = mode === 'draw' && tier === 1;

  // distinct consonants, due and weak first
  const pool = useMemo(() => {
    const out: Letter[] = [];
    const seenIds = new Set<string>();
    for (const g of api.items as GameItem[]) {
      const l = content.letter(g.ref);
      if (!l || seenIds.has(l.id) || !isConsonant(l)) continue;
      seenIds.add(l.id);
      out.push(l);
    }
    return out;
  }, [api.items, content]);

  // look-alike pairs where both letters have been met
  const pairs = useMemo(() => {
    const ids = new Set(pool.map((l) => l.id));
    const out: [Letter, Letter][] = [];
    const done = new Set<string>();
    for (const l of pool) {
      for (const o of l.lookalikes) {
        const k = [l.id, o].sort().join('|');
        if (!ids.has(o) || done.has(k)) continue;
        done.add(k);
        out.push([l, content.letter(o)!]);
      }
    }
    return out;
  }, [pool, content]);

  const sceneRef = useRef<RainScene | null>(null);
  const st = useRef({
    drops: [] as Drop[],
    call: null as Call | null,
    nextId: 1,
    spawned: 0,
    spawnTimer: 0,
    callGate: 900,
    ready: false,
  });
  const [ui, setUi] = useState<{ call: { options: Letter[]; pair: boolean } | null; msg: { text: string; good: boolean } | null; clearKey: number }>({
    call: null, msg: null, clearKey: 0,
  });
  const clearPad = () => setUi((u) => ({ ...u, clearKey: u.clearKey + 1 }));

  const fallSeconds = () => FALL_SECONDS / apiRef.current.pace.speed;
  const maxDrops = seen ? 4 : 3;

  const pickLetter = (): { letter: Letter; pair: boolean } => {
    const s = st.current;
    const block = Math.floor(s.spawned / 10);
    if (tier >= 3 && pairs.length && s.spawned % 10 >= 6) {
      return { letter: pick(pairs[block % pairs.length]), pair: true };
    }
    const onScreen = new Set(s.drops.filter((d) => d.state === 'fall').map((d) => d.letter.id));
    const free = pool.filter((l) => !onScreen.has(l.id));
    const list = free.length ? free : pool;
    return { letter: list[Math.floor(Math.pow(Math.random(), 1.5) * list.length)], pair: false };
  };

  const spawn = () => {
    const s = st.current;
    const { letter, pair } = pickLetter();
    // spread across the width, away from the last drop
    const last = s.drops[s.drops.length - 1];
    let x = Math.random();
    if (last && Math.abs(last.x - x) < 0.25) x = (x + 0.5) % 1;
    s.drops.push({ id: s.nextId++, letter, x, p: 0, state: 'fall', called: false, pair, since: 0, tried: false });
    s.spawned++;
  };

  const optionsFor = (target: Letter): Letter[] => {
    const others = pool.filter((l) => l.id !== target.id);
    const looks = tier >= 3 ? others.filter((l) => target.lookalikes.includes(l.id) || l.lookalikes.includes(target.id)) : [];
    const rest = shuffle(others.filter((l) => !looks.includes(l)));
    return shuffle([target, ...[...looks, ...rest].slice(0, 3)]);
  };

  const play = (c: Call) => {
    void sound.play({
      ref: `letter:${c.drop.letter.id}`,
      thai: c.drop.letter.name,
      voice: c.voice,
      speed: tier === 1 ? 'slow' : 'normal',
      noise: tier === 4,
      speaker: 'Letter',
    });
  };

  const makeCall = () => {
    const s = st.current;
    const falling = s.drops.filter((d) => d.state === 'fall' && !d.called);
    let d: Drop | undefined;
    if (seen) {
      const early = falling.filter((x) => x.p < 0.45);
      d = early.length ? pick(early) : undefined;
    } else {
      d = falling.sort((a, b) => b.p - a.p)[0];
    }
    if (!d) return;
    d.called = true;
    const c: Call = {
      drop: d, at: performance.now(), replays: 0,
      voice: tier === 1 ? (s.spawned % 2 ? 'm1' : 'f1') : pick(VOICES),
      reported: false,
      options: mode === 'choose' ? optionsFor(d.letter) : [],
    };
    s.call = c;
    setUi((u) => ({ ...u, call: { options: c.options, pair: d!.pair } }));
    play(c);
  };

  const replay = () => {
    const c = st.current.call;
    if (!c) return;
    c.replays++;
    play(c);
  };

  const skillNow: Skill = mode === 'choose' || seen ? 'read' : 'write';

  const report = (c: Call, correct: boolean, extra: { blank?: boolean; as?: Letter | null; hand?: number | null } = {}) => {
    if (c.reported) return;
    c.reported = true;
    const ref = `letter:${c.drop.letter.id}`;
    const ms = Math.round(performance.now() - c.at);
    apiRef.current.answer({
      ref, skill: skillNow, correct, ms, replays: c.replays, blank: extra.blank,
      handwritingScore: skillNow === 'write' ? (extra.hand ?? null) : null,
      confusedWith: extra.as && extra.as.id !== c.drop.letter.id ? `letter:${extra.as.id}` : undefined,
      counts: true,
      points: correct ? 10 + Math.round(15 * apiRef.current.pace.speed) : 0,
      data: { mode, seen, tier, pair: c.drop.pair },
    });
    // tier 1 drawing: the drawing is logged on 'write' but could be a copy
    if (mode === 'draw' && seen && extra.hand != null) {
      engine.report({
        ref, skill: 'write', source: 'drill:ink-run', correct, ms, handwritingScore: extra.hand, counts: false,
        data: { seen: true, tier },
      });
    }
  };

  const at = (d: Drop) => sceneRef.current?.pos(d) ?? { x: 0, y: 0 };

  const finish = (r: Result) => {
    sound.stop();
    const v = feed.get();
    feed.set({ last: r, cue: v.cue + 1, hits: v.hits + (r.correct ? 1 : 0), misses: v.misses + (r.correct ? 0 : 1) });
    const l = r.letter;
    const text = r.correct
      ? `${l.char}  ${l.name} · ${l.keyword}`
      : r.how === 'landed'
        ? `Landed. It was ${l.char}, ${l.name}.`
        : `It was ${l.char}, ${l.name}${r.as ? `. You ${r.how === 'drawn' ? 'drew' : 'chose'} ${r.as.char}` : ''}.`;
    setUi((u) => ({ ...u, call: null, msg: { text, good: r.correct } }));
    clearPad();
  };

  const hit = (c: Call, retry: boolean) => {
    const s = st.current;
    c.drop.state = 'hit';
    c.drop.since = 0;
    s.call = null;
    s.callGate = CALL_GAP_MS;
    if (retry) apiRef.current.addScore(5);
    if (!reducedMotion) {
      const p = at(c.drop);
      apiRef.current.burst?.burst(p.x, p.y);
    }
    finish({ letter: c.drop.letter, correct: true, as: null, how: mode === 'draw' ? 'drawn' : 'chosen' });
  };

  const miss = (c: Call, how: Result['how'], as: Letter | null) => {
    const s = st.current;
    c.drop.state = 'miss';
    c.drop.since = 0;
    s.call = null;
    s.callGate = CALL_GAP_MS + 400;
    if (!reducedMotion) {
      const p = at(c.drop);
      apiRef.current.burst?.pull(p.x, p.y);
    }
    apiRef.current.loseLife();
    finish({ letter: c.drop.letter, correct: false, as, how });
  };

  // ---------- answers ----------

  const onInk = (ink: Ink) => {
    const c = st.current.call;
    if (!c || apiRef.current.paused) {
      clearPad();
      return;
    }
    const target = c.drop.letter;
    // every consonant is a candidate, met or not, so a drawing is read as
    // what it looks like (candidates are only compared, never introduced)
    const cands = new Map<string, Letter>();
    for (const l of content.letters) if (isConsonant(l)) cands.set(l.id, l);
    cands.set(target.id, target);
    const ranked = recognise(ink, [...cands.values()]);
    const top = ranked[0];
    const hand = handwritingScore(ink, target);
    const correct = !!top && top.id === target.id && top.score > 0;
    const as = top && top.score > 0 ? (cands.get(top.id) ?? null) : null;
    const first = !c.reported;
    report(c, correct, { as, hand });
    if (correct) {
      hit(c, !first);
      return;
    }
    c.drop.tried = true;
    if (!reducedMotion) {
      const p = at(c.drop);
      apiRef.current.burst?.pull(p.x, p.y);
    }
    setUi((u) => ({ ...u, msg: { text: as ? `That reads as ${as.char}. Again.` : 'Could not read that. Again.', good: false } }));
    clearPad();
  };

  const onChoose = (i: number) => {
    const c = st.current.call;
    if (!c || apiRef.current.paused) return;
    const l = c.options[i];
    if (!l) return;
    const correct = l.id === c.drop.letter.id;
    report(c, correct, { as: l });
    if (correct) hit(c, false);
    else miss(c, 'chosen', l);
  };

  // ---------- frame ----------

  const { host } = usePixi((app) => {
    const scene = new RainScene(app, reducedMotion);
    sceneRef.current = scene;
    const chars = pool.map((l) => l.char).join('');
    // start once the Thai font is in, so the first glyphs draw in it
    if (!document.fonts) st.current.ready = true;
    else
      document.fonts
        .load(`600 46px ${THAI_FONT.split(',')[0]}`, chars || 'ก')
        .catch(() => undefined)
        .finally(() => {
          st.current.ready = true;
        });
    const tick = () => {
      const s = st.current;
      const dt = Math.min(64, app.ticker.deltaMS);
      if (s.ready && !apiRef.current.paused && pool.length) {
        const fall = fallSeconds();
        for (const d of s.drops) {
          if (d.state === 'fall') d.p += dt / 1000 / fall;
          else d.since += dt;
        }
        // landings
        for (const d of s.drops) {
          if (d.state !== 'fall' || d.p < 1) continue;
          d.p = 1;
          if (s.call && s.call.drop === d) {
            report(s.call, false, { blank: !s.call.reported });
            miss(s.call, 'landed', null);
          } else {
            d.state = 'gone';
          }
        }
        for (const d of s.drops) if (d.state !== 'fall' && d.state !== 'gone' && d.since > 900) d.state = 'gone';
        s.drops = s.drops.filter((d) => d.state !== 'gone');
        // new drops
        s.spawnTimer -= dt;
        const fallingNow = s.drops.filter((d) => d.state === 'fall').length;
        if ((s.spawnTimer <= 0 || fallingNow === 0) && fallingNow < maxDrops) {
          spawn();
          s.spawnTimer = (fall * 1000) / maxDrops;
        }
        // the next call
        s.callGate -= dt;
        if (!s.call && s.callGate <= 0) makeCall();
      }
      scene.sync(s.drops, seen);
    };
    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
      scene.destroy();
      sceneRef.current = null;
    };
  });

  useEffect(() => () => sound.stop(), [sound]);
  useEffect(() => feed.set({ mode, seen }), [feed, mode, seen]);

  useKeys((a) => {
    if (api.paused) return;
    if (a.type === 'play') {
      replay();
      return true;
    }
    if (mode === 'choose' && a.type === 'rate' && a.n <= 4) {
      onChoose(a.n - 1);
      return true;
    }
    if (mode === 'draw' && a.type === 'key' && a.down && a.key === 'Backspace') {
      clearPad();
      return true;
    }
  });

  const padH = device === 'phone' ? 'min(36vh, 270px)' : 'clamp(240px, 40%, 420px)';
  const call = ui.call;
  const slots = Math.min(4, Math.max(2, pool.length));

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={host} style={{ position: 'relative', flex: 1, minHeight: 150 }} aria-hidden />
      {mode === 'draw' ? (
        <div style={{ height: padH, width: 'min(calc(100% - 32px), 620px)', margin: '8px auto 0', position: 'relative', flex: 'none' }}>
          <InkPad onInk={onInk} clearKey={ui.clearKey} disabled={!call} label={seen ? 'Draw the letter' : 'Write it from memory'} />
          <button className="pill small" type="button" onClick={clearPad} style={{ position: 'absolute', top: 6, right: 6 }}>Clear</button>
        </div>
      ) : (
        <div
          role="group"
          aria-label="Choose the letter"
          style={{ width: 'min(calc(100% - 32px), 620px)', margin: '8px auto 0', display: 'grid', gridTemplateColumns: `repeat(${slots}, 1fr)`, gap: 8, flex: 'none' }}
        >
          {Array.from({ length: slots }, (_, i) => {
            const l = call?.options[i];
            return (
              <button
                key={i}
                type="button"
                className="card"
                disabled={!l}
                onClick={() => onChoose(i)}
                style={{ minHeight: 92, display: 'grid', placeItems: 'center', position: 'relative', opacity: l ? 1 : 0.35, cursor: l ? 'pointer' : 'default' }}
                aria-label={l ? `Letter ${i + 1}: ${l.char}` : `Letter ${i + 1}`}
              >
                {!touch && <span className="kbd" style={{ position: 'absolute', top: 8, left: 8 }}>{i + 1}</span>}
                <span lang="th" style={{ fontFamily: 'var(--thai)', fontSize: 46, fontWeight: 600, lineHeight: 1 }}>{l?.char ?? ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* a fixed bar: the message has two lines kept for it, so the run above never resizes */}
      <div className="hrow" style={{ height: 'calc(116px + env(safe-area-inset-bottom))', padding: '12px var(--gutter) calc(14px + env(safe-area-inset-bottom))', width: 'min(100%, 660px)', margin: '0 auto', alignItems: 'flex-start', flex: 'none' }}>
        <button className="iconbtn" type="button" onClick={replay} disabled={!call} aria-label="Hear it again" style={{ opacity: call ? 1 : 0.4 }}>
          <PlayIcon />
        </button>
        <div className="grow" aria-live="polite">
          <Label fg={!!call}>{call ? (call.pair ? 'Look-alike round · listen' : 'Listen') : 'Next letter'}</Label>
          <FitText className="body" lang="th" lines={2} min={11} valign="top" style={{ marginTop: 4, color: ui.msg ? (ui.msg.good ? 'var(--fg)' : 'var(--bad)') : undefined }}>
            {ui.msg?.text ?? ''}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ---------- side panel ----------

function InkPanel({ feed }: { feed: Feed }) {
  const v = useSyncExternalStore(feed.subscribe, feed.get);
  const { device } = useDevice();
  const { reducedMotion } = useApp();
  const last = v.last;
  const n = v.hits + v.misses;
  // the stroke animation plays only between letters, in choose mode on desktop
  const strokes = v.mode === 'choose' && device === 'desktop' && !reducedMotion;
  return (
    <PanelScroll>
    <div className="stack gap-4" style={{ paddingTop: 8 }}>
      <div>
        <Label>Last letter</Label>
        {last ? (
          <div className="stack gap-2" style={{ marginTop: 8 }}>
            {strokes ? (
              <LetterFromDots key={v.cue} char={last.letter.char} strokes={last.letter.strokes} cue={v.cue} size={180} colour={last.correct ? '#E8E8E8' : '#FF5A4F'} />
            ) : (
              <div lang="th" className="thai-xl" style={{ color: last.correct ? 'var(--fg)' : 'var(--bad)' }}>{last.letter.char}</div>
            )}
            <div className="h-s">{last.letter.name}</div>
            <div className="small">
              {last.letter.keyword} · {last.letter.cls} class · sounds {last.letter.initial}
            </div>
            {!last.correct && (
              <div className="small bad">
                {last.how === 'landed' ? 'It landed.' : last.as ? `You ${last.how === 'drawn' ? 'drew' : 'chose'} ${last.as.char}, ${last.as.name}.` : 'Not read as a letter.'}
              </div>
            )}
          </div>
        ) : (
          <p className="small" style={{ marginTop: 8 }}>Each letter shows here once it is answered or lands.</p>
        )}
      </div>
      <hr className="rule" />
      <div className="stats">
        <div className="stat"><div className="label">Hits</div><div className="v num">{v.hits}</div></div>
        <div className="stat"><div className="label">Misses</div><div className="v num">{v.misses}</div></div>
        <div className="stat"><div className="label">Accuracy</div><div className="v num">{n ? Math.round((v.hits / n) * 100) : 0}%</div></div>
      </div>
      <hr className="rule" />
      <p className="small" style={{ margin: 0 }}>
        {v.mode === 'choose'
          ? 'Choosing counts as reading. Drawing is on touch devices.'
          : 'Tier 1 shows the letters, so it counts as reading and the drawing is logged. From tier 2 you write from memory and it counts as writing.'}
      </p>
    </div>
    </PanelScroll>
  );
}

/** The side panel scrolls inside the row instead of stretching the game. */
function PanelScroll({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 200 }}>
      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingRight: 4 }}>{children}</div>
    </div>
  );
}
