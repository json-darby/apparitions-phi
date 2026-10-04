// Row-tear wipe for screen changes. Wrap the routed screen:
//   <RowTearWipe routeKey={path}>{screen}</RowTearWipe>
// When routeKey changes, a snapshot of the outgoing screen (a DOM clone taken
// just before React swaps it, with canvases copied) is cut into horizontal
// rows that tear sideways and fade, revealing the new screen underneath.
// About 0.4 s, transforms and opacity only, removed as soon as it ends or on
// any tap or key. Reduced motion: no effect. Very large screens: fewer rows.
// Layout: the wrapper is display: contents, so it adds no box.

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useReducedMotionSafe } from './DotCanvas';
import { hash1 } from './core/math';

interface Shot {
  key: string;
  clone: HTMLElement;
  canvases: HTMLCanvasElement[];
  rect: DOMRect;
  scrollTop: number;
  mainClass: string;
  rows: number;
}

export function RowTearWipe({ routeKey, children, duration = 380 }: { routeKey: string; children: ReactNode; duration?: number }) {
  const live = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const keyRef = useRef(routeKey);
  const shot = useRef<Shot | null>(null);
  const rm = useReducedMotionSafe();

  // Capture during render: the DOM still holds the outgoing screen here.
  if (routeKey !== keyRef.current && !rm && live.current && shot.current?.key !== routeKey) {
    const el = live.current;
    const parent = el.parentElement;
    const count = el.getElementsByTagName('*').length;
    if (parent && count > 0 && count < 5000) {
      shot.current = {
        key: routeKey,
        clone: el.cloneNode(true) as HTMLElement,
        canvases: Array.from(el.querySelectorAll('canvas')),
        rect: parent.getBoundingClientRect(),
        scrollTop: parent.scrollTop,
        mainClass: parent.className,
        rows: count < 1500 ? (parent.clientWidth < 700 ? 6 : 8) : 4,
      };
    }
  }

  useLayoutEffect(() => {
    if (keyRef.current === routeKey) return;
    keyRef.current = routeKey;
    const s = shot.current;
    shot.current = null;
    const h = host.current;
    if (!s || s.key !== routeKey || !h || rm) return;
    return runTear(h, s, duration);
  }, [routeKey, rm, duration]);

  return (
    <div ref={live} style={{ display: 'contents' }}>
      {children}
      <div ref={host} aria-hidden data-row-tear="" style={{ display: 'contents' }} />
    </div>
  );
}

function runTear(host: HTMLElement, s: Shot, duration: number): () => void {
  const { rect, rows } = s;
  if (rect.width < 2 || rect.height < 2) return () => {};
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  Object.assign(layer.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: '50', pointerEvents: 'none', overflow: 'hidden' });
  // the clone itself is excluded from the snapshot (host lives inside live)
  s.clone.querySelectorAll('[data-row-tear]').forEach((n) => n.remove());
  s.clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  const rowH = rect.height / rows;
  const anims: Animation[] = [];
  for (let i = 0; i < rows; i++) {
    const strip = document.createElement('div');
    Object.assign(strip.style, { position: 'absolute', left: '0', top: `${i * rowH}px`, width: '100%', height: `${Math.ceil(rowH) + 1}px`, overflow: 'hidden', background: 'var(--bg, #050505)', willChange: 'transform, opacity' });
    const frame = document.createElement('div');
    frame.className = s.mainClass;
    Object.assign(frame.style, { position: 'absolute', left: '0', top: `${-i * rowH - s.scrollTop}px`, width: `${rect.width}px`, height: `${rect.height + s.scrollTop}px`, overflow: 'visible', margin: '0' });
    const c = i === 0 ? s.clone : (s.clone.cloneNode(true) as HTMLElement);
    // copy what the dot canvases were showing
    const cs = c.querySelectorAll('canvas');
    cs.forEach((cc, k) => {
      const src = s.canvases[k];
      if (!src || !src.width) return;
      cc.width = src.width;
      cc.height = src.height;
      try {
        cc.getContext('2d')?.drawImage(src, 0, 0);
      } catch {
        /* tainted or lost */
      }
    });
    frame.appendChild(c);
    strip.appendChild(frame);
    const edge = document.createElement('div');
    Object.assign(edge.style, { position: 'absolute', left: '0', right: '0', top: '0', height: '1px', background: 'var(--accent, #2E9BFF)', opacity: '0.0' });
    strip.appendChild(edge);
    layer.appendChild(strip);
    const dir = hash1(i * 7.3 + rect.width) > 0.5 ? 1 : -1;
    const dist = 25 + 85 * hash1(i * 3.1 + 0.7);
    const delay = i * (duration * 0.06) + hash1(i * 1.9) * duration * 0.12;
    anims.push(
      strip.animate(
        [
          { transform: 'translateX(0)', opacity: 1 },
          { transform: `translateX(${dir * dist * 0.12}%)`, opacity: 1, offset: 0.25 },
          { transform: `translateX(${dir * dist}%)`, opacity: 0 },
        ],
        { duration, delay, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'both' },
      ),
    );
    anims.push(edge.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0 }], { duration: duration * 0.7, delay, fill: 'both' }));
  }
  host.appendChild(layer);
  let gone = false;
  const end = () => {
    if (gone) return;
    gone = true;
    for (const a of anims) a.cancel();
    layer.remove();
    window.removeEventListener('pointerdown', end, true);
    window.removeEventListener('keydown', end, true);
  };
  window.addEventListener('pointerdown', end, true);
  window.addEventListener('keydown', end, true);
  const total = duration + rows * duration * 0.06 + duration * 0.12 + 40;
  const timer = window.setTimeout(end, total);
  return () => {
    clearTimeout(timer);
    end();
  };
}
