// Dev only: code-made clips (a buzz with each item's tone shapes, not Thai
// speech) for a few items, held in memory as blob URLs, so playback, voice
// rotation, street noise and pitch scoring can be tried before the pipeline
// has produced any audio. Never shipped: imported only behind import.meta.env.DEV.

import type { Content } from '../content/repo';
import { VOICES } from '../content/types';
import { encodeWav, mulberry32, synthUtterance, thaiToneContour } from './synth';

const RANGES: Record<string, { floorHz: number; ceilHz: number }> = {
  f1: { floorHz: 165, ceilHz: 300 },
  f2: { floorHz: 180, ceilHz: 330 },
  m1: { floorHz: 85, ceilHz: 160 },
  m2: { floorHz: 95, ceilHz: 175 },
};

export function buildDevFixture(content: Content, count = 12) {
  const out = new Map<string, { audio: Record<string, string | null>; pitch: (number | null)[][] | null }>();
  const items = content.items.filter((it) => it.tones.length > 0 && it.tones.length <= 4).slice(0, count);
  const rng = mulberry32(17);
  for (const it of items) {
    const audio: Record<string, string | null> = {};
    for (const v of VOICES) {
      for (const speed of ['normal', 'slow'] as const) {
        const per = speed === 'slow' ? 0.4 : 0.26;
        const res = synthUtterance(
          it.tones.map((t, i) => ({ tone: t, dur: per + rng() * 0.05, joined: i > 0 && rng() < 0.3 })),
          { ...RANGES[v], sampleRate: 22050, rng, snrDb: 40, lead: 0.08, tail: 0.12, amplitude: 0.5 },
        );
        audio[`${v}.${speed}`] = URL.createObjectURL(new Blob([encodeWav(res.pcm, res.sampleRate)], { type: 'audio/wav' }));
      }
    }
    const pitch = it.tones.map((t) => {
      const c = thaiToneContour(t);
      return Array.from({ length: 16 }, (_, i) => Math.round(c(i / 15) * 1000) / 1000);
    });
    out.set(`item:${it.id}`, { audio, pitch });
  }
  return out;
}
