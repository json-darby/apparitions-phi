// The situations readiness is measured against: the places you will actually
// stand on the trip, plus reading signs and menus. Each draws on content by
// theme; survival items weigh three times as much.

import type { Theme } from '../content/types';

export type SituationId = 'hotel' | 'food' | 'taxi' | 'market' | 'pharmacy' | 'bar' | 'signs';

export interface Situation {
  id: SituationId;
  name: string;
  /** what "ready" means, in plain words */
  canDo: string;
  themes: Theme[];
  /** letters count here (reading) */
  letters?: boolean;
  /** only counts when 18+ content is on */
  adult?: boolean;
}

/** Themes every conversation leans on; they count in every spoken situation at half weight. */
export const CORE_THEMES: Theme[] = ['greetings', 'questions', 'linking', 'verbs', 'tonepairs'];

export const SITUATIONS: Situation[] = [
  { id: 'hotel', name: 'Hotel desk', canDo: 'Check in, ask for what you need, understand the answer', themes: ['hotel', 'time', 'people'] },
  { id: 'food', name: 'Food stall', canDo: 'Order what you want, at your spice level, and pay', themes: ['food', 'ordering', 'numbers', 'classifiers'] },
  { id: 'taxi', name: 'Taxi', canDo: 'Say where to go, steer by left and right, settle the fare', themes: ['directions', 'numbers', 'time'] },
  { id: 'market', name: 'Market', canDo: 'Ask the price, haggle, count and pay', themes: ['shopping', 'numbers', 'classifiers', 'food'] },
  { id: 'pharmacy', name: 'Pharmacy', canDo: 'Describe what is wrong and understand the advice', themes: ['health'] },
  { id: 'bar', name: 'Bar', canDo: 'Order a round, make small talk, accept a no', themes: ['nightlife', 'ordering', 'classifiers', 'feelings', 'people'] },
  { id: 'signs', name: 'Signs and menus', canDo: 'Sound out signs, prices and menu lines', themes: ['signs', 'food'], letters: true },
];

export const READY = 0.8;
