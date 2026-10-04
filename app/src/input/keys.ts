// The input layer for keyboards. Number keys 1 to 6 rate a card, WASD or arrows
// walk, E talks, space plays audio. Screens register what they need; typing in
// a field never triggers shortcuts.

import { useEffect, useRef } from 'react';

export type KeyAction =
  | { type: 'rate'; n: number }
  | { type: 'move'; dx: number; dy: number; down: boolean }
  | { type: 'talk' }
  | { type: 'play' }
  | { type: 'confirm' }
  | { type: 'back' }
  | { type: 'key'; key: string; down: boolean };

export function keyAction(e: KeyboardEvent, down: boolean): KeyAction | null {
  const k = e.key;
  const lower = k.toLowerCase();
  if (down && /^[1-6]$/.test(k)) return { type: 'rate', n: Number(k) };
  const moves: Record<string, [number, number]> = {
    w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0],
    arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0],
  };
  if (moves[lower]) return { type: 'move', dx: moves[lower][0], dy: moves[lower][1], down };
  if (down && lower === 'e') return { type: 'talk' };
  if (down && k === ' ') return { type: 'play' };
  if (down && k === 'Enter') return { type: 'confirm' };
  if (down && k === 'Escape') return { type: 'back' };
  return { type: 'key', key: k, down };
}

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Subscribe to keyboard actions while the component is mounted. Return true to prevent default. */
export function useKeys(handler: (a: KeyAction, e: KeyboardEvent) => boolean | void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const on = (down: boolean) => (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (down && e.repeat && !/^(w|a|s|d|arrow)/i.test(e.key)) return;
      const a = keyAction(e, down);
      if (a && ref.current(a, e)) e.preventDefault();
    };
    const d = on(true);
    const u = on(false);
    window.addEventListener('keydown', d);
    window.addEventListener('keyup', u);
    return () => {
      window.removeEventListener('keydown', d);
      window.removeEventListener('keyup', u);
    };
  }, [enabled]);
}
