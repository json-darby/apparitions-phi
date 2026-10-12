// Extras: tools that sit beside the course, not inside it. Nothing in here
// changes the plan, progress, readiness or the daily minutes. Adding one is a
// line here and a route in app/routes.tsx.

export interface Extra {
  to: string;
  title: string;
  /** a few words for the row's right-hand side */
  note: string;
  /** a sentence for the Extras page */
  about: string;
}

export const EXTRAS: Extra[] = [
  {
    to: '/tapes',
    title: 'The Tapes',
    note: 'Pimsleur companion',
    about: 'Notes, phrases and the speakers’ clips for each Pimsleur unit, a short review and the tone rules, for a quick look on a break.',
  },
];
