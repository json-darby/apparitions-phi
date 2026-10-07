// School of the Night custom lessons: POST /school/custom.
//
// The learner describes a situation ("renting a scooter for three days"); a
// Gemini text model writes a section in the same format as the built-in ones:
// 6 to 12 lines you say, two or three likely replies per line with the line you
// answer each with, and one or two sentence frames with slot words. Every Thai
// form comes as a list of words with their romanisation, in both speaker forms.
//
// Then the checks, the same kinds as the course's:
//  1. rules (no model): Thai script only in the Thai, the course's romanisation
//     alphabet with at most one tone mark a syllable, the polite endings and
//     pronouns right for each speaker, the male and female forms the same apart
//     from those, a course word romanised as the course has it (fixed, not
//     failed), and at most five words the course does not have in your lines.
//  2. a second, different model reads only the Thai (blind): what it means in
//     English, and whether a Thai speaker would say it that way. Lines it
//     rejects are dropped; if too few survive, the section is written once more.
// No model is asked about tones: tones come from the romanisation's marks and,
// for course words, from the course.
//
// Safety: the scenario is screened here first, the model is told the same
// limits as the live tutor (server rules), and with 18+ off nothing from the
// Night side is written at all. Mock mode returns a canned section (renting a
// scooter) and costs nothing.

import type { TextModel } from './text.ts';

// ---------- shapes ----------

export interface Word {
  thai: string;
  roman: string;
}

export interface Reply {
  id: string;
  en: string;
  m: Word[];
  f: Word[];
  answer: string;
}

export interface Line {
  id: string;
  en: string;
  m: Word[];
  f: Word[];
  replies: Reply[];
  /** the checker's blind reading of the Thai */
  back?: string;
}

export interface SlotWord {
  id: string;
  en: string;
  word: Word[];
  m: Word[];
  f: Word[];
}

export interface Frame {
  id: string;
  en: string;
  m: { thai: string; roman: string };
  f: { thai: string; roman: string };
  words: SlotWord[];
}

export interface Draft {
  title: string;
  scenario: string;
  adult: boolean;
  door: string | null;
  lines: Line[];
  frames: Frame[];
  dropped: number;
  mock: boolean;
}

export interface CustomBody {
  scenario: string;
  /** lines in the learner's own words, optional */
  mine?: string;
  identity: 'm' | 'f';
  adult: boolean;
  /** course words to prefer: [thai, roman, en] */
  known: [string, string, string][];
  /** reword one line instead of writing a section */
  reword?: { en: string; context: string };
}

export const MAX_SCENARIO = 400;
export const MAX_MINE = 800;
export const MAX_KNOWN = 600;
export const MIN_LINES = 6;
export const MAX_LINES = 12;
export const MAX_NEW_WORDS = 5;

// ---------- the request ----------

/** The request, cleaned, or a reason it is refused. */
export function readBody(raw: unknown): CustomBody | string {
  if (!raw || typeof raw !== 'object') return 'send a JSON object';
  const o = raw as Record<string, unknown>;
  const scenario = typeof o.scenario === 'string' ? o.scenario.trim() : '';
  const reword = o.reword && typeof o.reword === 'object' ? (o.reword as Record<string, unknown>) : null;
  if (!reword && scenario.length < 4) return 'describe the situation';
  if (scenario.length > MAX_SCENARIO) return 'the description is too long';
  const mine = typeof o.mine === 'string' ? o.mine.trim().slice(0, MAX_MINE) : '';
  const known = Array.isArray(o.known)
    ? (o.known as unknown[])
        .filter((k): k is [string, string, string] => Array.isArray(k) && k.length === 3 && k.every((x) => typeof x === 'string' && x.length <= 80))
        .slice(0, MAX_KNOWN)
    : [];
  const body: CustomBody = { scenario, mine: mine || undefined, identity: o.identity === 'f' ? 'f' : 'm', adult: o.adult === true, known };
  if (reword) {
    const en = typeof reword.en === 'string' ? reword.en.trim() : '';
    if (!en || en.length > 160) return 'say what the line should mean';
    body.reword = { en, context: typeof reword.context === 'string' ? reword.context.trim().slice(0, MAX_SCENARIO) : scenario };
  }
  return body;
}

