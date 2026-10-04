# Hosting the live server on Google Cloud Run

This puts "Talk live" on your phone and iPad. The app itself is a static site on
Firebase Hosting; the live server holds the Gemini key and runs on Cloud Run, a
Google service that starts the server when the app calls it and stops it when
nobody does. The app never sees the key. A short access code that you choose
keeps everyone else out.

Nothing here has been deployed for you. Every command below is yours to run,
and nothing costs money until you finish step 11 and start talking.

Your key and access code live in one file on this PC, `server\.env.local`
(names `PHI_API_KEY` and `PHI_ACCESS_CODE`), and are copied from there into
Google's Secret Manager. The file itself is never uploaded.

All commands are for **Windows PowerShell**. Lines ending in a backtick ( ` )
continue on the next line; paste the whole block at once.

---

## What it costs (rough)

| What | Cost |
| --- | --- |
| Cloud Run, idle | About nothing. With minimum instances 0, nothing runs and nothing is billed between conversations. |
| Cloud Run, while talking | A live conversation keeps one small server running for its length. Cloud Run's monthly free allowance (at the time of writing about 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds per billing account) covers 20 minutes a day comfortably (about 36,000 vCPU-seconds a month). |
| Gemini Live | **Free on AI Studio's free tier** (with daily limits; Google may use free-tier conversations to improve its products). On the paid tier, the code's own estimate is $0.023 a minute: with the default cap of 20 live minutes a day, at most about $14 in a 30-day month. Check the real price on the Gemini API pricing page. |
| Speech check (optional, step A) | The code's estimate: $0.016 a minute of audio. Each check is a few seconds, at most 400 a day. |
| Building and storing the server | Cloud Build, Artifact Registry and Secret Manager: free or pennies at this size. |

**The real money guards are Google's, not the server's.** Do step 4 (the
budget alert), and on AI Studio's paid tier its prepaid credit and spend cap. The server also has its own
caps (20 live minutes a day, 15 minutes a conversation, 2 at once), but on Cloud
Run its usage count lives inside the running container, and Cloud Run stops the
container after a quiet spell, so **the daily count and the spending ledger
start again from zero whenever it restarts.** Step B keeps them across restarts.
`--max-instances 1` below keeps everything in one place, so the caps can never
be doubled by a second copy.

---

## Steps

### 1. Use the app's own project, with billing on

The server goes in the same Google Cloud project as the app: `apparitions-phi`
(the Firebase project, under the Google account the app was published with).
Do not use a project that another app on this computer uses (for example the
one the content pipeline billed).

**Cloud Run needs billing turned on for the project**, even when everything
stays inside the free allowance. In the Firebase console for `apparitions-phi`,
click **Upgrade** at the bottom of the left menu and choose **Blaze (pay as you
go)**. "Confirm purchase" shows no amount: nothing is charged by upgrading,
and the app's hosting stays inside the same free limits.

### 2. Install the Google Cloud command line and sign in

1. Install the Google Cloud CLI for Windows: https://cloud.google.com/sdk/docs/install
2. Open **Windows PowerShell** and run (with your own project ID and Firebase
   Hosting site name, the part before `.web.app` in the app's address):

```powershell
gcloud auth login
$PROJECT = "apparitions-phi"             # the app's project (step 1)
$REGION  = "europe-west2"                # London
$APP     = "apparitions-phi"             # your Firebase Hosting site name
gcloud config set project $PROJECT
# run this from the project folder (the one that holds app, server and pipeline)
# reads one value from server\.env.local without printing it
function Get-EnvValue($name) { ((Get-Content server\.env.local) -match "^$name=" | Select-Object -First 1) -replace "^$name=", "" }
```

These `$` names and `Get-EnvValue` last until you close the window. If you
close it, run this block again (apart from `gcloud auth login`) before
carrying on.

### 3. Turn on the services it uses

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com generativelanguage.googleapis.com
```

### 4. Set a budget alert (the main money guard)

1. Open https://console.cloud.google.com/billing/budgets, pick the billing
   account, **Create budget**.
2. Scope: just this project. Amount: for example $10 a month. Alerts at 50%,
   90% and 100%, emailed to you.

A budget alert warns you; it does not switch anything off. If you ever get the
100% email and did not expect it, turn the server off (see "Turn it off" below).

### 5. Get the Gemini key and put it in `server\.env.local`

The server needs a **Gemini API key from Google AI Studio** (it starts with
`AIza`). Not a Vertex AI key, not a service-account file. The server talks to
Gemini Live through the Gemini API with this key (`PHI_LIVE_API=gemini`).

1. Open https://aistudio.google.com/apikey and choose **Create API key**. When
   asked for a project, choose (or import) the project from step 1.
2. The **free tier** is enough: Talk live then costs nothing, within Google's
   daily limits (past them, the app falls back to scripted conversations).
   Google's terms: on the free tier your prompts and replies may be used to
   improve Google's products. If you want the paid tier instead (no such use,
   higher limits), choose **Set up billing** in AI Studio; it is prepaid, and
   a **monthly spend cap** on the **Spend** page is the ceiling.
