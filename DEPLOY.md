# Putting APPARITIONS: PHI online

There are two parts. Do part 1 to use the app on your phone and iPad. Part 2 is only for Talk live, the spoken conversations with Gemini; everything else works without it.

| Part | What it is | Cost |
| --- | --- | --- |
| 1. The app | The whole app: course, all audio, faces, lessons. A static website on Firebase Hosting. | Free (Spark plan, no card) |
| 2. Talk live (optional) | A small server on Google Cloud Run that holds the Gemini Live key, so the key never goes into the app. | Pay per use (see `server/DEPLOY-CLOUD-RUN.md`) |

Your progress never goes online. It stays on each device, and save files move it between devices (Settings → Your progress).

---

## Part 1: the app on Firebase Hosting (free)

You need: a Google account, and Node.js (already on this PC). About 15 minutes the first time.

### Once only

1. **Make a Firebase project.**
   1. Go to https://console.firebase.google.com and sign in with your Google account.
   2. Click **Create a project** and call it `apparitions-phi`.
      - The project ID becomes your web address, for example `apparitions-phi.web.app`.
      - If that ID is taken, Firebase adds a few letters; that's fine.
   3. Turn **Google Analytics off** (not needed), then click **Create project**.
   4. Leave it on the free **Spark** plan. No card is needed.

   Use a new project of your own. Don't use any other Google Cloud project on this PC.
2. **Install the Firebase tool.** Open PowerShell and run:
   ```
   npm install -g firebase-tools
   ```
3. **Sign in.** Run:
   ```
   firebase login
   ```
   A browser window opens; pick the same Google account and allow it.
4. **Link the app folder to your project.** Run:
   ```
   cd app   # from the project folder
   firebase use --add
   ```
   Pick `apparitions-phi` from the list. When it asks for an alias, type `default`.

### Every time you publish (the first time too)

```
cd app   # from the project folder
npm run build
firebase deploy --only hosting
```

- The build takes about a minute.
- The first deploy uploads about 85 MB (11,600 files) and takes a few minutes. Later deploys only send what changed.
- At the end it prints `Hosting URL: https://apparitions-phi.web.app` (or your ID). That's your app.
- Installed copies update themselves the next time they open.

### Install it on the Samsung S24

1. Open the Hosting URL in **Chrome**.
2. Tap **Install** on the card on Today. If the card isn't there, use Chrome's menu (⋮) and pick **Add to Home screen**, then **Install**.
3. Open it from the new **PHI** icon. It runs full screen, with no address bar, and works offline once it has opened once.
4. The first time you play a word, allow sound if asked. Allow the microphone the first time you record.

### Install it on the iPad

1. Open the Hosting URL in **Safari**. iPadOS 18.4 or later plays every recording.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open it from the **PHI** icon.

### Moving progress between the phone and the iPad

Each device keeps its own progress. To carry it over:

1. On the device you studied on, go to **Settings**, then **Your progress**, then **Save file**.
   - On a phone, **Share** sends the file straight to Google Drive, Gmail or Files.
   - The file is a small text file, for example `apparitions-phi-day12-2026-10-04.txt`.
2. On the other device, go to **Settings**, then **Load a save file**, and pick that file.
   - It shows what's in the file and what's on the device now before you confirm.

Today reminds you after a week without a save. It's also your backup if a phone is lost or the browser's data is cleared.

### Free plan limits (Spark)

- **Storage:** 10 GB. The app uses about 0.09 GB.
- **Downloads:** 360 MB a day. One person installing on two devices uses a small part of that.
  - Audio is fetched as you meet each word, then kept offline.
- If the daily download limit were ever reached, the site pauses until the next day. Nothing is charged on the Spark plan.

Anyone who has the address can open the app, but there's nothing private in it: progress stays on your devices. The address isn't listed anywhere unless you share it.

---

## Part 2: Talk live (optional)

Talk live needs:
- the small server in `server/`, run on Google Cloud Run;
- a **Gemini API key from Google AI Studio** (it starts with `AIza`), kept in Google's Secret Manager for that server and never in the app;
- an access code you choose, which the app sends so strangers can't use your minutes.

Without it, every conversation still works in scripted mode, offline.

Follow `server/DEPLOY-CLOUD-RUN.md` step by step. Then, on each device:
1. Open **Settings**, then **Talk live**.
2. Paste the server's `https://…run.app` address and your access code.
3. Tap **Test**.

---

## If something looks wrong

| Problem | What to do |
| --- | --- |
| No sound on the iPad | Update to iPadOS 18.4 or later. Today shows a note when the device can't play the recordings. |
| The app looks old after a deploy | Close it fully and open it again. It updates on the next open. |
| `firebase` is not recognised | Close PowerShell, open a new one, then run `npm install -g firebase-tools` again. |
| Deploy says "no project" | Run `firebase use --add` again from the `app` folder. |
