// The animation API. Screens import from here only. Everything is drawn by one
// shared WebGL dot renderer (src/anim/gl/engine.ts): one GL context for the
// whole app, instances paused off screen, still images on weak devices and
// with reduced motion. Every component fills the box you give it (style or
// className) and every one-shot replays when `cue` changes, so each can be
// mounted on its own (Library "Scenes and moments", catalogue) with defaults.
//
// Catalogue placements:
//   Gather ............ <Apparition mode="gather">      first meeting, opening screen
//   Idle .............. <Apparition mode="idle">        talk screen, fact screens
//   Follow ............ <Apparition mode="follow">      talk screen
//   Expression change . <Apparition expression=...>     talk: right, wrong, comfort dropping
//   Voice tear ........ <Apparition mode="tear" pitch>  tone pairs, new items, talk
//   Clearer as you learn <Apparition clarity>           street, cast
//   Word strength ..... <DotWord strength>              review, progress
//   Letter from dots .. <LetterFromDots>                writing studio, ink run, new letters
//   Face to word ...... <FaceToWord>                    new items, fact screens
//   Touch scatter ..... built into every dot canvas
//   Palm on the glass . <Sequence name="palm">          After Hours, comfort runs out
//   Wai ............... <Sequence name="wai">           day 1, first hotel scene
//   Hand-over ......... <Sequence name="handover">      task complete at food stall and market
//   Driver's glance ... <Sequence name="glance">        start of Meter's Running
//   Walk-away ......... <Sequence name="walkaway">      failed task, end of a chapter
//   Street in depth ... <StreetScene place>             The Street street
//   Object turn ....... <ObjectTurn object>             culture / fact screens
//   Row-tear wipe ..... <RowTearWipe> (in the shell)    screen changes
//   Hit burst ......... <HitBurstLayer ref>             all drills
//   Constellation ..... <Constellation people>          day complete
//   The whole cast .... <CastFinale>                    day 30 finale
//
// Animations do not play inside Review or during a drill round, apart from
// the hit burst. DotWord is a still unless `live` is set, so it is safe there.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { DotCanvas, useReducedMotionSafe } from './DotCanvas';
import { DotWordScene, FaceToWordScene, LetterScene } from './sources/textScenes';
import { SequenceScene } from './sources/sequenceScene';
import { ObjectScene, StreetSceneDots } from './sources/objectScene';
import { ConstellationScene, FinaleScene } from './sources/groupScenes';
import { fontReady, measureText } from './sources/text';
import { personColour, personName, CAST_IDS } from './people';
import { SEQUENCE_WHO } from './core/looks';
import { SEQ_INFO, type SequenceName } from './core/timelines';
import { PLACES } from '../content/seed';
import { PLACE_COLOURS, type PlaceId } from '../content/types';
import { tinted, useFaceTint } from './tint';

export { Apparition, personColour, personName } from './Apparition';
export type { ApparitionProps, ApparitionMode, Expression } from './Apparition';
export { HitBurstLayer } from './HitBurst';
export type { HitBurstHandle } from './HitBurst';
export { RowTearWipe } from './RowTearWipe';
export { PEOPLE_CREDIT } from './packs';
export type { SequenceName } from './core/timelines';
export { SEQUENCES, SEQ_INFO } from './core/timelines';

/** A word drawn in dots: weak words thin and torn, strong words solid. Still unless `live`. */
export function DotWord({ text, strength, colour = '#E8E8E8', size = 64, style, live = false }: { text: string; strength: number; colour?: string; size?: number; style?: CSSProperties; live?: boolean }) {
  const rm = useReducedMotionSafe();
  const [scene] = useState(() => new DotWordScene());
  scene.props = { text, strength, colour, live };
  const [, bump] = useState(0);
  useEffect(() => {
    let on = true;
    fontReady(text).then(() => on && bump((x) => x + 1));
    return () => {
      on = false;
    };
  }, [text]);
  const m = typeof document !== 'undefined' ? measureText(text, size) : { w: size * 2, h: size };
  const w = Math.ceil(m.w + size * 0.3);
  const h = Math.ceil(Math.max(size * 1.45, m.h * 1.2));
  return (
    <div style={{ position: 'relative', display: 'grid', placeItems: 'center', ...style }}>
      <DotCanvas scene={scene} still={rm || !live} label={text} style={{ width: w, height: h, maxWidth: '100%' }} />
    </div>
  );
}

