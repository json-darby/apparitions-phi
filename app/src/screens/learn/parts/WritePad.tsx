// A small writing pad. Collects ink as strokes of points in a 100 x 100 box,
// the shape the handwriting module reads.

import { useEffect, useRef, useState } from 'react';
import type { Ink, Point } from '../../../writing/recognise';

export function WritePad({ size = 240, onInk, disabled }: { size?: number; onInk: (ink: Ink) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ink = useRef<Ink>([]);
  const drawing = useRef<Point[] | null>(null);
  const [empty, setEmpty] = useState(true);

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const px = size * dpr;
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.setLineDash([3, 5]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, size / 2);
    g.lineTo(size, size / 2);
    g.moveTo(size / 2, 0);
    g.lineTo(size / 2, size);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = Math.max(3, size / 40);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of ink.current) {
      g.beginPath();
      s.forEach((p, i) => {
        const x = (p.x / 100) * size;
        const y = (p.y / 100) * size;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      if (s.length === 1) g.lineTo((s[0].x / 100) * size + 0.1, (s[0].y / 100) * size);
      g.stroke();
    }
  };

  useEffect(redraw);

  const at = (e: React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, t: performance.now() };
  };

  // one square: the stroke count and Clear sit inside it, so the pad is the whole box
  return (
    <div className="write-pad-box" style={{ width: size, maxWidth: '100%', aspectRatio: '1 / 1' }}>
      <canvas
        ref={canvas}
        className="write-pad"
        style={{ width: '100%', height: '100%', touchAction: 'none' }}
        aria-label="Writing pad"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drawing.current = [at(e)];
          ink.current = [...ink.current, drawing.current];
          setEmpty(false);
          redraw();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          drawing.current.push(at(e));
          redraw();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = null;
          onInk(ink.current.map((s) => s.slice()));
        }}
        onPointerCancel={() => {
          drawing.current = null;
        }}
      />
      <div className="write-pad-bar">
        <span className="small num">{empty ? 'Write with a finger, pen or mouse' : `${ink.current.length} stroke${ink.current.length === 1 ? '' : 's'}`}</span>
        <button
          type="button"
          className="pill small"
          disabled={empty || disabled}
          onClick={() => {
            ink.current = [];
            setEmpty(true);
            onInk([]);
            redraw();
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
