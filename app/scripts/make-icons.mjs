// Draws the app icon (PHI in glowing dots on near-black) as PNGs, no dependencies.
// Run: node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const GLYPHS = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size) {
  const px = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) px.set([5 / 255, 5 / 255, 5 / 255], i * 3);
  const word = 'PHI';
  const cols = word.length * 5 + (word.length - 1) * 2;
  const cell = (size * 0.7) / cols;
  const x0 = (size - cols * cell) / 2;
  const y0 = (size - 7 * cell) / 2;
  const dots = [];
  word.split('').forEach((ch, wi) => {
    GLYPHS[ch].forEach((row, ry) =>
      row.split('').forEach((b, rx) => {
        if (b === '1') dots.push([x0 + (wi * 7 + rx + 0.5) * cell, y0 + (ry + 0.5) * cell]);
      }),
    );
  });
  const r = cell * 0.36;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [cx, cy] of dots) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        v += Math.max(0, Math.min(1, r - d + 0.5)) + Math.exp(-((d / (cell * 0.9)) ** 2)) * 0.18;
      }
      v = Math.min(1, v);
      const i = (y * size + x) * 3;
      // blue glow into white core
      px[i] = Math.min(1, px[i] + v * (0.75 + 0.25 * v));
      px[i + 1] = Math.min(1, px[i + 1] + v * (0.85 + 0.15 * v));
      px[i + 2] = Math.min(1, px[i + 2] + v);
    }
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size * 3; x++) raw[y * (size * 3 + 1) + 1 + x] = Math.round(px[y * size * 3 + x] * 255);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) writeFileSync(new URL(`../public/icons/icon-${s}.png`, import.meta.url), icon(s));
console.log('icons written');
