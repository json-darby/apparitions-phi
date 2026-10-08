// Sentence builder: put word tiles in the right order, from the worked
// examples of patterns the learner has met, using only words they have met.
// Drag on touch; tap, click or number keys anywhere. Logged as a 'read' answer
// for the pattern; it only counts once the pattern is met.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link } from '../../app/router';
import { PlayIcon } from '../../audio/SoundLayer';
import { useKeys } from '../../input/keys';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RunRail, Screen, TopBar } from '../../ui/kit';
import { patternThai, shuffle } from './parts/common';
import { usableExercises, type Exercise } from './parts/sentences';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

const MAX = 8;

function meaning(e: Exercise): string {
  const slots = e.tiles.filter((t) => t.slot);
  if (slots.length === 1 && /\bX\b/.test(e.pattern.en)) return e.pattern.en.replace(/\bX\b/, slots[0].en);
  // a structural frame ("not + verb"): the glosses read as the meaning
  if (e.pattern.en.includes('+')) return e.tiles.map((t) => t.en).join(' ');
  return slots.map((t) => t.en).join(' · ');
}

function scramble(n: number): number[] {
  const base = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return base;
  let s = shuffle(base);
  for (let k = 0; k < 6 && s.every((v, i) => v === i); k++) s = shuffle(base);
  return s;
}

