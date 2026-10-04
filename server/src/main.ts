// npm --prefix phi-project/server run dev        (real mode once credentials are set)
// npm --prefix phi-project/server run mock       (or MOCK=1: no credentials, no cost)
// On Cloud Run the container runs `node src/main.ts` (see Dockerfile).

import { createPhiServer, describeConfig } from './app.ts';
import { hasCredentials, MIN_PUBLIC_CODE } from './config.ts';
import { log } from './log.ts';

const s = createPhiServer();
const d = describeConfig(s.config);
log('config', {
  mock: d.mock, cloudRun: d.cloudRun, liveVia: d.liveVia, sttVia: d.sttVia, access: d.access,
  live: `${d.liveModel}@${d.liveLocation}`, stt: d.stt, minutes: d.liveMinutesPerDay, cap: d.budgetUsd,
  origins: d.origins.length,
});
if (d.access === 'locked') {
  log(
    `REFUSING live and speech checks: this server is on a public address and PHI_ACCESS_CODE is not set ` +
    `(or is shorter than ${MIN_PUBLIC_CODE} characters). Anyone could otherwise spend money through it. ` +
    `Set PHI_ACCESS_CODE and restart (Cloud Run: gcloud run services update ... --update-env-vars).`,
  );
}
if (!s.config.mock && !hasCredentials(s.config)) {
  log('no-credentials: /health answers, live and stt report unavailable. Run with MOCK=1 to test, or set PHI_API_KEY (Live) / PHI_GCP_PROJECT (speech check).');
}
if (s.config.onCloudRun) {
  log('cloud-run: the usage ledger and the daily minute count live in this container only and reset when it restarts. A Google Cloud budget alert is the real money guard.');
}
await s.listen();

const stop = async () => {
  await s.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
