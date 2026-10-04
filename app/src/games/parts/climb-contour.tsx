// Tone Climb: tone contours drawn as dots (SVG), for lane buttons and the pitch
// panel. Shapes come from toneShape so the platforms, the buttons and the
// panel all show the same five curves.

import { toneShape, TONE_LABEL } from '../../audio/sound';
import type { Tone } from '../../content/types';

/** One colour per tone, the same everywhere in Tone Climb. */
export const TONE_COLOUR: Record<Tone, string> = {
  mid: '#E8E8E8',
  low: '#2E9BFF',
  falling: '#FFB03A',
  high: '#FF3C96',
  rising: '#2EE6E6',
};
export const TONE_HEX: Record<Tone, number> = {
  mid: 0xe8e8e8,
  low: 0x2e9bff,
  falling: 0xffb03a,
  high: 0xff3c96,
  rising: 0x2ee6e6,
};

/** A single tone shape as a row of dots. */
export function ToneContour({ tone, w = 56, h = 26, dots = 11, colour, dim }: { tone: Tone; w?: number; h?: number; dots?: number; colour?: string; dim?: boolean }) {
  const pts = toneShape(tone, dots);
  const c = colour ?? TONE_COLOUR[tone];
  const pad = 3;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`${TONE_LABEL[tone]} tone shape`} role="img" style={{ display: 'block', opacity: dim ? 0.45 : 1 }}>
      {pts.map((v, i) => (
        <circle key={i} cx={pad + ((w - 2 * pad) * i) / (dots - 1)} cy={pad + (1 - v) * (h - 2 * pad)} r={1.7} fill={c} />
      ))}
    </svg>
  );
}

/**
 * The whole word's pitch line, one segment per syllable, with the asked
 * syllable bright and the rest dim. Tone names sit under each segment.
 */
export function WordContour({ tones, focus, w = 300, h = 110 }: { tones: Tone[]; focus: number; w?: number; h?: number }) {
  const n = tones.length;
  const per = 16;
  const top = 8;
  const plotH = h - 34;
  const segW = w / n;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Pitch line: ${tones.map((t) => TONE_LABEL[t]).join(', ')}`} style={{ display: 'block' }}>
      <line x1={0} x2={w} y1={top + plotH / 2} y2={top + plotH / 2} stroke="rgba(255,255,255,.08)" />
      {tones.map((t, s) => {
        const pts = toneShape(t, per);
        const on = s === focus;
        const x0 = s * segW + 8;
        const sw = segW - 16;
        return (
          <g key={s} opacity={on ? 1 : 0.35}>
            {s > 0 && <line x1={s * segW} x2={s * segW} y1={top} y2={top + plotH} stroke="rgba(255,255,255,.14)" strokeDasharray="2 4" />}
            {pts.map((v, i) => (
              <circle key={i} cx={x0 + (sw * i) / (per - 1)} cy={top + (1 - v) * plotH} r={on ? 2.6 : 2} fill={TONE_COLOUR[t]} />
            ))}
            <text x={s * segW + segW / 2} y={h - 6} textAnchor="middle" fontSize="10" fontWeight="600" letterSpacing="1.4" fill={on ? '#f2f2f2' : '#8c8c8c'}>
              {TONE_LABEL[t].toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
