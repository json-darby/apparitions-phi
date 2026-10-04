// Placeholder scripted tasks for The Street (Phase 2). Built only from seed items
// plus the polite endings. Every line, NPC or learner, is composed from item
// ids, so each reply knows exactly which items it uses. The Thai is unchecked
// until Phase 4, when the full 25 tasks are generated and pass the checks.
//
// Learner lines depend on the speaking identity (ครับ for male, ค่ะ / คะ for
// female), so tasks are built per identity: tasksFor(identity). STREET_TASKS is
// the male build, kept for ids, days and progress counts.
//
// Once a generated course is loaded (setCourseTasks) only its own scripts are
// offered. A task the course lacks is not ready yet; it never falls back to
// the placeholder script here. These specs stay for the seed-only mode and
// for tests.

import { SEED_ITEMS } from './seed';
import { sayForm, type Identity } from './repo';
import type { DialogueNode, DialogueOption, Item, PlaceId, StreetTask, Tone } from './types';

const ITEM = new Map<string, Item>(SEED_ITEMS.map((i) => [i.id, i]));

/** Speech forms of the cast: the ending each person uses. */
export const NPC_SEX: Record<string, Identity> = {
  nok: 'f', ton: 'm', ploy: 'f', lek: 'm', mai: 'f', bank: 'm', fah: 'f', pim: 'f',
};

export const ENDING_IDS = ['khrap', 'kha-statement', 'kha-question'];

// ---------- line composition ----------

export type Ending = 's' | 'q' | null;

export interface Line {
  thai: string;
  roman: string;
  /** item ids the line is built from, including the polite ending */
  items: string[];
  tones: Tone[];
}

/**
 * Compose a line from items: the seed set, unless another set is given. '_'
 * puts a space between phrases. 'I' is ผม or ฉัน by speaker. The polite ending
 * goes through sayForm, the same rule every other screen uses.
 */
export function compose(parts: string[], who: Identity, ending: Ending, from: ReadonlyMap<string, Item> = ITEM): Line {
  const items: string[] = [];
  const tones: Tone[] = [];
  let thai = '';
  const roman: string[] = [];
  let space = false;
  for (const p0 of parts) {
    if (p0 === '_') {
      space = true;
      continue;
    }
    const p = p0 === 'I' ? (who === 'm' ? 'i-male' : 'i-female') : p0;
    const it = from.get(p);
    if (!it) throw new Error(`street-seed: unknown item ${p}`);
    thai += (space && thai ? ' ' : '') + it.thai;
    roman.push(it.roman);
    items.push(it.id);
    tones.push(...it.tones);
    space = false;
  }
  const base = { thai, roman: roman.join(' ') };
  if (!ending) return { ...base, items, tones };
  const end = who === 'm' ? 'khrap' : ending === 'q' ? 'kha-question' : 'kha-statement';
  const e = from.get(end);
  if (!e) throw new Error(`street-seed: unknown item ${end}`);
  if (!items.length) {
    // the ending alone: "ค่ะ" as "here you are", "yes"
    return { thai: e.thai, roman: e.roman, items: [end], tones: [...e.tones] };
  }
  const host = from.get(items[0])!;
  const said = sayForm({ ...host, thai: base.thai, roman: base.roman, forms: undefined, polite: ending === 'q' ? 'question' : 'statement' }, who);
  return { ...said, items: [...items, end], tones: [...tones, ...e.tones] };
}

// ---------- node and option shapes ----------

export interface StreetOption extends DialogueOption {
  tones: Tone[];
}

export interface StreetNode extends DialogueNode {
  /** index into the task's steps, for the step rail */
  step: number;
  /** item ids the NPC line is built from */
  items: string[];
  tones: Tone[];
  /**
   * Items you must understand in the NPC line to pick the right reply. Only
   * set where the right reply depends on it; those choices also log 'hear'.
   */
  heard?: string[];
  options: StreetOption[];
}

interface OptSpec {
  say: string[];
  end?: Ending;
  en: string;
  /** false = a wrong reply; omitted = an acceptable one */
  ok?: boolean;
  /** next node id; omitted: wrong replies stay on this node, right ones end the task */
  next?: string | null;
  rep?: number;
  baht?: number;
  comfort?: number;
  fb?: string;
}

interface NodeSpec {
  id: string;
  step: number;
  say: string[];
  end?: Ending;
  en: string;
  stage?: string;
  expression?: DialogueNode['expression'];
  /** true = every non-ending item in the NPC line */
  heard?: string[] | true;
  opts: OptSpec[];
}

function buildNode(speaker: string, spec: NodeSpec, me: Identity, from: ReadonlyMap<string, Item>): StreetNode {
  const npc = compose(spec.say, NPC_SEX[speaker] ?? 'f', spec.end === undefined ? 's' : spec.end, from);
  const heard = spec.heard === true ? npc.items.filter((i) => !ENDING_IDS.includes(i)) : spec.heard;
  return {
    id: spec.id,
    step: spec.step,
    speaker,
    thai: npc.thai,
    roman: npc.roman,
    en: spec.en,
    stage: spec.stage,
    expression: spec.expression,
    items: npc.items,
    tones: npc.tones,
    heard,
    options: spec.opts.map((o) => {
      const l = compose(o.say, me, o.end === undefined ? 's' : o.end, from);
      const correct = o.ok !== false;
      return {
        items: l.items,
        thai: l.thai,
        roman: l.roman,
        tones: l.tones,
        en: o.en,
        next: o.next !== undefined ? o.next : correct ? null : spec.id,
        rep: o.rep,
        baht: o.baht,
        comfort: o.comfort,
        correct,
        feedback: o.fb,
      };
    }),
  };
}

interface TaskSpec extends Omit<StreetTask, 'nodes' | 'start'> {
  nodes: NodeSpec[];
  /** shown on the task screen: what Phase 4 replaces */
  note?: string;
}

export interface StreetTaskBuilt extends StreetTask {
  nodes: Record<string, StreetNode>;
  note?: string;
}

function build(spec: TaskSpec, me: Identity, from: ReadonlyMap<string, Item> = ITEM): StreetTaskBuilt {
  const nodes: Record<string, StreetNode> = {};
  for (const n of spec.nodes) nodes[n.id] = buildNode(spec.person, n, me, from);
  const { nodes: _n, ...rest } = spec;
  return { ...rest, start: spec.nodes[0].id, nodes };
}

// ---------- the street tasks ----------

const PLACEHOLDER = 'Placeholder script. The Thai is unchecked until Phase 4.';

