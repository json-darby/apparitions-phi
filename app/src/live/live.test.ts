// Live conversation: the persona, the guardrails, the tool mapping and review
// logging, the audio helpers, and a full round trip through the local server
// in MOCK mode (no Google, no credentials, no cost).

import { describe, expect, it } from 'vitest';
import { CAST, PLACES, SEED_ITEMS } from '../content/seed';
import { taskById, tasksFor, type StreetTaskBuilt } from '../content/street-seed';
import type { Item } from '../content/types';
import type { Answer, AnswerResult } from '../engine/engine';
import { checkHealth, LiveClient, liveUsable, pcm16ToFloat, probeMessage, probeServer, serverReachable, toPcm16k, wsProtocols, wsUrl, type Health } from './client';
import { BUILD_SERVER_URL, bindLiveStore, codeFor, LIVE_SERVER_KEY, liveServer, normalizeServerUrl, saveLiveServer, savedLiveServer, type LiveKv } from './serverConfig';

describe('server reachability', () => {
  it('a server on this computer is tried only from a page on this computer', () => {
    expect(serverReachable('http://127.0.0.1:8787', 'localhost')).toBe(true);
    expect(serverReachable('http://localhost:8787', '127.0.0.1')).toBe(true);
    expect(serverReachable('http://127.0.0.1:8787', 'phi.example.app')).toBe(false);
    expect(serverReachable('https://live.example.app', 'phi.example.app')).toBe(true);
  });

  it('an https server the owner entered is reachable from any page; http only from an http page', () => {
    // the hosted app (Firebase) on the phone, the Cloud Run server
    expect(serverReachable('https://phi-server-abc-nw.a.run.app', 'phi-app.web.app', 'https:')).toBe(true);
    expect(serverReachable('https://phi-server-abc-nw.a.run.app', 'localhost', 'http:')).toBe(true);
    // loopback from the hosted app: never
    expect(serverReachable('http://127.0.0.1:8787', 'phi-app.web.app', 'https:')).toBe(false);
    expect(serverReachable('http://[::1]:8787', 'phi-app.firebaseapp.com', 'https:')).toBe(false);
    // a plain http server elsewhere: mixed content from an https page
    expect(serverReachable('http://192.168.1.20:8787', 'phi-app.web.app', 'https:')).toBe(false);
    expect(serverReachable('http://192.168.1.20:8787', '192.168.1.20', 'http:')).toBe(true);
    // not an address
    expect(serverReachable('', 'localhost')).toBe(false);
    expect(serverReachable('ftp://x.example', 'localhost')).toBe(false);
  });
});

