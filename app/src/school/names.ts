// School of the Night's names, in one place so they are easy to change.

export const SCHOOL = {
  name: 'School of the Night',
  thai: 'โรงเรียนกลางคืน',
  roman: 'roong-rian klaang-khʉʉn',
} as const;

/** The tutor: a new character, separate from the street cast (Nok is the food-stall vendor). */
export const TUTOR = {
  name: 'Khru Dao',
  thai: 'ครูดาว',
} as const;

/**
 * The voice setup (plan: "Voice setup and the accent test").
 *  A  the live model speaks the English too, in a Thai accent
 *  B  the live model speaks Thai only; English is on screen, optionally read by the phone's voice
 * B until the accent test says otherwise. A is one prompt away: change this.
 */
export type VoiceSetup = 'A' | 'B';
export const VOICE_SETUP: VoiceSetup = 'B';

/** The feature's accent colour (the --violet token in global.css). */
export const ACCENT = 'var(--violet)';