/** Dots stream along the stroke order to form a letter, then hold. Replays when `cue` changes. */
export function LetterFromDots({ char, strokes = null, colour = '#E8E8E8', size = 220, cue, onDone, style }: { char: string; strokes?: { d: string }[] | null; colour?: string; size?: number; cue?: number; onDone?: () => void; style?: CSSProperties }) {
  const rm = useReducedMotionSafe();
  const [scene] = useState(() => new LetterScene());
  scene.props = { char, strokes, colour, onDone };
  return <DotCanvas scene={scene} still={rm} cue={cue} label={`The letter ${char}`} style={{ width: size, height: size, ...style }} />;
}

/** A face dissolves and its dots re-form as the word just said. Replays when `cue` changes. */
export function FaceToWord({ who, thai, colour, cue, onDone, style }: { who: string; thai: string; colour?: string; cue?: number; onDone?: () => void; style?: CSSProperties }) {
  const rm = useReducedMotionSafe();
  const [scene] = useState(() => new FaceToWordScene());
  useFaceTint();
  scene.props = { who, thai, colour: tinted(colour ?? personColour(who)), onDone };
  return <DotCanvas scene={scene} still={rm} cue={cue} label={`${personName(who)} says ${thai}`} style={{ width: '100%', minHeight: 240, ...style }} />;
}

/** A frame sequence (stop motion) replayed as dots. Replays when `cue` changes. */
export function Sequence({ name, who, colour, cue, loop = false, onDone, style }: { name: SequenceName; who?: string; colour?: string; cue?: number; loop?: boolean; onDone?: () => void; style?: CSSProperties }) {
  const rm = useReducedMotionSafe();
  const [scene] = useState(() => new SequenceScene());
  const person = who ?? SEQUENCE_WHO[name];
  useFaceTint();
  scene.props = { name, who: person, colour: tinted(colour ?? personColour(person)), loop, onDone };
  return <DotCanvas scene={scene} still={rm} cue={cue} label={`${personName(person)}: ${SEQ_INFO[name]?.label ?? name}`} style={{ width: '100%', minHeight: 200, ...style }} />;
}

/** A place on the street as a dot scene, with parallax from the camera position (0..1 along the street). */
export function StreetScene({ place, camera = 0.5, colour, style }: { place: string; camera?: number; colour?: string; style?: CSSProperties }) {
  const rm = useReducedMotionSafe();
  const [scene] = useState(() => new StreetSceneDots());
  const pl = PLACES.find((p) => p.id === place);
  scene.props = { place, camera, colour: colour ?? PLACE_COLOURS[place as PlaceId] ?? (place === 'shop' ? '#9BE564' : PLACE_COLOURS.default), sign: pl?.thaiSign ?? '' };
  return <DotCanvas scene={scene} still={rm} label={`${pl?.name ?? place} in light`} style={{ width: '100%', minHeight: 180, ...style }} />;
}

/** An object turning slowly: a dish, a tuk-tuk, a temple roof, a banknote, a bottle, a glass of ice, a stall. */
export function ObjectTurn({ object, colour = '#FFB03A', style }: { object: string; colour?: string; style?: CSSProperties }) {
  const rm = useReducedMotionSafe();
  const [scene] = useState(() => new ObjectScene());
  scene.props = { object, colour };
  return <DotCanvas scene={scene} still={rm} label={object} style={{ width: '100%', minHeight: 160, ...style }} />;
}

/** Everyone you spoke to today as small faces that link up. Defaults to the whole cast. */
export function Constellation({ people, style, cue, onDone }: { people?: string[]; style?: CSSProperties; cue?: number; onDone?: () => void }) {
  const rm = useReducedMotionSafe();
  useFaceTint();
  const [scene] = useState(() => new ConstellationScene());
  const list = useMemo(() => (people && people.length ? people : CAST_IDS), [people]);
  scene.props = { people: list };
  scene.onDone = onDone;
  return <DotCanvas scene={scene} still={rm} cue={cue} label={`Today you spoke to ${list.map(personName).join(', ')}`} style={{ width: '100%', minHeight: 160, ...style }} />;
}

/** All eight gather one by one and face you. Replays when `cue` changes. */
export function CastFinale({ style, cue, onDone, people }: { cue?: number; onDone?: () => void; style?: CSSProperties; people?: string[] }) {
  const rm = useReducedMotionSafe();
  useFaceTint();
  const [scene] = useState(() => new FinaleScene());
  scene.props = { people: people && people.length ? people : CAST_IDS, onDone };
  return <DotCanvas scene={scene} still={rm} cue={cue} label="The whole cast" style={{ width: '100%', minHeight: 300, ...style }} />;
}
