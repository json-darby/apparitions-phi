# Phi server

A small server that holds Google credentials so the app never does. It runs on
the PC for development, or on Google Cloud Run so the hosted app can use it from
a phone or tablet (see [DEPLOY-CLOUD-RUN.md](DEPLOY-CLOUD-RUN.md)). It does
three things:

| Endpoint | What it does |
| --- | --- |
| `GET /health` | Is the server up, is it in mock mode, live minutes left today, spend against the cap. The app offers "Talk live" only when this answers. When an access code is set, without it this says only `{ ok, service, needsCode: true }`. |
| `WS /live` | The live conversation with a street character. Relays the learner's voice (16 kHz PCM, only while the talk button is held) to Gemini Live (the Gemini API with a key, or Vertex AI) and the character's voice (24 kHz PCM) back. Holds the session and resumes it when Google's ~10-minute connection ends. |
| `POST /stt` | The online consonant and vowel check. Speech-to-Text v2, `chirp_3`, falling back to `chirp_2`, Thai. Returns `{ transcript, confidence, similarity, model }`; similarity is 0..1 against the target Thai with tone marks removed. Tones are never judged here. |

On the PC it listens on `127.0.0.1:8787` only. On Cloud Run (`K_SERVICE` is
set) it listens on `0.0.0.0:$PORT` and reads only environment variables; any
other non-loopback `PHI_SERVER_HOST` counts as public too. It answers only the
app's origins (`http://localhost:5173`, `http://127.0.0.1:5173`, the preview
ports 4173, plus `PHI_ALLOWED_ORIGINS`), and never logs audio, transcripts,
keys, tokens, access codes or the project id.

### The access code

`PHI_ACCESS_CODE` is the app's simple login to the server. When it is set,
`/stt` and `/live` need it: the header `x-phi-code` over HTTP, and over the
websocket (a browser cannot set headers there) the subprotocol list
`['phi', 'phi-code.<base64url of the code>']`, of which the server picks `phi`.
It is not put in the URL, so it stays out of Cloud Run's request logs. Codes are
compared in constant time; 5 wrong codes from one address make it wait 15
minutes (`PHI_CODE_FAILURES`, `PHI_CODE_LOCK_MINUTES`). On a public address the
code is required: unset, or shorter than 12 characters, and the server refuses
live and speech checks for everyone and says so in its log. On the PC, unset
means no code, as before. The app keeps the address and code on the device
(Settings → Talk live).

## Run it on the PC

Node 22.18 or newer runs the TypeScript directly; there is no build step.

```
npm --prefix phi-project/server install
npm --prefix phi-project/server run mock    # no credentials, no cost
npm --prefix phi-project/server run dev     # real mode (watch), once credentials are set
npm --prefix phi-project/server test        # everything in mock mode
```

Then run the app as usual (`npm --prefix phi-project/app run dev`). In The Street,
a "Scripted / Talk live" switch appears above a conversation when the server is
up. Scripted stays the default and always works offline.

### Mock mode

`MOCK=1` (or `npm run mock`): no Google, no credentials, no network. The
character answers from the task's script that the app sends: it says the
opening line (with a soft hum standing in for a voice), calls `slotFilled` when
a reply matches a right option, gives a hint in Thai then English after two
stuck tries, calls `questComplete` at the end, and `flagUnsafe` on obviously
off-limits requests. A held talk button with at least 0.3 s of audio is heard as
the right reply for the step; shorter is heard as silence. Typed Thai is matched
for real. `/stt` returns the target as the transcript (similarity 1) unless the
audio is near-empty. Mock usage is written to the ledger at $0 and counts
toward the daily minute cap, so the caps can be tested.

## What the owner sets on the PC

Credentials go in `phi-project/pipeline/.env.local` (shared with the pipeline;
`server/.env.local` also works and wins). On Cloud Run the same names are
environment variables instead (see DEPLOY-CLOUD-RUN.md).

```
PHI_GCP_PROJECT=<the project with the trial credit>   # uses gcloud Application Default Credentials
PHI_BUDGET_USD=30                                      # shared cap with the pipeline
# optional
PHI_API_KEY=                     # a Gemini API key from Google AI Studio, for Live (see PHI_LIVE_API)
PHI_LIVE_API=                    # gemini (the key) | vertex (ADC). Default: gemini when the key is set
                                 # and there is no PHI_GCP_PROJECT (or on Cloud Run), else vertex
PHI_LIVE_LOCATION=us-central1    # Vertex only: where gemini-3.8-live is served
PHI_LIVE_MODEL=gemini-3.8-live
PHI_LIVE_ENDPOINT=               # full wss:// URL if Google's path differs
PHI_STT_LOCATION=us              # chirp_3
PHI_STT_FALLBACK_LOCATION=asia-southeast1   # chirp_2
PHI_LIVE_MINUTES_PER_DAY=20
PHI_ALLOWED_ORIGINS=             # extra app origins, separated by ; , or spaces
PHI_ACCESS_CODE=                 # optional on the PC, required on a public address
PHI_LEDGER_PATH=                 # usage ledger file (default server/work/usage.jsonl)
```