const STREET: TaskSpec[] = [
  {
    id: 'hotel-hello', title: 'Say hello at the hotel desk', place: 'hotel', person: 'ploy', day: 1,
    reward: { baht: 20, rep: 2 }, steps: ['Greet', 'Thank'],
    nodes: [
      {
        id: 'greet', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'She looks up from the screen. A fan ticks behind her.',
        opts: [
          { say: ['hello'], en: 'Hello.', rep: 1, next: 'key' },
          { say: ['thank-you'], en: 'Thank you.', ok: false, fb: 'She waits. Nothing to thank her for yet.' },
          { say: ['sorry'], en: 'Sorry.', ok: false, fb: 'She tilts her head. You have not done anything yet.' },
          { say: ['dont-understand'], en: "I don't understand.", ok: false, fb: 'She said hello. That one you know.' },
        ],
      },
      {
        id: 'key', step: 1, say: [], en: 'Here you are.', end: 's',
        stage: 'She slides a key card across the desk.',
        opts: [
          { say: ['thank-you'], en: 'Thank you.', rep: 1 },
          { say: ['hello'], en: 'Hello.', ok: false, fb: 'You already said hello. She is still holding the card out.' },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, fb: 'It is a key. It is free.' },
          { say: ['never-mind'], en: 'Never mind.', ok: false, fb: 'She frowns at the card, then at you.' },
        ],
      },
    ],
  },
  {
    id: 'food-water', title: 'Order a coffee, no ice', place: 'food', person: 'nok', day: 4,
    reward: { baht: 20, rep: 2 }, steps: ['Order', 'Ice', 'Pay'],
    nodes: [
      {
        id: 'order', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'Nok has a kettle on and three orders in her head.',
        opts: [
          { say: ['khaw', 'coffee', 'noi'], en: 'A coffee, please.', next: 'ice' },
          { say: ['khaw', 'water', 'noi'], en: 'A water, please.', ok: false, fb: 'You wanted coffee. Nok is already reaching for the water.' },
          { say: ['khaw', 'beer', 'noi'], en: 'A beer, please.', ok: false, fb: 'Not at this hour, and not from this stall.' },
          { say: ['coffee', 'expensive'], en: 'Coffee is expensive.', ok: false, fb: 'She shrugs. You have not asked the price.' },
        ],
      },
      {
        id: 'ice', step: 1, say: ['ice', 'mai-q'], end: 'q', en: 'Ice?', heard: true,
        stage: 'The scoop hovers over the ice bucket.',
        opts: [
          { say: ['mai-not', 'ao', 'ice'], en: 'No ice.', next: 'pay' },
          { say: ['ao'], en: 'Yes, I will take it.', ok: false, fb: 'The task was no ice. In it goes.' },
          { say: ['khaw', 'ice', 'noi'], en: 'Some ice, please.', ok: false, fb: 'That is the opposite of no ice.' },
          { say: ['tiger'], en: 'Tiger.', ok: false, fb: 'Tiger, not ice. Rising tone. She waits.' },
        ],
      },
      {
        id: 'pay', step: 2, say: ['n4', 'n10', 'baht'], en: 'Forty baht.', heard: true,
        opts: [
          { say: ['n4', 'n10', 'yes', 'mai-q'], end: 'q', en: 'Forty, right?', next: 'paid' },
          { say: ['n7', 'n10', 'yes', 'mai-q'], end: 'q', en: 'Seventy, right?', ok: false, fb: 'Forty. Sìi, not jèt.' },
          { say: ['n4', 'n100', 'yes', 'mai-q'], end: 'q', en: 'Four hundred, right?', ok: false, fb: 'For a coffee. She laughs. Forty.' },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, rep: -1, fb: 'Forty baht for coffee is not the place to haggle.' },
        ],
      },
      {
        id: 'paid', step: 2, say: ['yes'], en: 'Yes.',
        stage: 'She holds out a hand for the money.',
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 40 baht.)', baht: -40 },
          { say: ['sorry'], en: 'Sorry.', ok: false, fb: 'Nothing to apologise for. Just pay.' },
          { say: ['dont-understand'], en: "I don't understand.", ok: false, fb: 'She said yes. The hand is still out.' },
        ],
      },
    ],
  },
  {
    id: 'market-mango', title: 'Haggle for a mango', place: 'market', person: 'lek', day: 5,
    reward: { baht: 30, rep: 2 }, steps: ['Ask', 'Counter', 'Pay'],
    nodes: [
      {
        id: 'ask', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'Lek is stacking mangoes into a pyramid that will not survive the night.',
        opts: [
          { say: ['how-much-this'], end: 'q', en: 'How much is this?', next: 'price' },
          { say: ['mango', 'how-much'], end: 'q', en: 'How much are the mangoes?', next: 'price' },
          { say: ['banana', 'how-much'], end: 'q', en: 'How much are the bananas?', ok: false, fb: 'He points at the bananas. You came for a mango.' },
          { say: ['sorry'], en: 'Sorry.', ok: false, fb: 'He waits. Lek has all night.' },
        ],
      },
      {
        id: 'price', step: 1, say: ['n8', 'n10', 'baht'], en: 'Eighty baht.', heard: true,
        stage: 'He names it without looking up.',
        opts: [
          { say: ['too-expensive'], en: 'Too expensive.', next: 'counter' },
          { say: ['reduce'], end: 'q', en: 'Can you take a little off?', next: 'counter' },
          { say: ['n8', 'n100', 'mai-q'], end: 'q', en: 'Eight hundred?', ok: false, fb: 'Eighty. Bpàet sìp. No mango costs eight hundred.' },
          { say: ['not-spicy'], en: 'Not spicy.', ok: false, fb: 'It is a mango. He laughs anyway.' },
        ],
      },
      {
        id: 'counter', step: 1, say: ['n7', 'n10', 'baht'], en: 'Seventy baht.', heard: true,
        stage: 'He sighs like it costs him.',
        opts: [
          { say: ['n6', 'n10', 'dai', 'mai-q'], end: 'q', en: 'Sixty, can you?', next: 'deal' },
          { say: ['ao'], en: "I'll take it.", baht: -70, next: null },
          { say: ['n8', 'n10', 'dai', 'mai-q'], end: 'q', en: 'Eighty, can you?', ok: false, fb: 'He offered seventy. You just bid up.' },
          { say: ['mai-not', 'ao'], en: "I don't want it.", ok: false, rep: -1, fb: 'He shrugs and turns to the next customer. You came for a mango.' },
        ],
      },
      {
        id: 'deal', step: 2, say: ['dai'], en: 'Fine.',
        stage: 'He bags the mango with great reluctance.',
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 60 baht.)', baht: -60, rep: 1 },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, rep: -1, fb: 'He already said yes. Pushing past a yes is bad form.' },
          { say: ['dont-understand'], en: "I don't understand.", ok: false, fb: 'Dâai: fine, can do. He holds out the bag.' },
        ],
      },
    ],
  },
  {
    id: 'market-shirt', title: 'Haggle a shirt under 300 baht', place: 'market', person: 'lek', day: 6,
    reward: { baht: 40, rep: 2 }, steps: ['Ask', 'Counter', 'Pay'],
    nodes: [
      {
        id: 'ask', step: 0, say: ['shirt', 'mai-new'], en: 'New shirts.',
        stage: 'A rail of shirts, still in their bags.',
        opts: [
          { say: ['how-much-this'], end: 'q', en: 'How much is this?', next: 'price' },
          { say: ['tiger', 'how-much'], end: 'q', en: 'How much is the tiger?', ok: false, fb: 'Sʉ̌a, rising, is a tiger. Sʉ̂a, falling, is the shirt.' },
          { say: ['hello'], en: 'Hello.', ok: false, fb: 'Polite, but he is waiting for a question.' },
        ],
      },
      {
        id: 'price', step: 1, say: ['n3', 'n100', 'n5', 'n10', 'baht'], en: 'Three hundred and fifty baht.', heard: true,
        opts: [
          { say: ['too-expensive'], en: 'Too expensive.', next: 'counter' },
          { say: ['n2', 'n100', 'dai', 'mai-q'], end: 'q', en: 'Two hundred, can you?', next: 'counter' },
          { say: ['ao'], en: "I'll take it.", ok: false, fb: 'Three fifty is over your limit of three hundred.' },
          { say: ['n5', 'n10', 'mai-q'], end: 'q', en: 'Fifty?', ok: false, fb: 'Three hundred and fifty. You heard the end of it.' },
        ],
      },
      {
        id: 'counter', step: 1, say: ['n2', 'n100', 'n8', 'n10', 'baht'], en: 'Two hundred and eighty baht.', heard: true,
        stage: 'He folds his arms. This is the real price.',
        opts: [
          { say: ['ao'], en: "I'll take it.", baht: -280, next: null },
          { say: ['n2', 'n100', 'n5', 'n10', 'dai', 'mai-q'], end: 'q', en: 'Two fifty, can you?', next: 'deal' },
          { say: ['n3', 'n100', 'dai', 'mai-q'], end: 'q', en: 'Three hundred, can you?', ok: false, fb: 'He said two eighty. You offered more.' },
          { say: ['mai-not', 'ao'], en: "I don't want it.", ok: false, fb: 'Under three hundred was the brief. Two eighty is under.' },
        ],
      },
      {
        id: 'deal', step: 2, say: ['dai'], en: 'Fine.', stage: 'He shakes his head, smiling, and bags it.',
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 250 baht.)', baht: -250, rep: 1 },
          { say: ['reduce'], end: 'q', en: 'A little more off?', ok: false, rep: -1, fb: 'He said yes. Pushing past a yes is bad form.' },
        ],
      },
    ],
  },
  {
    id: 'food-fried-rice', title: 'Order not-spicy fried rice', place: 'food', person: 'nok', day: 9,
    reward: { baht: 40, rep: 2 }, steps: ['Order', 'Spice', 'Pay'],
    nodes: [
      {
        id: 'order', step: 0, say: ['fried-rice', 'mai-q'], end: 'q', en: 'Fried rice?',
        stage: 'She wipes the wok and waits.',
        opts: [
          { say: ['khaw', 'fried-rice', 'noi'], en: 'Fried rice, please.', next: 'spice' },
          { say: ['khaw', 'fried-rice', 'n1', 'cl-plate'], en: 'One plate of fried rice.', next: 'spice' },
          { say: ['khaw', 'pad-thai', 'noi'], en: 'Pad thai, please.', ok: false, fb: 'Pad thai. You wanted fried rice.' },
          { say: ['no'], en: "No, that's not right.", ok: false, fb: 'Fried rice is exactly right.' },
        ],
      },
      {
        id: 'spice', step: 1, say: ['spicy', 'mai-q'], end: 'q', en: 'Spicy?', heard: true,
        stage: 'Her hand is already near the chillies.',
        opts: [
          { say: ['not-spicy'], en: 'Not spicy.', next: 'pay' },
          { say: ['very-spicy'], en: 'Very spicy.', ok: false, fb: 'In go the chillies. You asked for not spicy.' },
          { say: ['little-spicy'], en: 'A little spicy.', ok: false, fb: 'Close, but the brief was not spicy at all.' },
          { say: ['dont-understand'], en: "I don't understand.", ok: false, fb: 'Phèt: spicy. She mimes fanning her mouth.' },
        ],
      },
      {
        id: 'pay', step: 2, say: ['n6', 'n10', 'baht'], en: 'Sixty baht.', heard: true,
        stage: 'She bags it and holds it out.',
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 60 baht.)', baht: -60 },
          { say: ['n4', 'n10', 'yes', 'mai-q'], end: 'q', en: 'Forty, right?', ok: false, fb: 'Sixty. Hòk sìp.' },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, rep: -1, fb: 'Street food is not for haggling.' },
        ],
      },
    ],
  },
  {
    id: 'bar-beer', title: 'Order two bottles of beer', place: 'bar', person: 'bank', day: 10,
    reward: { baht: 30, rep: 2 }, steps: ['Order', 'Ice', 'Pay'],
    nodes: [
      {
        id: 'order', step: 0, say: ['beer', 'mai-q'], end: 'q', en: 'Beer?',
        stage: 'Bank is minding the bar for a friend, badly and cheerfully.',
        opts: [
          { say: ['khaw', 'beer', 'n2', 'cl-bottle'], en: 'Two bottles of beer.', next: 'ice' },
          { say: ['khaw', 'beer', 'n2', 'cl-plate'], en: 'Two plates of beer.', ok: false, fb: 'Two plates of beer. He laughs. Bottles are khùat.' },
          { say: ['khaw', 'beer', 'n2', 'cl-glass'], en: 'Two glasses of beer.', ok: false, fb: 'He reaches for glasses. You wanted bottles.' },
          { say: ['khaw', 'water', 'n2', 'cl-bottle'], en: 'Two bottles of water.', ok: false, fb: 'Water. Not tonight.' },
        ],
      },
      {
        id: 'ice', step: 1, say: ['ice', 'mai-q'], end: 'q', en: 'Ice?',
        stage: 'Beer with ice is normal here. Either answer is fine.',
        opts: [
          { say: ['ao'], en: 'Yes, please.', next: 'pay' },
          { say: ['mai-not', 'ao'], en: 'No thanks.', next: 'pay' },
          { say: ['khaw', 'ice', 'noi'], en: 'Some ice, please.', next: 'pay' },
        ],
      },
      {
        id: 'pay', step: 2, say: ['n1', 'n100', 'n4', 'n10', 'baht'], en: 'A hundred and forty baht.', heard: true,
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 140 baht.)', baht: -140 },
          { say: ['n4', 'n100', 'yes', 'mai-q'], end: 'q', en: 'Four hundred, right?', ok: false, fb: 'A hundred and forty. Nʉ̀ng rói sìi sìp.' },
          { say: ['reduce'], end: 'q', en: 'Can you take a little off?', ok: false, fb: 'Bar prices are on the board. He points at it.' },
        ],
      },
    ],
  },
  {
    id: 'taxi-stop-here', title: 'Get the taxi to stop at your soi', place: 'taxi', person: 'ton', day: 11,
    reward: { baht: 30, rep: 2 }, steps: ['Straight', 'Turn', 'Stop', 'Pay'],
    note: 'Your hotel: straight on, then left, then stop.',
    nodes: [
      {
        id: 'straight', step: 0, say: ['straight', 'mai-q'], end: 'q', en: 'Straight on?', heard: true,
        stage: 'He glances at you in the mirror.',
        opts: [
          { say: ['yes', '_', 'straight'], en: 'Yes, straight on.', next: 'turn' },
          { say: ['no'], en: "No, that's not right.", ok: false, fb: 'Straight on was right.' },
          { say: ['stop-here'], en: 'Stop here.', ok: false, fb: 'You have only just got in.' },
          { say: ['turn-right'], en: 'Turn right.', ok: false, fb: 'Your hotel is straight on first.' },
        ],
      },
      {
        id: 'turn', step: 1, say: ['turn-right', 'mai-q'], end: 'q', en: 'Turn right?', heard: true,
        stage: 'The lights. The corner where your soi starts.',
        opts: [
          { say: ['no', '_', 'turn-left'], en: 'No, turn left.', next: 'stop' },
          { say: ['yes'], en: 'Yes.', ok: false, baht: -20, fb: 'He turns right. The meter ticks on while he loops back.' },
          { say: ['straight'], en: 'Straight on.', ok: false, fb: 'Your soi is to the left.' },
          { say: ['far'], en: 'Far.', ok: false, fb: 'Glai, mid tone: far. Not an answer to his question.' },
        ],
      },
      {
        id: 'stop', step: 2, say: ['near', 'mai-q'], end: 'q', en: 'Near here?', heard: true,
        stage: 'Your hotel sign, blue, coming up on the left.',
        opts: [
          { say: ['stop-here'], en: 'Stop here.', next: 'pay' },
          { say: ['far'], en: 'Far.', ok: false, fb: 'You sail past the hotel.' },
          { say: ['straight'], en: 'Straight on.', ok: false, fb: 'The sign goes by. He looks at you in the mirror.' },
        ],
      },
      {
        id: 'pay', step: 3, say: ['n7', 'n10', 'baht'], en: 'Seventy baht.', heard: true,
        stage: 'The meter reads 70.',
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 70 baht.)', baht: -70 },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, rep: -1, fb: 'It is the meter. He taps it.' },
          { say: ['n7', 'n100', 'yes', 'mai-q'], end: 'q', en: 'Seven hundred, right?', ok: false, fb: 'Seventy. Jèt sìp.' },
        ],
      },
    ],
  },
  {
    id: 'hotel-toilet', title: 'Ask where the toilet is', place: 'hotel', person: 'ploy', day: 12,
    reward: { baht: 20, rep: 2 }, steps: ['Ask', 'Check', 'Thank'],
    nodes: [
      {
        id: 'ask', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'The lobby is cold enough to keep meat in.',
        opts: [
          { say: ['toilet', 'where-is'], end: 'q', en: 'Where is the toilet?', next: 'way' },
          { say: ['rice', 'where-is'], end: 'q', en: 'Where is the rice?', ok: false, fb: 'Rice. She points vaguely at the street.' },
          { say: ['khaw', 'water', 'noi'], en: 'Water, please.', ok: false, fb: 'She hands you a bottle. Not what you needed.' },
          { say: ['toilet', 'expensive'], en: 'The toilet is expensive.', ok: false, fb: 'It is free. She looks worried for you.' },
        ],
      },
      {
        id: 'way', step: 1, say: ['turn-left'], en: 'Turn left.', heard: true,
        stage: 'She points, but the lobby has four corridors.',
        opts: [
          { say: ['turn-left', 'yes', 'mai-q'], end: 'q', en: 'Turn left, right?', next: 'thank' },
          { say: ['turn-right', 'yes', 'mai-q'], end: 'q', en: 'Turn right, right?', ok: false, fb: 'Left. Sáai. She points again, patiently.' },
          { say: ['straight', 'yes', 'mai-q'], end: 'q', en: 'Straight on, right?', ok: false, fb: 'She said turn. Líao.' },
        ],
      },
      {
        id: 'thank', step: 2, say: ['yes'], end: 's', en: 'Yes.',
        opts: [
          { say: ['thank-you'], en: 'Thank you.' },
          { say: ['sorry'], en: 'Sorry.', ok: false, fb: 'Nothing to apologise for.' },
          { say: ['hello'], en: 'Hello.', ok: false, fb: 'Wrong end of the conversation.' },
        ],
      },
    ],
  },
  {
    id: 'food-papaya', title: 'Papaya salad, a little spicy', place: 'food', person: 'nok', day: 17,
    reward: { baht: 40, rep: 3 }, steps: ['Order', 'Spice', 'Verdict'],
    nodes: [
      {
        id: 'order', step: 0, say: ['hello'], en: 'Hello.', stage: 'The mortar is going. It is always going.',
        opts: [
          { say: ['khaw', 'papaya-salad', 'noi'], en: 'Papaya salad, please.', next: 'spice' },
          { say: ['khaw', 'tom-yum', 'noi'], en: 'Tom yum, please.', ok: false, fb: 'Soup. You wanted the salad.' },
          { say: ['khaw', 'orange', 'noi'], en: 'An orange, please.', ok: false, fb: 'Sôm alone is an orange. Sôm-dtam is the salad.' },
        ],
      },
      {
        id: 'spice', step: 1, say: ['spicy', 'mai-q'], end: 'q', en: 'Spicy?', heard: true,
        stage: 'She holds up one chilli. Then three.',
        opts: [
          { say: ['little-spicy'], en: 'A little spicy.', next: 'taste', baht: -60 },
          { say: ['very-spicy'], en: 'Very spicy.', ok: false, fb: 'Brave. Not the brief.' },
          { say: ['not-spicy'], en: 'Not spicy.', ok: false, fb: 'The brief was a little. She puts one back.' },
        ],
      },
      {
        id: 'taste', step: 2, say: ['delicious', 'mai-q'], end: 'q', en: 'Good?', heard: true,
        stage: 'She watches you take the first bite. So does the next table.',
        opts: [
          { say: ['delicious'], en: 'Delicious.', rep: 1 },
          { say: ['mai-not', 'delicious'], en: 'Not good.', ok: false, rep: -1, fb: 'Honest. Also untrue. She takes it personally.' },
          { say: ['very-spicy'], en: 'Very spicy.', fb: 'She laughs. A little, she says, is a little.' },
        ],
      },
    ],
  },
  {
    id: 'pharmacy-headache', title: 'Buy something for a headache', place: 'pharmacy', person: 'mai', day: 19,
    reward: { baht: 40, rep: 2 }, steps: ['Describe', 'Confirm', 'Dose', 'Pay'],
    nodes: [
      {
        id: 'describe', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'She looks up from the counter. A fan turns behind her.',
        opts: [
          { say: ['headache'], en: 'I have a headache.', next: 'confirm' },
          { say: ['khaw', 'medicine', 'noi'], en: 'Some medicine, please.', next: 'confirm', fb: 'Vague, but she can work with it.' },
          { say: ['khaw', 'ice', 'noi'], en: 'Some ice, please.', ok: false, fb: 'Ice. Wrong shop.' },
          { say: ['very-spicy'], en: 'Very spicy.', ok: false, fb: 'She frowns. Is it the food?' },
        ],
      },
      {
        id: 'confirm', step: 1, say: ['headache', 'yes', 'mai-q'], end: 'q', en: 'A headache, yes?', heard: true,
        opts: [
          { say: ['yes'], en: 'Yes.', next: 'dose' },
          { say: ['no'], en: "No, that's not right.", ok: false, fb: 'You do have a headache. Getting worse.' },
          { say: ['dont-understand'], en: "I don't understand.", ok: false, fb: 'Bpùat hǔa. She taps her temple.' },
        ],
      },
      {
        id: 'dose', step: 2, say: ['gin', 'n2', 'cl-thing'], en: 'Take two.', heard: true,
        stage: 'She shakes a strip of tablets.',
        opts: [
          { say: ['n2', 'cl-thing', 'yes', 'mai-q'], end: 'q', en: 'Two, right?', next: 'pay' },
          { say: ['n3', 'cl-thing', 'yes', 'mai-q'], end: 'q', en: 'Three, right?', ok: false, fb: 'Two. Sǎwng. She holds up two fingers.' },
          { say: ['n10', 'cl-thing', 'yes', 'mai-q'], end: 'q', en: 'Ten, right?', ok: false, fb: 'She looks genuinely alarmed. Two.' },
        ],
      },
      {
        id: 'pay', step: 3, say: ['n5', 'n10', 'baht'], en: 'Fifty baht.', heard: true,
        opts: [
          { say: ['thank-you'], en: 'Thank you. (Hand over 50 baht.)', baht: -50 },
          { say: ['reduce'], end: 'q', en: 'Can you take a little off?', ok: false, fb: 'The price is printed. It is a pharmacy.' },
          { say: ['n5', 'n100', 'yes', 'mai-q'], end: 'q', en: 'Five hundred, right?', ok: false, fb: 'Fifty. Hâa sìp.' },
        ],
      },
    ],
  },
];

