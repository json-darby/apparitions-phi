// Silent seed set for Phases 1 to 3: about 60 placeholder items, 10 letters and
// 5 sentence patterns. Status is 'placeholder' throughout. The checked 30-day
// content replaces this in Phase 4 and must pass the automatic text checks.

import {
  emptyMedia,
  type CastMember,
  type CultureNote,
  type Item,
  type Letter,
  type Pattern,
  type Place,
  type Skill,
  type Theme,
  type Tone,
} from './types';

const WORD_SKILLS: Skill[] = ['hear', 'say', 'read', 'tone'];
const PHRASE_SKILLS: Skill[] = ['hear', 'say', 'read'];

type ItemSpec = [
  id: string,
  thai: string,
  roman: string,
  tones: string,
  en: string,
  theme: Theme,
  day: number,
  extra?: Partial<Item>,
];

const T: Record<string, Tone> = { M: 'mid', L: 'low', F: 'falling', H: 'high', R: 'rising' };

function item([id, thai, roman, tones, en, theme, day, extra]: ItemSpec): Item {
  const toneList = tones.split('').map((c) => T[c]);
  const kind = roman.includes(' ') ? 'phrase' : 'word';
  return {
    id,
    kind,
    thai,
    roman,
    tones: toneList,
    en,
    theme,
    day,
    survival: false,
    skills: kind === 'word' ? WORD_SKILLS : PHRASE_SKILLS,
    tags: [],
    status: 'placeholder',
    media: emptyMedia(),
    ...extra,
  };
}

const S = { survival: true };

