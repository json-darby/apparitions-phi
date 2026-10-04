// Writing studio. Watch the stroke order, trace it, write it from memory, build
// it from parts, or take it to paper. Drawing is for touch screens and pens; a
// mouse-only desktop gets Watch and a Choose mode (pick the letter from its
// look-alikes) instead.
//
// Deep links: /writing?letter=<letterId>&mode=watch|trace|memory|choose|parts|paper
// Watch works for any letter; the other modes are for letters already met (an
// unmet letter can still be traced and built, as practice that never counts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link, navigate, useRoute } from '../../app/router';
import { LetterFromDots } from '../../anim';
import type { Letter } from '../../content/types';
import { Six } from '../../engine/grade';
import { useKeys } from '../../input/keys';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RatingBar, Screen, Seg, TopBar, fmtInterval } from '../../ui/kit';
import { warmGlyphFont } from '../../writing/glyph';
import { bounds, strokePoints } from '../../writing/geometry';
import { LetterChips, LetterFacts, letterRef, partsFor, playName, shuffle, useCanDraw, useWritingLetters } from '../../writing/LetterBits';
import { Pad, type PadHandle } from '../../writing/Pad';
import { handwritingDetail, type Ink, type ScoreDetail } from '../../writing/recognise';
import { StrokePlayer } from '../../writing/StrokePlayer';
import { getStrokes } from '../../writing/strokes';
import '../../writing/writing.css';

type Mode = 'watch' | 'trace' | 'memory' | 'choose' | 'parts' | 'paper';
const MODE_LABEL: Record<Mode, string> = {
  watch: 'Watch', trace: 'Trace', memory: 'Memory', choose: 'Choose', parts: 'Parts', paper: 'Paper',
};
const isMode = (m: string | null): m is Mode => !!m && m in MODE_LABEL;

export default function WritingStudio() {
  const { content } = useApp();
  const route = useRoute();
  const { device } = useDevice();
  const canDraw = useCanDraw();
  const { met, today, all } = useWritingLetters();
  const metIds = useMemo(() => new Set(met.map((l) => l.id)), [met]);

  const qLetter = route.query.get('letter');
  const qMode = route.query.get('mode');
  const linked = qLetter ? content.letter(qLetter) : undefined;

  // letters on offer: met, then today's, then a linked one; none yet means this course day's letters (watch only)
  const offered = useMemo(() => {
    const ids = new Set([...met, ...today].map((l) => l.id));
    if (linked) ids.add(linked.id);
    let list = all.filter((l) => ids.has(l.id));
    if (!list.length) list = all.filter((l) => l.day <= 1);
    return list;
  }, [met, today, all, linked]);

  const modes: Mode[] = canDraw ? ['watch', 'trace', 'memory', 'parts', 'paper'] : ['watch', 'choose', 'parts', 'paper'];
  let mode: Mode = isMode(qMode) ? qMode : 'watch';
  let swapped = false;
  if (!canDraw && (mode === 'trace' || mode === 'memory')) {
    mode = mode === 'trace' ? 'watch' : 'choose';
    swapped = true;
  }
  if (canDraw && mode === 'choose') mode = 'memory';

  const letter = linked ?? offered[0] ?? null;
  const go = (patch: { letter?: string; mode?: Mode }) => {
    const l = patch.letter ?? letter?.id;
    const m = patch.mode ?? mode;
    navigate(`/writing?${l ? `letter=${encodeURIComponent(l)}&` : ''}mode=${m}`, true);
  };

  useEffect(() => {
    void warmGlyphFont(all.map((l) => l.char).join(''));
  }, [all]);

  const usesPicker = mode !== 'memory' && mode !== 'choose';
  const top = (
    <div className="ws-top">
      <div className="hrow between wrap" style={{ gap: 12 }}>
        <h1 className="h-l">Writing</h1>
        {device !== 'phone' && <Link to="/writing/author" className="label" style={{ textDecoration: 'none' }}>Stroke tool</Link>}
      </div>
      <div className="ws-modes">
        <Seg label="Mode" value={mode} options={modes.map((m) => ({ v: m, label: MODE_LABEL[m] }))} onChange={(m) => go({ mode: m })} />
      </div>
      {usesPicker && letter && <LetterChips letters={offered} value={letter.id} onPick={(id) => go({ letter: id })} metIds={metIds} />}
      {swapped && <p className="small" style={{ margin: 0 }}>Drawing is on touch screens and pens. Here you watch, choose and build.</p>}
    </div>
  );

  if (!letter) {
    return (
      <Screen top={<TopBar mid="Writing studio" parent="/" />}>
        {top}
        <p className="body">No letters yet.</p>
      </Screen>
    );
  }

  const key = `${mode}:${usesPicker ? letter.id : ''}`;
  let body: React.ReactNode;
  let panel: React.ReactNode;
  switch (mode) {
    case 'watch':
      body = <WatchView key={key} letter={letter} />;
      panel = <FactsPanel letter={letter} dots />;
      break;
    case 'trace':
      body = <TraceView key={key} letter={letter} />;
      panel = device === 'phone' ? <FactsPanel letter={letter} /> : <FactsPanel letter={letter} player />;
      break;
    case 'memory':
      body = <MemoryView key={key} start={linked && metIds.has(linked.id) ? linked : null} met={met} />;
      panel = <HowItCounts mode="memory" />;
      break;
    case 'choose':
      body = <ChooseView key={key} start={linked && metIds.has(linked.id) ? linked : null} met={met} />;
      panel = <HowItCounts mode="choose" />;
      break;
    case 'parts':
      body = <PartsView key={key} letter={letter} />;
      panel = <FactsPanel letter={letter} />;
      break;
    case 'paper':
      body = <PaperView key={key} letter={letter} />;
      panel = <FactsPanel letter={letter} />;
      break;
  }

  return (
    <Screen top={<TopBar mid="Writing studio" parent="/" />} panel={panel}>
      {top}
      {body}
    </Screen>
  );
}