const SEXUAL = /\b(sex|sexual|porn\w*|nude|naked|blow ?job|hand ?job|oral|orgasm|fuck\w*|boobs?|tits|dick|cock|pussy|escort service|happy ending)\b|เซ็กส์|โป๊|เย็ด/i;
const HARD_DRUGS = /\b(cocaine|coke|meth|crystal|heroin|mdma|ecstasy|molly|ketamine|lsd|yaba|buy(ing)? drugs|drug dealer|dealer)\b|ยาบ้า|ยาไอซ์|โคเคน/i;
const MINORS = /\b(child|children|kid|kids|minor|minors|underage|teen|teens|teenager|schoolgirl|schoolboy|(1[0-7]|[1-9]) ?(yo|y\/o|years? old))\b|เด็ก/i;
const NIGHT = /\b(bar ?girls?|go-?go|gogo|ladyboys?|kathoey|flirt\w*|dating|date|tinder|hook ?up|girlfriend|boyfriend|kiss\w*|bed|hotel room|her room|my room|working girls?|freelancers?|massage parlou?r|soapy|beer bar|cannabis|weed|ganja|joint|pre-?roll|edibles?|420|strip club|red light|nana plaza|soi cowboy|walking street|pay bar ?fine|bar ?fine|lady drink)\b/i;

export type Screen = { ok: true } | { ok: false; code: 'unsafe' | 'adult-off'; message: string };

/** The scenario before any model sees it. */
export function screenScenario(text: string, adult: boolean): Screen {
  if (SEXUAL.test(text)) return { ok: false, code: 'unsafe', message: 'Custom lessons stay non-explicit. Describe the situation without sexual detail.' };
  if (HARD_DRUGS.test(text)) return { ok: false, code: 'unsafe', message: 'Custom lessons cannot cover getting hold of illegal drugs.' };
  if (MINORS.test(text) && (adult || NIGHT.test(text))) return { ok: false, code: 'unsafe', message: 'Everyone in a School of the Night lesson is an adult.' };
  if (!adult && NIGHT.test(text)) return { ok: false, code: 'adult-off', message: 'That sounds like a Night lesson, which is 18+. Turn on 18+ in Settings to build it.' };
  return { ok: true };
}

// ---------- the prompts ----------

const ROMAN_GUIDE = [
  'Romanisation: the course\'s own system, lower case, syllables joined by "-" inside a word. Tone marks on the vowel:',
  'no mark = mid (mii, bpai), grave = low (yàak, nòi), circumflex = falling (mâi, dâai), acute = high (khráp, nám), caron = rising (mǎi, khǎw).',
  'Long vowels doubled (aa, ii, uu, ʉʉ, ee, oo, əə). Use ʉ for อึ/อือ, ə for เออ, aw/aaw for เอาะ/ออ (gàawn ก่อน, khǎw ขอ), ae/aae for แอ.',
  'Initials: g ก, k ข ค (aspirated kh), j จ, ch ฉ ช, d ด, dt ต, th ถ ท, b บ, bp ป, ph ผ พ, f ฝ ฟ, ng ง.',
  'Examples: สวัสดี sà-wàt-dii, ขอบคุณ khàwp-khun, เท่าไหร่ thâo-rài, พาสปอร์ต phâat-bpàawt, เงินสด ngən-sòt, ที่ไหน thîi-nǎi.',
].join('\n');

const SHAPE = `Answer with JSON only, in exactly this shape:
{
  "refused": false,
  "title": "2 to 5 words, English",
  "adult": false,
  "door": "l1",
  "lines": [
    {
      "id": "l1",
      "en": "what you say, in plain English",
      "m": [{"thai": "อยาก", "roman": "yàak"}, {"thai": "เช่า", "roman": "châo"}, {"thai": "ครับ", "roman": "khráp"}],
      "f": [{"thai": "อยาก", "roman": "yàak"}, {"thai": "เช่า", "roman": "châo"}, {"thai": "ค่ะ", "roman": "khâ"}],
      "replies": [
        {"id": "l1.r1", "en": "what they say back", "m": [...words, said by a man...], "f": [...words, said by a woman...], "answer": "l3"}
      ]
    }
  ],
  "frames": [
    {
      "id": "f1",
      "en": "Do you have ___?",
      "m": {"thai": "มี ___ ไหมครับ", "roman": "mii ___ mǎi khráp"},
      "f": {"thai": "มี ___ ไหมคะ", "roman": "mii ___ mǎi khá"},
      "words": [
        {"id": "w1", "en": "a helmet", "word": [{"thai": "หมวกกันน็อก", "roman": "mùak-gan-náwk"}],
         "m": [...the whole sentence as words, male...], "f": [...the whole sentence as words, female...]}
      ]
    }
  ]
}
Every Thai form is a list of words, one Thai word (no spaces) per entry, each with its romanisation.`;

