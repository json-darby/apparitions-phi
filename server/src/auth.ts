// Google credentials, server side only. Tokens and keys are never logged or
// sent to the browser.
//
//   Live over the Gemini API (PHI_LIVE_API=gemini): the API key (PHI_API_KEY,
//     from Google AI Studio).
//   Live over Vertex AI: Application Default Credentials when PHI_GCP_PROJECT is
//     set (gcloud auth application-default login on the PC; on Cloud Run the
//     service's own service account), otherwise a Vertex API key.
//   Speech-to-Text: always ADC with PHI_GCP_PROJECT (the recognizer path names
//     the project); without a project the speech check reports unavailable.
//   Text (custom lessons): ADC with PHI_GCP_PROJECT (Vertex, like the
//     pipeline), otherwise PHI_API_KEY.
//
// google-auth-library is loaded lazily so mock mode never touches it.

import type { Config } from './config.ts';

export type Auth =
  | { kind: 'bearer'; token: string }
  | { kind: 'key'; key: string };

export type Purpose = 'live' | 'stt' | 'text';

let client: { getAccessToken(): Promise<{ token?: string | null } | string | null | undefined> } | null = null;

async function adc(): Promise<Auth> {
  if (!client) {
    const { GoogleAuth } = await import('google-auth-library');
    const ga = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    client = (await ga.getClient()) as unknown as typeof client;
  }
  const t = await client!.getAccessToken();
  const token = typeof t === 'string' ? t : t?.token;
  if (!token) throw new Error('no access token from Application Default Credentials');
  return { kind: 'bearer', token };
}

export async function getAuth(c: Config, purpose: Purpose = 'live'): Promise<Auth> {
  if (c.mock) throw new Error('auth requested in mock mode');
  if (purpose === 'live' && c.liveApi === 'gemini') {
    if (c.apiKey) return { kind: 'key', key: c.apiKey };
    throw new Error('no credentials: Live over the Gemini API needs PHI_API_KEY');
  }
  if (c.project) return adc();
  if ((purpose === 'live' || purpose === 'text') && c.apiKey) return { kind: 'key', key: c.apiKey };
  throw new Error(purpose === 'stt' ? 'no credentials: the speech check needs PHI_GCP_PROJECT' : 'no credentials: set PHI_API_KEY or PHI_GCP_PROJECT');
}

export function authHeaders(a: Auth, c: Config): Record<string, string> {
  if (a.kind === 'bearer') {
    // A person's gcloud login bills the project named here. On Cloud Run the
    // service account belongs to the project already, and naming it would need
    // an extra permission (serviceusage.services.use), so it is left out.
    return { Authorization: `Bearer ${a.token}`, ...(c.project && !c.onCloudRun ? { 'x-goog-user-project': c.project } : {}) };
  }
  return { 'x-goog-api-key': a.key };
}