// ---------- panels ----------

function FactsPanel({ letter, dots, player }: { letter: Letter; dots?: boolean; player?: boolean }) {
  const { sound, store, reducedMotion } = useApp();
  const [cue, setCue] = useState(0);
  const strokes = getStrokes(store, letter);
  return (
    <div className="stack gap-4" style={{ paddingTop: 'var(--s4)' }}>
      {dots && (
        <button type="button" onClick={() => setCue((c) => c + 1)} style={{ background: 'none', border: 0, padding: 0 }} aria-label="Replay the dots">
          <LetterFromDots char={letter.char} strokes={strokes} size={170} cue={cue} style={{ margin: '0 auto' }} />
        </button>
      )}
      {player && <StrokePlayer char={letter.char} strokes={strokes} loop speed={0.8} still={reducedMotion} className="ws-player-small" />}
      <LetterFacts letter={letter} onPlay={() => void playName(sound, letter)} />
    </div>
  );
}

function HowItCounts({ mode }: { mode: 'memory' | 'choose' }) {
  return (
    <div className="stack gap-3" style={{ paddingTop: 'var(--s4)' }}>
      <Label>How this counts</Label>
      {mode === 'memory' ? (
        <p className="small" style={{ margin: 0 }}>
          A letter is named. You write it, see the model over your ink, and rate yourself. The rating and the shape score set the next writing review. Only letters you have met are asked, and writing reviews open once you can read the letter reliably.
        </p>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          A letter is named. You pick it from letters that look like it. Keys 1 to 4 pick, space replays the name, Enter moves on. Only letters you have met are asked.
        </p>
      )}
      <p className="small" style={{ margin: 0 }}>Until sound arrives, the name shows as a caption in romanisation.</p>
    </div>
  );
}

// ---------- watch ----------

