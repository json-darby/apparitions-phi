# APPARITIONS: PHI

A nocturnal Thai language-learning app, where the people you talk to appear as glowing apparitions of light.

## About

*Phi* (ผี, rising tone) is Thai for spirit. Say it with a falling tone and it becomes *phîi*, an older brother or sister: tones in one word, and the first thing you learn to hear.

APPARITIONS: PHI teaches Thai from the street up over a 30 or 60 day course: a short lesson each day, new words with native audio, spaced-repetition review, tone training, the Thai script stroke by stroke, and conversations on a Bangkok night street with eight characters drawn as dot-cloud faces with depth. Talk to them live with your voice through the Gemini Live API, or take the scripted conversations, which work offline.

It installs as an app on phone, tablet and desktop, and keeps all progress on the device, with a plain-text save file to carry it between devices.

## Tech Stack

- **App** — React · TypeScript · Vite · WebGL · PixiJS · ts-fsrs · sql.js · installable PWA
- **Live server** — Node.js · TypeScript · WebSockets · Gemini Live API · Google Cloud Run
- **Content pipeline** — Python · Gemini · Chirp 3 HD text-to-speech · PyThaiNLP
- **Hosting** — Firebase Hosting

## Getting Started

### Prerequisites

- Node.js (v22.18+)
- Python 3.10+ (content pipeline only)

### App

```bash
cd app
npm install
npm run dev
```

### Live server (optional, for Talk live)

```bash
cd server
npm install
npm run dev
```

`npm run mock` runs it with no key and no cost.

### Environment Variables

Create a `.env.local` file in `server/` with the following keys:

| Variable | Description |
|----------|-------------|
| `PHI_API_KEY` | Google Gemini API key (Google AI Studio) for Talk live |
| `PHI_ACCESS_CODE` | Access code the app sends to the live server (12+ characters) |
| `PHI_LIVE_API` | `gemini` |

Deploying the app and the live server: see [DEPLOY.md](DEPLOY.md).

## Licence

All rights reserved.
