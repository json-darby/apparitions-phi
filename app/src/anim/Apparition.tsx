// A person drawn as glowing dots with depth (the WebGL dot renderer). Uses the
// person's portrait pack when one exists, otherwise a code-drawn stand-in.
// Fills its box: size it with style or className. A double tap steps every
// face to the next colour (Settings → Face colour); a small label says which.

import { useEffect, useState, type CSSProperties } from 'react';
import { DotCanvas, useReducedMotionSafe } from './DotCanvas';
import { FaceScene, type ApparitionMode } from './sources/faceScene';
import type { Expression } from './core/looks';
import { personColour, personName } from './people';
import { faceColourLabel, nextFaceColour, setFaceTint, tinted, useFaceTint, type FaceColour } from './tint';
import { useApp, type AppState } from '../app/context';

export { personColour, personName } from './people';

export type { Expression } from './core/looks';
export type { ApparitionMode } from './sources/faceScene';

export interface ApparitionProps {
  /** cast id ("mai"), "you", or another id (gets a seeded stand-in) */
  who: string;
  mode?: ApparitionMode;
  expression?: Expression;
  /** dot colour; defaults to the person's place colour */
  colour?: string;
  /** 0..1: how clearly they resolve (reputation); 1 = solid */
  clarity?: number;
  /** pitch curve (0..1 values) for the voice tear */
  pitch?: number[] | null;
  /** bump to replay a one-shot animation (gather, walk-away, voice tear) */
  cue?: number;
  onDone?: () => void;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

/** The app, or null outside it (the animation catalogue, tests). */
function useAppSafe(): AppState | null {
  try {
    // useApp is a plain useContext + throw, so the hook order is stable
    return useApp();
  } catch {
    return null;
  }
}

export function Apparition({ who, mode = 'idle', expression = 'neutral', colour, clarity = 1, pitch = null, cue, onDone, className, style, label }: ApparitionProps) {
  const rm = useReducedMotionSafe();
  const app = useAppSafe();
  const tint = useFaceTint();
  const [scene] = useState(() => new FaceScene());
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null);
  const own = colour ?? personColour(who);
  scene.props = { who, mode, expression, colour: tinted(own), clarity, pitch, onDone };

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1300);
    return () => clearTimeout(t);
  }, [flash]);

  const cycle = () => {
    const next: FaceColour = nextFaceColour(tint, own);
    if (app) app.updateSettings({ faceColour: next });
    else setFaceTint(next);
    setFlash({ text: faceColourLabel(next), n: (flash?.n ?? 0) + 1 });
  };

  return (
    <DotCanvas scene={scene} still={rm || mode === 'still'} cue={cue} label={label ?? `${personName(who)}, drawn in light`} className={className} style={style} onDoubleTap={cycle}>
      {flash && (
        <span key={flash.n} className="face-flash label" aria-live="polite">
          {flash.text}
        </span>
      )}
    </DotCanvas>
  );
}