export const SEED_ITEMS: Item[] = ([
  // greetings and politeness
  ['hello', 'สวัสดี', 'sà-wàt-dii', 'LLM', 'hello', 'greetings', 1, { ...S, polite: 'statement', hook: 'Sa-what-dee: "so, what day is it?" said with a smile.' }],
  ['thank-you', 'ขอบคุณ', 'khàwp-khun', 'LM', 'thank you', 'greetings', 1, { ...S, polite: 'statement', hook: 'Cop a coon: you thank the cop who caught the raccoon.' }],
  ['khrap', 'ครับ', 'khráp', 'H', 'polite ending (male speaker)', 'greetings', 1, { speaker: 'm', ...S, skills: ['hear', 'say', 'tone'] }],
  ['kha-statement', 'ค่ะ', 'khâ', 'F', 'polite ending (female speaker, statements)', 'greetings', 1, { speaker: 'f', ...S, skills: ['hear', 'say', 'tone'] }],
  ['kha-question', 'คะ', 'khá', 'H', 'polite ending (female speaker, questions)', 'greetings', 1, { speaker: 'f', ...S, skills: ['hear', 'tone'] }],
  ['sorry', 'ขอโทษ', 'khǎw-thôot', 'RF', 'sorry, excuse me', 'greetings', 1, { ...S, polite: 'statement' }],
  ['never-mind', 'ไม่เป็นไร', 'mâi-bpen-rai', 'FMM', 'never mind, no problem', 'greetings', 2, { polite: 'statement' }],
  ['yes', 'ใช่', 'châi', 'F', 'yes, that is right', 'greetings', 2, S],
  ['no', 'ไม่ใช่', 'mâi châi', 'FF', 'no, that is not right', 'greetings', 2, S],
  ['i-male', 'ผม', 'phǒm', 'R', 'I (male speaker)', 'greetings', 1, { speaker: 'm' }],
  ['i-female', 'ฉัน', 'chǎn', 'R', 'I (female speaker)', 'greetings', 1, { speaker: 'f' }],
  ['you', 'คุณ', 'khun', 'M', 'you', 'greetings', 1],
  ['dont-understand', 'ไม่เข้าใจ', 'mâi khâo-jai', 'FFM', "I don't understand", 'people', 2, { ...S, polite: 'statement' }],
  // core verbs and grammar words
  ['khaw', 'ขอ', 'khǎw', 'R', 'may I have, ask for', 'verbs', 2, S],
  ['ao', 'เอา', 'ao', 'M', 'take, want (a thing)', 'verbs', 4],
  ['gin', 'กิน', 'gin', 'M', 'eat', 'verbs', 2],
  ['bpai', 'ไป', 'bpai', 'M', 'go', 'verbs', 6],
  ['mai-not', 'ไม่', 'mâi', 'F', 'not', 'linking', 2, { contrasts: ['mai-q', 'mai-new', 'mai-wood'] }],
  ['mai-q', 'ไหม', 'mǎi', 'R', 'yes-no question ending', 'questions', 6, { contrasts: ['mai-not', 'mai-new', 'mai-wood'] }],
  ['dai', 'ได้', 'dâai', 'F', 'can, be able to', 'questions', 6],
  ['noi', 'หน่อย', 'nòi', 'L', 'a little (softens a request)', 'linking', 6],
  // numbers and money
  ['n1', 'หนึ่ง', 'nʉ̀ng', 'L', 'one', 'numbers', 3, S],
  ['n2', 'สอง', 'sǎwng', 'R', 'two', 'numbers', 3, S],
  ['n3', 'สาม', 'sǎam', 'R', 'three', 'numbers', 3, S],
  ['n4', 'สี่', 'sìi', 'L', 'four', 'numbers', 3, S],
  ['n5', 'ห้า', 'hâa', 'F', 'five', 'numbers', 3, S],
  ['n6', 'หก', 'hòk', 'L', 'six', 'numbers', 3, S],
  ['n7', 'เจ็ด', 'jèt', 'L', 'seven', 'numbers', 3, S],
  ['n8', 'แปด', 'bpàet', 'L', 'eight', 'numbers', 3, S],
  ['n9', 'เก้า', 'gâo', 'F', 'nine', 'numbers', 3, S],
  ['n10', 'สิบ', 'sìp', 'L', 'ten', 'numbers', 3, S],
  ['n100', 'ร้อย', 'rói', 'H', 'hundred', 'numbers', 5],
  ['baht', 'บาท', 'bàat', 'L', 'baht', 'numbers', 3, S],
  ['how-much', 'เท่าไหร่', 'thâo-rài', 'FL', 'how much', 'questions', 5, { ...S, polite: 'question' }],
  ['how-much-this', 'อันนี้เท่าไหร่', 'an-níi thâo-rài', 'MHFL', 'how much is this?', 'shopping', 5, { ...S, polite: 'question' }],
  ['expensive', 'แพง', 'phaeng', 'M', 'expensive', 'shopping', 5],
  ['too-expensive', 'แพงไป', 'phaeng bpai', 'MM', 'too expensive', 'shopping', 5, { polite: 'statement' }],
  ['reduce', 'ลดหน่อยได้ไหม', 'lót nòi dâai mǎi', 'HLFR', 'can you reduce it a little?', 'shopping', 5, { polite: 'question' }],
  // food and drink
  ['rice', 'ข้าว', 'khâao', 'F', 'rice', 'food', 2, { contrasts: ['white'] }],
  ['fried-rice', 'ข้าวผัด', 'khâao-phàt', 'FL', 'fried rice', 'food', 2],
  ['pad-thai', 'ผัดไทย', 'phàt-thai', 'LM', 'pad thai', 'food', 2],
  ['papaya-salad', 'ส้มตำ', 'sôm-dtam', 'FM', 'papaya salad', 'food', 8],
  ['tom-yum', 'ต้มยำ', 'dtôm-yam', 'FM', 'tom yum soup', 'food', 8],
  ['chicken', 'ไก่', 'gài', 'L', 'chicken', 'food', 2],
  ['pork', 'หมู', 'mǔu', 'R', 'pork', 'food', 2],
  ['spicy', 'เผ็ด', 'phèt', 'L', 'spicy', 'food', 8, S],
  ['not-spicy', 'ไม่เผ็ด', 'mâi phèt', 'FL', 'not spicy', 'food', 8, S],
  ['little-spicy', 'เผ็ดนิดหน่อย', 'phèt nít-nòi', 'LHL', 'a little spicy', 'food', 9],
  ['very-spicy', 'เผ็ดมาก', 'phèt mâak', 'LF', 'very spicy', 'food', 9],
  ['delicious', 'อร่อย', 'à-ròi', 'LL', 'delicious', 'food', 17],
  ['water', 'น้ำ', 'náam', 'H', 'water', 'food', 4, S],
  ['ice', 'น้ำแข็ง', 'nám-khǎeng', 'HR', 'ice', 'food', 4],
  ['beer', 'เบียร์', 'bia', 'M', 'beer', 'food', 4],
  ['coffee', 'กาแฟ', 'gaa-fae', 'MM', 'coffee', 'food', 4],
  // fruit (Night Market)
  ['orange', 'ส้ม', 'sôm', 'F', 'orange', 'food', 5],
  ['banana', 'กล้วย', 'glûay', 'F', 'banana', 'food', 5],
  ['mango', 'มะม่วง', 'má-mûang', 'HF', 'mango', 'food', 5],
  ['watermelon', 'แตงโม', 'dtaeng-moo', 'MM', 'watermelon', 'food', 5],
  ['coconut', 'มะพร้าว', 'má-phráao', 'HH', 'coconut', 'food', 5],
  // classifiers
  ['cl-thing', 'อัน', 'an', 'M', 'classifier: thing', 'classifiers', 10],
  ['cl-plate', 'จาน', 'jaan', 'M', 'classifier: plate', 'classifiers', 10],
  ['cl-glass', 'แก้ว', 'gâew', 'F', 'classifier: glass', 'classifiers', 10],
  ['cl-bottle', 'ขวด', 'khùat', 'L', 'classifier: bottle', 'classifiers', 10],
  // directions
  ['turn-left', 'เลี้ยวซ้าย', 'líao sáai', 'HH', 'turn left', 'directions', 11, S],
  ['turn-right', 'เลี้ยวขวา', 'líao khwǎa', 'HR', 'turn right', 'directions', 11, S],
  ['straight', 'ตรงไป', 'dtrong bpai', 'MM', 'straight on', 'directions', 11, S],
  ['stop-here', 'จอดที่นี่', 'jàwt thîi-nîi', 'LFF', 'stop here', 'directions', 11, { ...S, polite: 'statement' }],
  ['where-is', 'อยู่ที่ไหน', 'yùu thîi-nǎi', 'LFR', 'where is it?', 'directions', 12, { ...S, polite: 'question' }],
  ['toilet', 'ห้องน้ำ', 'hâwng-náam', 'FH', 'toilet', 'signs', 1, S],
  // health
  ['headache', 'ปวดหัว', 'bpùat hǔa', 'LR', 'headache', 'health', 19, S],
  ['medicine', 'ยา', 'yaa', 'M', 'medicine', 'health', 19, S],
  // tone pairs
  ['near', 'ใกล้', 'glâi', 'F', 'near', 'tonepairs', 4, { contrasts: ['far'] }],
  ['far', 'ไกล', 'glai', 'M', 'far', 'tonepairs', 4, { contrasts: ['near'] }],
  ['horse', 'ม้า', 'máa', 'H', 'horse', 'tonepairs', 4, { contrasts: ['dog'] }],
  ['dog', 'หมา', 'mǎa', 'R', 'dog', 'tonepairs', 4, { contrasts: ['horse'] }],
  ['white', 'ขาว', 'khǎao', 'R', 'white', 'tonepairs', 4, { contrasts: ['rice'] }],
  ['tiger', 'เสือ', 'sʉ̌a', 'R', 'tiger', 'tonepairs', 4, { contrasts: ['shirt'] }],
  ['shirt', 'เสื้อ', 'sʉ̂a', 'F', 'shirt', 'tonepairs', 4, { contrasts: ['tiger'] }],
  ['mai-new', 'ใหม่', 'mài', 'L', 'new', 'tonepairs', 4, { contrasts: ['mai-not', 'mai-q', 'mai-wood'] }],
  ['mai-wood', 'ไม้', 'máai', 'H', 'wood', 'tonepairs', 4, { contrasts: ['mai-not', 'mai-q', 'mai-new'] }],
] as ItemSpec[]).map(item);

