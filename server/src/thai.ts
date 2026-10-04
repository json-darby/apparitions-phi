// Thai text comparison for the consonant and vowel check. Tone marks are
// removed before comparing: a transcription model is not a judge of tones (the
// app's pitch measurement does that), so a tone-mark difference must never
// lower this score. What is left is consonants, vowels and final sounds.

const TONE_MARKS = /[่-๋]/g; // ่ ้ ๊ ๋
const NOISE = /[\s​.,!?'"“”‘’()\-–—…:;ๆฯ]/g;

/** Normalise for a segmental comparison: NFC, no spaces or punctuation, no tone marks. */
export function segmental(s: string): string {
  return s.normalize('NFC').replace(NOISE, '').replace(TONE_MARKS, '').toLowerCase();
}

export function levenshtein(a: string[], b: string[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1: 1 is the same consonants and vowels in the same order. */
export function similarity(heard: string, target: string): number {
  const a = [...segmental(heard)];
  const b = [...segmental(target)];
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}
