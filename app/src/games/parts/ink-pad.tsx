// Ink Run: a small drawing pad for finger or pen. (writing/Pad.tsx hands ink
// over after every stroke; a timed game wants the whole letter, so this pad
// waits until the pen has been up for a moment.) Strokes are handed over as
// Ink ({x, y, t}[][]) in the 100 x 100 stroke box the writing module uses
// (see writing/glyph.ts): the pad's square writing area maps to 0..100, with
// guide lines at the consonant top and the baseline. The ink is handed over
// once the pen has been up for a moment.

import { useEffect, useRef } from 'react';
import type { Ink, Point } from '../../writing/recognise';
import { GLYPH } from '../../writing/glyph';

const IDLE_MS = 650;

export function InkPad({ onInk, clearKey, disabled, label = 'Draw the letter' }: { onInk: (ink: Ink) => void; clearKey: number; disabled?: boolean; label?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onInkRef = useRef(onInk);
  onInkRef.current = onInk;
  const box = useRef({ sx: 0, sy: 0, side: 1, w: 1, h: 1 });

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { sx, sy, side, w, h } = box.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // guides: consonant top and baseline, as dotted hairlines
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const gy of [GLYPH.xHeight, GLYPH.baseline]) {
      const y = sy + (gy / 100) * side;
      for (let x = sx; x < sx + side; x += 7) ctx.fillRect(x, y, 2, 1);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f2f2f2';
    ctx.shadowColor = 'rgba(46,155,255,0.8)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = Math.max(5, side * 0.035);
    for (const s of strokes.current) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(sx + (s[0].x / 100) * side, sy + (s[0].y / 100) * side);
      if (s.length === 1) ctx.lineTo(sx + (s[0].x / 100) * side + 0.1, sy + (s[0].y / 100) * side);
      for (const p of s.slice(1)) ctx.lineTo(sx + (p.x / 100) * side, sy + (p.y / 100) * side);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  };

  // size the canvas to its box
  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const side = Math.max(1, Math.min(w, h) - 12);
      box.current = { sx: (w - side) / 2, sy: (h - side) / 2, side, w, h };
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // clear on request
  useEffect(() => {
    strokes.current = [];
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    redraw();
  }, [clearKey]);

  useEffect(() => () => {
    if (idle.current) clearTimeout(idle.current);
  }, []);

  const toBox = (e: React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect();
    const { sx, sy, side } = box.current;
    return { x: ((e.clientX - r.left - sx) / side) * 100, y: ((e.clientY - r.top - sy) / side) * 100, t: Math.round(e.timeStamp) };
  };

  const down = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    drawing.current = true;
    strokes.current.push([toBox(e)]);
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const s = strokes.current[strokes.current.length - 1];
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
    if (events.length) {
      const r = canvas.current!.getBoundingClientRect();
      const { sx, sy, side } = box.current;
      for (const ce of events) s.push({ x: ((ce.clientX - r.left - sx) / side) * 100, y: ((ce.clientY - r.top - sy) / side) * 100, t: Math.round(ce.timeStamp) });
    } else s.push(toBox(e));
    redraw();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      idle.current = null;
      const kept = strokes.current.filter((s) => s.length > 0);
      if (!kept.length) return;
      // t as ms since the first point of the attempt
      const t0 = kept[0][0].t ?? 0;
      onInkRef.current(kept.map((s) => s.map((p) => ({ x: p.x, y: p.y, t: (p.t ?? t0) - t0 }))));
    }, IDLE_MS);
  };

  return (
    <div
      ref={wrap}
      style={{
        position: 'relative', width: '100%', height: '100%', borderRadius: 8,
        border: '1px solid var(--rule-strong)', background: 'rgba(255,255,255,0.03)', touchAction: 'none',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div className="label" style={{ position: 'absolute', top: 10, left: 12, pointerEvents: 'none' }}>{label}</div>
      <canvas
        ref={canvas}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label={label}
        role="img"
      />
    </div>
  );
}