// Countable nouns and their classifiers
for (const [noun, cl] of [
  ['beer', 'cl-bottle'], ['water', 'cl-bottle'], ['coffee', 'cl-glass'], ['fried-rice', 'cl-plate'],
  ['pad-thai', 'cl-plate'], ['papaya-salad', 'cl-plate'], ['orange', 'cl-thing'], ['mango', 'cl-thing'],
] as const) {
  const it = SEED_ITEMS.find((i) => i.id === noun);
  if (it) it.classifier = cl;
}

function letter(
  id: string, char: string, name: string, keyword: string, initial: string, final: string | null,
  cls: Letter['cls'], day: number, lookalikes: string[],
): Letter {
  return {
    id, char, name, keyword, initial, final, cls, day, lookalikes,
    strokes: null,
    skills: ['read', 'write', 'hear'],
    status: 'placeholder',
    media: emptyMedia(),
  };
}

export const SEED_LETTERS: Letter[] = [
  letter('l-gor', 'ก', 'gor gài', 'chicken', 'g', 'k', 'mid', 1, ['l-bor']),
  letter('l-jor', 'จ', 'jor jaan', 'plate', 'j', 't', 'mid', 1, []),
  letter('l-dor', 'ด', 'dor dèk', 'child', 'd', 't', 'mid', 1, ['l-dtor']),
  letter('l-dtor', 'ต', 'dtor dtào', 'turtle', 'dt', 't', 'mid', 1, ['l-dor']),
  letter('l-bor', 'บ', 'bor bai-mái', 'leaf', 'b', 'p', 'mid', 1, ['l-bpor']),
  letter('l-bpor', 'ป', 'bpor bplaa', 'fish', 'bp', 'p', 'mid', 1, ['l-bor']),
  letter('l-or', 'อ', 'or àang', 'basin', '(silent)', null, 'mid', 1, []),
  letter('l-ngor', 'ง', 'ngor nguu', 'snake', 'ng', 'ng', 'low', 3, []),
  letter('l-nor', 'น', 'nor nǔu', 'mouse', 'n', 'n', 'low', 3, ['l-mor']),
  letter('l-mor', 'ม', 'mor máa', 'horse', 'm', 'm', 'low', 3, ['l-nor']),
];

