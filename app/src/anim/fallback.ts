// Still dotted images drawn with the 2D canvas, for browsers with no WebGL.
// Rare, so these are simple: a soft silhouette or the text, sampled to dots.

import { hexToRgb } from './core/math';

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** Draw `shape` in white on a small canvas, then redraw it as glowing dots. */
export function paintDots(ctx: CanvasRenderingContext2D, w: number, h: number, colour: string, shape: Painter, pitchPx = 7) {
  const cols = Math.max(8, Math.floor(w / pitchPx));
  const rows = Math.max(8, Math.floor(h / pitchPx));
  const src = document.createElement('canvas');
  src.width = cols;
  src.height = rows;
  const g = src.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, cols, rows);
  shape(g, cols, rows);
  const px = g.getImageData(0, 0, cols, rows).data;
  const [r, gg, b] = hexToRgb(colour).map((v) => Math.round(v * 255));
  ctx.clearRect(0, 0, w, h);
  const sx = w / cols;
  const sy = h / rows;
  const rad = Math.min(sx, sy) * 0.36;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const l = px[(y * cols + x) * 4] / 255;
      if (l < 0.08) continue;
      if (((x * 73856093) ^ (y * 19349663)) % 100 > l * 120) continue;
      ctx.fillStyle = `rgba(${r},${gg},${b},${(0.35 + 0.65 * l).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc((x + 0.5) * sx, (y + 0.5) * sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
}

export const headShape: Painter = (g, w, h) => {
  const s = Math.min(w, h);
  const cx = w / 2;
  const grad = g.createRadialGradient(cx - s * 0.08, h * 0.36, s * 0.02, cx, h * 0.42, s * 0.36);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(1, '#333');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(cx, h * 0.42, s * 0.25, s * 0.32, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#444';
  g.beginPath();
  g.ellipse(cx, h * 1.02, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#000';
  for (const dx of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + dx * s * 0.1, h * 0.4, s * 0.045, s * 0.022, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(cx - s * 0.07, h * 0.56, s * 0.14, s * 0.012);
};

export function textShape(text: string): Painter {
  return (g, w, h) => {
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h * 0.6;
    g.font = `600 ${size}px "Noto Sans Thai Looped", sans-serif`;
    const mw = g.measureText(text).width;
    if (mw > w * 0.9) size *= (w * 0.9) / mw;
    g.font = `600 ${size}px "Noto Sans Thai Looped", sans-serif`;
    g.fillText(text, w / 2, h / 2);
  };
}

export const blobShape: Painter = (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, Math.min(w, h) * 0.4);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};
