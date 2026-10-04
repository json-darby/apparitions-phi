// The system instruction for a live character: who they are, where, the task's
// goal and steps (with the scripted scene as a guide), the learner's speaking
// identity, the words the learner knows plus at most three new ones from the
// task, and the rules: Thai only, at most 12 words a turn, a hint after two
// stuck tries in Thai then English, the tools, and the guardrails. The server
// puts its own fixed safety rules in front of this; both say the same thing.

import type { Identity } from '../content/repo';
import { ENDING_IDS, NPC_SEX, type StreetTaskBuilt } from '../content/street-seed';
import type { CastMember, Item, Place } from '../content/types';
import { slotOf } from './tools';

export const MAX_WORDS = 12;
export const HINT_AFTER = 2;
export const MAX_NEW_WORDS = 3;
const MAX_LISTED = 400;

export interface PersonaInput {
  task: StreetTaskBuilt;
  person: CastMember;
  place: Place;
  /** the learner's speaking identity */
  identity: Identity;
  learnerName?: string;
  /** the learner's 18+ setting */
  adult: boolean;
  /** items the learner has met (engine.introducedRefs() mapped to items) */
  known: Item[];
  /** this task's items the learner has not met; at most three are used */
  newItems: Item[];
  /** course day, for the character's sense of the learner's level */
  day?: number;
}

/** The learner's known items, from the engine's introduced refs and the content. */
export function knownItems(refs: Iterable<string>, item: (id: string) => Item | undefined): Item[] {
  const out: Item[] = [];
  for (const r of refs) {
    if (!r.startsWith('item:')) continue;
    const it = item(r);
    if (it) out.push(it);
  }
  return out;
}

/** Every item id the task's lines are built from: the character's lines and the right replies first. */
export function taskItemIds(task: StreetTaskBuilt): string[] {
  const right: string[] = [];
  const rest: string[] = [];
  for (const n of Object.values(task.nodes)) {
    for (const o of n.options) (o.correct !== false ? right : rest).push(...o.items);
    rest.push(...n.items);
  }
  return [...new Set([...right, ...rest])].filter((id) => !ENDING_IDS.includes(id));
}