/** A stand-in for the app's Store: just the kv part. */
class FakeKv implements LiveKv {
  map = new Map<string, string>();
  get<T>(key: string, fallback: T): T {
    const v = this.map.get(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  }
  set<T>(key: string, value: T) {
    this.map.set(key, JSON.stringify(value));
  }
}

describe('the live server setting (Settings → Talk live)', () => {
  it('tidies a pasted address', () => {
    expect(normalizeServerUrl('phi-server-abc-nw.a.run.app/')).toBe('https://phi-server-abc-nw.a.run.app');
    expect(normalizeServerUrl('  https://Phi-Server.a.run.app/health ')).toBe('https://phi-server.a.run.app');
    expect(normalizeServerUrl('localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl('ftp://x.example')).toBeNull();
    expect(normalizeServerUrl('https://me:pw@x.example')).toBeNull();
  });

  it('is kept in the local database as live_server { url, code }, and the code goes only to that server', () => {
    const kv = new FakeKv();
    bindLiveStore(kv);
    try {
      expect(liveServer()).toEqual({ url: BUILD_SERVER_URL, code: '' });
      saveLiveServer({ url: 'phi-server-abc-nw.a.run.app', code: ' the-owners-code-1234 ' });
      expect(kv.get(LIVE_SERVER_KEY, null)).toEqual({ url: 'https://phi-server-abc-nw.a.run.app', code: 'the-owners-code-1234' });
      expect(liveServer()).toEqual({ url: 'https://phi-server-abc-nw.a.run.app', code: 'the-owners-code-1234' });
      expect(wsUrl()).toBe('wss://phi-server-abc-nw.a.run.app/live');
      expect(codeFor('https://phi-server-abc-nw.a.run.app/')).toBe('the-owners-code-1234');
      expect(codeFor('https://someone-else.example')).toBe('');
      expect(() => saveLiveServer({ url: 'ftp://nope', code: '' })).toThrow();
      // both empty: back to the build default
      saveLiveServer({ url: '', code: '' });
      expect(savedLiveServer()).toBeNull();
      expect(liveServer().url).toBe(BUILD_SERVER_URL);
    } finally {
      bindLiveStore(null);
    }
  });

  it('the websocket carries the code as a subprotocol next to phi (a browser cannot set headers there)', () => {
    expect(wsProtocols('')).toBeUndefined();
    const p = wsProtocols('รหัส+/=code')!;
    expect(p[0]).toBe('phi');
    expect(p[1]).toMatch(/^phi-code\.[A-Za-z0-9_-]+$/);
    expect(Buffer.from(p[1].slice('phi-code.'.length), 'base64url').toString('utf8')).toBe('รหัส+/=code');
  });

  it('says what a test found, in one line', () => {
    const h = { ok: true, mock: false, live: { available: true, model: 'm', minutesPerDay: 20, minutesLeft: 12.6, active: 0 }, stt: { available: false, model: 'c', callsLeftToday: 1 }, budget: { ok: true, spentUsd: 0, capUsd: 30 } } as Health;
    expect(probeMessage({ state: 'ok', health: h }, 'https://x')).toBe('Connected · 12 live minutes left today');
    expect(probeMessage({ state: 'wrong-code', health: null }, 'https://x')).toBe('Wrong code');
    expect(probeMessage({ state: 'unreachable', health: null }, 'https://x', 'https://phi-app.web.app')).toMatch(/^Not reachable.*https:\/\/phi-app\.web\.app/);
    expect(probeMessage({ state: 'blocked', health: null }, 'http://127.0.0.1:8787')).toMatch(/^Not reachable/);
    expect(probeMessage({ state: 'ok', health: { ...h, live: { ...h.live, available: false } } }, 'https://x')).toMatch(/not set up/);
  });
});
import { buildPersona, HINT_AFTER, knownItems, MAX_NEW_WORDS, MAX_WORDS, newWordsFor, taskItemIds } from './persona';
import { checkSegmentalDetail, encodeWav } from './segmental';
import { glossFor, LiveRun, liveTools, matchOption, mentionsTones, scriptFor, similarity, TOOL_NAMES } from './tools';

const ITEM = new Map(SEED_ITEMS.map((i) => [i.id, i]));
const item = (id: string) => ITEM.get(id.replace(/^item:/, ''));

class FakeEngine {
  log: Answer[] = [];
  known = new Set<string>();
  answer(a: Answer): AnswerResult {
    this.log.push(a);
    const counted = a.counts !== false && this.known.has(`${a.ref}:${a.skill}`);
    return { counted, six: null, due: null, retestAt: null, becameLeech: false };
  }
}
function knowAll(f: FakeEngine) {
  for (const it of SEED_ITEMS) for (const k of it.skills) f.known.add(`item:${it.id}:${k}`);
  for (const it of SEED_ITEMS) f.known.add(`item:${it.id}:say`);
}

function persona(task: StreetTaskBuilt, over: Partial<Parameters<typeof buildPersona>[0]> = {}) {
  const person = CAST.find((c) => c.id === task.person)!;
  const place = PLACES.find((p) => p.id === task.place)!;
  const known = SEED_ITEMS.filter((i) => ['hello', 'thank-you', 'sorry', 'khrap', 'kha-statement'].includes(i.id));
  const newItems = newWordsFor(task, new Set(known.map((i) => i.id)), item);
  return buildPersona({ task, person, place, identity: 'm', adult: false, known, newItems, day: 4, ...over });
}

const right = (t: StreetTaskBuilt, node: string) => t.nodes[node].options.find((o) => o.correct !== false)!;

describe('persona', () => {
  const t = taskById('food-water', 'm')!;
  const p = persona(t);

  it('names the character, the place, the goal and the steps', () => {
    expect(p).toContain('You are Nok');
    expect(p).toContain('food stall');
    expect(p).toContain('ร้านอาหาร');
    expect(p).toContain(t.title);
    for (const s of t.steps) expect(p).toContain(`"${s}"`);
    expect(p).toContain(t.nodes.order.thai);
  });

  it('holds the language rules: Thai only, known words, at most 12 words, hint after 2 tries in Thai then English', () => {
    expect(MAX_WORDS).toBe(12);
    expect(HINT_AFTER).toBe(2);
    expect(p).toMatch(/Speak only Thai/);
    expect(p).toMatch(/At most 12 words per turn/);
    expect(p).toMatch(/2 times in a row.*first say a model reply in Thai, then the same in English/s);
    expect(p).toMatch(/WORD LIST/);
    expect(p).toContain('สวัสดี');
  });

  it('adds at most three new words, from the task, and only words the learner has not met', () => {
    const known = new Set(['hello', 'thank-you']);
    const nw = newWordsFor(t, known, item);
    expect(nw.length).toBeLessThanOrEqual(MAX_NEW_WORDS);
    for (const w of nw) {
      expect(taskItemIds(t)).toContain(w.id);
      expect(known.has(w.id)).toBe(false);
    }
    const all = new Set(SEED_ITEMS.map((i) => i.id));
    expect(newWordsFor(t, all, item)).toEqual([]);
  });

  it('known words come from the engine refs and content', () => {
    const k = knownItems(['item:hello', 'letter:ko-kai', 'item:nope', 'item:coffee'], item);
    expect(k.map((i) => i.id)).toEqual(['hello', 'coffee']);
  });

  it('follows the speaking identity for the learner and the character', () => {
    expect(p).toMatch(/learner speaks as a man: ครับ/);
    expect(p).toMatch(/You are a woman: end polite statements with ค่ะ/);
    const f = persona(t, { identity: 'f' });
    expect(f).toMatch(/learner speaks as a woman: ค่ะ/);
    const taxi = persona(taskById('taxi-stop-here', 'm')!);
    expect(taxi).toMatch(/You are a man: end polite sentences with ครับ/);
  });

  it('guardrails: no flirting outside After Hours, no drug coaching, no real people, adults only, no tone judging', () => {
    expect(p).toMatch(/no flirting, romance or innuendo/);
    expect(p).toMatch(/No coaching on obtaining drugs/);
    expect(p).toMatch(/No real people/);
    expect(p).toMatch(/an adult/);
    expect(p).toMatch(/Never comment on, grade or correct the learner's tones/);
  });

  it('After Hours: only with the 18+ setting, consent-forward, never explicit', () => {
    const ah = taskById('after-hours-1', 'm')!;
    expect(() => persona(ah, { adult: false })).toThrow(/18\+/);
    const a = persona(ah, { adult: true });
    expect(a).toMatch(/After Hours, 18\+/);
    expect(a).toMatch(/non-explicit flirting/);
    expect(a).toMatch(/a no is final/);
    expect(a).toMatch(/Never sexual or explicit/);
  });

  it('keeps adult-only words out of the list when 18+ is off', () => {
    const adultItem: Item = { ...SEED_ITEMS[0], id: 'x-adult', thai: 'ทดสอบ', adult: true };
    const q = persona(t, { known: [adultItem, SEED_ITEMS[0]] });
    expect(q).not.toContain('ทดสอบ');
  });
});

describe('tools', () => {
  it('declares exactly slotFilled, questComplete and flagUnsafe, with the task steps as slots', () => {
    const t = taskById('food-water', 'm')!;
    const decl = liveTools(t.steps);
    expect(decl.map((d) => d.name)).toEqual([...TOOL_NAMES]);
    const slot = (decl[0].parameters as { properties: { slot: { enum: string[] } } }).properties.slot;
    expect(slot.enum).toEqual(t.steps);
  });

  it('builds the script the mock server answers from', () => {
    const t = taskById('food-water', 'f')!;
    const s = scriptFor(t);
    expect(s.start).toBe(t.start);
    expect(s.nodes.find((n) => n.id === 'ice')!.slot).toBe('Ice');
    expect(s.nodes.find((n) => n.id === 'order')!.options.some((o) => o.correct)).toBe(true);
  });

  it('matches by consonants and vowels, ignoring tone marks and the polite ending', () => {
    const t = taskById('food-water', 'm')!;
    const want = right(t, 'order');
    expect(matchOption(t.nodes.order, want.thai)?.option).toBe(want);
    expect(matchOption(t.nodes.order, want.thai.replace(/[่-๋]/g, ''))?.option).toBe(want);
    expect(matchOption(t.nodes.order, want.thai.replace(/ครับ$/, ''))?.option).toBe(want);
    expect(matchOption(t.nodes.order, 'อะไรก็ได้')).toBeNull();
    expect(similarity('เสื้อ', 'เสือ')).toBe(1);
  });

  it('a spoken reply that matches the step logs say reviews under live:<task>, and counts', () => {
    const t = taskById('food-water', 'm')!;
    const f = new FakeEngine();
    knowAll(f);
    const run = new LiveRun(t, f);
    const u = run.learnerSaid(right(t, 'order').thai);
    expect(u.right).toBe(true);
    expect(u.counted.length).toBeGreaterThan(0);
    expect(f.log.every((a) => a.source === 'live:food-water' && a.skill === 'say')).toBe(true);
    expect(f.log.every((a) => a.counts === true)).toBe(true);
  });

  it('unmatched, wrong and typed replies are logged but never counted', () => {
    const t = taskById('food-water', 'm')!;
    const f = new FakeEngine();
    knowAll(f);
    const run = new LiveRun(t, f);
    const a = run.learnerSaid('อะไรก็ได้');
    const wrong = t.nodes.order.options.find((o) => o.correct === false)!;
    const b = run.learnerSaid(wrong.thai);
    const c = run.learnerSaid(right(t, 'order').thai, true);
    expect([a.counted, b.counted, c.counted].flat()).toEqual([]);
    expect(f.log.length).toBeGreaterThan(0);
    expect(f.log.every((x) => x.counts === false)).toBe(true);
    expect(run.stuck).toBe(2);
    expect(run.learnerSaid('').logged).toBe(0);
  });

  it('slotFilled moves the task, applies effects, counts hear for the line, and says once', () => {
    const t = taskById('food-water', 'm')!;
    const f = new FakeEngine();
    knowAll(f);
    const run = new LiveRun(t, f);
    run.learnerSaid(right(t, 'order').thai);
    const n0 = f.log.length;
    let r = run.onTool('slotFilled', { slot: 'Order', value: 'a coffee', learnerThai: right(t, 'order').thai });
    expect(r.response.ok).toBe(true);
    expect(r.response.nextStep).toBe('Ice');
    expect(f.log.length).toBe(n0); // say already counted from the transcript; 'order' has no heard items
    expect(run.node).toBe('ice');
    // ice: the right reply depends on hearing the question
    r = run.onTool('slotFilled', { slot: 'Ice', value: 'no ice', learnerThai: right(t, 'ice').thai });
    expect(r.kind).toBe('slot');
    const hear = f.log.filter((a) => a.skill === 'hear');
    expect(hear.map((a) => a.ref).sort()).toEqual(t.nodes.ice.heard!.map((i) => `item:${i}`).sort());
    expect(hear.every((a) => a.counts === true && a.source === 'live:food-water')).toBe(true);
    // the say for ice came through the tool
    expect(f.log.some((a) => a.skill === 'say' && (a.data as { via?: string }).via === 'tool')).toBe(true);
    run.onTool('slotFilled', { slot: 'Pay', value: 'forty right', learnerThai: right(t, 'pay').thai });
    expect(run.node).toBe('paid');
    run.onTool('slotFilled', { slot: 'Pay', value: 'thank you', learnerThai: right(t, 'paid').thai });
    expect(run.baht).toBe(-40);
    expect(run.outcome).toBe('done');
    expect(run.onTool('questComplete', {}).response.ok).toBe(true);
    expect(run.accuracy()).toBe(1);
  });

  it('try again: goes back to the line just answered, as often as wanted, never paying or counting twice', () => {
    const t = taskById('food-water', 'm')!;
    const f = new FakeEngine();
    knowAll(f);
    const run = new LiveRun(t, f);
    run.learnerSaid(right(t, 'order').thai);
    run.onTool('slotFilled', { slot: 'Order', value: 'a coffee', learnerThai: right(t, 'order').thai });
    run.learnerSaid(right(t, 'ice').thai);
    run.onTool('slotFilled', { slot: 'Ice', value: 'no ice', learnerThai: right(t, 'ice').thai });
    expect(run.node).toBe('pay');
    const counted = f.log.filter((a) => a.counts !== false).length;
    const baht = run.baht;
    for (let i = 0; i < 3; i++) {
      // back to the ice line, say it again, the character confirms again
      expect(run.retry()?.id).toBe('ice');
      expect(run.node).toBe('ice');
      expect(run.step).toBe(t.nodes.ice.step);
      run.learnerSaid(right(t, 'ice').thai);
      run.onTool('slotFilled', { slot: 'Ice', value: 'no ice', learnerThai: right(t, 'ice').thai });
      expect(run.node).toBe('pay');
    }
    expect(f.log.filter((a) => a.counts !== false).length).toBe(counted);
    expect(run.baht).toBe(baht);
    expect(run.slotsFilled).toBe(2);
    expect(run.accuracy()).toBe(1);
    // having already spoken at the new step, try again stays on it
    run.learnerSaid('ขอโทษ');
    expect(run.retry()?.id).toBe('pay');
    // the last step, just answered: back to it instead of ending
    run.onTool('slotFilled', { slot: 'Pay', value: 'forty right', learnerThai: right(t, 'pay').thai });
    run.learnerSaid(right(t, 'paid').thai);
    run.onTool('slotFilled', { slot: 'Pay', value: 'thank you', learnerThai: right(t, 'paid').thai });
    expect(run.outcome).toBe('done');
    expect(run.retry()?.id).toBe('paid');
    expect(run.outcome).toBeNull();
    run.onTool('slotFilled', { slot: 'Pay', value: 'thank you', learnerThai: right(t, 'paid').thai });
    expect(run.outcome).toBe('done');
    expect(run.baht).toBe(-40);
  });

  it('English shown for the line: hear is logged but does not count', () => {
    const t = taskById('food-water', 'm')!;
    const f = new FakeEngine();
    knowAll(f);
    const run = new LiveRun(t, f);
    run.onTool('slotFilled', { slot: 'Order', value: 'coffee', learnerThai: right(t, 'order').thai });
    run.glossShown();
    run.onTool('slotFilled', { slot: 'Ice', value: 'no ice', learnerThai: right(t, 'ice').thai });
    const hear = f.log.filter((a) => a.skill === 'hear');
    expect(hear.length).toBeGreaterThan(0);
    expect(hear.every((a) => a.counts === false)).toBe(true);
  });

  it('rejects a wrong reply, an unknown slot, an earlier slot and an early questComplete', () => {
    const t = taskById('food-water', 'm')!;
    const run = new LiveRun(t, new FakeEngine());
    const wrong = t.nodes.order.options.find((o) => o.correct === false)!;
    run.learnerSaid(wrong.thai);
    expect(run.onTool('slotFilled', { slot: 'Order', value: 'water', learnerThai: wrong.thai }).response.ok).toBe(false);
    expect(run.onTool('slotFilled', { slot: 'Dessert', value: 'x' }).response.ok).toBe(false);
    expect(run.onTool('questComplete', {}).response.ok).toBe(false);
    run.onTool('slotFilled', { slot: 'Order', value: 'coffee', learnerThai: right(t, 'order').thai });
    expect(run.onTool('slotFilled', { slot: 'Order', value: 'coffee' }).response.ok).toBe(false);
    expect(run.node).toBe('ice');
  });

  it('flagUnsafe is counted and answered with a redirect', () => {
    const run = new LiveRun(taskById('bar-beer', 'm')!, new FakeEngine());
    const r = run.onTool('flagUnsafe', { category: 'drugs' });
    expect(r.kind).toBe('unsafe');
    expect(run.flags).toBe(1);
    expect(String(r.response.instruction)).toMatch(/Redirect/);
  });

  it('After Hours: pushing after a no drops comfort, and at zero she leaves', () => {
    const t = taskById('after-hours-1', 'm')!;
    const run = new LiveRun(t, new FakeEngine(), { comfort: 2 });
    const rude = t.nodes.hello.options.find((o) => (o.comfort ?? 0) <= -3)!;
    run.learnerSaid(rude.thai);
    expect(run.comfort).toBe(0);
    expect(run.outcome).toBe('left');
  });

  it('tone talk is marked unverified; English glosses come from known items', () => {
    expect(mentionsTones('your tones were perfect')).toBe(true);
    expect(mentionsTones('เสียงดีมาก')).toBe(true);
    expect(mentionsTones('สวัสดีค่ะ')).toBe(false);
    const g = glossFor('ขอกาแฟหน่อย', SEED_ITEMS);
    expect(g.toLowerCase()).toContain('coffee');
  });

  it('every task in both identities maps to a script with its steps as slots', () => {
    for (const id of ['m', 'f'] as const) {
      for (const t of tasksFor(id)) {
        const s = scriptFor(t);
        for (const n of s.nodes) expect(t.steps).toContain(n.slot);
      }
    }
  });
});

describe('audio helpers', () => {
  it('downsamples 48 kHz floats to 16 kHz PCM16 and back', () => {
    const f = new Float32Array(4800).fill(0.5);
    const p = toPcm16k(f, 48000);
    expect(p.length).toBe(1600);
    expect(p[10]).toBe(16383);
    const back = pcm16ToFloat(p.buffer as ArrayBuffer);
    expect(Math.abs(back[100] - 0.5)).toBeLessThan(0.001);
  });

  it('encodes a 16 kHz WAV header', () => {
    const w = encodeWav(new Float32Array(160), 16000);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(new DataView(w.buffer).getUint32(24, true)).toBe(16000);
    expect(w.length).toBe(44 + 320);
  });

  it('live is offered only when the server is up, can reach Gemini or is mock, and minutes are left', () => {
    const h = { ok: true, mock: false, live: { available: true, model: 'm', minutesPerDay: 20, minutesLeft: 5, active: 0 }, stt: { available: true, model: 'c', callsLeftToday: 1 }, budget: { ok: true, spentUsd: 0, capUsd: 150 } } as Health;
    expect(liveUsable(h)).toBe(true);
    expect(liveUsable(null)).toBe(false);
    expect(liveUsable({ ...h, live: { ...h.live, minutesLeft: 0 } })).toBe(false);
    expect(liveUsable({ ...h, budget: { ...h.budget, ok: false } })).toBe(false);
    expect(liveUsable({ ...h, live: { ...h.live, available: false } })).toBe(false);
    expect(wsUrl('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/live');
  });

  it('offline or no server: health is null and the segmental check is null', async () => {
    expect(await checkHealth('http://127.0.0.1:9', 500)).toBeNull();
    expect(await checkSegmentalDetail(new Blob([new Uint8Array(4000)]), 'สวัสดี', 'http://127.0.0.1:9', 500)).toBeNull();
  });
});

// ---------- the round trip through the real server code, in MOCK mode ----------

type ServerMod = {
  createPhiServer(over: Record<string, unknown>, opts: { quiet?: boolean; tempDir?: boolean }): {
    listen(): Promise<{ url: string }>;
    close(): Promise<void>;
    hub: { mockDelayMs: number };
  };
};
const serverPath = new URL('../../../server/src/app.ts', import.meta.url).href;
const server = (await import(/* @vite-ignore */ serverPath).catch(() => null)) as ServerMod | null;

describe.runIf(!!server)('mock round trip through the local server', () => {
  async function boot(over: Record<string, unknown> = {}) {
    // no access code unless a test sets one (an owner's .env.local must not change the tests)
    const s = server!.createPhiServer({ mock: true, port: 0, host: '127.0.0.1', accessCode: null, requireCode: false, ...over }, { quiet: true, tempDir: true });
    s.hub.mockDelayMs = 5;
    const { url } = await s.listen();
    return { s, url };
  }

  it('health, then a whole task spoken through Live, logged as reviews', async () => {
    const { s, url } = await boot();
    try {
      const h = await checkHealth(url);
      expect(h?.mock).toBe(true);
      expect(liveUsable(h)).toBe(true);

      const t = taskById('food-water', 'm')!;
      const f = new FakeEngine();
      knowAll(f);
      const run = new LiveRun(t, f);
      const npc: string[] = [];
      let completed!: () => void;
      const done = new Promise<void>((r) => (completed = r));
      let client!: LiveClient;
      client = new LiveClient({
        base: url,
        audio: false,
        handlers: {
          transcript: (m) => {
            if (!m.final) return;
            if (m.who === 'npc') {
              npc.push(m.text);
              // answer each line by voice: half a second of "speech"
              void (async () => {
                await client.talk(true);
                client.sendAudio(new Int16Array(8000));
                await client.talk(false);
              })();
            } else run.learnerSaid(m.text);
          },
          tool: ({ name, args }) => {
            const r = run.onTool(name, args);
            if (name === 'questComplete') completed();
            return r.response;
          },
        },
      });
      await client.start({ type: 'start', taskId: t.id, systemInstruction: persona(t), tools: liveTools(t.steps), voice: 'f', adult: false, adultTask: false, script: scriptFor(t) });
      expect(client.mock).toBe(true);
      await done;
      client.stop();
      expect(npc[0]).toBe(t.nodes.order.thai);
      expect(run.outcome).toBe('done');
      expect(run.baht).toBe(-40);
      const says = f.log.filter((a) => a.skill === 'say' && a.counts);
      const hears = f.log.filter((a) => a.skill === 'hear' && a.counts);
      expect(says.length).toBeGreaterThan(0);
      expect(hears.length).toBeGreaterThan(0);
      expect(f.log.every((a) => a.source === 'live:food-water')).toBe(true);
    } finally {
      await s.close();
    }
  });

  it('the server refuses an 18+ scene with the setting off', async () => {
    const { s, url } = await boot();
    try {
      const t = taskById('after-hours-1', 'm')!;
      const errors: string[] = [];
      const c = new LiveClient({ base: url, audio: false, handlers: { error: (code) => errors.push(code) } });
      await expect(c.start({ type: 'start', taskId: t.id, systemInstruction: 'x', tools: [], voice: 'f', adult: false, adultTask: true })).rejects.toThrow();
      expect(errors).toEqual(['adult-off']);
    } finally {
      await s.close();
    }
  });

  it('the segmental check goes through /stt (fake recogniser)', async () => {
    const { s, url } = await boot();
    try {
      const r = await checkSegmentalDetail(new Blob([encodeWav(new Float32Array(16000), 16000)], { type: 'audio/wav' }), 'ขอกาแฟ', url);
      expect(r?.mock).toBe(true);
      expect(r?.similarity).toBe(1);
    } finally {
      await s.close();
    }
  });

  it('a server with an access code: the saved address and code reach /health, /live and /stt', async () => {
    const CODE = 'the-owners-code-1234';
    const { s, url } = await boot({ requireCode: true, accessCode: CODE });
    const kv = new FakeKv();
    bindLiveStore(kv);
    try {
      expect((await probeServer(url, '')).state).toBe('needs-code');
      expect((await probeServer(url, 'not-it')).state).toBe('wrong-code');
      const ok = await probeServer(url, CODE);
      expect(ok.state).toBe('ok');
      expect(ok.health?.needsCode).toBe(true);
      saveLiveServer({ url, code: CODE });
      const h = await checkHealth();
      expect(h?.mock).toBe(true);
      expect(liveUsable(h)).toBe(true);
      // a conversation with no base given uses the saved server and code
      const c = new LiveClient({ audio: false, handlers: {} });
      await c.start({ type: 'start', taskId: 'x', systemInstruction: 'x', tools: [], voice: 'f', adult: false, adultTask: false });
      expect(c.mock).toBe(true);
      c.stop();
      const r = await checkSegmentalDetail(new Blob([encodeWav(new Float32Array(16000), 16000)], { type: 'audio/wav' }), 'ขอกาแฟ');
      expect(r?.similarity).toBe(1);
      // a wrong saved code: the conversation is refused with a reason
      saveLiveServer({ url, code: 'not-it' });
      const errors: string[] = [];
      const bad = new LiveClient({ audio: false, handlers: { error: (code) => errors.push(code) } });
      await expect(bad.start({ type: 'start', taskId: 'x', systemInstruction: 'x', tools: [], voice: 'f', adult: false, adultTask: false })).rejects.toThrow();
      expect(errors).toEqual(['access']);
    } finally {
      bindLiveStore(null);
      await s.close();
    }
  });

  it('a public server with no code set says it is locked', async () => {
    const { s, url } = await boot({ requireCode: true, accessCode: null });
    try {
      expect((await probeServer(url, 'anything-at-all')).state).toBe('locked');
    } finally {
      await s.close();
    }
  });
});
