// The hand-written 30-day spine and the shape of each day. All generated
// content must follow it. Unlock days for drills and chapters come from here.

export interface DaySpine {
  day: number;
  script: string;
  focus: string;
  situation: string;
  culture: string;
  checkpoint?: 'week' | 'final';
}

export const SPINE: DaySpine[] = [
  { day: 1, script: 'The five tones by ear. Mid-class ก จ ด ต บ ป อ. Long vowel า', focus: 'Greetings, polite particles, I and you', situation: 'Hotel desk: say hello', culture: 'The wai' },
  { day: 2, script: 'Long vowels ี ู. Mid tone as the default', focus: 'Yes and no, not + verb', situation: 'Food stall: point and order', culture: 'Street-food manners' },
  { day: 3, script: 'Low-class ง น ม ย ร ล ว', focus: 'Numbers 0 to 10', situation: 'Market prices', culture: 'Baht notes and coins' },
  { day: 4, script: 'Vowels เ แ โ. Mid versus low tone training begins', focus: 'Want a thing, want to do', situation: 'Order a drink', culture: 'Ice, water, safety' },
  { day: 5, script: 'ำ ใ ไ. Reading first syllables', focus: 'Numbers 11 to 100, how much', situation: 'Night Market opens', culture: 'Haggling' },
  { day: 6, script: 'Live and dead syllables', focus: 'Polite requests', situation: 'Taxi rank', culture: 'Taxi, app cars, tuk-tuks' },
  { day: 7, script: 'Checkpoint 1: tones, 15 letters, 60 items', focus: 'Review', situation: 'Short task', culture: 'Temple dress', checkpoint: 'week' },
  { day: 8, script: 'High-class ข ฉ ถ ผ ฝ ส ห', focus: 'Yes-no questions', situation: 'Heat Check opens', culture: 'Spice' },
  { day: 9, script: 'High-class tone rules', focus: 'Spicy, not spicy, a little', situation: 'Full food order', culture: 'Sharing dishes' },
  { day: 10, script: 'First tone mark on mid and high class', focus: 'Classifiers 1: thing, plate, glass, bottle', situation: 'Bar: order by classifier', culture: 'Drinking and tipping' },
  { day: 11, script: 'Low-class ค ช ท พ ฟ ซ ฮ', focus: 'Left, right, straight', situation: "Meter's Running, part 1", culture: 'Addresses and sois' },
  { day: 12, script: 'Low-class rules. Second tone mark', focus: 'Where is, near, far', situation: 'Ask the way', culture: 'Landmarks over street names' },
  { day: 13, script: 'Short vowels ะ ิ ุ. Dead syllables', focus: 'Today, tomorrow, yesterday', situation: 'Book a taxi for later', culture: 'Telling time, intro' },
  { day: 14, script: 'Checkpoint 2: 30 letters, tone rules on 40 words', focus: 'Review. Tone Climb opens', situation: "Meter's Running, part 2", culture: 'Respect for the monarchy', checkpoint: 'week' },
  { day: 15, script: 'Final consonant sounds', focus: 'Clock time', situation: 'Hotel: check in, wake-up call', culture: 'Hotel norms and deposits' },
  { day: 16, script: 'Third and fourth tone marks', focus: 'Already, in progress, will', situation: 'Last Orders opens', culture: 'Sabai and kreng jai' },
  { day: 17, script: 'Silent leading ห', focus: "Like, don't like, delicious", situation: 'Market: describing food', culture: 'Fruit seasons' },
  { day: 18, script: 'Vowel combinations', focus: 'Small talk: name, country, job', situation: 'Bar chat', culture: 'Nicknames' },
  { day: 19, script: 'Silent-letter mark. Reading menus', focus: 'Classifiers 2: person, animal, room', situation: 'Pharmacy', culture: 'Pharmacies and common medicine' },
  { day: 20, script: 'Rare letters, recognition only', focus: 'Headache, allergic, medicine', situation: 'Pharmacy task', culture: 'Emergency numbers' },
  { day: 21, script: 'Checkpoint 3: sign reading, 200 items', focus: 'Ink Run fully open', situation: 'After Hours, part 1 (18+)', culture: 'Consent and respect', checkpoint: 'week' },
  { day: 22, script: 'Speed reading: signs and menus', focus: 'Feelings, compliments, polite refusals', situation: 'After Hours, part 2', culture: 'Dating manners' },
  { day: 23, script: 'Fast-speech tone changes, awareness only', focus: 'Invitations, consent-forward phrases', situation: 'Bar conversation', culture: 'Alcohol sale hours' },
  { day: 24, script: 'Reading prices and phone numbers', focus: 'Cannabis-shop vocabulary and the legal note', situation: 'Shop scene, talk only', culture: 'Current cannabis law' },
  { day: 25, script: 'Writing whole words from dictation', focus: 'Problems: lost, broken, too expensive', situation: 'Door to Door rehearsal', culture: 'Scams to know' },
  { day: 26, script: 'Mixed reading', focus: 'Comparing: more than, the most', situation: 'Hotel complaint', culture: 'Tipping recap' },
  { day: 27, script: 'Mixed', focus: "Plans: I'd like to, shall we", situation: 'Planning a day trip', culture: 'Islands and ferries' },
  { day: 28, script: 'Mixed', focus: 'Telling what happened', situation: 'Retell your day', culture: 'Festivals' },
  { day: 29, script: 'Final tone test', focus: 'Weak patterns', situation: 'Door to Door, full run', culture: 'Leaving Thailand' },
  { day: 30, script: 'Final assessment', focus: 'Everything', situation: 'Door to Door, scored, and the finale', culture: '', checkpoint: 'final' },
];

