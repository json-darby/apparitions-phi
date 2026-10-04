// Stroke order animation: each stroke draws itself in order over the faint
// glyph, with a numbered start dot and the pen tip. Speed is a multiplier.
// Reduced motion shows the finished letter with its start dots, no movement.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { StrokePath } from '../content/types';
import { glyphTextProps } from './glyph';
import { StartMarks } from './Pad';
import './writing.css';

/** Box units per second at speed 1. */
const UNITS_PER_S = 42;
const GAP_MS = 280;

export interface StrokePlayerProps {
  char: string;
  strokes: StrokePath[] | null;
  /** 0.5 slow, 1 normal, 2 fast */
  speed?: number;
  /** change to replay */
  cue?: number;
  loop?: boolean;
  still?: boolean;
  numbers?: boolean;
  size?: number;
  onDone?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function StrokePlayer({ char, strokes, speed = 1, cue = 0, loop, still, numbers = true, size, onDone, className = '', style }: StrokePlayerProps) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const tip = useRef<SVGCircleElement>(null);
  const [lens, setLens] = useState<number[]>([]);
  const done = useRef(onDone);
  done.current = onDone;
  const key = strokes?.map((s) => s.d).join('|') ?? '';

  useLayoutEffect(() => {
    setLens(paths.current.slice(0, strokes?.length ?? 0).map((p) => (p ? p.getTotalLength() : 0)));
  }, [key, strokes?.length]);

  useEffect(() => {
    if (!strokes?.length || lens.length !== strokes.length) return;
    const set = (i: number, drawn: number) => {
      const p = paths.current[i];
      if (p) p.style.strokeDashoffset = String(Math.max(0, lens[i] - drawn));
    };
    if (still) {
      lens.forEach((_, i) => set(i, lens[i]));
      if (tip.current) tip.current.style.opacity = '0';
      return;
    }
    let raf = 0;
    let start = performance.now();
    let finished = false;
    // each stroke takes its length / rate, plus a gap after
    const durs = lens.map((L) => (L / (UNITS_PER_S * speed)) * 1000);
    const total = durs.reduce((a, b) => a + b + GAP_MS, 0);
    const frame = (now: number) => {
      let t = now - start;
      if (t > total) {
        if (!finished) {
          finished = true;
          done.current?.();
        }
        if (loop && t > total + 1200) {
          start = now;
          finished = false;
          t = 0;
        }
      }
      let acc = 0;
      let tipAt: DOMPoint | null = null;
      for (let i = 0; i < lens.length; i++) {
        const local = t - acc;
        const f = Math.max(0, Math.min(1, local / durs[i]));
        set(i, lens[i] * f);
        if (f > 0 && f < 1) tipAt = paths.current[i]?.getPointAtLength(lens[i] * f) ?? null;
        acc += durs[i] + GAP_MS;
      }
      if (tip.current) {
        if (tipAt) {
          tip.current.setAttribute('cx', String(tipAt.x));
          tip.current.setAttribute('cy', String(tipAt.y));
          tip.current.style.opacity = '1';
        } else tip.current.style.opacity = '0';
      }
      if (!finished || loop) raf = requestAnimationFrame(frame);
    };
    lens.forEach((_, i) => set(i, 0));
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [lens, speed, cue, loop, still, strokes?.length]);

  const box = size ? { width: size, height: size } : undefined;
  return (
    <div className={`player ${className}`} style={{ ...box, ...style }}>
      <svg viewBox="0 0 100 100" role="img" aria-label={`Stroke order for ${char}`}>
        <text {...glyphTextProps()} className="player-ghost" lang="th">
          {char}
        </text>
        {strokes?.map((s, i) => (
          <path key={`g${i}`} d={s.d} className="player-guide" />
        ))}
        {strokes?.map((s, i) => (
          <path
            key={`s${i}${key}`}
            ref={(el) => {
              paths.current[i] = el;
            }}
            d={s.d}
            className="player-stroke"
            style={{ strokeDasharray: lens[i] ? `${lens[i]} ${lens[i] + 1}` : undefined, strokeDashoffset: lens[i] ?? 0 }}
          />
        ))}
        {numbers && strokes && <StartMarks strokes={strokes} />}
        <circle ref={tip} r={2.4} className="player-tip" style={{ opacity: 0 }} />
      </svg>
      {!strokes?.length && <div className="player-none small">No stroke path yet. The font outline is shown.</div>}
    </div>
  );
}
