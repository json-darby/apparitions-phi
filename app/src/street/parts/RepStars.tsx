// Reputation as five small stars at the top right of a person's head: one star
// for every two points of the 0..10 reputation, half a star for an odd point.
// The face stays clear at every reputation; the stars carry the standing.

import type { CSSProperties } from 'react';
import { REP_MAX } from '../state';

const STAR = 'M12 2.6l2.8 6.1 6.6.7-4.9 4.5 1.4 6.5L12 17.1l-5.9 3.3 1.4-6.5-4.9-4.5 6.6-.7z';

export function RepStars({ rep, name, colour, style }: { rep: number; name: string; colour?: string; style?: CSSProperties }) {
  const v = Math.max(0, Math.min(REP_MAX, rep)) / 2; // 0..5 in halves
  const fill = colour ?? 'var(--fg)';
  return (
    <div
      className="rep-stars"
      role="img"
      aria-label={`Reputation with ${name}: ${v} of 5 stars`}
      title={`Reputation ${Math.max(0, rep)} of ${REP_MAX}`}
      style={{ position: 'absolute', zIndex: 2, display: 'flex', gap: 2, pointerEvents: 'none', left: 'auto', bottom: 'auto', width: 'auto', height: 'auto', ...style }}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const part = Math.max(0, Math.min(1, v - i)); // 0, 0.5 or 1
        const id = `rs-${name}-${i}`;
        return (
          <svg key={i} viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
            <defs>
              <clipPath id={id}>
                <rect x="0" y="0" width={24 * part} height="24" />
              </clipPath>
            </defs>
            <path d={STAR} fill="none" stroke="var(--rule-strong)" strokeWidth="1.6" strokeLinejoin="round" />
            {part > 0 && <path d={STAR} fill={fill} clipPath={`url(#${id})`} />}
          </svg>
        );
      })}
    </div>
  );
}
