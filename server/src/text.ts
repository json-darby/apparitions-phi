// Gemini text, JSON out: the one generateContent call School of the Night's
// custom lessons need. Same credentials as the rest of the server (auth.ts):
//
//   PHI_GCP_PROJECT set: Vertex AI with Application Default Credentials, at
//     PHI_TEXT_LOCATION (default global), billed to that project, the same
//     path the content pipeline uses.
//   otherwise PHI_API_KEY: the Gemini API (PHI_LIVE_API=gemini) or Vertex
//     express mode.
//
// Every call reserves its worst case against the shared spending cap first and
// records what it really used in the ledger. Prompts and answers are never
// logged.

import type { Config } from './config.ts';
import { authHeaders, getAuth } from './auth.ts';
import type { Ledger } from './ledger.ts';

export interface TextCall {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** a short name for the ledger, e.g. "school.generate" */
  stage: string;
}

export interface TextAnswer {
  data: unknown;
  model: string;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

/** Something that answers a TextCall with JSON (the real model, or a stand-in in tests). */
export type TextModel = (call: TextCall) => Promise<TextAnswer>;

/** Conservative token estimate: Thai runs near one token per 1 to 2 characters, English about 4. */
export function estTokens(text: string): number {
  let thai = 0;
  for (const ch of text) if (ch >= '฀' && ch <= '๿') thai++;
  return Math.ceil(thai / 1.2 + (text.length - thai) / 3) + 16;
}

export function textCost(c: Config, model: string, tokensIn: number, tokensOut: number): number {
  const p = c.prices.text[model] ?? c.prices.text.default;
  return tokensIn * p.in + tokensOut * p.out;
}

export function textUrl(c: Config, model: string): string {
  if (c.project) {
    const loc = c.textLocation;
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${encodeURIComponent(c.project)}/locations/${loc}/publishers/google/models/${model}:generateContent`;
  }
  if (c.liveApi === 'gemini') return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`;
}

/** Can a real text call be made? */
export function textCredentials(c: Config): boolean {
  return !!(c.project || c.apiKey);
}

/** Pull the first JSON object or array out of a model's answer (it may wrap it in a code fence). */
export function parseJsonAnswer(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('the answer was not JSON');
  }
}

export class TextHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The real model through Google. One try per call: a failure is reported, never retried in a loop. */
export function geminiText(c: Config, ledger: Ledger): TextModel {
  return async (call) => {
    const maxOut = call.maxOutputTokens ?? 8192;
    const estIn = estTokens(call.system) + estTokens(call.prompt);
    // the worst case (the whole output budget used, thinking included) must fit under the cap
    ledger.reserve(textCost(c, call.model, estIn, maxOut), call.stage);
    const auth = await getAuth(c, 'text');
    const thinking = call.model.startsWith('gemini-3') ? { thinkingLevel: 'low' } : { thinkingBudget: 1024 };
    const res = await fetch(textUrl(c, call.model), {
      method: 'POST',
      signal: AbortSignal.timeout(90_000),
      headers: { 'Content-Type': 'application/json', ...authHeaders(auth, c) },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: call.system }] },
        contents: [{ role: 'user', parts: [{ text: call.prompt }] }],
        generationConfig: { temperature: call.temperature ?? 0.6, maxOutputTokens: maxOut, responseMimeType: 'application/json', thinkingConfig: thinking },
      }),
    });
    if (!res.ok) throw new TextHttpError(res.status, `text ${call.model} http ${res.status}`);
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const u = j.usageMetadata ?? {};
    const tokensIn = u.promptTokenCount || estIn;
    const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const usd = textCost(c, call.model, tokensIn, tokensOut);
    ledger.record({ kind: 'text', model: call.model, units: { seconds: 0, tokensIn, tokensOut }, usd, mock: false, note: call.stage });
    const cand = j.candidates?.[0];
    if (cand?.finishReason === 'MAX_TOKENS') throw new Error('the answer was cut off');
    if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new TextHttpError(451, 'blocked by the model');
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
    return { data: parseJsonAnswer(text), model: call.model, tokensIn, tokensOut, usd };
  };
}
