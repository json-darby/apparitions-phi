// Every sound comes from the course's own clips. A line with no clip, or a
// clip that will not play, shows as a caption; the device's built-in voice is
// never used, even when the device has a Thai one.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { Content } from '../content/repo';
import { emptyMedia, type Item } from '../content/types';
import { defaultSettings } from '../core/settings';
import { AudioSound } from './AudioSound';
import { genderOfText } from './sound';

function item(id: string, thai: string, clip: boolean): Item {
  const media = emptyMedia();
  if (clip) media.audio['f1.normal'] = `audio/item/${id}/f1.normal.ogg`;
  return {
    id, kind: 'word', thai, roman: id, tones: ['mid'], en: id, theme: 'greetings', day: 1,
    survival: false, skills: ['hear', 'read'], tags: [], status: 'checked', media,
  };
}

/** Let the service's async playback steps run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('only course voices', () => {
  // a device with a Thai voice installed: it must stay unused
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'th-TH', name: 'Thai' }], speak, cancel: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(readonly text: string) {} });
  afterAll(() => vi.unstubAllGlobals());

  const content = new Content({ items: [item('with-clip', 'มี', true), item('no-clip', 'หมด', false)], letters: [], patterns: [], culture: [] });
  const sound = new AudioSound();
  sound.configure({ content, settings: defaultSettings('2026-10-04') });

  it('is in audio mode once the course has a clip', () => {
    expect(sound.mode).toBe('audio');
    expect(sound.hasClip({ ref: 'item:with-clip', thai: 'มี' })).toBe(true);
    expect(sound.hasClip({ ref: 'item:no-clip', thai: 'หมด' })).toBe(false);
  });

  it('shows the caption alone for a line with no clip', async () => {
    const done = sound.play({ ref: 'item:no-clip', thai: 'หมด', roman: 'mòt', tones: ['low'] });
    await settle();
    const cap = sound.getState().caption;
    expect(cap?.source).toBe('caption');
    expect(cap?.thai).toBe('หมด');
    expect(speak).not.toHaveBeenCalled();
    sound.stop();
    await done;
    expect(sound.getState().caption).toBeNull();
  });

  it('shows the caption when a clip will not play', async () => {
    // no Web Audio and no <audio> element here, so the clip cannot play
    const done = sound.play({ ref: 'item:with-clip', thai: 'มี', tones: ['mid'] });
    await settle();
    expect(sound.getState().caption?.source).toBe('caption');
    expect(speak).not.toHaveBeenCalled();
    sound.stop();
    await done;
  });
});

describe('the voice fits the words', () => {
  it('reads the speaker from particles and the word for I', () => {
    expect(genderOfText('ผมเห็นด้วยกับคุณ')).toBe('m');
    expect(genderOfText('ขอโทษครับ ห้องน้ำ')).toBe('m');
    expect(genderOfText('ดิฉันมาจากอังกฤษ')).toBe('f');
    expect(genderOfText('ขอบคุณค่ะ')).toBe('f');
    expect(genderOfText('ค่าธรรมเนียม')).toBeNull();
    expect(genderOfText('คะแนน')).toBeNull();
    expect(genderOfText('ไปไหน')).toBeNull();
  });

  const sound = new AudioSound();
  const entry = {
    audio: { 'f1.normal': 'a/f1.ogg', 'm1.normal': 'a/m1.ogg', 'm2.normal': 'a/m2.ogg' },
    pitch: null,
    texts: new Set<string>(),
  };

  it('never has a woman say ผม, even when a screen asks for her voice', () => {
    for (let i = 0; i < 8; i++) expect(sound.pickClip(entry, { thai: 'ผมเห็นด้วยกับคุณ', tones: [] })?.voice).toMatch(/^m/);
    expect(sound.pickClip(entry, { thai: 'ผมเห็นด้วยกับคุณ', tones: [], voice: 'f1' })?.voice).toMatch(/^m/);
  });

  it('never has a man say ดิฉัน', () => {
    const f = { ...entry, audio: { 'f1.normal': 'a/f1.ogg', 'f2.normal': 'a/f2.ogg', 'm1.normal': 'a/m1.ogg' } };
    expect(sound.pickClip(f, { thai: 'ดิฉันมาจากอังกฤษ', tones: [], voice: 'm1' })?.voice).toMatch(/^f/);
  });

  it('still plays the only clip there is', () => {
    const one = { ...entry, audio: { 'f1.normal': 'a/f1.ogg' } };
    expect(sound.pickClip(one, { thai: 'ผมกินข้าว', tones: [] })?.voice).toBe('f1');
  });
});


describe('two-form lines', () => {
  const line = {
    id: 'example.chicken', thai: 'ผมกินไก่', roman: 'phǒm gin gài', speaker: 'you',
    forms: { m: { thai: 'ผมกินไก่', roman: 'phǒm gin gài' }, f: { thai: 'ฉันกินไก่', roman: 'chǎn gin gài' } },
    audio: { 'm1.normal': 'a/m1.ogg', 'm2.normal': 'a/m2.ogg', 'f1.normal': 'a/f1.ogg' },
  };
  const content = new Content({ items: [], letters: [], patterns: [], culture: [], lines: [line] });
  const sound = new AudioSound();
  sound.configure({ content, settings: defaultSettings('2026-10-09') });

  it('reads the woman\'s version in a woman\'s voice, even when a man\'s voice is asked for', () => {
    expect(sound.hasClip({ thai: 'ฉันกินไก่' })).toBe(true);
    const idx = (sound as unknown as { audioIndex(): { resolve(r: { thai: string }): unknown } }).audioIndex();
    const entry = idx.resolve({ thai: 'ฉันกินไก่' }) as Parameters<AudioSound['pickClip']>[0];
    expect(sound.pickClip(entry, { thai: 'ฉันกินไก่', tones: [], voice: 'm1' })?.voice).toBe('f1');
    for (let i = 0; i < 6; i++) expect(sound.pickClip(entry, { thai: 'ฉันกินไก่', tones: [] })?.voice).toBe('f1');
    for (let i = 0; i < 6; i++) expect(sound.pickClip(entry, { thai: 'ผมกินไก่', tones: [] })?.voice).toMatch(/^m/);
  });
});

describe('the audio cache', () => {
  it('has the same name in the app and the service worker', async () => {
    const { readFileSync } = await import('node:fs');
    const { AUDIO_CACHE } = await import('./AudioSound');
    expect(readFileSync('vite.config.ts', 'utf-8')).toContain(`cacheName: '${AUDIO_CACHE}'`);
  });
});
