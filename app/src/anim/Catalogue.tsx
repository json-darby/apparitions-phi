// /anim: every animation in the Phase 3 catalogue, playable here on phone and
// desktop, with the still fallback one tap away. This is how the owner checks
// the exit test: "Every placement in the catalogue plays on phone and desktop,
// with a still fallback".

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Screen, TopBar } from '../ui/kit';
import { CAST, PLACES, SEED_ITEMS, SEED_LETTERS } from '../content/seed';
import { PLACE_COLOURS, type Tone } from '../content/types';
import { pitchCurve } from '../audio/sound';
import { Apparition, CastFinale, Constellation, DotWord, FaceToWord, HitBurstLayer, LetterFromDots, ObjectTurn, RowTearWipe, Sequence, StreetScene, type HitBurstHandle } from './index';
import { EXPRESSIONS, type Expression } from './core/looks';
import { SEQ_INFO, SEQUENCES, type SequenceName } from './core/timelines';
import { getEngine, type EngineStats } from './gl/engine';
import { loadManifest, PEOPLE_CREDIT, reloadPacks, type PackManifest } from './packs';
import { personColour } from './people';
import { OBJECTS } from './sources/objectScene';

const COLOURS: { v: string; label: string }[] = [
  { v: 'auto', label: 'Place' },
  { v: PLACE_COLOURS.default, label: 'Blue' },
  { v: PLACE_COLOURS.food, label: 'Amber' },
  { v: PLACE_COLOURS.pharmacy, label: 'Cyan' },
  { v: PLACE_COLOURS.bar, label: 'Pink' },
  { v: PLACE_COLOURS.you, label: 'White' },
];
const WHO = [...CAST.map((c) => ({ v: c.id, label: c.name })), { v: 'you', label: 'You' }];
const TONES: Tone[] = ['mid', 'low', 'falling', 'high', 'rising'];
const OBJECT_LABEL: Record<string, string> = { dish: 'A plate of fried rice', tuktuk: 'A tuk-tuk', temple: 'A temple roof', banknote: 'Coins (invented, no real currency)', bottle: 'A bottle of water', ice: 'A glass of tube ice', stall: 'A market stall' };

const noStats: EngineStats = { fps: 0, dots: 0, live: 0, drawn: 0, quality: 2, contexts: 1, webgl: 0, ms: 0 };

function useStats(): EngineStats {
  const eng = getEngine();
  const ref = useRef<EngineStats>(noStats);
  return useSyncExternalStore(
    (fn) => (eng ? eng.subscribe(fn) : () => {}),
    () => {
      if (!eng) return noStats;
      const s = eng.stats;
      const r = ref.current;
      if (r.fps !== s.fps || r.dots !== s.dots || r.live !== s.live || r.drawn !== s.drawn || r.quality !== s.quality || r.ms !== s.ms || r.webgl !== s.webgl) ref.current = { ...s };
      return ref.current;
    },
  );
}

