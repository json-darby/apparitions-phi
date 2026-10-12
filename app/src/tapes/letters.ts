// The Thai script at a glance: each consonant's class and its sound at the start
// and at the end of a syllable, and the vowel shapes (– marks where the consonant goes).

export type LetterClass = 'mid' | 'high' | 'low';

export const CONSONANTS: [string, LetterClass, string, string][] = [
  ['ก', 'mid', 'g', 'k'], ['ข', 'high', 'k', 'k'], ['ค', 'low', 'k', 'k'], ['ฆ', 'low', 'k', 'k'], ['ง', 'low', 'ng', 'ng'],
  ['จ', 'mid', 'j', 't'], ['ฉ', 'high', 'ch', 't'], ['ช', 'low', 'ch', 't'], ['ซ', 'low', 's', 't'], ['ฌ', 'low', 'ch', 't'],
  ['ญ', 'low', 'y', 'n'], ['ฎ', 'mid', 'd', 't'], ['ฏ', 'mid', 'dt', 't'], ['ฐ', 'high', 't', 't'], ['ฑ', 'low', 't', 't'],
  ['ฒ', 'low', 't', 't'], ['ณ', 'low', 'n', 'n'], ['ด', 'mid', 'd', 't'], ['ต', 'mid', 'dt', 't'], ['ถ', 'high', 't', 't'],
  ['ท', 'low', 't', 't'], ['ธ', 'low', 't', 't'], ['น', 'low', 'n', 'n'], ['บ', 'mid', 'b', 'p'], ['ป', 'mid', 'bp', 'p'],
  ['ผ', 'high', 'p', '–'], ['ฝ', 'high', 'f', 'p'], ['พ', 'low', 'p', 'p'], ['ฟ', 'low', 'f', 'p'], ['ภ', 'low', 'p', 'p'],
  ['ม', 'low', 'm', 'm'], ['ย', 'low', 'y', 'i'], ['ร', 'low', 'r', 'n'], ['ล', 'low', 'l', 'n'], ['ว', 'low', 'w', 'o'],
  ['ศ', 'high', 's', 't'], ['ษ', 'high', 's', 't'], ['ส', 'high', 's', 't'], ['ห', 'high', 'h', '–'], ['ฬ', 'low', 'l', 'n'],
  ['อ', 'mid', '(silent)', '–'], ['ฮ', 'low', 'h', '–'],
];

export const VOWELS: [string, string, string][] = [
  ['–า', 'aa', 'long'], ['–ะ', 'a', 'short'], ['–ี', 'ii', 'long'], ['–ิ', 'i', 'short'], ['–ื', 'ʉʉ', 'long'], ['–ึ', 'ʉ', 'short'],
  ['–ู', 'uu', 'long'], ['–ุ', 'u', 'short'], ['เ–', 'ee', 'long'], ['เ–ะ', 'e', 'short'], ['แ–', 'ɛɛ', 'long'], ['แ–ะ', 'ɛ', 'short'],
  ['โ–', 'oo', 'long'], ['โ–ะ', 'o', 'short'], ['–อ', 'ɔɔ', 'long'], ['เ–าะ', 'ɔ', 'short'], ['เ–อ', 'əə', 'long'], ['เ–ีย', 'ia', 'long'],
  ['เ–ือ', 'ʉa', 'long'], ['–ัว', 'ua', 'long'], ['ไ– ใ–', 'ai', 'live'], ['เ–า', 'ao', 'live'], ['–ำ', 'am', 'live'], ['–ั–', 'a (with a final)', 'short'],
];

/** The tone marks, with what each does by class. */
export const MARKS: { mark: string; name: string; does: string }[] = [
  { mark: 'ก่', name: 'mái èek', does: 'low on mid and high class, falling on low class' },
  { mark: 'ก้', name: 'mái too', does: 'falling on mid and high class, high on low class' },
  { mark: 'ก๊', name: 'mái dtrii', does: 'high (mid class only)' },
  { mark: 'ก๋', name: 'mái jàt-dtà-waa', does: 'rising (mid class only)' },
];
