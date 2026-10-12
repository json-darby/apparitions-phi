// The Tapes' own small review: a card per unit phrase, from units marked heard.
// Again comes back in this session, Good and Easy push it out (an SM-2 style
// interval). Kept apart from the app's own schedule on purpose.

import type { Card, TapesState } from './db';
import type { Pack, UnitItem } from './pack';

export const dayNumber = (ms = Date.now()) => {
  const d = new Date(ms);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
};

export interface Deck {
  id: string;
  n: number;
  i: number;
  item: UnitItem;
}

export function deckOf(pack: Pack, heard: number[]): Deck[] {
  const out: Deck[] = [];
  [...heard].sort((a, b) => a - b).forEach((n) => {
    (pack.units[String(n)] ?? []).forEach((item, i) => {
      // single words with no meaning of their own make poor cards
      if (!item.mean) return;
      out.push({ id: `u${n}.${i}`, n, i, item });
    });
  });
  return out;
}

export function dueCount(pack: Pack, s: TapesState, heard: number[], today = dayNumber()) {
  const deck = deckOf(pack, heard);
  const due = deck.filter((c) => s.cards[c.id] && s.cards[c.id].due <= today).length;
  const unseen = deck.filter((c) => !s.cards[c.id]).length;
  const fresh = Math.max(0, Math.min(unseen, s.newPerDay - (s.intro[String(today)] ?? 0)));
  return { due, fresh, started: deck.filter((c) => s.cards[c.id]).length };
}

/** The next card: due ones first (not the one just seen), then a new one if today's allowance is left. */
export function nextCard(pack: Pack, s: TapesState, heard: number[], lastId: string | null, today = dayNumber()): { card: Deck; isNew: boolean } | null {
  const deck = deckOf(pack, heard);
  const due = deck.filter((c) => s.cards[c.id] && s.cards[c.id].due <= today);
  const pick = due.find((c) => c.id !== lastId) ?? due[0];
  if (pick) return { card: pick, isNew: false };
  if ((s.intro[String(today)] ?? 0) >= s.newPerDay) return null;
  const fresh = deck.find((c) => !s.cards[c.id]);
  return fresh ? { card: fresh, isNew: true } : null;
}

export type Grade = 0 | 1 | 2;

export function grade(prev: Card | undefined, g: Grade, today = dayNumber()): Card {
  const c: Card = prev ? { ...prev } : { ivl: 0, ease: 2.5, due: today };
  if (g === 0) {
    c.ivl = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = today;
  } else {
    if (c.ivl < 1) c.ivl = g === 2 ? 4 : 1;
    else {
      const good = Math.max(c.ivl + 1, Math.round(c.ivl * c.ease));
      // Easy always lands later than Good
      c.ivl = g === 2 ? Math.max(good + 1, Math.round(c.ivl * c.ease * 1.3)) : good;
    }
    if (g === 2) c.ease += 0.15;
    c.due = today + c.ivl;
  }
  return c;
}

/** What each button will do, for the label under it. */
export function gradeLabel(prev: Card | undefined, g: Grade): string {
  if (g === 0) return 'again soon';
  const d = grade(prev, g, 0).due;
  return d === 1 ? 'tomorrow' : `${d} days`;
}
