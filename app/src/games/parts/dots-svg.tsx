// The same dot glyphs as SVG, for buttons, trays and side panels. Plus a hook
// that keeps the latest value in a ref, for Pixi tickers reading React props.

import { useId, useRef } from 'react';
import type { DotPt } from './dots-glyphs';
import { css } from './dots-pixi';

export function DotGlyph({ dots, size = 56, glow = true, label }: { dots: DotPt[]; size?: number; glow?: boolean; label?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="-1.05 -1.05 2.1 2.1" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {glow && (
        <defs>
          <filter id={`g${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.03" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <g filter={glow ? `url(#g${id})` : undefined}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={Math.max(0.018, d.r)} fill={css(d.c)} opacity={d.a ?? 1} />
        ))}
      </g>
    </svg>
  );
}

/** Ref that always holds the latest value. */
export function useLatest<T>(value: T) {
  const r = useRef(value);
  r.current = value;
  return r;
}