/**
 * Days 31 to 60, for the 60-day course. It goes further rather than slower:
 * more words (planWords has each plan's total), every vowel form and tone mark written, reading
 * running text, natural-speed listening and longer conversation. Days 1 to 30
 * are the same on both courses, so day 30 is a midpoint assessment here.
 */
export const SPINE_EXTENSION: DaySpine[] = [
  { day: 31, script: 'All vowel pairs, short and long', focus: 'Feelings and opinions', situation: 'Café conversation', culture: 'Thai coffee and tea' },
  { day: 32, script: 'Vowel forms เอีย เอือ อัว', focus: 'Past experiences', situation: 'Tell the stall about your day', culture: 'The six-hour clock' },
  { day: 33, script: 'Writing the first two tone marks on every class', focus: 'Comparing in more detail', situation: 'Shopping for clothes', culture: 'Sizes and fitting rooms' },
  { day: 34, script: 'Writing the third and fourth tone marks', focus: 'If and then', situation: 'Plans fall through', culture: 'Mai pen rai in practice' },
  { day: 35, script: 'Dictation: whole words, round two', focus: 'Chained requests', situation: 'Hotel problems', culture: 'Complaining politely' },
  { day: 36, script: 'Reading running text: short notices', focus: 'Reported speech: he said that', situation: 'Gossip at the food stall', culture: 'Face, deeper' },
  { day: 37, script: 'Checkpoint 5: all consonants written, 450 items', focus: 'Review', situation: 'Short task', culture: 'Regional food', checkpoint: 'week' },
  { day: 38, script: 'Consonant clusters กร คล ปร', focus: 'Worried, surprised, annoyed', situation: 'Lost property at the station', culture: 'Tourist police' },
  { day: 39, script: 'Borrowed words and irregular spellings', focus: 'Trains and buses', situation: 'Book a train', culture: 'Overnight trains' },
  { day: 40, script: 'Reading menus at speed', focus: 'Ordering for a group, preferences', situation: 'Dinner for six', culture: 'Sharing the bill' },
  { day: 41, script: 'Numbers and abbreviations in text', focus: 'Describing symptoms', situation: 'Clinic visit', culture: 'Hospitals and insurance' },
  { day: 42, script: 'Natural-speed listening, part 1', focus: 'Particles นะ สิ เลย จัง', situation: 'Chat at the bar', culture: 'Street Thai and textbook Thai' },
  { day: 43, script: 'Natural speed, part 2: dropped pronouns', focus: 'Casual questions เหรอ รึยัง', situation: 'A phone call', culture: 'Messaging manners' },
  { day: 44, script: 'Checkpoint 6: running text, tones on new voices', focus: 'Review', situation: 'Short task', culture: 'Festivals through the year', checkpoint: 'week' },
  { day: 45, script: 'Thai numerals ๑ ๒ ๓', focus: 'Banks, cash machines, exchange', situation: 'Change money', culture: 'Fees and card scams' },
  { day: 46, script: 'Reading transport signs', focus: 'Landmarks, sides, floors', situation: 'Find a place from a description', culture: 'Getting around Bangkok' },
  { day: 47, script: 'Formal and royal words, recognition only', focus: 'Register up and down', situation: 'Talk to someone older', culture: 'Elder and younger: phîi and náwng' },
  { day: 48, script: 'Writing a short message', focus: 'Invitations and replies', situation: 'Plan a night out', culture: 'Nightlife districts' },
  { day: 49, script: 'Reading a short story', focus: 'Describing people and places', situation: 'Describe your home town', culture: 'The regions of Thailand' },
  { day: 50, script: 'Fast-speech tone changes in practice', focus: 'Humour and teasing', situation: 'Banter at the market', culture: 'Sanùk' },
  { day: 51, script: 'Checkpoint 7: 600 items, five minutes of live talk', focus: 'Review', situation: 'Short task', culture: 'Temple etiquette, deeper', checkpoint: 'week' },
  { day: 52, script: 'Dictation: whole sentences', focus: 'Delays and refunds', situation: 'Airline desk', culture: 'Travel insurance claims' },
  { day: 53, script: 'Reading headlines', focus: "I agree, I don't think so", situation: 'Talk about the news, lightly', culture: 'Topics to leave alone' },
  { day: 54, script: 'Mixed reading', focus: 'Plans and boundaries', situation: 'A second meeting (18+)', culture: 'Consent and respect, again' },
  { day: 55, script: 'Mixed reading', focus: 'Islands and beaches', situation: 'Book a boat', culture: 'Sea safety' },
  { day: 56, script: 'Mixed reading', focus: 'Emergencies, deeper', situation: 'Help someone in trouble', culture: 'Emergency services' },
  { day: 57, script: 'Mixed reading', focus: 'Telling a story', situation: 'Retell the trip so far', culture: 'Saying goodbye' },
  { day: 58, script: 'Final writing test', focus: 'Weakest patterns', situation: 'Door to Door, extended', culture: 'Coming back' },
  { day: 59, script: 'Final tone test', focus: 'Everything', situation: 'Door to Door, full run', culture: 'Keeping it up at home' },
  { day: 60, script: 'Final assessment', focus: 'Everything', situation: 'Door to Door, scored, and the finale', culture: '', checkpoint: 'final' },
];

