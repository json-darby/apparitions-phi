// The learner's pitch line drawn over the target, one cell per syllable. The
// target is a soft band (the reference contour: measured from the course clip
// where one exists, else the textbook shape); the learner is a bright line.
// Under each cell: the target tone, what was heard, and a hairline score.

import { TONE_LABEL, toneShape, type SpeechScore } from './sound';
import type { Tone } from '../content/types';

function path(values: number[], x0: number, x1: number, h: number, pad: number): string {
  const n = values.length;
  return values
    .map((v, i) => {
      const x = x0 + (n === 1 ? 0 : (i / (n - 1)) * (x1 - x0));
      const y = pad + (1 - Math.max(-0.1, Math.min(1.1, v))) * (h - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export interface PitchCompareProps {
  tones: Tone[];
  /** reference per syllable (16 points 0..1); textbook shapes when absent */
  reference?: number[][] | null;
  /** learner per syllable (null = not voiced) */
  learner?: (number[] | null)[] | null;
  /** per syllable 0..1 */
  scores?: number[] | null;
  heard?: (Tone | null)[] | null;
  /** convenience: take learner, reference, scores and heard from a score */
  score?: SpeechScore | null;
  /** syllable labels (romanisation) */
  sylls?: string[];
  w?: number;
  h?: number;
  /** hide the labels row */
  bare?: boolean;
  learnerColour?: string;
}

export function PitchCompare(p: PitchCompareProps) {
  const { tones, w = 360, h = 120, bare = false, learnerColour = 'var(--blue)' } = p;
  const reference = p.reference ?? p.score?.reference ?? null;
  const learner = p.learner ?? p.score?.syllables ?? null;
  const scores = p.scores ?? p.score?.tones ?? null;
  const heard = p.heard ?? p.score?.heard ?? null;
  const n = Math.max(1, tones.length);
  const gap = n > 1 ? 12 : 0;
  const segW = (w - gap * (n - 1)) / n;
  const pad = 12;
  const label = `Pitch line: ${tones.map((t) => TONE_LABEL[t]).join(', ')}${learner ? ' with your line over it' : ''}`;
  return (
    <div className="pitch-compare" style={{ width: '100%', maxWidth: w }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }} role="img" aria-label={label}>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="var(--rule)" strokeWidth={1} strokeDasharray={g === 0.5 ? '3 4' : undefined} />
        ))}
        {tones.map((t, i) => {
          const x0 = i * (segW + gap) + 4;
          const x1 = x0 + segW - 8;
          const ref = reference?.[i] ?? toneShape(t, 16);
          const mine = learner?.[i] ?? null;
          return (
            <g key={i}>
              {i > 0 && <line x1={x0 - gap / 2 - 4} x2={x0 - gap / 2 - 4} y1={6} y2={h - 6} stroke="var(--rule)" strokeWidth={1} />}
              <path d={path(ref, x0, x1, h, pad)} fill="none" stroke="var(--fg)" strokeOpacity={0.14} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
              <path d={path(ref, x0, x1, h, pad)} fill="none" stroke="var(--fg)" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" />
              {mine && (
                <>
                  <path d={path(mine, x0, x1, h, pad)} fill="none" stroke={learnerColour} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx={x1} cy={pad + (1 - Math.max(-0.1, Math.min(1.1, mine[mine.length - 1]))) * (h - pad * 2)} r={3.5} fill={learnerColour} />
                </>
              )}
            </g>
          );
        })}
      </svg>
      {!bare && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap, marginTop: 6 }}>
          {tones.map((t, i) => {
            const s = scores?.[i];
            const hd = heard?.[i];
            const ok = hd != null && hd === t;
            return (
              <div key={i} className="stack gap-1" style={{ minWidth: 0, textAlign: 'left' }}>
                {p.sylls?.[i] && <span className="small" style={{ color: 'var(--fg-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.sylls[i]}</span>}
                <span className="label" style={{ color: 'var(--fg)' }}>{TONE_LABEL[t]}</span>
                {learner && (
                  <span className="small" style={{ color: hd == null ? 'var(--mut)' : ok ? 'var(--good)' : 'var(--amber)' }}>
                    {hd == null ? 'not heard' : ok ? 'heard it' : `heard ${TONE_LABEL[hd].toLowerCase()}`}
                  </span>
                )}
                {s != null && (
                  <span className="meter" aria-label={`Tone match ${Math.round(s * 100)}%`}>
                    <i style={{ width: `${Math.round(s * 100)}%` }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
