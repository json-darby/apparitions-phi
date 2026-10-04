// Tone shapes drawn from code: one tone as a small line, or a whole word's
// pitch line with an optional learner line over it. Not animated.

import type { CSSProperties } from 'react';
import { TONE_LABEL, pitchCurve, toneShape } from '../../../audio/sound';
import type { Tone } from '../../../content/types';

function path(values: number[], x0: number, x1: number, h: number, pad: number): string {
  const n = values.length;
  return values
    .map((v, i) => {
      const x = x0 + (n === 1 ? 0 : (i / (n - 1)) * (x1 - x0));
      const y = pad + (1 - v) * (h - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** One tone's textbook shape. */
export function ToneShape({ tone, w = 96, h = 40, colour = 'currentColor', guide = true, strokeWidth = 3 }: { tone: Tone; w?: number; h?: number; colour?: string; guide?: boolean; strokeWidth?: number }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${TONE_LABEL[tone]} tone`} style={{ display: 'block', overflow: 'visible' }}>
      {guide && <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="var(--rule-strong)" strokeDasharray="3 4" strokeWidth={1} />}
      <path d={path(toneShape(tone, 24), 2, w - 2, h, 4)} fill="none" stroke={colour} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A row of tone shapes, one per syllable, with the syllable and tone name under each.
 * Always one row of one height: a seven-syllable phrase gets narrower cells and
 * smaller words (learn.css), never a second row.
 */
export function ToneRow({ tones, sylls, size = 64, showNames = true }: { tones: Tone[]; sylls?: string[]; size?: number; showNames?: boolean }) {
  const style = { '--n': Math.max(1, tones.length), '--tone-w': `${size}px` } as CSSProperties;
  return (
    <div className="tone-row" style={style}>
      {tones.map((t, i) => (
        <div key={i} className="tone-cell">
          <span className="tone-shape">
            <ToneShape tone={t} w={size} h={Math.round(size * 0.45)} />
          </span>
          {sylls && <div className="small fg2 tone-syl">{sylls[i] ?? ''}</div>}
          {showNames && <div className="label">{TONE_LABEL[t]}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * A word's pitch line: the target drawn from the tone shapes, syllables side
 * by side. `learner` (0..1 samples) is drawn over it when real audio exists.
 */
export function PitchLine({
  tones, learner, w = 320, h = 110, highlight, colour = 'var(--fg)', learnerColour = 'var(--blue)', label = 'Target pitch line',
}: { tones: Tone[]; learner?: number[] | null; w?: number; h?: number; highlight?: number; colour?: string; learnerColour?: string; label?: string }) {
  const n = Math.max(1, tones.length);
  const gap = n > 1 ? 10 : 0;
  const segW = (w - gap * (n - 1)) / n;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', maxWidth: w }} role="img" aria-label={label}>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="var(--rule)" strokeWidth={1} strokeDasharray={g === 0.5 ? '3 4' : undefined} />
      ))}
      {tones.map((t, i) => {
        const x0 = i * (segW + gap);
        return (
          <path
            key={i}
            d={path(toneShape(t, 24), x0 + 3, x0 + segW - 3, h, 10)}
            fill="none"
            stroke={colour}
            strokeOpacity={highlight == null || highlight === i ? 1 : 0.35}
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      })}
      {learner && learner.length > 1 && (
        <path d={path(learner, 3, w - 3, h, 10)} fill="none" stroke={learnerColour} strokeWidth={2} strokeDasharray="1 0" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** Two tone shapes over each other, for comparing a pair. */
export function PairPitch({ a, b, w = 300, h = 120, colours = ['var(--fg)', 'var(--blue)'] }: { a: Tone[]; b: Tone[]; w?: number; h?: number; colours?: [string, string] }) {
  const ca = pitchCurve(a, 24);
  const cb = pitchCurve(b, 24);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', maxWidth: w }} role="img" aria-label="The two pitch shapes">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="var(--rule)" strokeWidth={1} strokeDasharray={g === 0.5 ? '3 4' : undefined} />
      ))}
      <path d={path(ca, 4, w - 4, h, 10)} fill="none" stroke={colours[0]} strokeWidth={3} strokeLinecap="round" />
      <path d={path(cb, 4, w - 4, h, 10)} fill="none" stroke={colours[1]} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}
