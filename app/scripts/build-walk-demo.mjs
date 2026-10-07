// Bundles the street's walking body (src/street/body/*) into one small ES module
// for the stand-alone demo page animation-demos/"5 walk from video.html", so the
// demo runs the exact code the app runs. Re-run after changing the body code.
// Run: node scripts/build-walk-demo.mjs

import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');

await build({
  root: app,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: resolve(app, '../animation-demos/lib'),
    copyPublicDir: false,
    emptyOutDir: false,
    minify: true,
    target: 'es2022',
    lib: { entry: resolve(app, 'src/street/body/index.ts'), formats: ['es'], fileName: () => 'walk-body.js' },
  },
});
console.log('wrote animation-demos/lib/walk-body.js');
