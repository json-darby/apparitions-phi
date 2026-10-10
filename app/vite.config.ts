import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'APPARITIONS: PHI',
        short_name: 'PHI',
        id: './',
        description: 'APPARITIONS: PHI. Thai from the street up: words, tones, script and real conversations, a short session a day.',
        lang: 'en',
        categories: ['education'],
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#050505',
        theme_color: '#050505',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,woff,woff2,svg,png,json,webp,bin}'],
        // content/course.json (the generated course) is precached by the json pattern above,
        // so a new course version arrives with the app update and works offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/audio\//, /\/content\//],
        // ~12,000 clips (~75 MB) are too many to precache: each is cached the first
        // time it plays (or all at once from Settings → Download all audio, which
        // fills this same cache), then served offline.
        runtimeCaching: [
          {
            urlPattern: /\/audio\/.+\.(?:ogg|opus|webm|m4a|mp3|wav)$/i,
            handler: 'CacheFirst',
            options: {
              // AUDIO_CACHE in src/audio/AudioSound.ts: bump both when shipped clips change in place
              cacheName: 'phi-audio-2',
              expiration: { maxEntries: 40000 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
