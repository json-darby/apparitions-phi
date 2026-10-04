// Names and colours for anyone drawn: cast members use their place colour.

import { CAST } from '../content/seed';
import { PLACE_COLOURS } from '../content/types';

export function personColour(who: string): string {
  if (who === 'you') return PLACE_COLOURS.you;
  return CAST.find((c) => c.id === who)?.colour ?? PLACE_COLOURS.default;
}

export function personName(who: string): string {
  if (who === 'you') return 'You';
  return CAST.find((c) => c.id === who)?.name ?? who;
}

export const CAST_IDS: string[] = CAST.map((c) => c.id);
