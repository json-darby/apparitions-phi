// A cast member's face in a conversation: gathers on first meeting, follows
// the pointer while listening, tears along the pitch of the line while
// speaking, and changes expression on right and wrong replies.

import { useEffect, useState, type CSSProperties } from 'react';
import { useApp } from '../../app/context';
import { Apparition, type Expression } from '../../anim';
import { pitchCurve } from '../../audio/sound';
import type { Tone } from '../../content/types';

export function Face({
  who, colour, clarity, speaking, tones, expression = 'neutral', firstMeeting, cue, style, className,
}: {
  who: string;
  colour: string;
  clarity: number;
  speaking: boolean;
  tones?: Tone[];
  expression?: Expression;
  firstMeeting?: boolean;
  cue?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const { reducedMotion, content } = useApp();
  const [gathering, setGathering] = useState(!!firstMeeting);
  useEffect(() => {
    if (!gathering) return;
    const t = setTimeout(() => setGathering(false), 2200);
    return () => clearTimeout(t);
  }, [gathering]);
  const mode = reducedMotion ? 'still' : gathering ? 'gather' : speaking ? 'tear' : 'follow';
  const name = content.person(who)?.name ?? who;
  return (
    <Apparition
      who={who}
      mode={mode}
      expression={expression}
      colour={colour}
      clarity={clarity}
      pitch={speaking && tones?.length ? pitchCurve(tones) : null}
      cue={cue}
      onDone={() => setGathering(false)}
      className={className}
      style={style}
      label={`${name}, drawn in light, ${expression === 'neutral' ? 'listening' : expression}`}
    />
  );
}