// ---------- chapters ----------

const METERS: TaskSpec[] = [
  {
    id: 'meters-running-1', title: "Meter's Running, part 1", place: 'taxi', person: 'ton', day: 11,
    reward: { baht: 0, rep: 2 }, steps: ['Greet'], chapter: 'meters-running',
    nodes: [
      {
        id: 'greet', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'Ton turns the meter on before you have shut the door.',
        opts: [
          { say: ['hello'], en: 'Hello.', rep: 1 },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, fb: 'The meter says 35. He shows you.' },
          { say: ['stop-here'], en: 'Stop here.', ok: false, fb: 'You have not moved yet.' },
        ],
      },
    ],
  },
  {
    id: 'meters-running-2', title: "Meter's Running, part 2", place: 'taxi', person: 'ton', day: 14,
    reward: { baht: 0, rep: 2 }, steps: ['Fare', 'Meter'], chapter: 'meters-running',
    note: 'Placeholder. The line you want is "use the meter, please". It is not in the seed set, so here you refuse the flat fare with what you have. Phase 4 adds the real line.',
    nodes: [
      {
        id: 'fare', step: 0, say: ['n3', 'n100', 'baht'], en: 'Three hundred baht.', heard: true,
        stage: 'A different car. He does not touch the meter.',
        opts: [
          { say: ['too-expensive'], en: 'Too expensive.', next: 'meter' },
          { say: ['mai-not', 'ao'], en: "I don't want it.", next: 'meter', fb: 'You reach for the door. He reconsiders.' },
          { say: ['n3', 'n10', 'yes', 'mai-q'], end: 'q', en: 'Thirty, right?', ok: false, fb: 'Three hundred. Sǎam rói. Read the hundred.' },
          { say: ['dai'], en: 'Fine.', ok: false, baht: -300, next: null, fb: 'You agreed to a flat three hundred. The meter would have said about ninety.' },
        ],
      },
      {
        id: 'meter', step: 1, say: ['dai'], en: 'Fine.',
        stage: 'He sighs and presses the meter. It reads 35.',
        opts: [
          { say: ['thank-you'], en: 'Thank you.', rep: 1 },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, fb: 'It is the meter now. Let it run.' },
        ],
      },
    ],
  },
];

