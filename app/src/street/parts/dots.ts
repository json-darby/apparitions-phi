// Helpers for The Street: the standing figure the cast are drawn from (as dots,
// by the street renderer), and a seeded random source.

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Is (x, y) inside a standing figure of height h? y runs from -h (top) to 0 (feet). */
export function inside(x: number, y: number, h: number, build: number): boolean {
  const u = h / 250;
  const ax = Math.abs(x) / u;
  const yy = (y + h) / u; // 0 at the top of the head
  if (yy < 0 || yy > 250) return false;
  // head
  const hx = x / u;
  const hy = yy - 24;
  if (hx * hx + hy * hy * 0.8 < 21 * 21) return true;
  // neck
  if (yy >= 42 && yy < 54) return ax < 8;
  // torso, shoulders to hips
  if (yy >= 54 && yy < 140) {
    const t = (yy - 54) / 86;
    const half = (34 - 9 * t) * build;
    if (ax < half) return true;
    // arms, hanging a little apart
    if (yy < 150 && ax >= half + 1 && ax < half + 10 - t * 2) return true;
    return false;
  }
  // arms past the hip
  if (yy >= 140 && yy < 152) return ax > 26 * build && ax < 34 * build;
  // legs
  if (yy >= 140) {
    const t = (yy - 140) / 110;
    return ax > 2 + t * 1 && ax < (17 - t * 6) * build;
  }
  return false;
}

/**
 * A standing figure as a texture for the street's dot renderer: grey brightness
 * (lit from above, a little from the shop side), alpha = the outline. The
 * figure fills the canvas from crown (top) to soles (bottom), 0.4 wide.
 */
export function figureCanvas(build = 1, rows = 200): HTMLCanvasElement {
  const H = rows;
  const W = Math.round(rows * 0.4);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const im = g.createImageData(W, H);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const x = ((px + 0.5) / W - 0.5) * 100;
      const y = ((py + 0.5) / H - 1) * 250;
      if (!inside(x, y, 250, build)) continue;
      const k = (py * W + px) * 4;
      const l = 0.5 + 0.38 * (1 - (py + 0.5) / H) + 0.1 * (x / 50);
      im.data[k] = im.data[k + 1] = im.data[k + 2] = Math.round(255 * Math.max(0, Math.min(1, l)));
      im.data[k + 3] = 255;
    }
  g.putImageData(im, 0, 0);
  return cv;
}
