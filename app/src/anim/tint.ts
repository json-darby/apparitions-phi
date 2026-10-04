// The learner's face colour: every face drawn in their own colour (the
// default), or all in one chosen colour. Set from Settings, or by
// double-tapping a face, which steps to the next colour. The draw code reads
// it at draw time through tinted().

import { useSyncExternalStore } from 'react';

export const FACE_COLOURS = [
  { id: 'own', label: 'Their own', hex: null },
  { id: 'amber', label: 'Amber', hex: '#F4B860' },
  { id: 'jade', label: 'Jade', hex: '#5FE0A8' },
  { id: 'sky', label: 'Sky', hex: '#72C2FF' },
  { id: 'lilac', label: 'Lilac', hex: '#B9A0FF' },
  { id: 'rose', label: 'Rose', hex: '#FF8FB1' },
  { id: 'moon', label: 'Moonlight', hex: '#E8E8E8' },
] as const;

export type FaceColour = (typeof FACE_COLOURS)[number]['id'];

let current: FaceColour = 'own';
const subs = new Set<() => void>();

export function faceColourHex(id: FaceColour): string | null {
  return FACE_COLOURS.find((c) => c.id === id)?.hex ?? null;
}

export function faceColourLabel(id: FaceColour): string {
  return FACE_COLOURS.find((c) => c.id === id)?.label ?? 'Their own';
}

export function setFaceTint(id: FaceColour | undefined) {
  const next = FACE_COLOURS.some((c) => c.id === id) ? (id as FaceColour) : 'own';
  if (next === current) return;
  current = next;
  for (const fn of subs) fn();
}

export function faceTint(): FaceColour {
  return current;
}

/** The colour a face is drawn in: the chosen colour, or its own. */
export function tinted(own: string): string {
  return faceColourHex(current) ?? own;
}

/** Re-render when the face colour changes. */
export function useFaceTint(): FaceColour {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => current,
  );
}

/** The next colour after `id` that looks different on a face whose own colour is `own`. */
export function nextFaceColour(id: FaceColour, own: string): FaceColour {
  const at = FACE_COLOURS.findIndex((c) => c.id === id);
  const shown = (c: (typeof FACE_COLOURS)[number]) => (c.hex ?? own).toLowerCase();
  const now = shown(FACE_COLOURS[Math.max(0, at)]);
  for (let k = 1; k <= FACE_COLOURS.length; k++) {
    const c = FACE_COLOURS[(Math.max(0, at) + k) % FACE_COLOURS.length];
    if (shown(c) !== now) return c.id;
  }
  return id;
}