function tile(thai: string, roman: string, en: string, slot = false) {
  return { thai, roman, en, slot };
}

export const SEED_PATTERNS: Pattern[] = [
  {
    id: 'p-khaw', frame: 'ขอ X หน่อย', en: 'can I have X, please', day: 2,
    note: 'ขอ starts a polite request. หน่อย at the end softens it.',
    examples: [
      [tile('ขอ', 'khǎw', 'may I have'), tile('น้ำ', 'náam', 'water', true), tile('หน่อย', 'nòi', 'a little')],
      [tile('ขอ', 'khǎw', 'may I have'), tile('ข้าวผัด', 'khâao-phàt', 'fried rice', true), tile('หน่อย', 'nòi', 'a little')],
    ],
    skills: ['read', 'say'], status: 'placeholder', media: emptyMedia(),
  },
  {
    id: 'p-mai-q', frame: 'X ไหม', en: 'yes-no question: X?', day: 6,
    note: 'Put ไหม at the end of a statement to make it a yes-no question.',
    examples: [
      [tile('เผ็ด', 'phèt', 'spicy', true), tile('ไหม', 'mǎi', '?')],
      [tile('ลด', 'lót', 'reduce', true), tile('หน่อย', 'nòi', 'a little'), tile('ได้', 'dâai', 'can'), tile('ไหม', 'mǎi', '?')],
    ],
    skills: ['read', 'say'], status: 'placeholder', media: emptyMedia(),
  },
  {
    id: 'p-mai-not', frame: 'ไม่ + verb', en: 'not + verb or description', day: 2,
    note: 'ไม่ goes straight before the verb or description it negates.',
    examples: [
      [tile('ไม่', 'mâi', 'not'), tile('เผ็ด', 'phèt', 'spicy', true)],
      [tile('ไม่', 'mâi', 'not'), tile('เข้าใจ', 'khâo-jai', 'understand', true)],
    ],
    skills: ['read', 'say'], status: 'placeholder', media: emptyMedia(),
  },
  {
    id: 'p-how-much', frame: 'X เท่าไหร่', en: 'how much is X?', day: 5,
    note: 'Question words go at the end in Thai.',
    examples: [
      [tile('อันนี้', 'an-níi', 'this one', true), tile('เท่าไหร่', 'thâo-rài', 'how much')],
      [tile('มะม่วง', 'má-mûang', 'mango', true), tile('เท่าไหร่', 'thâo-rài', 'how much')],
    ],
    skills: ['read', 'say'], status: 'placeholder', media: emptyMedia(),
  },
  {
    id: 'p-count', frame: 'item + number + classifier', en: 'two bottles of beer', day: 10,
    note: 'Thai counts with a classifier after the number: beer, two, bottle.',
    examples: [
      [tile('ขอ', 'khǎw', 'may I have'), tile('เบียร์', 'bia', 'beer', true), tile('สอง', 'sǎwng', 'two', true), tile('ขวด', 'khùat', 'bottle', true)],
      [tile('ขอ', 'khǎw', 'may I have'), tile('ข้าวผัด', 'khâao-phàt', 'fried rice', true), tile('หนึ่ง', 'nʉ̀ng', 'one', true), tile('จาน', 'jaan', 'plate', true)],
    ],
    skills: ['read', 'say'], status: 'placeholder', media: emptyMedia(),
  },
];