function rules(adult: boolean): string {
  return [
    'SAFETY (fixed):',
    '- Everyone in the lesson is an adult. Never mention or involve a minor.',
    '- Never sexual or explicit. Nightlife, dating and cannabis-shop lines stay light, non-explicit and consent-forward; saying no and taking no for an answer are part of it.',
    '- Nothing on obtaining, buying or hiding illegal drugs. No real, identifiable people.',
    adult
      ? '- The learner has 18+ on: bars, light flirting, dating and legal cannabis shops are allowed, non-explicitly. Set "adult": true for any such scenario.'
      : '- The learner has 18+ OFF: no bars, flirting, dating, nightlife or cannabis at all. If the scenario needs any of that, refuse.',
    '- If the scenario breaks these rules, answer {"refused": true, "reason": "one short sentence"} and nothing else.',
  ].join('\n');
}

function knownBlock(known: CustomBody['known']): string {
  if (!known.length) return '(none sent)';
  return known.map(([t, r, e]) => `${t} | ${r} | ${e}`).join('\n');
}

export function sectionPrompt(b: CustomBody, retry = false): { system: string; prompt: string } {
  const system = [
    'You write short spoken Thai lessons for "School of the Night", a Thai course for one adult English speaker getting ready for a trip to Thailand.',
    'A lesson section is: the lines the learner says in one situation, the replies a Thai person is likely to give to each, and the learner\'s answer to each reply (which is another line in the same section).',
    '',
    'REGISTER: the learner is a male speaker, friendly and polite, as a visitor talks to a vendor, driver or receptionist: ครับ at the end of his sentences, ผม for "I" when "I" is needed (Thai often drops it). Every line also has the female form: ค่ะ for statements, คะ for questions and after นะ, ฉัน for "I". The two forms are word for word the same apart from those.',
    'Replies come in two forms too: "m" as a man would say it, "f" as a woman would. A reply may drop the polite ending if a busy vendor would, but then both forms drop it.',
    'Natural, everyday Bangkok Thai a visitor can actually use: short (2 to 7 words), never textbook-stiff, never slang the learner could misuse.',
    'PREFER COURSE WORDS: build the lines from the course words listed in the request wherever they fit. Use at most five words that are not in that list across all your lines, and only when the situation needs them.',
    '',
    'CONTENT: 8 to 12 lines. Two or three likely replies for most lines, each answered by another line of the section (give that line\'s id as "answer"); trees stay two levels deep. Do not write "say that again", "slower" or "I don\'t understand": the course already has them. One or two frames: a sentence with one slot (___) and 3 to 5 words for it that fit this situation. "door" is the id of the line that best opens the section (usually the first thing you say).',
    '',
    ROMAN_GUIDE,
    '',
    rules(b.adult),
    '',
    SHAPE,
  ].join('\n');
  const prompt = [
    `The situation: ${b.scenario}`,
    b.mine ? `Lines the learner would like to say, in his own words (use them, made natural):\n${b.mine}` : '',
    `The learner speaks as a ${b.identity === 'f' ? 'woman (but write both forms as asked)' : 'man'}.`,
    retry ? 'An earlier attempt had too many lines that failed the checks: keep every line short, natural and built from course words.' : '',
    `COURSE WORDS (Thai | romanisation | English):\n${knownBlock(b.known)}`,
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
}

export function rewordPrompt(b: CustomBody): { system: string; prompt: string } {
  const r = b.reword!;
  const system = [
    'You write one spoken Thai line for a Thai lesson for an adult English speaker. Register: a male speaker, friendly and polite (ครับ, ผม), and the female form (ค่ะ for statements, คะ for questions, ฉัน), word for word the same apart from those. Short, natural Bangkok Thai. Prefer the course words listed.',
    ROMAN_GUIDE,
    rules(b.adult),
    'Answer with JSON only: {"refused": false, "line": {"id": "x", "en": "plain English", "m": [{"thai": "...", "roman": "..."}], "f": [...]}}. Every Thai form is a list of words, one Thai word per entry.',
  ].join('\n\n');
  const prompt = [`The situation: ${r.context}`, `The line should mean: ${r.en}`, `COURSE WORDS (Thai | romanisation | English):\n${knownBlock(b.known)}`].join('\n\n');
  return { system, prompt };
}

export function checkPrompt(items: { id: string; thai: string }[], scenario: string): { system: string; prompt: string } {
  const system = [
    'You are a native Thai speaker from Bangkok checking lines for a spoken Thai course. You see only the Thai.',
    'For each line: say in plain English what it means (your own reading, short), and whether a Thai speaker would actually say it that way in the situation (natural: true or false). Mark natural false for anything ungrammatical, unidiomatic, oddly formal, rude, or that a Thai person would not say. Do not judge tones or pronunciation.',
    'Answer with JSON only: {"items": [{"id": "...", "back": "English", "natural": true, "note": "short reason when false"}]}',
  ].join('\n');
  const prompt = [`The situation: ${scenario}`, 'Lines:', ...items.map((i) => `${i.id}: ${i.thai}`)].join('\n');
  return { system, prompt };
}

// ---------- reading the model's answer ----------

const str = (x: unknown, max = 200) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

function words(x: unknown): Word[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((w) => (w && typeof w === 'object' ? { thai: str((w as Word).thai, 40).replace(/\s+/g, ''), roman: str((w as Word).roman, 60).toLowerCase().normalize('NFC') } : null))
    .filter((w): w is Word => !!w && !!w.thai);
}

function form(x: unknown): { thai: string; roman: string } {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return { thai: str(o.thai, 80), roman: str(o.roman, 120).toLowerCase().normalize('NFC') };
}

function idOf(x: unknown, fallback: string): string {
  const s = str(x, 24).replace(/[^\w.-]/g, '');
  return s || fallback;
}

/** The model's answer as a draft (shape only; the checks come next). */
export function readDraft(raw: unknown, b: CustomBody): Draft | { refused: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (o.refused === true) return { refused: str(o.reason) || 'The model would not write that lesson.' };
  const lines: Line[] = (Array.isArray(o.lines) ? o.lines : []).slice(0, MAX_LINES + 4).map((l: Record<string, unknown>, i: number) => {
    const id = idOf(l?.id, `l${i + 1}`);
    return {
      id,
      en: str(l?.en, 140),
      m: words(l?.m),
      f: words(l?.f),
      replies: (Array.isArray(l?.replies) ? l.replies : []).slice(0, 3).map((r: Record<string, unknown>, k: number) => ({
        id: idOf(r?.id, `${id}.r${k + 1}`),
        en: str(r?.en, 140),
        m: words(r?.m),
        f: words(r?.f),
        answer: str(r?.answer, 24),
      })),
    };
  });
  const frames: Frame[] = (Array.isArray(o.frames) ? o.frames : []).slice(0, 2).map((f: Record<string, unknown>, i: number) => ({
    id: idOf(f?.id, `f${i + 1}`),
    en: str(f?.en, 80),
    m: form(f?.m),
    f: form(f?.f),
    words: (Array.isArray(f?.words) ? f.words : []).slice(0, 6).map((w: Record<string, unknown>, k: number) => ({
      id: idOf(w?.id, `w${k + 1}`),
      en: str(w?.en, 60),
      word: words(w?.word),
      m: words(w?.m),
      f: words(w?.f),
    })),
  }));
  return {
    title: str(o.title, 60) || 'My lesson',
    scenario: b.scenario,
    adult: b.adult && o.adult === true,
    door: str(o.door, 24) || null,
    lines,
    frames,
    dropped: 0,
    mock: false,
  };
}

// ---------- the rule checks ----------

const THAI_WORD = /^[฀-๿]+$/;
const ROMAN_SYL = /^[a-zəʉ]+$/;
const TONE_MARKS = /[̀́̂̌]/g;
const M_END = 'ครับ';
const F_ENDS = ['ค่ะ', 'คะ'];
const FIXED_ROMAN: Record<string, string> = { ครับ: 'khráp', ค่ะ: 'khâ', คะ: 'khá', ผม: 'phǒm', ฉัน: 'chǎn' };
const SPEAKER_WORDS = new Set(['ครับ', 'ค่ะ', 'คะ', 'ผม', 'ฉัน', 'ดิฉัน']);

/** A romanised word in the course's alphabet, one tone mark at most per syllable. */
export function romanOk(roman: string): boolean {
  if (!roman) return false;
  return roman.split('-').every((syl) => {
    const d = syl.normalize('NFD');
    const marks = d.match(TONE_MARKS)?.length ?? 0;
    const bare = d.replace(TONE_MARKS, '');
    return marks <= 1 && ROMAN_SYL.test(bare) && /[aeiouəʉ]/.test(bare);
  });
}

/** Words fixed up from what is certain: the endings' and pronouns' romanisation, and course words as the course has them. */
function fixWords(ws: Word[], known: ReadonlyMap<string, string>): Word[] {
  return ws.map((w) => ({ thai: w.thai, roman: FIXED_ROMAN[w.thai] ?? known.get(w.thai) ?? w.roman }));
}

/** Problems with one speaker's form, or none. */
function formProblems(ws: Word[], sex: 'm' | 'f', needEnding: boolean): string[] {
  const out: string[] = [];
  if (!ws.length) return ['empty'];
  for (const w of ws) {
    if (!THAI_WORD.test(w.thai)) out.push(`not Thai script: ${w.thai}`);
    if (!romanOk(w.roman)) out.push(`romanisation ${w.roman}`);
  }
  const thais = ws.map((w) => w.thai);
  if (sex === 'm' && thais.some((t) => t === 'ฉัน' || t === 'ค่ะ' || t === 'คะ' || t === 'ดิฉัน')) out.push('female forms in the male line');
  if (sex === 'f' && thais.some((t) => t === 'ผม' || t === 'ครับ')) out.push('male forms in the female line');
  const last = thais[thais.length - 1];
  if (needEnding && sex === 'm' && last !== M_END) out.push('the male form does not end with ครับ');
  if (needEnding && sex === 'f' && !F_ENDS.includes(last)) out.push('the female form does not end with ค่ะ or คะ');
  if (ws.length > 12) out.push('too long');
  return out;
}

/** The female ending a sentence takes: คะ for a question or after นะ, ค่ะ otherwise. */
function fixFemaleEnding(ws: Word[], en: string): Word[] {
  const last = ws[ws.length - 1]?.thai;
  if (!F_ENDS.includes(last)) return ws;
  const prev = ws[ws.length - 2]?.thai;
  const want = en.trim().endsWith('?') || prev === 'นะ' ? 'คะ' : 'ค่ะ';
  return [...ws.slice(0, -1), { thai: want, roman: FIXED_ROMAN[want] }];
}

const core = (ws: Word[]) => ws.filter((w) => !SPEAKER_WORDS.has(w.thai)).map((w) => w.thai).join('');

/** Check a pair of forms; fixed forms and problems. */
function checkPair(m0: Word[], f0: Word[], en: string, known: ReadonlyMap<string, string>, needEnding: boolean): { m: Word[]; f: Word[]; problems: string[] } {
  const m = fixWords(m0, known);
  const f = fixFemaleEnding(fixWords(f0, known), en);
  const ending = needEnding || m[m.length - 1]?.thai === M_END || F_ENDS.includes(f[f.length - 1]?.thai);
  const problems = [...formProblems(m, 'm', ending).map((p) => `m: ${p}`), ...formProblems(f, 'f', ending).map((p) => `f: ${p}`)];
  if (core(m) !== core(f)) problems.push('the male and female forms differ beyond the endings and "I"');
  if (!en) problems.push('no English');
  return { m, f, problems };
}

export interface Checked {
  draft: Draft;
  /** why each dropped thing went, for tests and the server log (counts only there) */
  problems: Record<string, string[]>;
}

/** The rule checks: fix what is certain, drop what fails, keep the tree consistent. */
export function ruleCheck(d: Draft, knownList: CustomBody['known']): Checked {
  const known = new Map(knownList.map(([t, r]) => [t, r.toLowerCase().normalize('NFC')]));
  const problems: Record<string, string[]> = {};
  let dropped = d.dropped;
  const seen = new Set<string>();
  let lines: Line[] = [];
  for (const l of d.lines) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    const c = checkPair(l.m, l.f, l.en, known, true);
    if (c.problems.length) {
      problems[l.id] = c.problems;
      dropped++;
      continue;
    }
    const replies: Reply[] = [];
    for (const r of l.replies) {
      const rc = checkPair(r.m, r.f, r.en, known, false);
      if (rc.problems.length || seen.has(r.id)) {
        problems[r.id] = rc.problems.length ? rc.problems : ['duplicate id'];
        continue;
      }
      seen.add(r.id);
      replies.push({ ...r, m: rc.m, f: rc.f });
    }
    lines.push({ ...l, m: c.m, f: c.f, replies });
  }
  // at most five new words in your lines: drop the lines that bring in more, from the end, while enough remain
  const isNew = (w: Word) => !known.has(w.thai) && !SPEAKER_WORDS.has(w.thai);
  const newIn = (ls: Line[]) => new Set(ls.flatMap((l) => l.m.filter(isNew).map((w) => w.thai)));
  if (known.size) {
    for (let i = lines.length - 1; i >= 0 && newIn(lines).size > MAX_NEW_WORDS && lines.length > MIN_LINES; i--) {
      const without = lines.filter((_, k) => k !== i);
      if (newIn(without).size < newIn(lines).size) {
        problems[lines[i].id] = ['too many new words'];
        lines = without;
        dropped++;
      }
    }
  }
  lines = lines.slice(0, MAX_LINES);
  const ids = new Set(lines.map((l) => l.id));
  lines = lines.map((l) => ({ ...l, replies: l.replies.filter((r) => ids.has(r.answer) && r.answer !== l.id) }));
  const frames: Frame[] = [];
  for (const fr of d.frames) {
    if (!fr.en.includes('___') || !fr.m.thai.includes('___') || !fr.f.thai.includes('___')) {
      problems[fr.id] = ['the frame has no ___ slot'];
      continue;
    }
    const ws: SlotWord[] = [];
    for (const w of fr.words) {
      const word = fixWords(w.word, known);
      const c = checkPair(w.m, w.f, fr.en.replace('___', w.en), known, true);
      const wp = formProblems(word, 'm', false);
      if (c.problems.length || wp.length || !w.en) {
        problems[`${fr.id}/${w.id}`] = [...c.problems, ...wp];
        continue;
      }
      ws.push({ ...w, word, m: c.m, f: c.f });
    }
    if (ws.length >= 2) frames.push({ ...fr, m: { ...fr.m, roman: fr.m.roman.normalize('NFC') }, words: ws });
  }
  const door = d.door && ids.has(d.door) ? d.door : lines[0]?.id ?? null;
  return { draft: { ...d, lines, frames, door, dropped }, problems };
}

