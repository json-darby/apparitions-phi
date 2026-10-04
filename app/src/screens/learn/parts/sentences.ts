// Sentence builder, the part that needs no screen: which worked examples a
// learner can be given. Met material only.

import type { Item, Pattern, PatternTile } from '../../../content/types';

export interface Exercise {
  pattern: Pattern;
  ex: number;
  tiles: PatternTile[];
}

/** Thai compared without spaces or zero-width characters. */
const bare = (thai: string) => thai.replace(/[\s​‌‍]/g, '');

/**
 * The exercises open to this learner: examples of patterns already met whose
 * every tile is a word already met. An example that uses a word not met yet is
 * dropped, and so is a pattern left with no example.
 */
export function usableExercises(patterns: Pattern[], items: Item[], isMet: (ref: string) => boolean): Exercise[] {
  const known = new Set<string>();
  for (const it of items) {
    if (!isMet(`item:${it.id}`)) continue;
    known.add(bare(it.thai));
    if (it.forms) for (const f of [it.forms.m, it.forms.f]) known.add(bare(f.thai));
  }
  return patterns
    .filter((p) => isMet(`pattern:${p.id}`))
    .flatMap((p) => p.examples.map((tiles, ex) => ({ pattern: p, ex, tiles })))
    // one tile alone leaves nothing to put in order
    .filter((e) => e.tiles.length > 1 && e.tiles.every((t) => known.has(bare(t.thai))));
}