export interface MeterLeg {
  /** item id of the direction he says */
  dir: 'turn-left' | 'turn-right' | 'straight' | 'stop-here';
}
export interface MeterPart {
  part: 1 | 2;
  day: number;
  title: string;
  intro: string;
  task: string;
  /** seconds from the instruction to the junction */
  window: number;
  legs: MeterLeg[];
}

/** Items the drive is built from: what the driver says, and the lines you stop him with. */
export const METER_ITEMS = ['turn-left', 'turn-right', 'straight', 'stop-here'] as const;

export const METERS_PARTS: MeterPart[] = [
  {
    part: 1, day: 11, title: 'Part 1 · Honest meter', task: 'meters-running-1', window: 5,
    intro: 'Ton tells you the way in Thai. Steer before each junction. Wrong turns cost a life and put baht on the meter.',
    legs: [{ dir: 'straight' }, { dir: 'turn-left' }, { dir: 'straight' }, { dir: 'turn-right' }, { dir: 'turn-left' }, { dir: 'stop-here' }],
  },
  {
    part: 2, day: 14, title: 'Part 2 · No meter', task: 'meters-running-2', window: 3.8,
    intro: 'This driver quotes a flat fare. Get the meter on first. Then faster junctions, and you call the stop.',
    legs: [{ dir: 'turn-right' }, { dir: 'straight' }, { dir: 'turn-left' }, { dir: 'turn-left' }, { dir: 'straight' }, { dir: 'turn-right' }, { dir: 'straight' }, { dir: 'stop-here' }],
  },
];

