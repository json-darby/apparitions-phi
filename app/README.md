# APPARITIONS: PHI (the app)

The installable web app. To put it online, see `../DEPLOY.md`.

## Run it

```
npm install
npm run dev          # http://localhost:5173, also on your network
npm test             # unit tests, including the 30-day simulator
npm run build        # production build with the offline service worker, in dist/
npm run preview      # serve the build at http://localhost:4173 (install it from here)
```

To install on a phone or tablet, open the preview or deployed address in the browser and use "Add to Home Screen" / "Install app". It then opens with no network. Browsers only allow the service worker and microphone on `localhost` or HTTPS, so for a phone use a deployed copy or a secure tunnel. Capacitor builds come in Phase 6.

## Where things are

| Folder | What it holds |
| --- | --- |
| `src/core` | dates, clock, settings |
| `src/content` | the content model, the silent seed set, the content repository, street task scripts |
| `src/db` | SQLite (sql.js) store with the append-only answer log, IndexedDB persistence |
| `src/engine` | the memory engine (FSRS-6 via ts-fsrs), grading, the 30-day simulator |
| `src/path` | the 30-day spine, daily blocks, unlock days |
| `src/audio` | the one shared play, record and score interface (captions until Phase 4) |
| `src/app`, `src/ui`, `src/styles` | shell, router, layout sizes, shared parts, look |
| `src/screens` | Today, Welcome, Progress, Settings and the Learn screens |
| `src/writing` | writing pad, stroke data, handwriting matching |
| `src/games` | the five drills and their shared frame |
| `src/street` | The Street: street, talk, chapters, cast |
| `src/anim` | the WebGL dot renderer and every catalogue animation |

## Rules the code keeps

- Every answer from every screen and game goes through `engine.answer` / `engine.report`, and is logged in an append-only table (triggers refuse updates and deletes).
- Games ask the engine for items they may use and never introduce new ones. An answer that could be got without understanding the Thai is logged with `counts: false` and does not move the schedule.
- Every content record has empty audio, pitch, image and animation slots from day one.
- Every screen plays, records and scores through `useApp().sound`. In Phase 4 `CaptionSound` is replaced by a real audio implementation of the same interface.
