// Hit burst for drills: dots burst from a correct answer and are pulled back in
// on a miss. A plain 2D canvas; the loop only runs while dots are alive.

import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { hexToRgb } from './core/math';
import { useReducedMotionSafe } from './DotCanvas';

export interface HitBurstHandle {
  /** dots burst from a correct answer at (x, y) in layer pixels */
  burst(x: number, y: number, colour?: string): void;
  /** dots pulled back in on a miss */
  pull(x: number, y: number, colour?: string): void;
}

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  r: number;
  c: string;
  kind: 0 | 1 | 2; // burst, pull, still ring
  tx: number;
  ty: number;
}

const MAX = 600;

export const HitBurstLayer = forwardRef<HitBurstHandle, { style?: CSSProperties }>(function HitBurstLayer({ style }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const dots = useRef<Dot[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  const rm = useReducedMotionSafe();
  const rmRef = useRef(rm);
  rmRef.current = rm;

  const tick = (now: number) => {
    raf.current = 0;
    const el = cv.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dt = Math.min(0.05, last.current ? (now - last.current) / 1000 : 0.016);
    last.current = now;
    const dpr = el.width / Math.max(1, el.clientWidth);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const live: Dot[] = [];
    for (const d of dots.current) {
      d.age += dt;
      if (d.age >= d.life) continue;
      const k = d.age / d.life;
      if (d.kind === 0) {
        d.vx *= Math.exp(-dt * 3.2);
        d.vy = d.vy * Math.exp(-dt * 3.2) + 60 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      } else if (d.kind === 1) {
        const e = k * k;
        d.x = d.x + (d.tx - d.x) * Math.min(1, e * 0.5 + dt * 6);
        d.y = d.y + (d.ty - d.y) * Math.min(1, e * 0.5 + dt * 6);
      }
      const a = d.kind === 1 ? Math.sin(Math.PI * k) : 1 - k;
      ctx.fillStyle = d.c;
      ctx.globalAlpha = a * 0.25;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      live.push(d);
    }
    ctx.globalAlpha = 1;
    dots.current = live;
    if (live.length) raf.current = requestAnimationFrame(tick);
    else last.current = 0;
  };

  const start = () => {
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      el.width = Math.max(1, Math.round(el.clientWidth * dpr));
      el.height = Math.max(1, Math.round(el.clientHeight * dpr));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      dots.current = [];
    };
  }, []);

  useImperativeHandle(
    ref,
    () => {
      const col = (c: string | undefined, d: string) => {
        const [r, g, b] = hexToRgb(c ?? d).map((v) => Math.round(v * 255));
        return `rgb(${r},${g},${b})`;
      };
      const add = (list: Dot[]) => {
        dots.current = dots.current.concat(list).slice(-MAX);
        start();
      };
      return {
        burst(x, y, colour) {
          const c = col(colour, '#E8E8E8');
          const list: Dot[] = [];
          if (rmRef.current) {
            for (let i = 0; i < 20; i++) {
              const a = (i / 20) * Math.PI * 2;
              list.push({ x: x + Math.cos(a) * 34, y: y + Math.sin(a) * 34, vx: 0, vy: 0, life: 0.45, age: 0, r: 2, c, kind: 2, tx: x, ty: y });
            }
          } else
            for (let i = 0; i < 72; i++) {
              const a = Math.random() * Math.PI * 2;
              const s = 160 + Math.random() * 420;
              list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.55 + Math.random() * 0.4, age: 0, r: 1.4 + Math.random() * 1.8, c, kind: 0, tx: x, ty: y });
            }
          add(list);
        },
        pull(x, y, colour) {
          const c = col(colour, '#FF5A4F');
          const list: Dot[] = [];
          const n = rmRef.current ? 16 : 54;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
            const r = rmRef.current ? 30 : 70 + Math.random() * 60;
            list.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: 0, vy: 0, life: rmRef.current ? 0.4 : 0.5 + Math.random() * 0.2, age: 0, r: 1.3 + Math.random() * 1.4, c, kind: rmRef.current ? 2 : 1, tx: x, ty: y });
          }
          add(list);
        },
      };
    },
    [],
  );

  return <canvas ref={cv} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', ...style }} />;
});