export type CourseDays = 30 | 60;

/** The default course length; use courseSpine for the learner's own. */
export const COURSE_DAYS = 30;

export function courseSpine(len: CourseDays): DaySpine[] {
  if (len === 30) return SPINE;
  return [
    ...SPINE.map((d) => (d.day === 30 ? { ...d, script: 'Midpoint assessment', situation: 'Door to Door, scored', checkpoint: 'week' as const } : d)),
    ...SPINE_EXTENSION,
  ];
}

export function checkpointDays(len: CourseDays): number[] {
  return courseSpine(len).filter((d) => d.checkpoint).map((d) => d.day);
}

export type BlockId = 'review' | 'new' | 'writing' | 'tonelab' | 'drill' | 'street' | 'culture';

export interface Block {
  id: BlockId;
  label: string;
  minutes: number;
}

/** A day at 60 minutes: review 15, new items and listening 9, writing 6, tone lab 6, a drill 15, The Street 9. At 30 each is roughly halved. */
export function dayBlocks(track: 30 | 60): Block[] {
  const f = track === 60 ? 1 : 0.5;
  return [
    { id: 'review', label: 'Review', minutes: 15 * f },
    { id: 'new', label: 'New items and listening', minutes: 9 * f },
    { id: 'writing', label: 'Writing', minutes: 6 * f },
    { id: 'tonelab', label: 'Tone lab', minutes: 6 * f },
    { id: 'drill', label: 'A drill', minutes: 15 * f },
    { id: 'street', label: 'The Street', minutes: 9 * f },
    { id: 'culture', label: 'Culture note', minutes: 0 },
  ];
}