3. (Paid tier only) set the spend cap, for example $10.
4. Check that the Live model `gemini-3.8-live` is listed for your key. If AI
   Studio shows a different name for the current Live model, use that name
   with `PHI_LIVE_MODEL` in step 10.
5. Open `phi-project\server\.env.local` in Notepad and paste the key straight
   after `PHI_API_KEY=` (no quotes, no spaces). Save.

Do not paste the key into the app, a chat or any other file.

### 6. Make up the access code and put it in `server\.env.local`

The access code is the app's "login" to your server. It must be **at least 12
characters**: letters, digits and dashes only. The server refuses all live and
speech requests without one, and after 5 wrong tries from one place, that place
waits 15 minutes.

Make one up, or let PowerShell make a random one and show it to you:

```powershell
[guid]::NewGuid().ToString("N").Substring(0, 20)
```

Put it straight after `PHI_ACCESS_CODE=` in `server\.env.local` and save. You
type it once on each device (step 12), so keep it somewhere you can find it.

Check both are in place. This shows only their lengths, never the values:

```powershell
"key: "  + (Get-EnvValue PHI_API_KEY).Length + " characters (a Gemini key is 39)"
"code: " + (Get-EnvValue PHI_ACCESS_CODE).Length + " characters (12 or more)"
```

### 7. Copy both into Secret Manager

Secret Manager is Google's locked box. The server reads the key and the code
from it, so neither goes into the deploy command, the Cloud Run settings page
or any log. These lines copy each value from `server\.env.local` without
printing it:

```powershell
(Get-EnvValue PHI_API_KEY) | gcloud secrets create phi-gemini-key --data-file=-
(Get-EnvValue PHI_ACCESS_CODE) | gcloud secrets create phi-access-code --data-file=-
```

(A newline at the end of a value is fine: the server trims it.)

### 8. Make the account the server runs as, and let it read both secrets

```powershell
gcloud iam service-accounts create phi-server --display-name "Phi live server"
gcloud secrets add-iam-policy-binding phi-gemini-key --member "serviceAccount:phi-server@$PROJECT.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding phi-access-code --member "serviceAccount:phi-server@$PROJECT.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
```

And let Cloud Build build the server from source (Google's documented step for
`--source` deploys; harmless if already allowed):

```powershell
$NUMBER = gcloud projects describe $PROJECT --format "value(projectNumber)"
gcloud projects add-iam-policy-binding $PROJECT --member "serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role roles/run.builder
```

### 9. The app's addresses

The server only answers pages it knows. Firebase Hosting gives the app two
addresses, `https://<site>.web.app` and `https://<site>.firebaseapp.com`; the
command below allows both (from `$APP`). If you add your own domain later, add
it too (see "Change things later"). Separate several with `;`.

### 10. Deploy

From the `phi-project` folder (step 2 already went there):

```powershell
# run this from the project folder (the one that holds app, server and pipeline)
gcloud run deploy phi-server `
  --source server `
  --region $REGION `
  --service-account "phi-server@$PROJECT.iam.gserviceaccount.com" `
  --allow-unauthenticated `
  --min-instances 0 `
  --max-instances 1 `
  --timeout 3600 `
  --memory 512Mi `
  --set-secrets "PHI_API_KEY=phi-gemini-key:latest,PHI_ACCESS_CODE=phi-access-code:latest" `
  --set-env-vars "PHI_LIVE_API=gemini,PHI_ALLOWED_ORIGINS=https://$APP.web.app;https://$APP.firebaseapp.com,PHI_LIVE_MINUTES_PER_DAY=20"
```

