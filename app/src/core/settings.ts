// Learner settings. Stored in the kv table under "settings".

import type { Identity } from '../content/repo';
import type { Speed, VoiceId } from '../content/types';
import type { FaceColour } from '../anim/tint';

export interface Settings {
  onboarded: boolean;
  /** the "How Thai works" primer was finished or skipped */
  primerDone: boolean;
  /** speaking identity: male or female forms for the learner's own speech */
  identity: Identity;
  /** daily track */
  minutes: 30 | 60;
  /** course length: 30 days, or 60 days that go further */
  courseDays: 30 | 60;
  /** local date of day 1 */
  startDate: string;
  /** local date of the trip; reviews are never scheduled past it */
  tripDate: string | null;
  /** 18+ content (After Hours, nightlife items) */
  adult: boolean;
  reducedMotion: 'auto' | 'on' | 'off';
  /** romanisation fades per item as it gets stronger */
  romanFade: boolean;
  /** review ratings: three plain buttons, all six, or three for the first 14 days and six after ('auto') */
  ratings: 'auto' | 'simple' | 'detailed';
  /** drills on desktop, or Learn and The Street only */
  desktopDrills: boolean;
  /** learner's display name in The Street */
  name: string;
  /** sound: real audio where clips exist ('auto'), or silent captions only */
  sound: 'auto' | 'captions';
  /** speed when a screen does not ask for one */
  speed: Speed;
  /** the voice that models "your" speech (record sheet, hearing practice); auto follows identity */
  myVoice: VoiceId | 'auto';
  /** go full screen (no address bar) on the first tap after the app opens */
  fullscreen: boolean;
  /** learner's mid-tone pitch in Hz from the microphone check; null = not calibrated */
  voiceMidHz: number | null;
  /** faces drawn in their own colours, or all in one chosen colour (double-tap a face to change it) */
  faceColour: FaceColour;
}

/** The voice that models the learner's own speech. */
export function myVoiceFor(s: Pick<Settings, 'myVoice' | 'identity'>): VoiceId {
  return s.myVoice && s.myVoice !== 'auto' ? s.myVoice : s.identity === 'f' ? 'f1' : 'm1';
}

export function defaultSettings(today: string): Settings {
  return {
    onboarded: false,
    primerDone: false,
    identity: 'm',
    minutes: 60,
    courseDays: 60,
    startDate: today,
    tripDate: null,
    adult: false,
    reducedMotion: 'auto',
    romanFade: true,
    ratings: 'auto',
    desktopDrills: true,
    name: '',
    sound: 'auto',
    speed: 'normal',
    myVoice: 'auto',
    fullscreen: false,
    voiceMidHz: null,
    faceColour: 'own',
  };
}