/**
 * New material per day: ceilings, not targets. The planner fits what the day's time allows, today's
 * lesson first (engine newCandidates). At an hour a day the ceiling clears a whole day's words (the
 * course has up to 16 a day) with room to catch up; half an hour takes the day's core. What each plan
 * really teaches is measured on the real course (engine/plans.test.ts) and shown at onboarding.
 */
export function newQuota(track: 30 | 60, day = 1) {
  if (day > 30) return track === 60 ? { items: 10, letters: 2, patterns: 1 } : { items: 6, letters: 1, patterns: 1 };
  return track === 60 ? { items: 20, letters: 3, patterns: 2 } : { items: 8, letters: 2, patterns: 1 };
}

/**
 * The order new material is taught in, so the day's cards match the day's lesson. The full plan
 * (60 days at an hour a day) has time for the whole alphabet and every pattern, so letters and
 * patterns lead, then today's words, then words from earlier days that did not fit then. Every
 * shorter plan teaches today's lesson first (its letters and patterns, then its words), then what is
 * left from earlier days. Survival words lead within each group. The engine plans with it and the
 * readiness forecast replays it.
 */
export function teachingCompare(day: number, full: boolean) {
  type E = { kind: string; day: number; survival?: boolean };
  const rank = (e: E) => (full ? (e.kind === 'item' ? 1 : 0) : (e.day === day ? 0 : 2) + (e.kind === 'item' ? 1 : 0));
  const today = (e: E) => (e.day === day ? 0 : 1);
  return (a: E, b: E) => rank(a) - rank(b) || today(a) - today(b) || a.day - b.day || (b.survival ? 1 : 0) - (a.survival ? 1 : 0);
}

/** The full plan: the whole course at an hour a day. */
export const isFullPlan = (courseDays: number, minutes: number) => courseDays === 60 && minutes === 60;

/**
 * Words and phrases each plan really teaches by its last day: the real course run through the real
 * planner by a learner who does every session (engine/plans.test.ts holds these to the course).
 * The full plan also teaches the whole alphabet and every sentence pattern.
 */
export function planWords(courseDays: number, minutes: number): number {
  if (courseDays === 60) return minutes === 60 ? 570 : 270;
  return minutes === 60 ? 310 : 150;
}

export type DrillId = 'night-market' | 'heat-check' | 'last-orders' | 'ink-run' | 'tone-climb';
export type ChapterId = 'meters-running' | 'after-hours' | 'door-to-door';

export interface Unlock {
  id: DrillId | ChapterId | 'street';
  title: string;
  day: number;
  tag: string;
  adult?: boolean;
}

export const DRILLS: Unlock[] = [
  { id: 'night-market', title: 'Night Market', day: 5, tag: 'Slicer' },
  { id: 'heat-check', title: 'Heat Check', day: 8, tag: 'Service' },
  { id: 'last-orders', title: 'Last Orders', day: 16, tag: 'Stacker' },
  { id: 'ink-run', title: 'Ink Run', day: 3, tag: 'Letter rain' }, // letters from day 1; fully open on day 21,
  { id: 'tone-climb', title: 'Tone Climb', day: 14, tag: 'Platformer' },
];

export const STREET: Unlock[] = [
  { id: 'street', title: 'Walk the street', day: 1, tag: 'Street' },
  { id: 'meters-running', title: "Taxi · Meter's Running", day: 11, tag: 'Chapter' },
  { id: 'after-hours', title: 'Bar · After Hours', day: 21, tag: '18+', adult: true },
  { id: 'door-to-door', title: 'The whole trip · Door to Door', day: 25, tag: 'Chapter' },
];

/** Checkpoints on the 30-day course. On the 60-day course use checkpointDays(60). */
export const CHECKPOINT_DAYS = [7, 14, 21, 30];

export function spineFor(day: number, len: CourseDays = 30): DaySpine {
  const spine = courseSpine(len);
  return spine[Math.min(Math.max(day, 1), spine.length) - 1];
}