export default function SentenceBuilder() {
  const { engine, content, sound, settings } = useApp();
  const { device } = useDevice();

  // met patterns, met words: nothing from later in the course
  const [{ exercises, patternsMet }] = useState(() => {
    const metRefs = engine.introducedRefs();
    const isMet = (ref: string) => metRefs.has(ref) && (settings.adult || !content.entry(ref)?.adult);
    return {
      exercises: shuffle(usableExercises(content.patterns, content.items, isMet)).slice(0, MAX),
      patternsMet: content.patterns.some((p) => isMet(`pattern:${p.id}`)),
    };
  });

  const [at, setAt] = useState(0);
  const cur = exercises[at];
  const [poolOrder, setPoolOrder] = useState<number[]>(() => (cur ? scramble(cur.tiles.length) : []));
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<null | boolean>(null);
  const [logged, setLogged] = useState(false);
  const [hints, setHints] = useState(0);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const t0 = useRef(performance.now());

  // drag state
  const drag = useRef<{ idx: number; from: 'pool' | 'row'; x: number; y: number; moved: boolean; pid: number } | null>(null);
  const [ghost, setGhost] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const suppressClick = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    t0.current = performance.now();
  }, [at]);

  const pool = poolOrder.filter((i) => !placed.includes(i));
  const done = !cur;

  const place = (idx: number, at?: number) => {
    if (result === true) return;
    setResult(null);
    setPlaced((p) => {
      const without = p.filter((x) => x !== idx);
      const pos = at == null ? without.length : Math.max(0, Math.min(at, without.length));
      return [...without.slice(0, pos), idx, ...without.slice(pos)];
    });
  };
  const unplace = (idx: number) => {
    if (result === true) return;
    setResult(null);
    setPlaced((p) => p.filter((x) => x !== idx));
  };

  const check = () => {
    if (!cur || placed.length !== cur.tiles.length || result === true) return;
    const ok = placed.map((i) => cur.tiles[i].thai).join('|') === cur.tiles.map((t) => t.thai).join('|');
    setResult(ok);
    if (!logged) {
      const ref = `pattern:${cur.pattern.id}`;
      engine.answer({
        ref,
        skill: 'read',
        source: 'sentence-builder',
        correct: ok,
        ms: Math.round(performance.now() - t0.current),
        hints,
        counts: engine.isIntroduced(ref),
        data: { example: cur.ex, order: placed },
      });
      setLogged(true);
      setScore((s) => ({ right: s.right + (ok ? 1 : 0), done: s.done + 1 }));
    }
  };

  const next = () => {
    const n = at + 1;
    setAt(n);
    setPlaced([]);
    setResult(null);
    setLogged(false);
    setHints(0);
    setPoolOrder(exercises[n] ? scramble(exercises[n].tiles.length) : []);
  };

  const hint = () => {
    if (!cur || result === true) return;
    // put the first wrong-or-missing position right
    const k = placed.findIndex((idx, i) => cur.tiles[idx].thai !== cur.tiles[i].thai);
    const pos = k === -1 ? placed.length : k;
    if (pos >= cur.tiles.length) return;
    const want = cur.tiles.findIndex((t, i) => t.thai === cur.tiles[pos].thai && !placed.slice(0, pos).includes(i));
    setHints((h) => h + 1);
    setPlaced((p) => {
      const kept = p.slice(0, pos).filter((x) => x !== want);
      return [...kept, want];
    });
    setResult(null);
  };

  const hear = () => {
    if (!cur) return;
    const t = patternThai(cur.pattern, cur.ex);
    sound.play({ ref: `pattern:${cur.pattern.id}`, thai: t.thai, roman: t.roman, en: meaning(cur) });
  };

  useKeys((a) => {
    if (done) return;
    if (a.type === 'confirm') {
      if (result === true) next();
      else check();
      return true;
    }
    if (a.type === 'rate' || (a.type === 'key' && a.down && /^[7-9]$/.test(a.key))) {
      const n = a.type === 'rate' ? a.n : Number((a as { key: string }).key);
      const idx = pool[n - 1];
      if (idx != null) place(idx);
      return true;
    }
    if (a.type === 'key' && a.down && a.key === 'Backspace') {
      const last = placed[placed.length - 1];
      if (last != null) unplace(last);
      return true;
    }
    if (a.type === 'play') {
      hear();
      return true;
    }
  });

  // ---- drag ----
  const insertIndexAt = (x: number, y: number): number => {
    const row = rowRef.current;
    if (!row) return placed.length;
    const els = [...row.querySelectorAll<HTMLElement>('[data-row-idx]')];
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (y < r.top - 6) return i;
      if (y <= r.bottom + 6 && x < r.left + r.width / 2) return i;
    }
    return els.length;
  };
  const inside = (el: HTMLElement | null, x: number, y: number) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  // moves and the drop are followed on the window, so a drag can leave the tile
  const live = useRef({ onMove: (_e: PointerEvent) => {}, onUp: (_e: PointerEvent) => {} });
  const onDown = (idx: number, from: 'pool' | 'row') => (e: React.PointerEvent) => {
    if (result === true || e.button !== 0) return;
    drag.current = { idx, from, x: e.clientX, y: e.clientY, moved: false, pid: e.pointerId };
    const move = (ev: PointerEvent) => live.current.onMove(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      live.current.onUp(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
    d.moved = true;
    setGhost({ idx: d.idx, x: e.clientX, y: e.clientY });
    setOver(inside(rowRef.current, e.clientX, e.clientY));
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    setOver(false);
    if (!d || !d.moved || e.type === 'pointercancel') return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (inside(rowRef.current, e.clientX, e.clientY)) {
      let pos = insertIndexAt(e.clientX, e.clientY);
      if (d.from === 'row') {
        const cur = placed.indexOf(d.idx);
        if (cur !== -1 && cur < pos) pos -= 1;
      }
      place(d.idx, pos);
    } else if (d.from === 'row') {
      unplace(d.idx);
    }
  };
  live.current = { onMove, onUp };

  if (!exercises.length) {
    return (
      <Screen top={<TopBar mid="Sentence builder" parent="/" />} narrow>
        <div className="prompt">
          <Label>Sentence builder</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>{patternsMet ? 'Nothing to build yet.' : 'No patterns yet.'}</h1>
          <p className="body">
            {patternsMet
              ? 'The patterns you have met use words still to come. They open here once those words are in.'
              : 'Sentence patterns start once you have met your first pattern. Patterns arrive with the new items.'}
          </p>
        </div>
        <div className="learn-foot">
          <div className="btn-row">
            <Link to="/" className="pill" style={{ textDecoration: 'none' }}>Today</Link>
            <Link to="/new" className="pill solid" style={{ textDecoration: 'none' }}>New items</Link>
          </div>
        </div>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen top={<TopBar mid="Sentence builder" parent="/" />} narrow>
        <div className="prompt">
          <Label>Sentence builder · done</Label>
          <div className="big-score" style={{ marginTop: 14 }}>{score.right}/{score.done}</div>
          <p className="body">First tries in the right order. Patterns you have met count as reading reviews.</p>
        </div>
        <div className="learn-foot">
          <div className="btn-row">
            <Link to="/review" className="pill" style={{ textDecoration: 'none' }}>Review</Link>
            <ContinueLink current="sentence" />
          </div>
        </div>
      </Screen>
    );
  }

  const tile = (idx: number, from: 'pool' | 'row', n?: number, rowIdx?: number) => {
    const t = cur.tiles[idx];
    return (
      <button
        key={`${from}-${idx}`}
        type="button"
        className={`tile ${ghost?.idx === idx ? 'ghosted' : ''}`}
        data-row-idx={rowIdx}
        onPointerDown={onDown(idx, from)}
        onClick={() => {
          if (suppressClick.current) return;
          if (from === 'pool') place(idx);
          else unplace(idx);
        }}
        aria-label={`${t.thai}, ${t.roman}, ${t.en}${from === 'row' ? ', placed' : ''}`}
      >
        {n != null && <span className="kbd">{n}</span>}
        <span className="thai" lang="th">{t.thai}</span>
        <span className="small">{t.roman}</span>
      </button>
    );
  };

  const metPattern = engine.isIntroduced(`pattern:${cur.pattern.id}`);
  const note = (
    <div className="stack gap-3" style={{ paddingTop: 8 }}>
      <Label>Pattern</Label>
      <FitText className="thai-l" lang="th" min={18}>{cur.pattern.frame}</FitText>
      <FitText className="h-s" lines={2} min={13} valign="top">{cur.pattern.en}</FitText>
      <p className="body" style={{ margin: 0 }}>{cur.pattern.note}</p>
      <p className="small" style={{ margin: 0 }}>Met: this counts as a reading review.</p>
      <div className="stack gap-1">
        <Label>Score</Label>
        <div className="h-m num">{score.right} / {score.done}</div>
      </div>
    </div>
  );

  // the row and the tray each keep room for two rows of tiles, the most any sentence here needs,
  // so a tile moving from one to the other never makes either change size
  return (
    <Screen top={<TopBar mid="Sentence builder" parent="/" />} panel={device === 'phone' ? undefined : note} narrow={device === 'desktop'}>
      <RunRail n={at} total={exercises.length} left={`Sentence builder · ${at + 1} of ${exercises.length}`} right={metPattern ? 'Counts' : 'Practice'} />
      <div className="sb-prompt">
        <FitText className="label" min={8}>{`Put it in order · ${cur.pattern.en}`}</FitText>
        <FitText as="h1" className="h-l" lines={2} min={18}>{meaning(cur)}</FitText>
        {device === 'phone' && <FitText as="p" className="small" lines={3} min={10} valign="top">{cur.pattern.note}</FitText>}
      </div>

      <div className="stack gap-2">
        <Label>Your sentence</Label>
        <div ref={rowRef} className={`tile-drop ${over ? 'over' : ''} ${result === true ? 'right' : result === false ? 'wrong' : ''}`} aria-label="Your sentence">
          {placed.length === 0 && <span className="small">{device === 'phone' ? 'Tap or drag tiles here' : 'Click tiles, drag them, or press their numbers'}</span>}
          {placed.map((idx, i) => tile(idx, 'row', undefined, i))}
        </div>
      </div>

      <div className="stack gap-2" style={{ marginTop: 18 }}>
        <Label>Tiles</Label>
        <div ref={poolRef} className="tiles">
          {pool.map((idx, i) => tile(idx, 'pool', device === 'desktop' ? i + 1 : undefined))}
        </div>
      </div>

      <FitText as="p" className="body sb-fb" lines={2} min={11} valign="top">
        {result === false && (
          <>
            <span className="bad">Not that order.</span> It goes <span className="thai">{cur.tiles.map((t) => t.thai).join(' ')}</span>. Move tiles to fix it, or go on.
          </>
        )}
        {result === true && (
          <>
            <span className="good">Right.</span> {patternThai(cur.pattern, cur.ex).roman}.
          </>
        )}
      </FitText>

      <div className="learn-foot">
        <div className="btn-row three">
          <button className="pill" type="button" onClick={hint} disabled={result === true}>Hint</button>
          <button className="pill" type="button" onClick={hear}><PlayIcon size={12} /> Hear</button>
          {result === true || result === false ? (
            <button className="pill solid" type="button" onClick={result === true ? next : check} disabled={result === false && placed.length !== cur.tiles.length}>
              {result === true ? (at + 1 >= exercises.length ? 'Finish' : 'Next') : 'Check again'}
            </button>
          ) : (
            <button className="pill solid" type="button" onClick={check} disabled={placed.length !== cur.tiles.length}>Check</button>
          )}
        </div>
        {/* kept in place (hidden) until a wrong order offers it */}
        <button className={`pill small ${result === false ? '' : 'keep'}`} type="button" onClick={next} style={{ alignSelf: 'flex-start' }} tabIndex={result === false ? 0 : -1} aria-hidden={result !== false}>
          Skip to next
        </button>
        {device === 'desktop' && <KeyHints hints={[['1–9', 'Place tile'], ['Backspace', 'Take back'], ['Enter', 'Check'], ['Space', 'Hear']]} />}
      </div>
      {ghost && (
        <div className="tile tile-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden>
          <span className="thai" lang="th">{cur.tiles[ghost.idx].thai}</span>
          <span className="small">{cur.tiles[ghost.idx].roman}</span>
        </div>
      )}
    </Screen>
  );
}