// ---------- the second model's check ----------

interface Verdict {
  id: string;
  back: string;
  natural: boolean;
}

function readVerdicts(raw: unknown): Map<string, Verdict> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { items?: unknown };
  const out = new Map<string, Verdict>();
  for (const v of Array.isArray(o.items) ? o.items : []) {
    if (!v || typeof v !== 'object') continue;
    const x = v as Record<string, unknown>;
    const id = str(x.id, 40);
    if (id) out.set(id, { id, back: str(x.back, 160), natural: x.natural !== false });
  }
  return out;
}

/** What the checker reads: each line, reply and slot sentence, male form, Thai only. */
export function checkItems(d: Draft): { id: string; thai: string }[] {
  const join = (ws: Word[]) => ws.map((w) => w.thai).join('');
  return [
    ...d.lines.flatMap((l) => [{ id: l.id, thai: join(l.m) }, ...l.replies.map((r) => ({ id: r.id, thai: join(r.m) }))]),
    ...d.frames.flatMap((f) => f.words.map((w) => ({ id: `${f.id}/${w.id}`, thai: join(w.m) }))),
  ];
}

/** Drop what the checker says a Thai speaker would not say; keep its blind reading for the review. Missing verdicts pass. */
export function applyVerdicts(d: Draft, raw: unknown): Draft {
  const v = readVerdicts(raw);
  const bad = (id: string) => v.get(id)?.natural === false;
  let dropped = d.dropped;
  let lines = d.lines.filter((l) => (bad(l.id) ? (dropped++, false) : true));
  const ids = new Set(lines.map((l) => l.id));
  lines = lines.map((l) => ({
    ...l,
    back: v.get(l.id)?.back || l.back,
    replies: l.replies.filter((r) => !bad(r.id) && ids.has(r.answer)),
  }));
  const frames = d.frames
    .map((f) => ({ ...f, words: f.words.filter((w) => !bad(`${f.id}/${w.id}`)) }))
    .filter((f) => f.words.length >= 2);
  const door = d.door && ids.has(d.door) ? d.door : lines[0]?.id ?? null;
  return { ...d, lines, frames, door, dropped };
}