// After Hours: 18+. Non-explicit, clothed, consent-forward. Rapport is the
// option's rep; comfort is hers. Respecting a no raises rapport. Pushing past
// one drops comfort; at zero she leaves (Palm on the glass).
const AFTER: TaskSpec[] = [
  {
    id: 'after-hours-1', title: 'After Hours, part 1', place: 'bar', person: 'fah', day: 21, adult: true,
    reward: { baht: 0, rep: 3 }, steps: ['Small talk', 'Compliment', 'Ask to sit', 'Goodbye'], chapter: 'after-hours',
    note: 'Placeholder. Compliments and invitations arrive with the day 22 phrases; these lines use only the seed set.',
    nodes: [
      {
        id: 'hello', step: 0, say: ['hello'], en: 'Hello.',
        stage: 'Fah is at the end of the bar with a beer, reading the label like it owes her money.',
        opts: [
          { say: ['hello'], en: 'Hello.', rep: 1, next: 'beer' },
          { say: ['khaw', 'beer', 'noi'], en: 'A beer, please.', ok: false, comfort: -1, fb: 'She is not the bartender. She points at Bank.' },
          { say: ['you', 'expensive'], en: 'You are expensive.', ok: false, comfort: -3, fb: 'That lands badly. Very badly.' },
        ],
      },
      {
        id: 'beer', step: 0, say: ['beer', 'delicious', 'mai-q'], end: 'q', en: 'Is the beer any good?', heard: true,
        stage: 'She nods at your bottle.',
        opts: [
          { say: ['delicious'], en: 'It is good.', rep: 1, next: 'shirt' },
          { say: ['mai-not', 'delicious'], en: 'Not really.', rep: 2, next: 'shirt', fb: 'She laughs. Honesty is in short supply in here.' },
          { say: ['n2', 'cl-bottle'], en: 'Two bottles.', ok: false, comfort: -1, fb: 'She asked if it is good, not how many.' },
          { say: ['dont-understand'], en: "I don't understand.", fb: 'She says it again, slower, smiling.' , next: 'beer' },
        ],
      },
      {
        id: 'shirt', step: 1, say: ['beer', 'n2', 'cl-bottle'], en: 'Two bottles. (To Bank, for her and a friend.)',
        stage: 'She tugs at her sleeve. A new shirt, the tag still on. She has not noticed.',
        opts: [
          { say: ['shirt', 'mai-new', 'mai-q'], end: 'q', en: 'New shirt?', rep: 2, comfort: 1, next: 'sit', fb: 'She finds the tag and laughs at herself.' },
          { say: ['you', 'white'], en: 'You are white.', ok: false, comfort: -2, fb: 'Not a compliment anywhere.' },
          { say: ['never-mind'], en: 'Never mind.', next: 'sit', fb: 'Fine, if flat.' },
        ],
      },
      {
        id: 'sit', step: 2, say: ['yes'], end: 'q', en: 'Yes?',
        stage: 'You nod at the empty stool beside her. She glances at the door.',
        opts: [
          { say: ['dai', 'mai-q'], end: 'q', en: 'Is it okay?', next: 'no' },
          { say: ['near', 'near'], en: 'Close, close.', ok: false, comfort: -2, fb: 'You are already sitting down. She leans away.' },
          { say: ['thank-you'], en: 'Thank you.', ok: false, comfort: -1, fb: 'Thanking her for a yes she has not given.' },
        ],
      },
      {
        id: 'no', step: 2, say: ['sorry', '_', 'mai-not', 'dai'], en: "Sorry, I can't.", heard: true,
        expression: 'puzzled',
        stage: 'She is waiting for someone. She says it kindly.',
        opts: [
          { say: ['never-mind'], en: 'No problem.', rep: 3, comfort: 1, next: 'bye', fb: 'She relaxes. That was the right answer.' },
          { say: ['sorry'], en: 'Sorry.', rep: 2, next: 'bye', fb: 'A little stiff, but she appreciates it.' },
          { say: ['dai', 'mai-q'], end: 'q', en: 'Can I, though?', ok: false, comfort: -3, next: 'push', fb: 'She said no.' },
          { say: ['dont-understand'], en: "I don't understand.", ok: false, comfort: -1, fb: 'Mâi dâai: no. You understood.' },
        ],
      },
      {
        id: 'push', step: 2, say: ['mai-not', 'dai'], en: 'No.', expression: 'sad', heard: true,
        stage: 'Flatter now. She moves her bag to the stool.',
        opts: [
          { say: ['sorry'], en: 'Sorry.', rep: 1, next: 'bye', fb: 'She accepts it. Just.' },
          { say: ['never-mind'], en: 'No problem.', rep: 1, next: 'bye' },
          { say: ['dai', 'mai-q'], end: 'q', en: 'Can I, though?', ok: false, comfort: -4, fb: 'Twice is the limit. There was a limit.' },
        ],
      },
      {
        id: 'bye', step: 3, say: ['hello'], en: 'Bye.',
        stage: 'Her friend arrives. She lifts her bottle to you on the way past.',
        opts: [
          { say: ['hello'], en: 'Bye.', rep: 1 },
          { say: ['thank-you'], en: 'Thank you.', rep: 1 },
        ],
      },
    ],
  },
  {
    id: 'after-hours-2', title: 'After Hours, part 2', place: 'bar', person: 'bank', day: 22, adult: true,
    reward: { baht: 0, rep: 3 }, steps: ['Offer', 'Your no', 'Read the room', 'Goodbye'], chapter: 'after-hours',
    note: 'Placeholder. The polite refusals and invitations of day 22 to 23 replace these lines in Phase 4.',
    nodes: [
      {
        id: 'offer', step: 0, say: ['beer', 'mai-q'], end: 'q', en: 'Another beer?', heard: true,
        stage: 'Bank slides onto the next stool. Easy laugh, two bottles already open.',
        opts: [
          { say: ['mai-not', 'ao', '_', 'thank-you'], en: 'No thanks.', rep: 2, next: 'again' },
          { say: ['khaw', 'water', 'noi'], en: 'A water, please.', rep: 2, next: 'again', fb: 'Sensible. He respects it.' },
          { say: ['ao'], en: 'Yes.', rep: 1, next: 'again' },
          { say: ['coffee'], en: 'Coffee.', ok: false, fb: 'At this hour. He laughs.' , next: 'offer' },
        ],
      },
      {
        id: 'again', step: 1, say: ['bpai', 'mai-q'], end: 'q', en: 'Coming along? We are moving on.', heard: true,
        stage: 'His friends are heading for the door. You are tired.',
        opts: [
          { say: ['mai-not', 'bpai', '_', 'thank-you'], en: 'Not going, thanks.', rep: 2, next: 'ok', fb: 'Your no, said plainly. That is all it takes.' },
          { say: ['sorry', '_', 'mai-not', 'bpai'], en: 'Sorry, not going.', rep: 2, next: 'ok' },
          { say: ['bpai'], en: 'Going.', ok: false, comfort: -1, next: 'ok', fb: 'You wanted to go home. Say so.' },
        ],
      },
      {
        id: 'ok', step: 1, say: ['never-mind'], en: 'No problem.',
        stage: 'He takes it without a flicker. Fah, back at the bar, looks over. Her phone is face down.',
        opts: [
          { say: ['hello'], en: 'Hello. (To Fah.)', rep: 1, next: 'fah' },
          { say: ['thank-you'], en: 'Thank you. (To Bank.)', rep: 1, next: 'fah' },
        ],
      },
      {
        id: 'fah', step: 2, say: ['hello'], en: 'Hello again.',
        stage: 'Fah turns her stool toward you. Then her phone lights up and she glances at it twice.',
        opts: [
          { say: ['never-mind', '_', 'hello'], en: 'No problem, bye.', rep: 3, next: 'bye', fb: 'You read it. She mouths thank you.' },
          { say: ['sorry'], en: 'Sorry.', rep: 2, next: 'bye', fb: 'You step back. She smiles, distracted.' },
          { say: ['you', 'beer', 'mai-q'], end: 'q', en: 'Beer, you?', ok: false, comfort: -2, next: 'fah2', fb: 'She is looking at her phone. You missed it.' },
        ],
      },
      {
        id: 'fah2', step: 2, say: ['sorry', '_', 'mai-not', 'dai'], en: 'Sorry, I can\'t.', heard: true, expression: 'sad',
        opts: [
          { say: ['never-mind'], en: 'No problem.', rep: 2, next: 'bye' },
          { say: ['dai', 'mai-q'], end: 'q', en: 'Can you, though?', ok: false, comfort: -4, fb: 'She said no.' },
        ],
      },
      {
        id: 'bye', step: 3, say: ['hello'], en: 'Bye.',
        stage: 'The bar thins out. Someone puts on a slower song.',
        opts: [
          { say: ['hello'], en: 'Bye.', rep: 1 },
          { say: ['thank-you'], en: 'Thank you.', rep: 1 },
        ],
      },
    ],
  },
];

