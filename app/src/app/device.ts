// Three layout sizes: phone, tablet, desktop. Plus what input the device has.

import { useEffect, useState } from 'react';

export type Device = 'phone' | 'tablet' | 'desktop';

export function deviceFor(w: number, h: number): Device {
  if (w < 700) return 'phone';
  if (w < 1100 || (w < 1280 && h > w)) return 'tablet';
  return 'desktop';
}

export function useDevice(): { device: Device; touch: boolean; w: number; h: number } {
  const get = () => ({
    device: deviceFor(window.innerWidth, window.innerHeight),
    touch: matchMedia('(pointer: coarse)').matches,
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const [s, set] = useState(get);
  useEffect(() => {
    const on = () => set(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
