// A measuring tool, skipped in normal test runs: scores a file of measured
// speaker contours for The Tapes against the tones the text says, using the
// app's own tone classifier.
//
//   TAPES_PITCH=<contours.json> TAPES_META=<meta.json> npx vitest run src/tapes/pitch-check
//
// contours.json: { "unit.index": [16 numbers 0..1 | null, one per syllable] }
// meta.json:     { "unit.index": { "tones": [0-4 per syllable], ... } }
// Writes <contours>.kept.json: only the syllables that read as their own tone
// ([] for the rest), and only clips where at least half agree.

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyTone } from '../audio/score';
import { TONES } from '../content/types';

const file = process.env.TAPES_PITCH;
const metaFile = process.env.TAPES_META;
const NAMES = ['mid', 'low', 'falling', 'high', 'rising'] as const;

describe.skipIf(!file || !metaFile)('Tapes speaker contours', () => {
  it('reports how many syllables read as their own tone', () => {
    const got = JSON.parse(readFileSync(file!, 'utf8')) as Record<string, (number[] | null)[] | null>;
    const meta = JSON.parse(readFileSync(metaFile!, 'utf8')) as Record<string, { tones: number[] }>;
    let syl = 0, measured = 0, agree = 0, clips = 0, accepted = 0, keptSyl = 0, wrongLength = 0;
    const perTone: Record<string, [number, number]> = Object.fromEntries(TONES.map((t) => [t, [0, 0]]));
    const kept: Record<string, number[][]> = {};
    for (const [key, m] of Object.entries(meta)) {
      clips++;
      syl += m.tones.length;
      const c = got[key];
      if (!c) continue;
      if (c.length !== m.tones.length) { wrongLength++; continue; }
      const ok = c.map((x, i) => {
        if (!x || x.length !== 16) return false;
        measured++;
        const t = NAMES[m.tones[i]];
        perTone[t][1]++;
        const hit = classifyTone(x).tone === t;
        if (hit) { agree++; perTone[t][0]++; }
        return hit;
      });
      const n = ok.filter(Boolean).length;
      if (n >= Math.ceil(m.tones.length / 2)) {
        accepted++;
        keptSyl += n;
        kept[key] = c.map((x, i) => (ok[i] ? (x as number[]).map((v) => Math.round(v * 1000) / 1000) : []));
      }
    }
    const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : '0'}%`;
    console.log([
      `clips ${clips}, syllables ${syl}`,
      `measured syllables ${measured} (${pct(measured, syl)})${wrongLength ? `, ${wrongLength} clips with the wrong syllable count` : ''}`,
      `read as their own tone: ${agree} (${pct(agree, measured)} of measured, ${pct(agree, syl)} of all)`,
      `clips used (half or more agree): ${accepted} (${pct(accepted, clips)}), syllables kept ${keptSyl} (${pct(keptSyl, syl)})`,
      `per tone: ${TONES.map((t) => `${t} ${pct(perTone[t][0], perTone[t][1])}`).join(', ')}`,
    ].join('\n'));
    writeFileSync(file!.replace(/\.json$/, '.kept.json'), JSON.stringify(kept));
    expect(clips).toBeGreaterThan(0);
  });
});