// ---------- the whole request ----------

export type CustomResult =
  | { ok: true; draft: Draft }
  | { ok: true; line: Line }
  | { ok: false; status: number; code: string; message: string };

export interface Models {
  write: TextModel;
  check: TextModel;
  writeModel: string;
  checkModel: string;
}

/** Write, check, and if too few lines pass, write once more. */
export async function buildCustom(b: CustomBody, models: Models): Promise<CustomResult> {
  const screen = screenScenario(`${b.scenario}\n${b.mine ?? ''}\n${b.reword?.en ?? ''}`, b.adult);
  if (!screen.ok) return { ok: false, status: 422, code: screen.code, message: screen.message };
  if (b.reword) return reword(b, models);
  let best: Draft | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = sectionPrompt(b, attempt > 0);
    const ans = await models.write({ model: models.writeModel, system: p.system, prompt: p.prompt, stage: 'school.generate', temperature: 0.7, maxOutputTokens: 12000 });
    const read = readDraft(ans.data, b);
    if ('refused' in read) return { ok: false, status: 422, code: 'refused', message: read.refused };
    const ruled = ruleCheck(read, b.known).draft;
    if (!ruled.lines.length) continue;
    const c = checkPrompt(checkItems(ruled), b.scenario);
    const verdicts = await models.check({ model: models.checkModel, system: c.system, prompt: c.prompt, stage: 'school.check', temperature: 0.2, maxOutputTokens: 6000 });
    const checked = applyVerdicts(ruled, verdicts.data);
    if (!best || checked.lines.length > best.lines.length) best = checked;
    if (checked.lines.length >= MIN_LINES) break;
  }
  if (!best || best.lines.length < 3) return { ok: false, status: 502, code: 'checks', message: 'Too few lines passed the checks. Try describing the situation another way.' };
  return { ok: true, draft: best };
}