export const SEED_CULTURE: CultureNote[] = [
  { id: 'c-wai', day: 1, title: 'The wai', body: 'Palms together, a small bow. You return a wai from an equal or an elder. You do not need to start one with staff serving you; a smile and a polite ending do the job.', items: ['hello'], status: 'placeholder' },
  { id: 'c-street-food', day: 2, title: 'Street-food manners', body: 'Point, order, pay when you finish or when you collect. Shared tables are normal. Condiments on the table are for everyone.', items: ['fried-rice'], status: 'placeholder' },
  { id: 'c-baht', day: 3, title: 'Baht notes and coins', body: 'Notes run 20, 50, 100, 500 and 1,000. Keep small notes for stalls and taxis; a 1,000 note for a 40 baht dish is a nuisance.', items: ['baht'], status: 'placeholder' },
  { id: 'c-ice', day: 4, title: 'Ice, water, safety', body: 'Tube ice with a hole through it is factory-made. Drink bottled or filtered water, and watch which ice goes in your glass.', items: ['ice', 'water'], status: 'placeholder' },
  { id: 'c-haggling', day: 5, title: 'Haggling', body: 'Haggle at markets, not in shops with printed prices. Keep it light. Once you name a price and it is accepted, you buy.', items: ['too-expensive', 'reduce'], status: 'placeholder' },
];

export const CAST: CastMember[] = [
  { id: 'nok', name: 'Nok', role: 'Food vendor', age: '50s', place: 'food', colour: '#FFB03A', look: 'woman in her fifties, short practical hair, apron, warm and quick' },
  { id: 'ton', name: 'Ton', role: 'Taxi driver', age: '40s', place: 'taxi', colour: '#2E9BFF', look: 'man in his forties, polo shirt, sunglasses pushed up, patient' },
  { id: 'ploy', name: 'Ploy', role: 'Hotel receptionist', age: '20s', place: 'hotel', colour: '#2E9BFF', look: 'woman in her twenties, neat uniform, hair tied back, precise' },
  { id: 'lek', name: 'Lek', role: 'Market trader', age: '30s', place: 'market', colour: '#FFB03A', look: 'man in his thirties, cap, fast talker, teasing' },
  { id: 'mai', name: 'Mai', role: 'Pharmacist', age: '30s', place: 'pharmacy', colour: '#2EE6E6', look: 'woman in her thirties, white coat, long dark hair, calm' },
  { id: 'bank', name: 'Bank', role: 'Bar regular', age: 'late 20s', place: 'bar', colour: '#FF3C96', look: 'man in his late twenties, open shirt, easy laugh' },
  { id: 'fah', name: 'Fah', role: 'Bar regular', age: 'late 20s', place: 'bar', colour: '#FF3C96', look: 'woman in her late twenties, short bob, direct gaze, dry humour' },
  { id: 'theo', name: 'Theo', role: 'Shop assistant', age: 'late 20s', place: null, colour: '#9BE564', look: 'Londoner in his late twenties, locs tied back, short beard, green tee under a linen shirt, easy-going' },
  { id: 'pim', name: 'Pim', role: 'Guide and narrator', age: '30s', place: null, colour: '#E8E8E8', look: 'woman in her thirties, linen shirt, notebook, unhurried' },
];

// x: the middle of each shopfront in the street photograph (measured in street/geometry.ts);
// the taxi rank is the pavement just before the parked taxi.
export const PLACES: Place[] = [
  { id: 'hotel', name: 'Hotel desk', thaiSign: 'โรงแรม', signRoman: 'roong-raem', x: 0.15, person: 'ploy' },
  { id: 'food', name: 'Food stall', thaiSign: 'ร้านอาหาร', signRoman: 'ráan aa-hǎan', x: 0.257, person: 'nok' },
  { id: 'pharmacy', name: 'Pharmacy', thaiSign: 'ร้านขายยา', signRoman: 'ráan khǎai yaa', x: 0.386, person: 'mai' },
  { id: 'bar', name: 'Bar', thaiSign: 'บาร์', signRoman: 'baa', x: 0.508, person: 'fah' },
  { id: 'market', name: 'Market', thaiSign: 'ตลาด', signRoman: 'dtà-làat', x: 0.75, person: 'lek' },
  { id: 'taxi', name: 'Taxi rank', thaiSign: 'แท็กซี่', signRoman: 'tháek-sîi', x: 0.83, person: 'ton' },
];