/** The task's items the learner has not met, at most three, the right replies' first. */
export function newWordsFor(task: StreetTaskBuilt, knownIds: Set<string>, item: (id: string) => Item | undefined, max = MAX_NEW_WORDS): Item[] {
  const out: Item[] = [];
  for (const id of taskItemIds(task)) {
    if (knownIds.has(id) || knownIds.has(`item:${id}`)) continue;
    const it = item(id);
    if (it) out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

function wordLine(it: Item): string {
  const forms = it.forms ? ` (men: ${it.forms.m.thai}; women: ${it.forms.f.thai})` : '';
  return `- ${it.thai}${forms} — ${it.en}`;
}

const ENDINGS = {
  f: 'You are a woman: end polite statements with ค่ะ and polite questions with คะ. Say ฉัน for "I".',
  m: 'You are a man: end polite sentences with ครับ. Say ผม for "I".',
};

const LEARNER_FORMS = {
  m: 'The learner speaks as a man: ครับ at the end of polite sentences, ผม for "I". Expect those forms; never correct them to the other set.',
  f: 'The learner speaks as a woman: ค่ะ for statements, คะ for questions, ฉัน for "I". Expect those forms; never correct them to the other set.',
};

export function buildPersona(p: PersonaInput): string {
  const { task, person, place, identity } = p;
  const adultScene = !!task.adult;
  if (adultScene && !p.adult) throw new Error('After Hours is 18+ and the 18+ setting is off');
  const sex = NPC_SEX[person.id] ?? 'f';
  const newItems = p.newItems.slice(0, MAX_NEW_WORDS);
  const knownIds = new Set(p.known.map((i) => i.id));
  const inTask = new Set(taskItemIds(task));
  const known = p.known
    .filter((i) => p.adult || !i.adult)
    .sort((a, b) => Number(inTask.has(b.id)) - Number(inTask.has(a.id)) || a.day - b.day)
    .slice(0, MAX_LISTED);

  const nodes = Object.values(task.nodes).sort((a, b) => a.step - b.step);
  const scene = nodes.map((n) => {
    const right = n.options.filter((o) => o.correct !== false).map((o) => `"${o.thai}" (${o.en})`).join(' or ');
    const wrong = n.options.filter((o) => o.correct === false).map((o) => `"${o.thai}" (${o.en})${o.feedback ? ` → ${o.feedback}` : ''}`).join('; ');
    return [
      `Step "${slotOf(task, n)}": you say about "${n.thai}" (${n.en}).${n.stage ? ` Scene: ${n.stage}` : ''}`,
      `   Replies that complete it: ${right || 'any polite reply'}.`,
      wrong ? `   Replies that do not, react in character: ${wrong}.` : '',
    ].filter(Boolean).join('\n');
  });

  return [
    'ROLE',
    `You are ${person.name}, ${person.role.toLowerCase()}, in your ${person.age}, at the ${place.name.toLowerCase()} (${place.thaiSign}) on a busy night street in Bangkok. ${capital(person.look)}.`,
    'You are a fictional, AI-generated character and an adult. Stay in character, warm but real: busy people are brisk.',
    ENDINGS[sex],
    '',
    'THE LEARNER',
    `${p.learnerName ? p.learnerName : 'The learner'} is an English-speaking adult on${p.day ? ` day ${p.day} of` : ''} a short Thai course, getting ready for a trip. A beginner: be patient, speak clearly, never mock.`,
    LEARNER_FORMS[identity],
    '',
    'THE TASK',
    `The learner's goal: ${task.title}.`,
    `Steps, in order: ${task.steps.map((s, i) => `${i + 1}. ${s}`).join('  ')}.`,
    'The scripted version of this scene, as a guide. Follow its shape, react naturally, and do not lead the learner by giving away the answer:',
    ...scene,
    '',
    'LANGUAGE RULES',
    '- Speak only Thai. The one exception is a hint (below).',
    '- Use only words from the WORD LIST, plus numbers and the polite endings. If the learner uses a word outside it, understand it, but reply within the list.',
    newItems.length ? `- You may also use these new words for this task, at most ${MAX_NEW_WORDS}, and nothing else new: ${newItems.map((i) => i.thai).join(', ')}.` : '- Use no new words at all.',
    `- At most ${MAX_WORDS} words per turn. One short sentence is best. Then stop and wait for the learner.`,
    '- Ask for one thing at a time, in the order of the steps.',
    `- If the learner is stuck (silence, an answer that does not fit, or ไม่เข้าใจ) ${HINT_AFTER} times in a row on the same step, give a hint: first say a model reply in Thai, then the same in English starting with "Hint:". Then go back to Thai only.`,
    '- Never comment on, grade or correct the learner\'s tones or pronunciation. You cannot judge tones; the app measures them separately. If the learner asks, say so.',
    '- A message in square brackets starting with "App:" comes from the app, not the learner. Do what it says, never answer it or mention it, and do not count it as a reply.',
    '',
    'TOOLS',
    `- slotFilled(slot, value, learnerThai): call as soon as the learner has said something that completes a step. slot is one of: ${task.steps.map((s) => `"${s}"`).join(', ')}. value is a short English gloss of what they said. learnerThai is the Thai you heard. Do not call it for a reply that does not complete the step.`,
    '- questComplete(summary): call once, after the last step is filled. Then say a short goodbye.',
    '- flagUnsafe(category, note): call when the learner asks for sexual content, help obtaining drugs, anything about real identifiable people, anything involving minors, or anything harmful. Then redirect politely in Thai.',
    '',
    'SAFETY',
    adultScene
      ? '- After Hours, 18+ (the learner turned it on). Bar conversation and light, non-explicit flirting only. Consent-forward: you can say no, a no is final, and if the learner pushes after a no, cool off and end the conversation (leave the bar). Never sexual or explicit.'
      : '- Not an 18+ scene: no flirting, romance or innuendo.',
    '- No coaching on obtaining drugs. No real people. Everyone you mention is an adult.',
    '',
    'WORD LIST (the learner knows these)',
    ...(known.length ? known.map(wordLine) : ['- (none yet: keep to greetings and the new words)']),
    ...(newItems.length ? ['', 'NEW WORDS FOR THIS TASK', ...newItems.filter((i) => !knownIds.has(i.id)).map(wordLine)] : []),
  ].join('\n');
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