Sign in once with `gcloud auth application-default login` and pick the street
project (not any other project on this machine). Enable `aiplatform.googleapis.com`
and `speech.googleapis.com` on it. The speech check always uses ADC with
`PHI_GCP_PROJECT`; without a project `/stt` answers 503 and the app scores tones
on the device only.

## Limits and money

| Setting | Default | Env |
| --- | --- | --- |
| Live minutes a day (mock included) | 20 | `PHI_LIVE_MINUTES_PER_DAY` |
| Longest single conversation | 15 min | `PHI_LIVE_MAX_SESSION_MINUTES` |
| Conversations open at once | 2 | `PHI_LIVE_MAX_CONCURRENT` |
| Conversations started a minute | 6 | `PHI_LIVE_STARTS_PER_MINUTE` |
| Speech checks a minute / a day | 30 / 400 | `PHI_STT_PER_MINUTE`, `PHI_STT_PER_DAY` |
| Largest speech-check upload | 2 MB | `PHI_STT_MAX_BYTES` |
| Seconds a dropped browser has to reattach | 45 | `PHI_LIVE_REATTACH_SECONDS` |

Every use is written to `server/work/usage.jsonl` (or `PHI_LEDGER_PATH`; kind,
model, seconds, dollars; never audio or text). On Cloud Run that file lives in
the container and starts again from zero when the container restarts, so there
the daily minute cap and `PHI_BUDGET_USD` reset too (unless the ledger is on a
mounted bucket); a Google Cloud budget alert and the Gemini prepaid credit are
the real money guards. The spending cap is shared in spirit with the
pipeline: real spend in this ledger plus real spend in
`pipeline/work/ledger.jsonl` must stay under `PHI_BUDGET_USD`. A live session is
refused, or stopped, when it would pass the cap. Prices: Live about $0.023 a
minute, Chirp STT $0.016 a minute (research report, 2 Oct 2026).

## Guardrails

The app builds each character's system instruction (persona, place, the task's
goal and steps, the learner's known words plus at most three new ones, Thai
only, at most 12 words a turn, a hint after two stuck tries in Thai then
English). The server always puts its own fixed rules in front, which the browser
cannot remove: adults only, nothing sexual or explicit, no help obtaining drugs,
no real people, never grade tones, emergency numbers if someone is in danger,
and flirting only in an After Hours scene with the 18+ setting on (the server
refuses an 18+ scene when the app says the setting is off). Three `flagUnsafe`
calls end a conversation.

## Endpoints and ids targeted (unverified until the first real call)

- Live over the Gemini API (`PHI_LIVE_API=gemini`, the Cloud Run path):
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=…`,
  model `models/gemini-3.8-live`, as in Google's Live API WebSocket guide
  (ai.google.dev, checked 4 Oct 2026). The key is a Gemini API key from AI
  Studio; it travels in the URL as documented, and that URL is never logged.
- Live over Vertex AI (`PHI_LIVE_API=vertex`, ADC):
  `wss://{PHI_LIVE_LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`,
  model `projects/{project}/locations/{location}/publishers/google/models/gemini-3.8-live`.
  Which location serves `gemini-3.8-live` (some reports say Gemini 3 models are
  served only at `global`) is not confirmed. Google documents Vertex express-mode
  API keys for `generateContent`, not for Live, so a Vertex key is not the
  supported way in.
- Both: push-to-talk (`automaticActivityDetection.disabled`, `activityStart`/`activityEnd`),
  `realtimeInput.audio` at `audio/pcm;rate=16000`, input and output transcription,
  `sessionResumption` and `contextWindowCompression`.
- STT: `https://{location}-speech.googleapis.com/v2/projects/{project}/locations/{location}/recognizers/_:recognize`,
  `chirp_3` in `us`, then `chirp_2` in `asia-southeast1`, `languageCodes: ["th-TH"]`,
  auto-decoding (the app sends 16 kHz WAV). Whether Chirp 3 is generally
  available for Thai is not confirmed; the fallback covers it.

## Deploying to Cloud Run

Step by step, for Windows: [DEPLOY-CLOUD-RUN.md](DEPLOY-CLOUD-RUN.md). In short:
`gcloud run deploy phi-server --source server --region europe-west2 --max-instances 1
--allow-unauthenticated --timeout 3600`, with the Gemini key from Secret Manager
(`--set-secrets PHI_API_KEY=…`) and `PHI_LIVE_API=gemini`, `PHI_ACCESS_CODE`,
`PHI_ALLOWED_ORIGINS` (the Firebase Hosting addresses). The `Dockerfile` runs
`node src/main.ts` on Node 24 (TypeScript type stripping, no build step);
`.dockerignore` and `.gcloudignore` keep `.env` files, `work/`, tests and
`node_modules` out. Then in the app: Settings → Talk live → the https
address and the code → Test.