async function reword(b: CustomBody, models: Models): Promise<CustomResult> {
  const p = rewordPrompt(b);
  const ans = await models.write({ model: models.writeModel, system: p.system, prompt: p.prompt, stage: 'school.reword', temperature: 0.5, maxOutputTokens: 3000 });
  const o = (ans.data && typeof ans.data === 'object' ? ans.data : {}) as Record<string, unknown>;
  if (o.refused === true) return { ok: false, status: 422, code: 'refused', message: str(o.reason) || 'The model would not write that line.' };
  // the English is the learner's own: the female ending follows it, and it is what the line means
  const one = readDraft({ lines: [{ ...(o.line as object), id: 'x', en: b.reword!.en, replies: [] }] }, b);
  if ('refused' in one) return { ok: false, status: 422, code: 'refused', message: one.refused };
  const ruled = ruleCheck(one, b.known).draft;
  const line = ruled.lines[0];
  if (!line) return { ok: false, status: 502, code: 'checks', message: 'That line did not pass the checks. Try other words.' };
  const c = checkPrompt(checkItems(ruled), b.reword!.context);
  const verdicts = await models.check({ model: models.checkModel, system: c.system, prompt: c.prompt, stage: 'school.check', temperature: 0.2, maxOutputTokens: 2000 });
  const checked = applyVerdicts(ruled, verdicts.data).lines[0];
  if (!checked) return { ok: false, status: 502, code: 'checks', message: 'A Thai speaker would not say it that way. Try other words.' };
  return { ok: true, line: { ...checked, en: b.reword!.en } };
}