export interface AfterPart {
  task: string;
  title: string;
  day: number;
}

/** After Hours parts in order. The script of each comes from the course when one is loaded. */
export const AFTER_PARTS: AfterPart[] = AFTER.map((s) => ({ task: s.id, title: s.title, day: s.day }));

// Door to Door: one continuous chain. Short scenes, one or two steps each.
const DOOR: TaskSpec[] = [
  {
    id: 'd2d-hotel', title: 'Hotel check-in', place: 'hotel', person: 'ploy', day: 25, chapter: 'door-to-door',
    reward: { baht: 0, rep: 1 }, steps: ['Greet', 'Key'],
    nodes: [
      {
        id: 'greet', step: 0, say: ['hello'], en: 'Hello.', stage: 'Midnight check-in. Ploy has seen worse.',
        opts: [
          { say: ['hello'], en: 'Hello.', next: 'key' },
          { say: ['sorry'], en: 'Sorry.', ok: false, fb: 'Hello first.' },
          { say: ['toilet', 'where-is'], end: 'q', en: 'Where is the toilet?', ok: false, fb: 'Urgent, but check in first.' },
        ],
      },
      {
        id: 'key', step: 1, say: [], end: 's', en: 'Here you are.', stage: 'The key card.',
        opts: [
          { say: ['thank-you'], en: 'Thank you.' },
          { say: ['too-expensive'], en: 'Too expensive.', ok: false, fb: 'The key is free.' },
          { say: ['hello'], en: 'Hello.', ok: false, fb: 'Again?' },
        ],
      },
    ],
  },
  {
    id: 'd2d-taxi', title: 'Taxi', place: 'taxi', person: 'ton', day: 25, chapter: 'door-to-door',
    reward: { baht: 0, rep: 1 }, steps: ['Turn', 'Stop'],
    nodes: [
      {
        id: 'turn', step: 0, say: ['turn-left', 'mai-q'], end: 'q', en: 'Turn left?', heard: true, stage: 'The corner. Your map says right.',
        opts: [
          { say: ['no', '_', 'turn-right'], en: 'No, turn right.', next: 'stop' },
          { say: ['yes'], en: 'Yes.', ok: false, fb: 'Your map says right.' },
          { say: ['straight'], en: 'Straight on.', ok: false, fb: 'Right, not straight.' },
        ],
      },
      {
        id: 'stop', step: 1, say: ['near', 'mai-q'], end: 'q', en: 'Near here?', heard: true, stage: 'The market lights.',
        opts: [
          { say: ['stop-here'], en: 'Stop here.', baht: -80 },
          { say: ['far'], en: 'Far.', ok: false, fb: 'You are there.' },
          { say: ['turn-left'], en: 'Turn left.', ok: false, fb: 'You are there. Stop.' },
        ],
      },
    ],
  },
  {
    id: 'd2d-food', title: 'Street food', place: 'food', person: 'nok', day: 25, chapter: 'door-to-door',
    reward: { baht: 0, rep: 1 }, steps: ['Order', 'Spice'],
    nodes: [
      {
        id: 'order', step: 0, say: ['hello'], en: 'Hello.', stage: 'Dinner. You want pad thai.',
        opts: [
          { say: ['khaw', 'pad-thai', 'noi'], en: 'Pad thai, please.', next: 'spice' },
          { say: ['khaw', 'fried-rice', 'noi'], en: 'Fried rice, please.', ok: false, fb: 'Pad thai was the plan.' },
          { say: ['khaw', 'pork', 'noi'], en: 'Pork, please.', ok: false, fb: 'Just pork. She waits for the dish.' },
        ],
      },
      {
        id: 'spice', step: 1, say: ['spicy', 'mai-q'], end: 'q', en: 'Spicy?', heard: true,
        opts: [
          { say: ['not-spicy'], en: 'Not spicy.', baht: -60 },
          { say: ['little-spicy'], en: 'A little spicy.', baht: -60 },
          { say: ['dog'], en: 'Dog.', ok: false, fb: 'Mǎa, rising: dog. She does not ask again.' },
        ],
      },
    ],
  },
  {
    id: 'd2d-market', title: 'Market', place: 'market', person: 'lek', day: 25, chapter: 'door-to-door',
    reward: { baht: 0, rep: 1 }, steps: ['Price', 'Counter'],
    nodes: [
      {
        id: 'price', step: 0, say: ['n1', 'n100', 'baht'], en: 'A hundred baht.', heard: true, stage: 'A coconut. He names a tourist price.',
        opts: [
          { say: ['too-expensive'], en: 'Too expensive.', next: 'counter' },
          { say: ['reduce'], end: 'q', en: 'A little off?', next: 'counter' },
          { say: ['n1', 'n10', 'yes', 'mai-q'], end: 'q', en: 'Ten, right?', ok: false, fb: 'A hundred. Rói.' },
        ],
      },
      {
        id: 'counter', step: 1, say: ['n6', 'n10', 'baht'], en: 'Sixty baht.', heard: true,
        opts: [
          { say: ['ao'], en: "I'll take it.", baht: -60 },
          { say: ['n9', 'n10', 'dai', 'mai-q'], end: 'q', en: 'Ninety, can you?', ok: false, fb: 'He said sixty. You bid up.' },
          { say: ['mai-not', 'ao'], en: "I don't want it.", ok: false, fb: 'Sixty is fair. Take it.' },
        ],
      },
    ],
  },
  {
    id: 'd2d-pharmacy', title: 'Pharmacy', place: 'pharmacy', person: 'mai', day: 25, chapter: 'door-to-door',
    reward: { baht: 0, rep: 1 }, steps: ['Describe', 'Dose'],
    nodes: [
      {
        id: 'describe', step: 0, say: ['hello'], en: 'Hello.', stage: 'Too much sun. Your head is pounding.',
        opts: [
          { say: ['headache'], en: 'I have a headache.', next: 'dose' },
          { say: ['khaw', 'beer', 'noi'], en: 'A beer, please.', ok: false, fb: 'Wrong shop, and wrong idea.' },
          { say: ['spicy'], en: 'Spicy.', ok: false, fb: 'She waits for the real problem.' },
        ],
      },
      {
        id: 'dose', step: 1, say: ['gin', 'n1', 'cl-thing'], en: 'Take one.', heard: true,
        opts: [
          { say: ['n1', 'cl-thing', 'yes', 'mai-q'], end: 'q', en: 'One, right?', baht: -40 },
          { say: ['n2', 'cl-thing', 'yes', 'mai-q'], end: 'q', en: 'Two, right?', ok: false, fb: 'One. Nʉ̀ng.' },
          { say: ['n9', 'cl-thing', 'yes', 'mai-q'], end: 'q', en: 'Nine, right?', ok: false, fb: 'One.' },
        ],
      },
    ],
  },
  {
    id: 'd2d-bar', title: 'Night out', place: 'bar', person: 'bank', day: 25, chapter: 'door-to-door',
    reward: { baht: 0, rep: 1 }, steps: ['Round'],
    nodes: [
      {
        id: 'round', step: 0, say: ['beer', 'mai-q'], end: 'q', en: 'Beer?', heard: true, stage: 'Last stop. Three of you.',
        opts: [
          { say: ['khaw', 'beer', 'n3', 'cl-bottle'], en: 'Three bottles of beer.', baht: -210 },
          { say: ['khaw', 'beer', 'n3', 'cl-plate'], en: 'Three plates of beer.', ok: false, fb: 'Plates. Bottles are khùat.' },
          { say: ['khaw', 'beer', 'n2', 'cl-bottle'], en: 'Two bottles of beer.', ok: false, fb: 'There are three of you.' },
        ],
      },
    ],
  },
];

