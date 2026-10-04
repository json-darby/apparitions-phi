// The writing pad: one square surface for finger, pen and mouse. Shared by the
// Writing studio, the stroke tool, Ink Run and Review's write cards.
//
//   import { Pad, type PadHandle } from '../writing/Pad';
//   const pad = useRef<PadHandle>(null);
//   <Pad ref={pad} guide="ก" ghost onInk={(ink) => ...} />
//   pad.current?.clear(); pad.current?.undo(); pad.current?.ink();
//
// Props (all optional):
//   onInk(ink)  called after every stroke ends, and after clear and undo, with
//               all strokes so far. Points are in the pad's 100 x 100 box
//               (x right, y down), with t in ms from the first point and p
//               (pressure 0..1) for pens. Pass the ink straight to
//               recognise() or handwritingScore().
//   onStart()   called when the first point of a fresh attempt lands
//   guide       a letter; drawn faintly behind the ink when ghost is on
//   ghost       show the guide letter (default true when guide is given)
//   size        side in CSS px; omit to fill the container's width
//   disabled    ignore input
//   overlay     model strokes drawn over the ink (e.g. to compare after an attempt)
//   marks       strokes whose start points get numbered dots
//   lines       writing lines (baseline, body top), default true
//   label       accessible name
//
// Palm rejection: while a pen is in use (seen in the last 2 s, hovering
// counts) touches are ignored, and a pen landing mid-touch replaces the touch
// stroke. Only one pointer draws at a time.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { StrokePath } from '../content/types';
import { GLYPH, glyphTextProps } from './glyph';
import { strokePoints } from './geometry';
import type { Ink, Point } from './recognise';
import './writing.css';

export interface PadHandle {
  clear(): void;
  undo(): void;
  ink(): Ink;
}