// ---------- mock: a canned section, no cost ----------

const W = (pairs: string): Word[] =>
  pairs.split(' ').map((p) => {
    const [thai, roman] = p.split('|');
    return { thai, roman };
  });

const M = (s: string) => W(`${s} ครับ|khráp`);
const F = (s: string, q = false) => W(`${s} ${q ? 'คะ|khá' : 'ค่ะ|khâ'}`);

/** Renting a scooter: real Thai, mostly course words, both forms, as a model would send it. */
export function mockSectionAnswer(): unknown {
  const line = (id: string, en: string, s: string, q: boolean, replies: unknown[] = []) => ({ id, en, m: M(s), f: F(s, q), replies });
  const reply = (id: string, en: string, s: string, answer: string, q = false) => ({ id, en, m: M(s), f: F(s, q), answer });
  return {
    refused: false,
    title: 'Renting a scooter',
    adult: false,
    door: 'l1',
    lines: [
      line('l1', "I'd like to rent a scooter.", 'อยาก|yàak เช่า|châo มอเตอร์ไซค์|maaw-dtəə-sai', false, [
        reply('l1.r1', 'For how many days?', 'กี่|gìi วัน|wan', 'l3', true),
        reply('l1.r2', 'Do you have a passport?', 'มี|mii พาสปอร์ต|phâat-bpàawt ไหม|mǎi', 'l7', true),
      ]),
      line('l2', 'How much a day?', 'วันละ|wan-lá เท่าไหร่|thâo-rài', true, [
        reply('l2.r1', '300 baht a day.', 'วันละ|wan-lá สาม|sǎam ร้อย|rói บาท|bàat', 'l9'),
        reply('l2.r2', 'Cash only.', 'เงินสด|ngən-sòt เท่านั้น|thâo-nán', 'l8'),
      ]),
      line('l3', 'Three days.', 'สาม|sǎam วัน|wan', false),
      line('l4', 'Can I pay cash?', 'จ่าย|jàai เงินสด|ngən-sòt ได้|dâai ไหม|mǎi', true, [reply('l4.r1', 'Yes, you can.', 'ได้|dâai', 'l8')]),
      line('l5', 'Do you have a helmet?', 'มี|mii หมวกกันน็อก|mùak-gan-náwk ไหม|mǎi', true, [
        reply('l5.r1', 'Yes, we do.', 'มี|mii', 'l8'),
        reply('l5.r2', 'No, we don’t.', 'ไม่|mâi มี|mii', 'l6'),
      ]),
      line('l6', 'Is there insurance?', 'มี|mii ประกัน|bprà-gan ไหม|mǎi', true, [reply('l6.r1', 'Yes, there is.', 'มี|mii', 'l8')]),
      line('l7', "Here's my passport.", 'นี่|nîi พาสปอร์ต|phâat-bpàawt', false),
      line('l8', "Okay, I'll take it.", 'โอเค|oo-khee เอา|ao', false),
      line('l9', 'Can you lower the price?', 'ลด|lót ได้|dâai ไหม|mǎi', true, [reply('l9.r1', "Can't, sorry.", 'ลด|lót ไม่|mâi ได้|dâai', 'l8')]),
    ],
    frames: [
      {
        id: 'f1',
        en: 'Do you have ___?',
        m: { thai: 'มี ___ ไหมครับ', roman: 'mii ___ mǎi khráp' },
        f: { thai: 'มี ___ ไหมคะ', roman: 'mii ___ mǎi khá' },
        words: [
          { id: 'w1', en: 'a helmet', word: W('หมวกกันน็อก|mùak-gan-náwk'), m: M('มี|mii หมวกกันน็อก|mùak-gan-náwk ไหม|mǎi'), f: F('มี|mii หมวกกันน็อก|mùak-gan-náwk ไหม|mǎi', true) },
          { id: 'w2', en: 'insurance', word: W('ประกัน|bprà-gan'), m: M('มี|mii ประกัน|bprà-gan ไหม|mǎi'), f: F('มี|mii ประกัน|bprà-gan ไหม|mǎi', true) },
          { id: 'w3', en: 'a map', word: W('แผนที่|phǎaen-thîi'), m: M('มี|mii แผนที่|phǎaen-thîi ไหม|mǎi'), f: F('มี|mii แผนที่|phǎaen-thîi ไหม|mǎi', true) },
        ],
      },
    ],
  };
}

