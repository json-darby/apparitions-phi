// PixiJS (v8) mounting helper for drills and the street game.

import { useEffect, useRef, useState } from 'react';
import { Application } from 'pixi.js';

/**
 * Mounts a Pixi application that fills its container and is destroyed on
 * unmount. setup runs once the app is ready; it may return a cleanup.
 */
export function usePixi(setup: (app: Application, host: HTMLDivElement) => void | (() => void), deps: unknown[] = []) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let cleanup: void | (() => void);
    const app = new Application();
    app
      .init({ resizeTo: el, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        el.appendChild(app.canvas);
        app.canvas.style.position = 'absolute';
        app.canvas.style.inset = '0';
        // resizeTo only reacts to window resizes; follow the host box itself too
        const ro = new ResizeObserver(() => {
          try {
            app.resize();
          } catch {
            /* destroyed */
          }
        });
        ro.observe(el);
        const user = setup(app, el);
        cleanup = () => {
          ro.disconnect();
          if (typeof user === 'function') user();
        };
        setReady(true);
      });
    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
      try {
        if (app.renderer) app.destroy(true, { children: true });
      } catch {
        /* already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { host, ready };
}

/** Thai-capable text style defaults for Pixi Text. */
export const THAI_FONT = "'Noto Sans Thai Looped', 'Inter Variable', sans-serif";
export const UI_FONT = "'Inter Variable', Inter, sans-serif";