export interface PadProps {
  onInk?: (ink: Ink) => void;
  onStart?: () => void;
  guide?: string;
  ghost?: boolean;
  size?: number;
  disabled?: boolean;
  overlay?: StrokePath[] | null;
  marks?: StrokePath[] | null;
  lines?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const PEN_HOLD_MS = 2000;
const INK_WIDTH = 3.4; // in box units
const INK_COLOUR = '#f2f2f2';

const copyInk = (ink: Ink): Ink => ink.map((s) => s.map((p) => ({ ...p })));

export const Pad = forwardRef<PadHandle, PadProps>(function Pad(
  { onInk, onStart, guide, ghost, size, disabled, overlay, marks, lines = true, label, className = '', style },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Ink>([]);
  const active = useRef<{ id: number; type: string } | null>(null);
  const lastPen = useRef(-Infinity);
  const t0 = useRef(0);
  const cb = useRef({ onInk, onStart });
  cb.current = { onInk, onStart };

  const ctx = () => canvasRef.current?.getContext('2d') ?? null;

  const widthAt = (p: Point) => (p.p != null && p.p > 0 ? INK_WIDTH * (0.65 + 0.7 * p.p) : INK_WIDTH);

  const drawSegment = useCallback((a: Point, b: Point) => {
    const c = ctx();
    const cv = canvasRef.current;
    if (!c || !cv) return;
    const k = cv.width / 100;
    c.strokeStyle = INK_COLOUR;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = widthAt(b) * k;
    c.beginPath();
    c.moveTo(a.x * k, a.y * k);
    c.lineTo(b.x * k, b.y * k);
    c.stroke();
  }, []);

  const drawDot = useCallback((p: Point) => {
    const c = ctx();
    const cv = canvasRef.current;
    if (!c || !cv) return;
    const k = cv.width / 100;
    c.fillStyle = INK_COLOUR;
    c.beginPath();
    c.arc(p.x * k, p.y * k, (widthAt(p) * k) / 2, 0, Math.PI * 2);
    c.fill();
  }, []);

  const redraw = useCallback(() => {
    const c = ctx();
    const cv = canvasRef.current;
    if (!c || !cv) return;
    c.clearRect(0, 0, cv.width, cv.height);
    for (const s of strokes.current) {
      if (s.length === 1) drawDot(s[0]);
      for (let i = 1; i < s.length; i++) drawSegment(s[i - 1], s[i]);
    }
  }, [drawDot, drawSegment]);

  // keep the canvas backing store at device resolution
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const fit = () => {
      const r = cv.getBoundingClientRect();
      const px = Math.max(1, Math.round(r.width * (window.devicePixelRatio || 1)));
      if (cv.width !== px || cv.height !== px) {
        cv.width = px;
        cv.height = px;
        redraw();
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [redraw]);

  const emit = () => cb.current.onInk?.(copyInk(strokes.current));

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        strokes.current = [];
        active.current = null;
        redraw();
        emit();
      },
      undo() {
        strokes.current.pop();
        active.current = null;
        redraw();
        emit();
      },
      ink: () => copyInk(strokes.current),
    }),
    [redraw],
  );

  const toPoint = (e: PointerEvent | React.PointerEvent, rect: DOMRect): Point => {
    const p: Point = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      t: Math.round(performance.now() - t0.current),
    };
    if (e.pointerType === 'pen' && e.pressure > 0) p.p = Math.round(e.pressure * 100) / 100;
    return p;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const now = performance.now();
    if (e.pointerType === 'pen') lastPen.current = now;
    if (e.pointerType === 'touch' && now - lastPen.current < PEN_HOLD_MS) return;
    if (active.current) {
      // a pen landing while a palm is down takes over; anything else waits
      if (!(e.pointerType === 'pen' && active.current.type === 'touch')) return;
      strokes.current.pop();
      redraw();
    }
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer may already be gone; drawing still works without capture
    }
    if (!strokes.current.length) {
      t0.current = now;
      cb.current.onStart?.();
    }
    active.current = { id: e.pointerId, type: e.pointerType };
    const p = toPoint(e, e.currentTarget.getBoundingClientRect());
    strokes.current.push([p]);
    drawDot(p);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') lastPen.current = performance.now();
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const s = strokes.current[strokes.current.length - 1];
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length ? events : [e.nativeEvent];
    for (const ev of list) {
      const p = toPoint(ev, rect);
      const last = s[s.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.25) continue;
      s.push(p);
      drawSegment(last, p);
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') lastPen.current = performance.now();
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // not captured
    }
    emit();
  };

  const showGhost = !!guide && ghost !== false;
  const box = size ? { width: size, height: size } : undefined;

  return (
    <div className={`pad ${disabled ? 'pad-off' : ''} ${className}`} style={{ ...box, ...style }}>
      <svg className="pad-under" viewBox="0 0 100 100" aria-hidden>
        {lines && (
          <g className="pad-lines">
            <line x1="4" x2="96" y1={GLYPH.baseline} y2={GLYPH.baseline} />
            <line x1="4" x2="96" y1={GLYPH.xHeight} y2={GLYPH.xHeight} className="dash" />
            <line x1="4" x2="96" y1={(GLYPH.baseline + GLYPH.xHeight) / 2} y2={(GLYPH.baseline + GLYPH.xHeight) / 2} className="dash faint" />
          </g>
        )}
        {showGhost && (
          <text {...glyphTextProps()} className="pad-ghost" lang="th">
            {guide}
          </text>
        )}
      </svg>
      <canvas
        ref={canvasRef}
        className="pad-ink"
        role="img"
        aria-label={label ?? (guide ? `Writing pad for ${guide}` : 'Writing pad')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!!(overlay?.length || marks?.length) && (
        <svg className="pad-over" viewBox="0 0 100 100" aria-hidden>
          {overlay?.map((s, i) => (
            <path key={i} d={s.d} className="pad-model" />
          ))}
          {marks && <StartMarks strokes={marks} />}
        </svg>
      )}
    </div>
  );
});

/** Numbered dots at each stroke's start, with a short tick showing the way the pen goes. */
export function StartMarks({ strokes, r = 3.6 }: { strokes: StrokePath[]; r?: number }) {
  return (
    <g className="start-marks">
      {strokes.map((s, i) => {
        const pts = strokePoints(s.d);
        if (!pts.length) return null;
        const a = pts[0];
        // a point a little way along, for the direction tick
        let b = pts[Math.min(pts.length - 1, 1)];
        for (const p of pts) {
          if (Math.hypot(p.x - a.x, p.y - a.y) > r * 2.2) {
            b = p;
            break;
          }
        }
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const tx = a.x + Math.cos(ang) * r * 2;
        const ty = a.y + Math.sin(ang) * r * 2;
        return (
          <g key={i}>
            <line x1={a.x + Math.cos(ang) * r} y1={a.y + Math.sin(ang) * r} x2={tx} y2={ty} className="start-tick" />
            <circle cx={a.x} cy={a.y} r={r} className="start-dot" />
            <text x={a.x} y={a.y + r * 0.42} className="start-num" fontSize={r * 1.25} textAnchor="middle">
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}