- If it asks to create an Artifact Registry repository, answer **Y**.
- `--set-secrets` hands the key and the code from Secret Manager to the server.
- `--allow-unauthenticated` lets the app reach the server at all; the access
  code is what keeps strangers out.
- `--max-instances 1`: one copy, so the minute caps hold. `--min-instances 0`:
  nothing runs (or costs) when idle. `--timeout 3600`: a live conversation may
  stay connected up to an hour (the server ends one at 15 minutes anyway).
- The build takes a few minutes. At the end it prints the **Service URL**,
  `https://phi-server-…run.app`. Get it again any time with:

```powershell
$URL = gcloud run services describe phi-server --region $REGION --format "value(status.url)"
$URL
```

**Try it for free first (optional).** Add `,MOCK=1` at the end of the
`--set-env-vars` value and deploy. The server then answers from the course
script with a hum for a voice and never calls Gemini, so you can check the
phone, the code and the connection at no Gemini cost. When it works, run the
same deploy command again without `,MOCK=1`.

### 11. Check it from the PC

```powershell
curl.exe "$URL/health"
curl.exe -H "x-phi-code: $(Get-EnvValue PHI_ACCESS_CODE)" "$URL/health"
```

The first answers only `{"ok":true,"service":"phi-server","needsCode":true}`.
The second answers in full, with `"live":{"available":true,...,"minutesLeft":20}`.
If it says `"locked":true`, the access code is missing or too short (steps 6, 7).
If `"live"` says `"available":false`, the key did not arrive (steps 5, 7, 8, 10).

### 12. In the app, on each device

1. Open the hosted app, then **Settings → Talk live**.
2. **Server address**: paste the Service URL (`https://phi-server-…run.app`).
3. **Access code**: the code from step 6.
4. Press **Test**. You should see **Connected · 20 live minutes left today**.
   - **Wrong code**: retype it (wait 15 minutes after 5 wrong tries).
   - **Not reachable**: check the address, and that the page's address is in
     `PHI_ALLOWED_ORIGINS` (the message names it).
5. Open a conversation in The Street: the **Scripted / Talk live** switch appears.
   Scripted stays the default and always works offline.

The address and code are kept on that device only; save files never carry
them, so type them once on each device. Without them, conversations run
scripted and offline, as before.

### 13. The first real conversation

Talk for a minute, then look at the server's log: Cloud Run → `phi-server` →
**Logs** in the console. A good start shows `live.start` and, at the end,
`live.end`. If you see `live.start-failed`:

| Log says | Likely cause |
| --- | --- |
| `live closed 1008 …` or `live closed 1007 …` | Google refused the setup, usually an unknown model name or a model the key cannot use. The words after the number say which. If they mention the language code, add `PHI_LIVE_LANGUAGE_CODE=none`. |
| `live handshake http 400` or `404` | The model name or the endpoint changed. Check the Live model name in AI Studio (set `PHI_LIVE_MODEL`), and the WebSocket address on Google's "Get started with Live API using WebSockets" page; if it changed, set `PHI_LIVE_ENDPOINT` to the new `wss://…BidiGenerateContent` address (the server adds the key). |
| `http 401` or `403` | The key is wrong, or its project has no Gemini API access. Recreate it (step 5), then add a new secret version (see "Change things later"). |
| `http 402` | The prepaid Gemini credit has run out, or the spend cap is reached. |
| `http 429` | Gemini rate limit (common on the free tier). |

The server logs never contain audio, transcripts, the key or the access code.

---

## Optional

### A. The online consonant-and-vowel check (speech-to-text)

Without this, the app scores tones on the device alone, which is how it already
works offline. To add Google's speech check:

```powershell
gcloud services enable speech.googleapis.com
gcloud projects add-iam-policy-binding $PROJECT --member "serviceAccount:phi-server@$PROJECT.iam.gserviceaccount.com" --role roles/speech.client
gcloud run services update phi-server --region $REGION --update-env-vars "PHI_GCP_PROJECT=$PROJECT"
```

It signs in as the server's own account (no key). Test again in the app;
`/health` with the code then shows `"stt":{"available":true,...}`.

### B. Keep the daily count and the ledger across restarts

The usage ledger can live in a Cloud Storage bucket instead of the container's
memory, so the daily minute cap and `PHI_BUDGET_USD` survive restarts:

```powershell
gcloud storage buckets create "gs://$PROJECT-phi-ledger" --location $REGION
gcloud storage buckets add-iam-policy-binding "gs://$PROJECT-phi-ledger" --member "serviceAccount:phi-server@$PROJECT.iam.gserviceaccount.com" --role roles/storage.objectUser
gcloud run services update phi-server --region $REGION `
  --add-volume "name=ledger,type=cloud-storage,bucket=$PROJECT-phi-ledger" `
  --add-volume-mount "volume=ledger,mount-path=/mnt/ledger" `
  --update-env-vars "PHI_LEDGER_PATH=/mnt/ledger/usage.jsonl,PHI_BUDGET_USD=10"
```

The file is tiny (one line per minute of talk). With `--max-instances 1` there
is only ever one writer.

---

## Change things later

- **A setting**: `gcloud run services update phi-server --region $REGION --update-env-vars "PHI_LIVE_MINUTES_PER_DAY=30"`.
  (`--set-env-vars` replaces them all; `--update-env-vars` changes only those named.)
- **More app addresses**: `--update-env-vars "PHI_ALLOWED_ORIGINS=https://$APP.web.app;https://$APP.firebaseapp.com;https://your.domain"`.
- **A new access code**: change `PHI_ACCESS_CODE` in `server\.env.local`, then run
  `(Get-EnvValue PHI_ACCESS_CODE) | gcloud secrets versions add phi-access-code --data-file=-`
  and `gcloud run services update phi-server --region $REGION --update-secrets "PHI_ACCESS_CODE=phi-access-code:latest"`.
  Then enter the new code on each device.
- **A new key**: change `PHI_API_KEY` in `server\.env.local`, then run
  `(Get-EnvValue PHI_API_KEY) | gcloud secrets versions add phi-gemini-key --data-file=-`
  and `gcloud run services update phi-server --region $REGION --update-secrets "PHI_API_KEY=phi-gemini-key:latest"`.
- **A new server version** (after code changes): run the step 10 command again.
- **The day** for the minute cap is Cloud Run's clock (UTC): it resets at midnight UTC.

## Turn it off

```powershell
gcloud run services delete phi-server --region $REGION
```

The app falls back to scripted conversations. Delete the key in AI Studio too
if you are done with it.

---

## Settings the server reads (all optional except the first three)

| Env var | What it is |
| --- | --- |
| `PHI_API_KEY` | The Gemini API key (from Secret Manager `phi-gemini-key`, step 7). |
| `PHI_ACCESS_CODE` | The access code, at least 12 characters (from Secret Manager `phi-access-code`, step 7). Without it, live and speech checks are refused on Cloud Run. |
| `PHI_ALLOWED_ORIGINS` | The app's addresses, separated by `;` (or commas, or spaces). `localhost` addresses are always allowed. |
| `PHI_LIVE_API` | `gemini` (the Gemini API, with the key; the default on Cloud Run when a key is set) or `vertex` (Vertex AI with the server's own account). |
| `PHI_LIVE_MINUTES_PER_DAY` | Default 20. |
| `PHI_LIVE_MAX_SESSION_MINUTES` | Default 15. |
| `PHI_LIVE_MODEL` | Default `gemini-3.8-live`. |
| `PHI_LIVE_ENDPOINT` | Only if Google moves the Live WebSocket address. |
| `PHI_GCP_PROJECT` | Turns on the speech check (step A). |
| `PHI_LEDGER_PATH`, `PHI_BUDGET_USD` | Where the usage ledger lives (step B) and the server's own spending cap (default $30, counted in that ledger). |
| `PHI_TRUSTED_PROXY_HOPS` | Default 1 on Cloud Run: how the server finds a caller's address for the wrong-code wait. Set 2 only if you put a Google load balancer in front. |
| `MOCK` | `1` for the free practice server (no Gemini calls). |

Cloud Run sets `PORT` and `K_SERVICE` itself; the server then listens on
`0.0.0.0:$PORT` and reads only these environment variables (no `.env` files).

## What is not yet confirmed

No real call has been made. Before relying on it, the first conversation (step
13) confirms: the Live model name on the Gemini API, the WebSocket address
(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=…`,
model `models/gemini-3.8-live`, both as shown in Google's Live API WebSocket
guide in October 2026), the voices `Kore` and `Charon`, and Thai output
(`th-TH`). The price per minute above is the code's estimate, not Google's.
