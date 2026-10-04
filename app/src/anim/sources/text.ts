// Thai text rasterised with Noto Sans Thai Looped to an offscreen canvas, then
// sampled to a grid of dots.

export const THAI_FONT = '"Noto Sans Thai Looped", "Inter Variable", sans-serif';

const ready = new Map<string, Promise<void>>();
/** Resolves when the Thai font can draw `text` (or after a short timeout). */
export function fontReady(text: string, weight = 600): Promise<void> {
  const k = `${weight}|${text}`;
  let p = ready.get(k);
  if (!p) {
    const f = (document as Document & { fonts?: FontFaceSet }).fonts;
    p = f
      ? Promise.race([f.load(`${weight} 64px ${THAI_FONT}`, text).then(() => undefined), new Promise<void>((r) => setTimeout(r, 1500))]).catch(() => undefined)
      : Promise.resolve();
    ready.set(k, p);
  }
  return p;
}

/** Width / height of a line of text at a font size (CSS px). */
export function measureText(text: string, size: number, weight = 600): { w: number; h: number } {
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `${weight} ${size}px ${THAI_FONT}`;
  const m = c.measureText(text);
  const asc = m.actualBoundingBoxAscent || size * 0.9;
  const desc = m.actualBoundingBoxDescent || size * 0.3;
  return { w: Math.max(size * 0.5, m.width), h: Math.max(size, asc + desc) };
}

/**
 * Draw text centred into a cols x rows grid and return coverage 0..1 per cell
 * (row-major, top row first). `fill` is the share of the box the text may use.
 */
export function rasterText(text: string, cols: number, rows: number, weight = 600, fill = 0.86): Float32Array {
  const scale = 4;
  const W = cols * scale;
  const H = rows * scale;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  let size = H * 0.62;
  g.font = `${weight} ${size}px ${THAI_FONT}`;
  let m = g.measureText(text);
  const k = Math.min((W * fill) / Math.max(1, m.width), (H * fill) / Math.max(1, (m.actualBoundingBoxAscent || size) + (m.actualBoundingBoxDescent || size * 0.25)));
  size *= Math.min(k, 1.6);
  g.font = `${weight} ${size}px ${THAI_FONT}`;
  m = g.measureText(text);
  const asc = m.actualBoundingBoxAscent || size * 0.75;
  const desc = m.actualBoundingBoxDescent || size * 0.2;
  g.fillText(text, W / 2, H / 2 + (asc - desc) / 2);
  const px = g.getImageData(0, 0, W, H).data;
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let yy = 0; yy < scale; yy++)
        for (let xx = 0; xx < scale; xx++) s += px[((y * scale + yy) * W + x * scale + xx) * 4];
      out[y * cols + x] = s / (scale * scale * 255);
    }
  return out;
}

/** Text drawn white on black on a canvas, for use as a texture (signs). */
export function textCanvas(text: string, w: number, h: number, weight = 600): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = h * 0.66;
  g.font = `${weight} ${size}px ${THAI_FONT}`;
  const mw = g.measureText(text).width;
  if (mw > w * 0.88) size *= (w * 0.88) / mw;
  g.font = `${weight} ${size}px ${THAI_FONT}`;
  g.fillText(text, w / 2, h / 2 + size * 0.06);
  return cv;
}