function WatchView({ letter }: { letter: Letter }) {
  const { store, sound, reducedMotion } = useApp();
  const [speed, setSpeed] = useState(1);
  const [cue, setCue] = useState(0);
  const strokes = getStrokes(store, letter);
  useKeys((a) => {
    if (a.type === 'play') {
      setCue((c) => c + 1);
      return true;
    }
  });
  return (
    <div className="ws-main">
      <StrokePlayer char={letter.char} strokes={strokes} speed={speed} cue={cue} still={reducedMotion} className="ws-player-big" />
      <div className="ws-controls">
        <button type="button" className="pill" onClick={() => setCue((c) => c + 1)}>Replay</button>
        <Seg label="Speed" value={speed} options={[{ v: 0.5, label: 'Slow' }, { v: 1, label: 'Normal' }, { v: 1.8, label: 'Fast' }]} onChange={(v) => { setSpeed(v); setCue((c) => c + 1); }} />
        <button type="button" className="pill" onClick={() => void playName(sound, letter, speed < 1 ? 'slow' : 'normal')}>Name</button>
      </div>
      <FitText as="p" className="small center" lines={2} min={10} valign="top">
        {strokes ? 'Start at the numbered dot. Most consonants start at the small head loop and run in one stroke.' : 'No stroke path for this letter yet. Study the outline.'}
      </FitText>
      <KeyHints hints={[['Space', 'replay']]} />
    </div>
  );
}

// ---------- trace ----------

function feedbackLines(d: ScoreDetail): string[] {
  const out: string[] = [];
  if (d.startOk != null) out.push(d.startOk ? 'Start point: right.' : 'Start point: off. Begin at the numbered dot.');
  if (d.directionOk != null) out.push(d.directionOk ? 'Direction: right.' : 'Direction: reversed. Follow the tick by the dot.');
  if (d.shape < 0.5) out.push('Shape: loose. Slow down and stay on the outline.');
  else if (d.shape < 0.8) out.push('Shape: close. Tighten the curves.');
  else out.push('Shape: on the line.');
  return out;
}