export interface DoorStop {
  task: string;
  label: string;
  /** a checkpoint restores a life when cleared */
  checkpoint?: boolean;
  optional?: boolean;
}

export const DOOR_TO_DOOR: DoorStop[] = [
  { task: 'd2d-hotel', label: 'Hotel check-in', checkpoint: true },
  { task: 'd2d-taxi', label: 'Taxi' },
  { task: 'd2d-food', label: 'Street food' },
  { task: 'd2d-market', label: 'Market', checkpoint: true },
  { task: 'd2d-pharmacy', label: 'Pharmacy' },
  { task: 'd2d-bar', label: 'Night out', optional: true },
];

// ---------- small talk ----------

function smallTalkSpec(place: PlaceId, person: string): TaskSpec {
  return {
    id: `smalltalk-${place}`, title: 'Small talk', place, person, day: 1,
    reward: { baht: 0, rep: 0 }, steps: ['Greet'],
    nodes: [
      {
        id: 'greet', step: 0, say: ['hello'], en: 'Hello.', stage: 'Nothing to do here tonight. A hello costs nothing.',
        opts: [
          { say: ['hello'], en: 'Hello.' },
          { say: ['thank-you'], en: 'Thank you.' },
          { say: ['sorry'], en: 'Sorry.', ok: false, fb: 'For what? A hello will do.' },
        ],
      },
    ],
  };
}

