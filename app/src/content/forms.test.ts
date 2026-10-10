// A learner who speaks as a woman sees her own Thai in examples and pattern tiles.

import { describe, expect, it } from 'vitest';
import { Content, forIdentity } from './repo';
import { emptyMedia, type Item, type Pattern } from './types';

const item: Item = {
  id: 'chicken', kind: 'word', thai: 'ไก่', roman: 'gài', tones: ['low'], en: 'chicken', theme: 'food', day: 1,
  survival: false, skills: ['hear'], tags: [], status: 'checked', media: emptyMedia(),
  example: { thai: 'ผมกินไก่', roman: 'phǒm gin gài', en: 'I eat chicken.', forms: { m: { thai: 'ผมกินไก่', roman: 'phǒm gin gài' }, f: { thai: 'ฉันกินไก่', roman: 'chǎn gin gài' } } },
};
const pattern: Pattern = {
  id: 'p-x-is-y', frame: 'X เป็น Y', en: 'X is Y', note: '', day: 1, skills: ['read'], status: 'checked', media: emptyMedia(),
  examples: [[{ thai: 'ผม', roman: 'phǒm', en: 'I (male)', forms: { m: { thai: 'ผม', roman: 'phǒm' }, f: { thai: 'ฉัน', roman: 'chǎn' } } }, { thai: 'เป็น', roman: 'bpen', en: 'be' }]],
};
const course = new Content({ items: [item], letters: [], patterns: [pattern], culture: [] });

describe('forIdentity', () => {
  it('leaves the course as it is for a man', () => {
    expect(forIdentity(course, 'm')).toBe(course);
  });
  it('gives a woman her own example and tiles', () => {
    const f = forIdentity(course, 'f');
    expect(f.item('item:chicken')?.example?.thai).toBe('ฉันกินไก่');
    expect(f.item('item:chicken')?.example?.roman).toBe('chǎn gin gài');
    const tile = f.pattern('pattern:p-x-is-y')!.examples[0][0];
    expect([tile.thai, tile.roman, tile.en]).toEqual(['ฉัน', 'chǎn', 'I (female)']);
    // the course itself is untouched
    expect(course.item('item:chicken')?.example?.thai).toBe('ผมกินไก่');
  });
});
