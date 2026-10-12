// After the build: put the locked Tapes pack (private/tapes-1.dat, made by
// scripts/tapes-seal.ts, never committed) into dist/t/. It goes in after the
// service worker is generated, so it is downloaded once on unlock, not precached.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'private', 'tapes-1.dat');
const to = join(root, 'dist', 't', 'tapes-1.dat');
if (existsSync(from)) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log('tapes: locked pack copied into dist/t/');
} else {
  console.log('tapes: no locked pack in private/ (The Tapes will offer the study file instead)');
}