const SMALL_PEOPLE: Record<PlaceId, string> = { hotel: 'ploy', food: 'nok', pharmacy: 'mai', bar: 'fah', market: 'lek', taxi: 'ton' };

// ---------- builds ----------

const ALL_SPECS = [...STREET, ...METERS, ...AFTER, ...DOOR];
const cache = new Map<Identity, StreetTaskBuilt[]>();

// ---------- the generated course (Phase 4) ----------

/** A course option carries both speakers' forms; the top-level thai/roman are the male build. */
interface CourseOption extends StreetOption {
  forms?: Record<Identity, { thai: string; roman: string; tones: Tone[] }>;
  end?: 's' | 'q' | null;
}

let courseTasks: StreetTask[] | null = null;
/** the loaded course's items by id: small talk is composed from these, never from the seed set */
let courseItems: Map<string, Item> | null = null;

/**
 * Use the generated course's scripts instead of the seed ones. Called once at
 * boot. Passing the course's `items` says a course is loaded: from then on
 * only its own tasks are offered, however few it has. Without `items`, an
 * empty list goes back to the seed scripts.
 */
export function setCourseTasks(tasks: StreetTask[], items?: Item[] | null) {
  courseTasks = items || tasks.length ? tasks : null;
  courseItems = items ? new Map(items.map((i) => [i.id, i])) : null;
  cache.clear();
  STREET_TASKS.splice(0, STREET_TASKS.length, ...tasksFor('m'));
  STREET_TASK_IDS.splice(0, STREET_TASK_IDS.length, ...STREET_TASKS.filter((t) => !t.chapter).map((t) => t.id));
}

function endingFor(identity: Identity, end: CourseOption['end']): string {
  return identity === 'm' ? 'khrap' : end === 'q' ? 'kha-question' : 'kha-statement';
}

/** A course task in one speaker's forms. */
function fromCourse(t: StreetTask, identity: Identity): StreetTaskBuilt {
  const nodes: Record<string, StreetNode> = {};
  for (const [id, n0] of Object.entries(t.nodes)) {
    const n = n0 as StreetNode;
    nodes[id] = {
      ...n,
      step: n.step ?? 0,
      items: n.items ?? [],
      tones: n.tones ?? [],
      options: (n.options as CourseOption[]).map((o) => {
        const f = o.forms?.[identity];
        if (!f) return o;
        // swap the male ending item for the learner's own
        const items = o.items.map((i) => (ENDING_IDS.includes(i) ? endingFor(identity, o.end) : i));
        return { ...o, thai: f.thai, roman: f.roman, tones: f.tones, items };
      }),
    };
  }
  return { ...t, nodes };
}

/** Every scripted task, with learner lines in the speaker's own forms. */
export function tasksFor(identity: Identity): StreetTaskBuilt[] {
  let t = cache.get(identity);
  if (!t) {
    t = courseTasks
      ? courseTasks.map((c) => fromCourse(c, identity))
      : ALL_SPECS.map((s) => ({ ...build(s, identity), note: s.note ?? PLACEHOLDER }));
    cache.set(identity, t);
  }
  return t;
}

/**
 * A task by id, including small talk ("smalltalk-food"). With a course loaded
 * an id the course lacks gives nothing (the part is not ready yet), and small
 * talk is composed from the course's own checked words, or not offered.
 */
export function taskById(id: string, identity: Identity): StreetTaskBuilt | undefined {
  const t = tasksFor(identity).find((x) => x.id === id);
  if (t) return t;
  const m = /^smalltalk-(\w+)$/.exec(id);
  if (!m || !(m[1] in SMALL_PEOPLE)) return undefined;
  const place = m[1] as PlaceId;
  const spec = smallTalkSpec(place, SMALL_PEOPLE[place]);
  if (!courseTasks) return { ...build(spec, identity), note: PLACEHOLDER };
  if (!courseItems) return undefined;
  try {
    return build(spec, identity, courseItems);
  } catch {
    // the course lacks one of the words
    return undefined;
  }
}

/** Every scripted task in the male build: ids, days, places. Kept up to date when a course loads. */
export const STREET_TASKS: StreetTask[] = tasksFor('m');
/** Street task ids (not chapters). Kept up to date when a course loads. */
export const STREET_TASK_IDS: string[] = STREET.map((s) => s.id);

/** Who a log source ("street:food-water", "live:bar-beer", "street:smalltalk-bar") was spoken to. */
export function personForSource(source: string): string | null {
  // scripted ("street:<task>") and live ("live:<task>") conversations both belong to the task's person
  const id = source.replace(/^(street|live):/, '');
  // the seed specs too: answers logged before a course loaded still belong to someone
  const t = STREET_TASKS.find((s) => s.id === id) ?? ALL_SPECS.find((s) => s.id === id);
  if (t) return t.person;
  const m = /^smalltalk-(\w+)$/.exec(id);
  if (m && m[1] in SMALL_PEOPLE) return SMALL_PEOPLE[m[1] as PlaceId];
  return null;
}

/** Signs on the street: each place's main sign, plus a smaller sign built from one item. */
export const STREET_SIGNS: Record<PlaceId, { item: string }> = {
  hotel: { item: 'toilet' },
  food: { item: 'fried-rice' },
  pharmacy: { item: 'medicine' },
  bar: { item: 'beer' },
  market: { item: 'mango' },
  taxi: { item: 'turn-left' },
};
