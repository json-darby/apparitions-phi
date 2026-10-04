// Every sound comes from the course's own clips. A line with no clip, or a
// clip that will not play, shows as a caption; the device's built-in voice is
// never used, even when the device has a Thai one.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { Content } from '../content/repo';
import { emptyMedia, type Item } from '../content/types';
import { defaultSettings } from '../core/settings';
import { AudioSound } from './AudioSound';

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
