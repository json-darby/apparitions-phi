// The React side of the dot engine: a sized box with a 2D canvas that the
// shared engine draws into. Fills its parent by default; size it with style or
// className. No WebGL: the scene paints a still with the 2D canvas instead.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type React from 'react';
import { getEngine, type DotScene, type Inst } from './gl/engine';
import { useApp } from '../app/context';

/** App reduced-motion setting, or the OS setting when outside the app shell. */
export function useReducedMotionSafe(): boolean {
  let rm = false;
  try {
    // useApp is a plain useContext + throw, so the hook order is stable
    rm = useApp().reducedMotion;
  } catch {
    rm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return rm;
}

export interface DotCanvasProps {
  scene: DotScene;
  still: boolean;
  label: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** bump to restart the scene clock */
  cue?: unknown;
  /** a double tap or double click on the drawing */
  onDoubleTap?: () => void;
}

export function DotCanvas({ scene, still, label, className, style, children, cue, onDoubleTap }: DotCanvasProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Inst | null>(null);
  const [noGL, setNoGL] = useState(false);

  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const eng = getEngine();
    if (!eng) {
      setNoGL(true);
      return;
    }
    const i = eng.add(el, scene);
    i.still = still;
    inst.current = i;
    return () => {
      inst.current = null;
      eng.remove(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => {
    inst.current?.setStill(still);
  }, [still]);

  // props changed: draw again (cheap for still scenes, a no-op for animating ones)
  useEffect(() => {
    inst.current?.invalidate();
  });

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    inst.current?.restart();
  }, [cue]);

  // 2D still when WebGL is missing
  useEffect(() => {
    if (!noGL) return;
    const el = cv.current;
    if (!el) return;
    const paint = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      const ctx = el.getContext('2d');
      if (ctx && scene.paint2D) scene.paint2D(ctx, el.width, el.height);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    return () => ro.disconnect();
  }, [noGL, scene]);

  // two taps within 350 ms and 40 px; works the same for touch, pen and mouse
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tap = onDoubleTap
    ? (e: React.PointerEvent) => {
        if (e.button > 0) return;
        const now = performance.now();
        const l = lastTap.current;
        if (l && now - l.t < 350 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 40) {
          lastTap.current = null;
          onDoubleTap();
        } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      }
    : undefined;

  return (
    <div className={className} role="img" aria-label={label} onPointerUp={tap} style={{ position: 'relative', ...(onDoubleTap ? { touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none' } : null), ...style }}>
      <canvas ref={cv} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      {children}
    </div>
  );
}
