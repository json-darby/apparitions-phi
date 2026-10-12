// Lock the owner's study page into the Tapes pack, kept out of the repo:
//   TAPES_PASSWORD=... node scripts/tapes-seal.ts <path to study index.html>
// With TAPES_PITCH_FILE=<path to { "unit.index": contours } JSON> the speakers'
// measured pitch goes into the phrases too, and with TAPES_MELODY_FILE=<path to
// { "unit.index": 48 points } JSON> their whole-phrase melody lines.
// writes private/tapes-1.dat (gitignored). `npm run build` copies it into dist.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMelody, mergePitch, parsePack } from '../src/tapes/pack.ts';
import { dataUrlBytes, packBody, seal } from '../src/tapes/sealed.ts';

const src = process.argv[2];
const password = process.env.TAPES_PASSWORD;
if (!src || !password) {
  console.error('usage: TAPES_PASSWORD=... node scripts/tapes-seal.ts <study index.html>');
  process.exit(1);
}
const { pack, clips } = parsePack(readFileSync(src, 'utf8'));
const pitchFile = process.env.TAPES_PITCH_FILE;
if (pitchFile) {
  const added = mergePitch(pack, JSON.parse(readFileSync(pitchFile, 'utf8')) as Record<string, unknown>);
  console.log(`pitch for ${added} phrases from ${pitchFile}`);
}
const melodyFile = process.env.TAPES_MELODY_FILE;
if (melodyFile) {
  const added = mergeMelody(pack, JSON.parse(readFileSync(melodyFile, 'utf8')) as Record<string, unknown>);
  console.log(`melody for ${added} phrases from ${melodyFile}`);
}
const body = packBody(pack, clips.map(dataUrlBytes));
const sealed = await seal(body, password);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'private', 'tapes-1.dat');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sealed);
const phrases = Object.values(pack.units).reduce((a, u) => a + u.length, 0);
console.log(`sealed ${Object.keys(pack.units).length} units, ${phrases} phrases, ${clips.length} clips -> ${out} (${(sealed.length / 1e6).toFixed(1)} MB)`);
