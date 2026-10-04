// The content model. Every learnable thing is an Item, a Letter or a Pattern.
// Each is split into skills, and each skill gets its own memory schedule.
// Every record carries empty media slots from day one so Phase 4 (sound) and
// Phase 3 (animation) fill files in without changing the shape of the data.

export type Skill = 'hear' | 'say' | 'read' | 'write' | 'tone';
export const SKILLS: Skill[] = ['hear', 'say', 'read', 'write', 'tone'];

export type Tone = 'mid' | 'low' | 'falling' | 'high' | 'rising';
export const TONES: Tone[] = ['mid', 'low', 'falling', 'high', 'rising'];

export type ContentKind = 'item' | 'letter' | 'pattern';

/** 'placeholder' = seed set for Phases 1 to 3; Phase 4 content arrives as 'checked' after the automatic checks. */
export type ContentStatus = 'placeholder' | 'draft' | 'checked';

/** Four voices, two speeds. f = female voice, m = male voice. */
export type VoiceId = 'f1' | 'f2' | 'm1' | 'm2';
export const VOICES: VoiceId[] = ['f1', 'f2', 'm1', 'm2'];
export type Speed = 'normal' | 'slow';

export interface MediaSlots {
  /** key `${voice}.${speed}`, e.g. "f1.slow". null until Phase 4 fills it. */
  audio: Record<string, string | null>;
  /** reference pitch curve per syllable, filled by the Phase 4 pitch pipeline */
  pitch: number[][] | null;
  image: string | null;
  animation: string | null;
}

export function emptyMedia(): MediaSlots {
  const audio: Record<string, string | null> = {};
  for (const v of VOICES) for (const s of ['normal', 'slow'] as Speed[]) audio[`${v}.${s}`] = null;
  return { audio, pitch: null, image: null, animation: null };
}

export type Theme =
  | 'greetings' | 'verbs' | 'questions' | 'numbers' | 'classifiers' | 'food' | 'ordering'
  | 'shopping' | 'directions' | 'hotel' | 'time' | 'people' | 'feelings' | 'health'
  | 'nightlife' | 'cannabis' | 'signs' | 'linking' | 'tonepairs';

export interface Item {
  id: string;
  kind: 'word' | 'phrase';
  thai: string;
  /** tone-marked romanisation, syllables joined with '-' and words with ' ' */
  roman: string;
  /** one tone per syllable, in order */
  tones: Tone[];
  en: string;
  theme: Theme;
  /** first pathway day it may be introduced */
  day: number;
  /** append the speaker's polite ending when said by the learner */
  polite?: 'statement' | 'question';
  /** said only by a male ('m') or female ('f') speaker, e.g. ครับ, ค่ะ, ผม, ฉัน */
  speaker?: 'm' | 'f';
  /** male/female speech forms when the words themselves differ */
  forms?: { m: { thai: string; roman: string }; f: { thai: string; roman: string } };
  hook?: string;
  example?: { thai: string; roman: string; en: string };
  /** classifier item id, for countable nouns */
  classifier?: string;
  /** item ids that sound or look alike, used for contrast drills and distractors */
  contrasts?: string[];
  survival: boolean;
  adult?: boolean;
  skills: Skill[];
  tags: string[];
  status: ContentStatus;
  media: MediaSlots;
}

export type ConsonantClass = 'mid' | 'high' | 'low';

export interface StrokePath {
  /** SVG path data in a 100 x 100 box, drawn in order */
  d: string;
}

export interface Letter {
  id: string;
  char: string;
  /** e.g. "gor gài" */
  name: string;
  /** the key word, in English */
  keyword: string;
  initial: string;
  final: string | null;
  cls: ConsonantClass | 'vowel' | 'tonemark';
  day: number;
  /** null until authored in the stroke tool; the app falls back to the font outline */
  strokes: StrokePath[] | null;
  lookalikes: string[];
  skills: Skill[];
  status: ContentStatus;
  media: MediaSlots;
}

export interface PatternTile {
  thai: string;
  roman: string;
  en: string;
  /** slot tiles are where an item goes */
  slot?: boolean;
}

export interface Pattern {
  id: string;
  /** e.g. "ขอ X หน่อย" */
  frame: string;
  en: string;
  note: string;
  day: number;
  /** worked examples, each a correct tile order */
  examples: PatternTile[][];
  skills: Skill[];
  status: ContentStatus;
  media: MediaSlots;
}

export type AnyContent =
  | ({ kind: 'item' } & { data: Item })
  | ({ kind: 'letter' } & { data: Letter })
  | ({ kind: 'pattern' } & { data: Pattern });

export interface CultureNote {
  id: string;
  day: number;
  title: string;
  body: string;
  /** item ids the note leans on */
  items: string[];
  status: ContentStatus;
}

// ---- The Street ----

export type PlaceId = 'food' | 'taxi' | 'hotel' | 'market' | 'bar' | 'pharmacy';
export const PLACE_COLOURS: Record<PlaceId | 'you' | 'default', string> = {
  food: '#FFB03A',
  market: '#FFB03A',
  pharmacy: '#2EE6E6',
  bar: '#FF3C96',
  taxi: '#2E9BFF',
  hotel: '#2E9BFF',
  you: '#E8E8E8',
  default: '#2E9BFF',
};

export interface Place {
  id: PlaceId;
  name: string;
  thaiSign: string;
  signRoman: string;
  x: number; // position along the street, 0..1
  person: string; // cast id
}

export interface CastMember {
  id: string;
  name: string;
  role: string;
  age: string;
  place: PlaceId | null;
  /** short description used for the portrait reference sheet in Phase 3 */
  look: string;
  colour: string;
}

export interface DialogueOption {
  /** item ids the line is built from; the reply only counts as a review if these are needed to choose it */
  items: string[];
  thai: string;
  roman: string;
  en: string;
  /** effect of choosing this */
  next: string | null;
  rep?: number;
  baht?: number;
  comfort?: number;
  correct?: boolean;
  feedback?: string;
}

export interface DialogueNode {
  id: string;
  speaker: string; // cast id
  thai: string;
  roman: string;
  en: string;
  stage?: string; // stage direction
  expression?: 'neutral' | 'smile' | 'puzzled' | 'sad';
  options: DialogueOption[];
}

export interface StreetTask {
  id: string;
  title: string;
  place: PlaceId;
  person: string;
  day: number;
  reward: { baht: number; rep: number };
  steps: string[]; // labels for the step indicator
  start: string;
  nodes: Record<string, DialogueNode>;
  adult?: boolean;
  chapter?: 'meters-running' | 'after-hours' | 'door-to-door';
}