function TraceView({ letter }: { letter: Letter }) {
  const { store, engine, reducedMotion } = useApp();
  const { device } = useDevice();
  const pad = useRef<PadHandle>(null);
  const [ink, setInk] = useState<Ink>([]);
  const [detail, setDetail] = useState<ScoreDetail | null>(null);
  const [cue, setCue] = useState(0);
  const strokes = getStrokes(store, letter);

  const check = () => {
    const cur = pad.current?.ink() ?? ink;
    if (!cur.length) return;
    const d = handwritingDetail(cur, letter, { inPlace: true, strokes });
    setDetail(d);
    engine.answer({ ref: letterRef(letter), skill: 'write', source: 'writing:trace', handwritingScore: d.basis === 'none' ? null : d.score, counts: false, data: { mode: 'trace' } });
  };
  const again = () => {
    pad.current?.clear();
    setDetail(null);
  };
  useKeys((a) => {
    if (a.type === 'confirm') {
      if (detail) again();
      else check();
      return true;
    }
  });

  return (
    <div className="ws-main">
      {device === 'phone' && (
        <button type="button" onClick={() => setCue((c) => c + 1)} style={{ background: 'none', border: 0, padding: 0 }} aria-label="Replay the stroke order">
          <StrokePlayer char={letter.char} strokes={strokes} cue={cue} still={reducedMotion} className="ws-player-small" />
        </button>
      )}
      <Pad
        ref={pad}
        guide={letter.char}
        ghost
        marks={strokes}
        overlay={detail ? strokes : null}
        onInk={(i) => {
          setInk(i);
          if (!i.length) setDetail(null);
        }}
        className="ws-pad"
        label={`Trace ${letter.char}`}
      />
      <div className="ws-grid three">
        <button type="button" className="pill" onClick={() => pad.current?.undo()} disabled={!ink.length}>Undo</button>
        <button type="button" className="pill" onClick={again} disabled={!ink.length}>Clear</button>
        {detail ? (
          <button type="button" className="pill solid" onClick={again}>Again</button>
        ) : (
          <button type="button" className="pill solid" onClick={check} disabled={!ink.length}>Check</button>
        )}
      </div>
      {/* the result's room is kept from the start: nothing moves when it arrives */}
      <div className="ws-feedback ws-trace-fb" aria-live="polite">
        {detail && (
          <div className="fade-in" ref={(el) => el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })}>
            {detail.basis === 'none' ? (
              <p className="small">The font has not loaded yet, so this one cannot be checked. Try again in a moment.</p>
            ) : (
              <>
                <div className="score num">{Math.round(detail.score * 100)}%</div>
                <div className="ws-lines">{feedbackLines(detail).map((l) => <span key={l}>{l}</span>)}</div>
                <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>Tracing is practice. It is logged but does not move the schedule.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- from memory ----------

/** Met letters, due writing reviews first, then the rest shuffled. A linked letter goes first. */
function useQueue(start: Letter | null, met: Letter[], skill: 'write' | 'read'): Letter[] {
  const { engine, content } = useApp();
  return useMemo(() => {
    const due = engine.forGame({ skills: [skill], kinds: ['letter'], count: 30 }).map((g) => content.letter(g.ref)).filter((l): l is Letter => !!l);
    const seen = new Set<string>();
    const out: Letter[] = [];
    for (const l of [...(start ? [start] : []), ...due, ...shuffle(met)]) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function NoneMet() {
  return (
    <div className="stack gap-3">
      <p className="body" style={{ margin: 0 }}>No letters met yet. Meet them in New items first, then they are asked here.</p>
      <div><Link to="/new" className="pill">New items</Link></div>
    </div>
  );
}

function MemoryView({ start, met }: { start: Letter | null; met: Letter[] }) {
  const { store, engine, sound } = useApp();
  const queue = useQueue(start, met, 'write');
  const [i, setI] = useState(0);
  const target = queue.length ? queue[i % queue.length] : null;
  const pad = useRef<PadHandle>(null);
  const [ink, setInk] = useState<Ink>([]);
  const [revealed, setRevealed] = useState<{ score: number | null; blank: boolean } | null>(null);
  const [rated, setRated] = useState<{ six: Six; text: string } | null>(null);
  const t = useRef({ from: 0, replays: 0, doneMs: 0 });

  const strokes = target ? getStrokes(store, target) : null;
  const ref = target ? letterRef(target) : '';
  const isMet = !!target && met.some((l) => l.id === target.id);

  const prompt = (replay = false) => {
    if (!target) return;
    if (replay) t.current.replays++;
    void playName(sound, target).then(() => {
      if (!replay && !t.current.from) t.current.from = Date.now();
    });
  };

  useEffect(() => {
    t.current = { from: 0, replays: 0, doneMs: 0 };
    const h = setTimeout(() => prompt(false), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const reveal = (blank: boolean) => {
    if (!target || revealed) return;
    const cur = pad.current?.ink() ?? ink;
    const d = !blank && cur.length ? handwritingDetail(cur, target, { strokes }) : null;
    t.current.doneMs = Date.now() - (t.current.from || Date.now());
    setRevealed({ score: d && d.basis !== 'none' ? d.score : null, blank: blank || !cur.length });
  };

  const rate = (six: Six) => {
    if (!target || !revealed || rated) return;
    const res = engine.answer({
      ref, skill: 'write', source: 'writing:memory', own: six,
      handwritingScore: revealed.blank ? null : revealed.score,
      blank: revealed.blank, ms: t.current.doneMs || undefined, replays: t.current.replays,
      counts: isMet, data: { mode: 'memory' },
    });
    const text = res.counted && res.due
      ? `Logged. Next writing review in ${fmtInterval(res.due - Date.now())}.`
      : isMet
        ? 'Logged as practice. Writing reviews for this letter open once you read it reliably.'
        : 'Logged as practice. This letter has not been met yet.';
    setRated({ six, text });
  };

  const next = () => {
    pad.current?.clear();
    setInk([]);
    setRevealed(null);
    setRated(null);
    setI((n) => n + 1);
  };

  useKeys((a) => {
    if (a.type === 'play') {
      prompt(true);
      return true;
    }
    if (a.type === 'confirm') {
      if (rated) next();
      else if (!revealed && ink.length) reveal(false);
      return true;
    }
  }, !!target);

  if (!target) return <NoneMet />;

  const preview = engine.preview(ref, 'write');
  return (
    <div className="ws-main">
      <div className="hrow between">
        <Label>{`Letter ${(i % queue.length) + 1} of ${queue.length}`}</Label>
        <button type="button" className="pill small" onClick={() => prompt(true)}>Name again</button>
      </div>
      <FitText as="p" className="body center ws-say" min={10}>
        {revealed ? (
          <>
            <span className="thai-m" lang="th">{target.char}</span> <span className="mut">{target.name} · {target.keyword}</span>
          </>
        ) : (
          'Write the letter you hear.'
        )}
      </FitText>
      <Pad
        ref={pad}
        ghost={false}
        overlay={revealed ? strokes : null}
        marks={revealed ? strokes : null}
        disabled={!!revealed}
        onInk={setInk}
        className="ws-pad"
        label="Write from memory"
      />
      {/* the same four buttons, the same note line and the same ratings before and after: Done becomes Next letter */}
      <div className="ws-grid four">
        <button type="button" className="pill" onClick={() => pad.current?.undo()} disabled={!ink.length || !!revealed}>Undo</button>
        <button type="button" className="pill" onClick={() => pad.current?.clear()} disabled={!ink.length || !!revealed}>Clear</button>
        <button type="button" className="pill" onClick={() => reveal(true)} disabled={!!revealed}>Show me</button>
        {revealed ? (
          <button type="button" className="pill solid" onClick={next} disabled={!rated}>Next letter</button>
        ) : (
          <button type="button" className="pill solid" onClick={() => reveal(false)} disabled={!ink.length}>Done</button>
        )}
      </div>
      <FitText as="p" className="small center" lines={2} min={10} valign="top">
        {!revealed
          ? 'Write it, then Done. Show me draws it for you.'
          : rated
            ? rated.text
            : revealed.blank
              ? 'The model is in blue. Rate it Blank, then copy it once.'
              : revealed.score == null
                ? 'The model is in blue over your ink. No shape score this time; rate by eye.'
                : `The model is in blue over your ink. Shape score ${Math.round(revealed.score * 100)}%.`}
      </FitText>
      <RatingBar preview={revealed ? preview : null} onRate={rate} chosen={rated?.six} enabled={!!revealed && !rated} />
      <KeyHints hints={[['Space', 'name again'], ['Enter', revealed ? 'next' : 'done'], ['1-6', 'rate']]} />
    </div>
  );
}

// ---------- choose (desktop, no drawing) ----------

function ChooseView({ start, met }: { start: Letter | null; met: Letter[] }) {
  const { content, engine, sound, store, reducedMotion } = useApp();
  const queue = useQueue(start, met, 'read');
  const [i, setI] = useState(0);
  const target = queue.length ? queue[i % queue.length] : null;
  const [picked, setPicked] = useState<string | null>(null);
  const t = useRef({ from: 0, replays: 0 });

  const options = useMemo(() => {
    if (!target) return [];
    const pool: Letter[] = [];
    const add = (l: Letter | undefined) => {
      if (l && l.id !== target.id && !pool.some((p) => p.id === l.id)) pool.push(l);
    };
    for (const id of target.lookalikes) add(content.letter(id));
    for (const l of shuffle(met)) add(l);
    for (const l of shuffle(content.letters)) add(l);
    return shuffle([target, ...pool.slice(0, 3)]);
    // fixed per question: answering changes the store, which must not reshuffle the options
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, queue]);

  const prompt = (replay = false) => {
    if (!target) return;
    if (replay) t.current.replays++;
    void playName(sound, target).then(() => {
      if (!replay && !t.current.from) t.current.from = Date.now();
    });
  };
  useEffect(() => {
    t.current = { from: 0, replays: 0 };
    setPicked(null);
    const h = setTimeout(() => prompt(false), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const pick = (l: Letter) => {
    if (!target || picked) return;
    setPicked(l.id);
    const correct = l.id === target.id;
    engine.answer({
      ref: letterRef(target), skill: 'read', source: 'writing:choose', correct,
      ms: t.current.from ? Date.now() - t.current.from : undefined, replays: t.current.replays,
      confusedWith: correct ? undefined : letterRef(l), counts: met.some((m) => m.id === target.id),
      data: { mode: 'choose', picked: l.id },
    });
  };
  const next = () => setI((n) => n + 1);

  useKeys((a) => {
    if (a.type === 'rate' && a.n <= options.length) {
      pick(options[a.n - 1]);
      return true;
    }
    if (a.type === 'play') {
      prompt(true);
      return true;
    }
    if (a.type === 'confirm' && picked) {
      next();
      return true;
    }
  }, !!target);

  if (!target) return <NoneMet />;
  const right = picked === target.id;
  return (
    <div className="ws-main">
      <div className="hrow between">
        <Label>{`Letter ${(i % queue.length) + 1} of ${queue.length}`}</Label>
        <button type="button" className="pill small" onClick={() => prompt(true)}>Name again</button>
      </div>
      <p className="body center" style={{ margin: 0 }}>Pick the letter you hear.</p>
      <div className="choose-grid">
        {options.map((l, k) => (
          <button
            key={l.id}
            type="button"
            lang="th"
            className={`choose-opt ${picked && l.id === target.id ? 'right' : ''} ${picked === l.id && !right ? 'wrong' : ''}`}
            onClick={() => pick(l)}
            aria-label={`Option ${k + 1}: ${l.char}`}
          >
            <span className="k">{k + 1}</span>
            {l.char}
          </button>
        ))}
      </div>
      {/* the answer's room is kept (hidden) until a letter is picked */}
      <div className={`stack gap-3 ${picked ? 'fade-in' : 'keep'}`} style={{ alignItems: 'center' }} aria-hidden={!picked}>
        <FitText as="p" className="body center" lines={2} min={11} valign="top" style={{ width: '100%' }}>
          {picked ? (right ? 'Right. ' : 'No. ') : ''}
          {picked && (
            <>
              <span lang="th" className="thai">{target.char}</span> is {target.name}, {target.keyword}.
            </>
          )}
        </FitText>
        <StrokePlayer char={target.char} strokes={getStrokes(store, target)} still={reducedMotion || !picked} className="ws-player-small" />
        <button type="button" className="pill solid" onClick={next} disabled={!picked} tabIndex={picked ? 0 : -1}>Next letter</button>
      </div>
      <KeyHints hints={[['1-4', 'pick'], ['Space', 'name again'], ['Enter', 'next']]} />
    </div>
  );
}

// ---------- build from parts ----------

/** A square view box around one piece, at least 40 units wide so small pieces keep their scale. */
function tileBox(d: string): string {
  const b = bounds(strokePoints(d));
  const side = Math.max(40, b.maxX - b.minX, b.maxY - b.minY) + 10;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return `${cx - side / 2} ${cy - side / 2} ${side} ${side}`;
}

function PartsView({ letter }: { letter: Letter }) {
  const { store, engine, reducedMotion } = useApp();
  const parts = useMemo(() => partsFor(store, letter), [store, letter]);
  const [round, setRound] = useState(0);
  const order = useMemo(() => (parts ? shuffle(parts.map((_, k) => k)) : []), [parts, round]);
  const [placed, setPlaced] = useState(0);
  const [misses, setMisses] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);

  if (!parts || parts.length < 2) return <p className="body">No parts for this letter yet. Its stroke path has not been drawn.</p>;
  const done = placed >= parts.length;

  const tap = (k: number) => {
    if (done) return;
    if (k === placed) {
      const n = placed + 1;
      setPlaced(n);
      setFlash(null);
      if (n >= parts.length) {
        engine.answer({ ref: letterRef(letter), skill: 'write', source: 'writing:parts', correct: misses === 0, counts: false, data: { mode: 'parts', misses } });
      }
    } else {
      setMisses((m) => m + 1);
      setFlash(k);
    }
  };
  const again = () => {
    setPlaced(0);
    setMisses(0);
    setFlash(null);
    setRound((r) => r + 1);
  };

  return (
    <div className="ws-main">
      <p className="body center" style={{ margin: 0 }}>Tap the pieces in the order you write them.</p>
      <div className="parts-board">
        <svg viewBox="0 0 100 100" aria-label={`${placed} of ${parts.length} pieces placed`} role="img">
          <text x="50" y="74" fontSize="90" textAnchor="middle" fontFamily="'Noto Sans Thai Looped'" fontWeight={500} fill="rgba(255,255,255,0.07)" lang="th">{letter.char}</text>
          {parts.slice(0, placed).map((p, k) => (
            <path key={k} d={p.d} className={`parts-placed ${k === placed - 1 && !done ? 'fresh' : ''}`} />
          ))}
        </svg>
      </div>
      <FitText className="small center" lines={2} min={10}>
        {done ? (misses ? `Built, with ${misses} slip${misses === 1 ? '' : 's'}.` : 'Built in order.') : placed ? parts.slice(0, placed).map((p) => p.label).join(', then ') : 'Nothing placed yet.'}
      </FitText>
      <div className="parts-tiles">
        {order.map((k) => (
          <button
            key={`${round}-${k}`}
            type="button"
            className={`part-tile ${flash === k ? 'miss' : ''}`}
            onClick={() => tap(k)}
            disabled={k < placed}
            aria-label={k < placed ? parts[k].label : `Piece ${order.indexOf(k) + 1}`}
          >
            <svg viewBox={tileBox(parts[k].d)} aria-hidden>
              <path d={parts[k].d} />
            </svg>
          </button>
        ))}
      </div>
      {/* kept in place (hidden) until the letter is built */}
      <div className={`stack gap-3 ${done ? 'fade-in' : 'keep'}`} style={{ alignItems: 'center' }} aria-hidden={!done}>
        {done && <StrokePlayer char={letter.char} strokes={getStrokes(store, letter)} still={reducedMotion} className="ws-player-small" />}
        {!done && <div className="ws-player-small" style={{ aspectRatio: '1 / 1' }} />}
        <button type="button" className="pill solid" onClick={again} disabled={!done} tabIndex={done ? 0 : -1}>Again</button>
      </div>
    </div>
  );
}

// ---------- pen and paper ----------

function PaperView({ letter }: { letter: Letter }) {
  const { store, reducedMotion, sound } = useApp();
  const strokes = getStrokes(store, letter);
  const [speed, setSpeed] = useState(0.6);
  return (
    <div className="ws-main">
      <p className="body center" style={{ margin: 0 }}>Write it on paper as it draws. Say the name as you go.</p>
      <StrokePlayer char={letter.char} strokes={strokes} speed={speed} loop still={reducedMotion} className="ws-player-big" />
      <div className="ws-controls">
        <Seg label="Speed" value={speed} options={[{ v: 0.35, label: 'Slow' }, { v: 0.6, label: 'Steady' }, { v: 1, label: 'Normal' }]} onChange={setSpeed} />
        <button type="button" className="pill" onClick={() => void playName(sound, letter)}>Name</button>
      </div>
      <div className="ws-controls">
        <Link to={`/writing/paper?letters=${letter.id}`} className="pill solid" style={{ textDecoration: 'none' }}>Practice sheet</Link>
        <Link to={`/writing/paper?letters=${letter.id}&step=photo`} className="pill" style={{ textDecoration: 'none' }}>Check a photo</Link>
      </div>
    </div>
  );
}