/** The mock checker: everything natural, the "blind" reading is the English it was written for. */
export function mockCheckAnswer(prompt: string, draft?: Draft): unknown {
  const en = new Map<string, string>();
  for (const l of draft?.lines ?? []) {
    en.set(l.id, l.en);
    for (const r of l.replies) en.set(r.id, r.en);
  }
  const ids = [...prompt.matchAll(/^([\w./-]+): /gm)].map((m) => m[1]);
  return { items: ids.map((id) => ({ id, back: en.get(id) ?? '', natural: true })) };
}

/** Mock models: the canned section, an echoing checker; a reworded line is "Can I look first?". */
export function mockModels(): Models {
  let last: Draft | undefined;
  const write: TextModel = async (call) => {
    if (call.stage === 'school.reword') {
      return { data: { refused: false, line: { id: 'x', en: '', m: M('ขอ|khǎw ดู|duu ก่อน|gàawn ได้|dâai ไหม|mǎi'), f: F('ขอ|khǎw ดู|duu ก่อน|gàawn ได้|dâai ไหม|mǎi', true) } }, model: 'mock', tokensIn: 0, tokensOut: 0, usd: 0 };
    }
    const data = mockSectionAnswer();
    last = readDraft(data, { scenario: '', identity: 'm', adult: false, known: [] }) as Draft;
    return { data, model: 'mock', tokensIn: 0, tokensOut: 0, usd: 0 };
  };
  const check: TextModel = async (call) => ({ data: mockCheckAnswer(call.prompt, last), model: 'mock', tokensIn: 0, tokensOut: 0, usd: 0 });
  return { write, check, writeModel: 'mock', checkModel: 'mock' };
}