function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="hrow wrap" role="group" aria-label={label} style={{ gap: 6 }}>
      {options.map((o) => (
        <button key={o.v} type="button" className="pill small" aria-pressed={o.v === value} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Card({ n, title, see, source, where, children, controls }: { n: number; title: string; see: string; source: string; where: string; children: ReactNode; controls?: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 14 }} aria-label={title}>
      <div className="hrow between" style={{ alignItems: 'baseline' }}>
        <h2 className="h-s">
          <span className="mut num" style={{ marginRight: 8 }}>{String(n).padStart(2, '0')}</span>
          {title}
        </h2>
        <span className="label">{source}</span>
      </div>
      <div className="small">{see}</div>
      <div className="label" style={{ color: 'var(--fg-2)' }}>Plays: {where}</div>
      <div style={{ position: 'relative', background: '#000', height: 270, overflow: 'hidden' }}>{children}</div>
      {controls && <div className="hrow wrap" style={{ gap: 8 }}>{controls}</div>}
    </section>
  );
}

function PlayBtn({ onClick, label = 'Play' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="pill small" onClick={onClick}>
      {label}
    </button>
  );
}

export default function Catalogue() {
  const eng = getEngine();
  const stats = useStats();
  const [who, setWho] = useState('fah');
  const [expr, setExpr] = useState<Expression>('neutral');
  const [col, setCol] = useState('auto');
  const [still, setStill] = useState(eng?.forceStill ?? false);
  const [density, setDensity] = useState(eng?.densityScale ?? 1);
  const [cues, setCues] = useState<Record<string, number>>({});
  const [tone, setTone] = useState<Tone>('rising');
  const [clarity, setClarity] = useState(0.35);
  const [strength, setStrength] = useState(0.3);
  const [letter, setLetter] = useState(SEED_LETTERS[0]?.char ?? 'ก');
  const [place, setPlace] = useState('food');
  const [camera, setCamera] = useState(0.5);
  const [object, setObject] = useState('dish');
  const [loop, setLoop] = useState(true);
  const [autoExpr, setAutoExpr] = useState(true);
  const [cycleExpr, setCycleExpr] = useState<Expression>('neutral');
  const [wipe, setWipe] = useState(0);
  const [packs, setPacks] = useState<PackManifest | null>(null);
  const burst = useRef<HitBurstHandle>(null);

  const cue = (k: string) => setCues((c) => ({ ...c, [k]: (c[k] ?? 0) + 1 }));
  const colour = col === 'auto' ? personColour(who) : col;
  const item = SEED_ITEMS.find((i) => i.thai && i.thai.length <= 8) ?? SEED_ITEMS[0];

  useEffect(() => {
    loadManifest().then(setPacks);
  }, []);
  useEffect(() => {
    if (!autoExpr) return;
    const order: Expression[] = ['neutral', 'smile', 'neutral', 'puzzled', 'sad', 'closed'];
    let i = 0;
    const id = setInterval(() => setCycleExpr(order[++i % order.length]), 2200);
    return () => clearInterval(id);
  }, [autoExpr]);
  // leave the engine as we found it
  useEffect(
    () => () => {
      const e = getEngine();
      e?.setForceStill(false);
      if (e) e.densityScale = 1;
    },
    [],
  );

  const packPeople = packs ? Object.keys(packs.people) : [];
  const packSeqs = packs ? Object.keys(packs.sequences) : [];

  const panel = (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Live</div>
        <div className="num" style={{ fontSize: 13, lineHeight: 1.7 }} aria-live="off">
          <div>FPS {stats.fps} · {stats.ms} ms render</div>
          <div>Dots per frame {stats.dots.toLocaleString()}</div>
          <div>Canvases {stats.live} live, {stats.drawn} drawn this frame</div>
          <div>GL contexts {eng ? 1 : 0} · WebGL {stats.webgl || 'none (2D stills)'}</div>
          <div>Quality {['still', 'light', 'full'][stats.quality]}{eng?.phone ? ' · phone density' : ''}</div>
          <div>Packs: {packPeople.length ? `portraits for ${packPeople.join(', ')}` : 'no portraits yet (code-drawn stand-ins)'}{packSeqs.length ? `; clips ${packSeqs.join(', ')}` : ''}</div>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Person</div>
        <Pills value={who} options={WHO} onChange={setWho} label="Person" />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Expression</div>
        <Pills value={expr} options={EXPRESSIONS.map((e) => ({ v: e, label: e === 'turn' ? 'Three-quarter' : e[0].toUpperCase() + e.slice(1) }))} onChange={setExpr} label="Expression" />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Colour</div>
        <Pills value={col} options={COLOURS} onChange={setCol} label="Colour" />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="label">Fallbacks</div>
        <div className="hrow wrap" style={{ gap: 6 }}>
          <button type="button" className="pill small" aria-pressed={still} onClick={() => { const v = !still; setStill(v); eng?.setForceStill(v); }}>
            Still fallback {still ? 'on' : 'off'}
          </button>
          {eng && ([2, 1, 0] as const).map((q) => (
            <button key={q} type="button" className="pill small" aria-pressed={stats.quality === q} onClick={() => eng.setQuality(q)}>
              {['Still', 'Light', 'Full'][q]}
            </button>
          ))}
          <button type="button" className="pill small" onClick={() => reloadPacks().then(setPacks)}>Reload packs</button>
        </div>
        <label className="small hrow" style={{ gap: 10 }}>
          Dot density
          <input type="range" min={0.4} max={1.3} step={0.05} value={density} onChange={(e) => { const v = +e.target.value; setDensity(v); if (eng) { eng.densityScale = v; eng.kick(); } }} />
          <span className="num">{density.toFixed(2)}</span>
        </label>
        <p className="small" style={{ margin: 0 }}>Reduced motion in Settings also shows stills. Slow frames step quality down by themselves (full, light, still).</p>
      </div>
      <p className="small" style={{ margin: 0 }}>{PEOPLE_CREDIT}</p>
    </div>
  );

  const rangeRow = (label: string, v: number, set: (x: number) => void) => (
    <label className="small hrow" style={{ gap: 10 }}>
      {label}
      <input type="range" min={0} max={1} step={0.01} value={v} onChange={(e) => set(+e.target.value)} />
      <span className="num">{v.toFixed(2)}</span>
    </label>
  );

  const fill = { position: 'absolute', inset: 0 } as const;
  let k = 0;
  return (
    <Screen top={<TopBar mid="Animation catalogue" parent="/settings" />} panel={panel}>
      <div className="stack" style={{ gap: 8 }}>
        <h1 className="h-l">Animation catalogue</h1>
        <p className="body" style={{ margin: 0 }}>Every Phase 3 animation and where it plays. Touch or hover any dot picture: the dots push away and settle.</p>
      </div>
      <section className="stack" style={{ gap: 8 }} aria-label="Stage">
        <div className="label">Stage · {WHO.find((w) => w.v === who)?.label} · {expr}</div>
        <div style={{ position: 'relative', background: '#000', height: 'min(70vh, 560px)' }}>
          <Apparition who={who} mode="follow" expression={expr} colour={colour} style={fill} />
        </div>
        <div className="label">The cast, eight canvases at once (as on the Cast page)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
          {WHO.slice(0, 8).map((w) => (
            <div key={w.v} className="stack" style={{ gap: 4 }}>
              <Apparition who={w.v} expression={expr} colour={col === 'auto' ? undefined : col} style={{ height: 150, background: '#000' }} />
              <span className="label">{w.label}</span>
            </div>
          ))}
        </div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 24 }}>
        <Card n={++k} title="Gather" see="Loose dots swarm together into a face." source="Portrait" where="first meeting, opening screen" controls={<PlayBtn onClick={() => cue('gather')} />}>
          <Apparition who={who} mode="gather" expression={expr} colour={colour} cue={cues.gather} style={fill} />
        </Card>
        <Card n={++k} title="Idle" see="The face breathes, blinks and drifts a few degrees." source="Portrait" where="Talk screen, fact screens">
          <Apparition who={who} mode="idle" expression={expr} colour={colour} style={fill} />
        </Card>
        <Card n={++k} title="Follow" see="The face turns toward your finger or mouse, or with phone tilt." source="Portrait" where="Talk screen">
          <Apparition who={who} mode="follow" expression={expr} colour={colour} style={fill} />
        </Card>
        <Card n={++k} title="Expression change" see="Dots flow from neutral to smile, puzzled or sad." source="4 to 6 portraits" where="Talk: right answer, wrong answer, comfort dropping" controls={<><button type="button" className="pill small" aria-pressed={autoExpr} onClick={() => setAutoExpr(!autoExpr)}>Cycle {autoExpr ? 'on' : 'off'}</button><span className="label">{autoExpr ? cycleExpr : expr}</span></>}>
          <Apparition who={who} mode="idle" expression={autoExpr ? cycleExpr : expr} colour={colour} style={fill} />
        </Card>
        <Card n={++k} title="Voice tear" see="Rows of the face shift along the pitch of the word: a rising tone sweeps upward." source="Portrait + pitch curve" where="Tone pairs, new items, Talk" controls={<><Pills value={tone} options={TONES.map((t) => ({ v: t, label: t }))} onChange={(t) => { setTone(t); cue('tear'); }} label="Tone" /><PlayBtn onClick={() => cue('tear')} /></>}>
          <Apparition who={who} mode="tear" pitch={pitchCurve([tone])} expression={expr} colour={colour} cue={cues.tear} style={fill} />
        </Card>
        <Card n={++k} title="Clearer as you learn" see="Barely spoken to: faint and broken. They sharpen as your reputation grows." source="Portrait" where="The Street street, cast gallery" controls={rangeRow('Clarity', clarity, setClarity)}>
          <Apparition who={who} mode="idle" expression={expr} colour={colour} clarity={clarity} style={fill} />
        </Card>
        <Card n={++k} title="Word strength" see="A weak word is drawn thin and torn, a strong one solid." source="Code" where="Review (still), progress screen" controls={rangeRow('Strength', strength, setStrength)}>
          <div className="stack" style={{ ...fill, justifyContent: 'center', gap: 4 }}>
            <DotWord text={item?.thai ?? 'สวัสดี'} strength={strength} colour={colour} size={64} />
            <DotWord text={item?.thai ?? 'สวัสดี'} strength={1} colour={colour} size={40} live />
          </div>
        </Card>
        <Card n={++k} title="Letter from dots" see="Dots stream along the stroke order to form a Thai letter, then hold." source="Code" where="Writing studio, Ink Run, new letters" controls={<><Pills value={letter} options={SEED_LETTERS.slice(0, 8).map((l) => ({ v: l.char, label: l.char }))} onChange={(c) => { setLetter(c); cue('letter'); }} label="Letter" /><PlayBtn onClick={() => cue('letter')} /></>}>
          <div style={{ ...fill, display: 'grid', placeItems: 'center' }}>
            <LetterFromDots char={letter} strokes={SEED_LETTERS.find((l) => l.char === letter)?.strokes ?? null} colour={colour} size={240} cue={cues.letter} />
          </div>
        </Card>
        <Card n={++k} title="Face to word" see="A face dissolves and its dots re-form as the Thai word they just said." source="Portrait + code" where="New items, fact screens" controls={<PlayBtn onClick={() => cue('f2w')} />}>
          <FaceToWord who={who} thai={item?.thai ?? 'สวัสดี'} colour={colour} cue={cues.f2w} style={fill} />
        </Card>
        <Card n={++k} title="Touch scatter" see="Dots push away from your finger and settle back. Built into every dot canvas." source="Any" where="Any face or object on screen">
          <Apparition who={who} mode="idle" expression="smile" colour={colour} style={fill} />
        </Card>
        {SEQUENCES.map((s: SequenceName) => (
          <Card key={s} n={++k} title={SEQ_INFO[s].label} see={SEQ_SEE[s]} source={packSeqs.includes(s) ? 'Frame sequence (pack)' : 'Frame sequence (code stand-in)'} where={SEQ_WHERE[s]} controls={<><PlayBtn onClick={() => cue(`seq-${s}`)} label="Replay" /><button type="button" className="pill small" aria-pressed={loop} onClick={() => setLoop(!loop)}>Loop {loop ? 'on' : 'off'}</button></>}>
            <Sequence name={s} colour={col === 'auto' ? undefined : col} cue={cues[`seq-${s}`]} loop={loop} style={fill} />
          </Card>
        ))}
        <Card n={++k} title="Street in depth" see="Each place on the street as a dot scene you move through with parallax." source="Scene image + depth" where="The Street street" controls={<><Pills value={place} options={[...PLACES.map((p) => ({ v: p.id as string, label: p.name })), { v: 'shop', label: "Theo's shop" }]} onChange={setPlace} label="Place" />{rangeRow('Camera', camera, setCamera)}</>}>
          <StreetScene place={place} camera={camera} colour={col === 'auto' ? undefined : col} style={fill} />
        </Card>
        <Card n={++k} title="Object turn" see="A dish, a tuk-tuk, a temple roof or a banknote turning slowly." source="Object image + depth" where="Thai fact screens" controls={<Pills value={object} options={OBJECTS.map((o) => ({ v: o, label: o }))} onChange={setObject} label="Object" />}>
          <ObjectTurn object={OBJECT_LABEL[object] ?? object} colour={col === 'auto' ? '#FFB03A' : col} style={fill} />
        </Card>
        <Card n={++k} title="Row-tear wipe" see="The outgoing screen tears sideways row by row into the next." source="Code" where="Screen changes (app shell)" controls={<PlayBtn onClick={() => setWipe((w) => w + 1)} label="Change screen" />}>
          <div style={{ ...fill, display: 'grid' }}>
            <RowTearWipe routeKey={String(wipe)}>
              <div style={{ ...fill, display: 'grid', placeItems: 'center', background: '#050505' }}>
                <div className="stack center" style={{ gap: 6 }}>
                  <div className="label">Screen {wipe + 1}</div>
                  <div className="h-m" style={{ color: wipe % 2 ? 'var(--amber)' : 'var(--blue)' }}>{wipe % 2 ? 'ตลาด' : 'โรงแรม'}</div>
                </div>
              </div>
            </RowTearWipe>
          </div>
        </Card>
        <Card n={++k} title="Hit burst" see="Dots burst from a correct answer and are pulled back on a miss." source="Code" where="All drills" controls={<><PlayBtn onClick={() => burst.current?.burst(170, 135, colour)} label="Correct" /><PlayBtn onClick={() => burst.current?.pull(170, 135, '#FF5A4F')} label="Miss" /></>}>
          <div style={fill} onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top; if (e.shiftKey || e.button === 2) burst.current?.pull(x, y, '#FF5A4F'); else burst.current?.burst(x, y, colour); }} onContextMenu={(e) => e.preventDefault()}>
            <div className="small" style={{ position: 'absolute', left: 12, top: 10 }}>Tap for a hit, shift-click or long-press menu for a miss</div>
            <HitBurstLayer ref={burst} />
          </div>
        </Card>
        <Card n={++k} title="Constellation" see="Everyone you spoke to today appears as small faces that link up." source="Portraits" where="Day complete" controls={<PlayBtn onClick={() => cue('const')} label="Replay" />}>
          <Constellation people={['nok', 'lek', 'mai', 'fah', 'ton']} cue={cues.const} style={fill} />
        </Card>
        <Card n={++k} title="The whole cast" see="All eight gather one by one and face you." source="Portraits + one sequence" where="Day 30 finale" controls={<PlayBtn onClick={() => cue('finale')} label="Replay" />}>
          <CastFinale cue={cues.finale} style={fill} />
        </Card>
      </div>
    </Screen>
  );
}

const SEQ_SEE: Record<SequenceName, string> = {
  palm: 'She looks at you, her face falls, she raises her palm to the screen, then fades, the handprint last.',
  wai: 'A character greets you with a wai.',
  handover: 'A vendor passes a bag toward the screen.',
  glance: 'The taxi driver looks back over his shoulder.',
  walkaway: 'A figure turns and walks into the dark, breaking up.',
};
const SEQ_WHERE: Record<SequenceName, string> = {
  palm: 'After Hours, when comfort runs out and she leaves',
  wai: 'Day 1, first hotel scene',
  handover: 'Task complete at the food stall and market',
  glance: "Start of Meter's Running",
  walkaway: 'Failed task, end of a chapter',
};
