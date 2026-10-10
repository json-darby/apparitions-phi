// Phase 4: the real sound service behind the one shared interface. Plays the
// course's recorded clips (Web Audio, decoded lazily, small LRU cache), records
// the learner, measures pitch on the device and scores tones. When the course
// has no audio, or the learner chose "Captions only", it behaves exactly like
// CaptionSound (it delegates to one), so no screen changes.
//
// Every sound comes from the course's own clips. A line with no clip, or one
// whose clip will not play, shows as a caption only: nothing is synthesised
// and the device's own voice is never used.

import { CaptionSound, captionMs, genderOfText, type PlayRequest, type Recording, type RecordReview, type RecordTarget, type SoundService, type SoundState, type SpeechScore } from './sound';
import type { Content, CourseLine } from '../content/repo';
import type { Item, Speed, Tone, VoiceId } from '../content/types';
import type { Settings } from '../core/settings';
import type { Store } from '../db/store';
import { trackPitch } from './pitch';
import { analyseTones, combineScores, DEFAULT_MID_HZ, rangeFromMid, type SpeakerRange, type ToneAnalysis } from './score';
import { MicError, openMic, type MicSession } from './recorder';

export interface SoundConfig {
  content: Content;
  settings: Settings;
  store?: Store;
}

interface AudioEntry {
  audio: Record<string, string | null>;
  pitch: (number | null)[][] | null;
  /** normalised texts this clip set says */
  texts: Set<string>;
  /** for a man's and a woman's version (ผมกินไก่ / ฉันกินไก่): which sex says each text, so each is read by its own voices */
  formSex?: Map<string, 'm' | 'f'>;
}

type Forms = { m: { thai: string }; f: { thai: string } };
/** Which sex says each of two differing forms, by normalised text (both with and without the polite ending). */
function formSexOf(forms: Forms | undefined): Map<string, 'm' | 'f'> | undefined {
  if (!forms || bare(forms.m.thai) === bare(forms.f.thai)) return undefined;
  const m = new Map<string, 'm' | 'f'>();
  for (const s of ['m', 'f'] as const) {
    m.set(key(forms[s].thai), s);
    m.set(bare(forms[s].thai), s);
  }
  return m;
}

const ROTATION: VoiceId[] = ['f1', 'm1', 'f2', 'm2'];
/** Sentences ship at normal speed only (owner's choice); slow plays them at this rate with pitch kept, so tones stay true. */
const SLOW_STRETCH = 0.75;
const PARTICLE = /(ครับ|ค่ะ|คะ|ค่า)$/;

/** Text key: no spaces or zero-width characters. */
function key(thai: string): string {
  return thai.replace(/[\s​‌‍ ]/g, '');
}
function bare(thai: string): string {
  return key(thai).replace(PARTICLE, '');
}
/** The sex of a recorded voice slot: f1, f2 and x1 are women, m1, m2 and x2 are men; cast voices are their own. */
function sexOfVoice(v: string): 'm' | 'f' | null {
  if (/^f\d$/.test(v) || v === 'x1') return 'f';
  if (/^m\d$/.test(v) || v === 'x2') return 'm';
  return null;
}

/** Index from refs and texts to clip sets. */
class AudioIndex {
  byRef = new Map<string, AudioEntry>();
  byText = new Map<string, AudioEntry>();
  hasAudio = false;

  constructor(content: Content, extra?: Map<string, { audio: Record<string, string | null>; pitch: (number | null)[][] | null }>) {
    const addText = (t: string, e: AudioEntry) => {
      if (!t) return;
      if (!this.byText.has(t)) this.byText.set(t, e);
    };
    const live = (a: Record<string, string | null> | undefined) => !!a && Object.values(a).some(Boolean);
    const itemTexts = (it: Item) => {
      const s = new Set<string>([bare(it.thai)]);
      if (it.forms) { s.add(bare(it.forms.m.thai)); s.add(bare(it.forms.f.thai)); }
      return s;
    };
    for (const it of content.items) {
      const o = extra?.get(`item:${it.id}`);
      const audio = o?.audio ?? it.media?.audio;
      if (!live(audio)) continue;
      const e: AudioEntry = { audio: audio!, pitch: o?.pitch ?? it.media?.pitch ?? null, texts: itemTexts(it), formSex: formSexOf(it.forms) };
      this.byRef.set(`item:${it.id}`, e);
      for (const t of e.texts) addText(t, e);
    }
    for (const l of content.letters) {
      const o = extra?.get(`letter:${l.id}`);
      const audio = o?.audio ?? l.media?.audio;
      if (!live(audio)) continue;
      this.byRef.set(`letter:${l.id}`, { audio: audio!, pitch: l.media?.pitch ?? null, texts: new Set() });
    }
    for (const p of content.patterns) {
      if (!live(p.media?.audio)) continue;
      const e: AudioEntry = { audio: p.media.audio, pitch: p.media.pitch ?? null, texts: new Set([bare(p.frame)]) };
      this.byRef.set(`pattern:${p.id}`, e);
    }
    const lines: CourseLine[] = [...content.lines.values()];
    for (const l of lines) {
      if (!live(l.audio)) continue;
      const e: AudioEntry = { audio: l.audio, pitch: l.pitch ?? null, texts: new Set([key(l.thai), bare(l.thai)]), formSex: formSexOf(l.forms) };
      // a two-form line also answers to its woman's (or man's) words
      if (l.forms) for (const f of [l.forms.m, l.forms.f]) { e.texts.add(key(f.thai)); e.texts.add(bare(f.thai)); }
      this.byRef.set(`line:${l.id}`, e);
      if (!this.byText.has(key(l.thai))) this.byText.set(key(l.thai), e);
    }
    for (const l of lines) {
      if (!live(l.audio)) continue;
      const e = this.byRef.get(`line:${l.id}`)!;
      addText(bare(l.thai), e);
      if (l.forms) for (const f of [l.forms.m, l.forms.f]) { addText(key(f.thai), e); addText(bare(f.thai), e); }
    }
    this.hasAudio = this.byRef.size > 0;
  }

  /** The clip set that says this request's text, or null. */
  resolve(req: { ref?: string; thai: string }): AudioEntry | null {
    const k = key(req.thai);
    const b = bare(req.thai);
    if (req.ref) {
      const e = this.byRef.get(req.ref);
      if (e && req.ref.startsWith('letter:')) return e;
      if (e && (e.texts.has(b) || e.texts.has(k))) return e;
    }
    return this.byText.get(k) ?? this.byText.get(b) ?? null;
  }
}

function parseKey(k: string): { voice: string; speed: string } {
  const i = k.lastIndexOf('.');
  return i < 0 ? { voice: k, speed: 'normal' } : { voice: k.slice(0, i), speed: k.slice(i + 1) };
}

/** Resolve a stored path (relative to the app root) to a URL. */
function urlOf(path: string): string {
  if (/^(blob:|data:|https?:)/.test(path)) return path;
  try {
    return new URL(path.replace(/^\//, ''), document.baseURI).href;
  } catch {
    return path;
  }
}

// ---------------------------------------------------------------- noise bed

function pinkNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      // Paul Kellet's pink filter, plus a brown rumble for traffic
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.06 + brown * 1.6;
      b6 = w * 0.115926;
    }
    // crossfade the loop seam
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) d[n - f + i] = d[n - f + i] * (1 - i / f) + d[i] * (i / f);
  }
  return buf;
}

/** Short knocks and clinks: cutlery, a wok, a dropped crate. */
function clatter(ctx: BaseAudioContext, kind: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.35);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const freqs = kind === 0 ? [2310, 3170, 4420] : kind === 1 ? [880, 1370, 2050] : [190, 330];
  const decay = kind === 0 ? 18 : kind === 1 ? 11 : 30;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t + f);
    v = v / freqs.length + (Math.random() * 2 - 1) * (kind === 2 ? 0.9 : 0.25) * Math.exp(-t * 60);
    d[i] = v * Math.exp(-t * decay) * 0.5;
  }
  return buf;
}

interface NoiseBed {
  stop(): void;
}

const noiseCache = new WeakMap<BaseAudioContext, { bed: AudioBuffer; hits: AudioBuffer[] }>();

function startNoise(ctx: AudioContext, level = 0.22): NoiseBed {
  let c = noiseCache.get(ctx);
  if (!c) {
    c = { bed: pinkNoise(ctx, 4), hits: [0, 1, 2].map((k) => clatter(ctx, k)) };
    noiseCache.set(ctx, c);
  }
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.25);
  out.connect(ctx.destination);
  const src = ctx.createBufferSource();
  src.buffer = c.bed;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  src.connect(lp).connect(out);
  src.start();
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hit = () => {
    if (!alive) return;
    const h = ctx.createBufferSource();
    h.buffer = c!.hits[Math.floor(Math.random() * c!.hits.length)];
    h.playbackRate.value = 0.8 + Math.random() * 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.25 + Math.random() * 0.6;
    let node: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      g.connect(p);
      node = p;
    }
    h.connect(g);
    node.connect(out);
    h.start();
    timer = setTimeout(hit, 250 + Math.random() * 900);
  };
  timer = setTimeout(hit, 200);
  return {
    stop() {
      alive = false;
      if (timer) clearTimeout(timer);
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.3);
      setTimeout(() => {
        try { src.stop(); } catch { /* */ }
        out.disconnect();
      }, 400);
    },
  };
}

// ---------------------------------------------------------------- segmental (optional, online)

type SegmentalFn = (blob: Blob, thai: string) => Promise<number | null>;
const segmentalModules = import.meta.glob('../live/segmental.ts');

async function onlineSegmental(blob: Blob | undefined, thai: string, timeoutMs = 6000): Promise<number | null> {
  const load = segmentalModules['../live/segmental.ts'];
  if (!load || !blob || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  try {
    const mod = (await load()) as { checkSegmental?: SegmentalFn };
    if (typeof mod.checkSegmental !== 'function') return null;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    const v = await Promise.race([mod.checkSegmental(blob, thai), timeout]);
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the service

/** Decoded-audio cache budget (bytes of float samples). */
const CACHE_BYTES = 48 * 1024 * 1024;
/** Review screen stays up this long before the take is handed back. */
const REVIEW_MS = 2800;

interface Take {
  rec: Recording;
  analysis: ToneAnalysis | null;
}

export class AudioSound implements SoundService {
  private captions = new CaptionSound();
  private state: SoundState = { caption: null, recording: null };
  private listeners = new Set<() => void>();
  private cfg: SoundConfig | null = null;
  private index: AudioIndex | null = null;
  private indexFor: Content | null = null;
  private fixture: Map<string, { audio: Record<string, string | null>; pitch: (number | null)[][] | null }> | null = null;
  private seq = 0;
  private rot = new Map<string, number>();

  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private bytes = 0;
  private loading = new Map<string, Promise<AudioBuffer>>();
  private playId = 0;
  private playDone: (() => void) | null = null;
  private stopPlayback: (() => void) | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;

  private recDone: ((r: Recording | null) => void) | null = null;
  private mic: MicSession | null = null;
  private vad: ReturnType<typeof setInterval> | null = null;
  private reviewTimer: ReturnType<typeof setTimeout> | null = null;
  private take: Take | null = null;
  private takes = new WeakMap<Recording, Take>();
  private scores = new WeakMap<Recording, Promise<SpeechScore | null>>();

  constructor() {
    this.captions.subscribe(() => this.emit());
    if (typeof window !== 'undefined') {
      // iPhone and iPad: Web Audio follows the ring/silent switch unless the page asks for media
      // playback (Safari 16.4+), so a learner with the ringer off would hear nothing.
      try {
        const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (s) s.type = 'playback';
      } catch { /* no Audio Session API */ }
      // Safari starts audio only from a completed tap (touchend or click), not from pointerdown,
      // so the first of any of these resumes the context and plays one silent frame to unlock it.
      const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
      const unlock = () => {
        try {
          const ctx = this.ensureCtx();
          void ctx.resume();
          const src = ctx.createBufferSource();
          src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          src.connect(ctx.destination);
          src.start(0);
        } catch { /* no Web Audio */ }
        if (this.ctx?.state === 'running') for (const e of events) window.removeEventListener(e, unlock, true);
      };
      for (const e of events) window.addEventListener(e, unlock, true);
    }
  }

  // ---- config and mode

  get mode(): 'captions' | 'audio' {
    if (!this.cfg || this.cfg.settings.sound === 'captions') return 'captions';
    return this.audioIndex()?.hasAudio ? 'audio' : 'captions';
  }

  /** Called at boot and whenever content or settings change. */
  configure(cfg: SoundConfig) {
    const before = this.mode;
    this.cfg = cfg;
    const after = this.mode;
    if (before !== after) {
      this.stop();
      this.captions.stop();
      if (this.state.recording) this.finishRecording(true);
      if (this.captions.getState().recording) this.captions.finishRecording(true);
      this.emit();
    }
  }

  /** Dev only: synthetic clips for some items, so playback and scoring can be tried before the pipeline runs. */
  useFixture(entries: Map<string, { audio: Record<string, string | null>; pitch: (number | null)[][] | null }> | null) {
    const before = this.mode;
    this.fixture = entries;
    this.indexFor = null;
    if (before !== this.mode) this.emit();
  }

  get fixtureOn(): boolean {
    return !!this.fixture;
  }

  private audioIndex(): AudioIndex | null {
    const content = this.cfg?.content;
    if (!content) return null;
    if (this.indexFor !== content || !this.index) {
      this.index = new AudioIndex(content, this.fixture ?? undefined);
      this.indexFor = content;
    }
    return this.index;
  }

  getState(): SoundState {
    return this.mode === 'captions' ? this.captions.getState() : this.state;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
  private set(s: Partial<SoundState>) {
    this.state = { ...this.state, ...s };
    this.emit();
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error('no Web Audio');
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    return this.ctx;
  }

  // ---- playback

  /** Which clip to play: requested voice, then a rotation over the four voices, matching the speaker's sex when the text needs it. */
  pickClip(entry: AudioEntry, req: PlayRequest): { url: string; voice: string; speed: string; rate: number } | null {
    const speed: Speed = req.speed ?? this.cfg?.settings.speed ?? 'normal';
    // the speaker's sex from the words, or from which of a two-form entry's versions is asked for
    const g = genderOfText(req.thai) ?? entry.formSex?.get(key(req.thai)) ?? entry.formSex?.get(bare(req.thai)) ?? null;
    let keys = Object.entries(entry.audio).filter(([, v]) => !!v) as [string, string][];
    if (!keys.length) return null;
    // words that only a man (or only a woman) would say are never read by the other: drop those clips
    // whenever a clip in the right voice exists, whatever voice the screen asked for
    if (g) {
      const fits = keys.filter(([k]) => sexOfVoice(parseKey(k).voice) !== (g === 'm' ? 'f' : 'm'));
      if (fits.some(([k]) => sexOfVoice(parseKey(k).voice) === g)) keys = fits;
    }
    let want: string | undefined = req.castVoice && entry.audio[`${req.castVoice}.normal`] ? req.castVoice : req.voice;
    if (!want) {
      const pool = ROTATION.filter((v) => !g || v[0] === g);
      const r = this.rot.get(req.ref ?? req.thai) ?? Math.floor(Math.random() * pool.length);
      this.rot.set(req.ref ?? req.thai, r + 1);
      want = pool[r % pool.length];
    }
    let best: [string, string] | null = null;
    let bestScore = -1;
    for (const kv of keys) {
      const { voice, speed: sp } = parseKey(kv[0]);
      let s = 0;
      if (voice === want) s += 8;
      if (g && voice[0] === g && /^[fm]\d$/.test(voice)) s += 4;
      if (sp === speed) s += 6;
      if (/^[fm]\d$/.test(voice)) s += 1;
      if (s > bestScore) { bestScore = s; best = kv; }
    }
    if (!best) return null;
    const { voice, speed: sp } = parseKey(best[0]);
    // no recorded slow clip (sentences): slow the normal one down instead
    const rate = speed === 'slow' && sp !== 'slow' ? SLOW_STRETCH : 1;
    return { url: urlOf(best[1]), voice, speed: rate !== 1 ? 'slow' : sp, rate };
  }

  /** True when a clip exists for this request (screens may use it to decide on hints). */
  hasClip(req: { ref?: string; thai: string }): boolean {
    return this.mode === 'audio' && !!this.audioIndex()?.resolve(req);
  }

  private async load(url: string): Promise<AudioBuffer> {
    const hit = this.buffers.get(url);
    if (hit) {
      this.buffers.delete(url);
      this.buffers.set(url, hit); // LRU: most recent last
      return hit;
    }
    let p = this.loading.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`audio ${res.status}`);
        const data = await res.arrayBuffer();
        const ctx = this.ensureCtx();
        const buf = await ctx.decodeAudioData(data);
        const size = buf.length * buf.numberOfChannels * 4;
        this.buffers.set(url, buf);
        this.bytes += size;
        for (const [k, b] of this.buffers) {
          if (this.bytes <= CACHE_BYTES || k === url) break;
          this.buffers.delete(k);
          this.bytes -= b.length * b.numberOfChannels * 4;
        }
        return buf;
      })();
      this.loading.set(url, p);
      p.finally(() => this.loading.delete(url)).catch(() => undefined);
    }
    return p;
  }

  async play(req: PlayRequest): Promise<void> {
    if (this.mode === 'captions') return this.captions.play(req);
    this.stop();
    const id = ++this.seq;
    this.playId = id;
    const done = new Promise<void>((resolve) => {
      this.playDone = resolve;
    });
    void this.run(req, id);
    return done;
  }

  private finishPlay(id: number) {
    if (this.playId !== id) return;
    this.playId = 0;
    this.stopPlayback = null;
    if (this.capTimer) clearTimeout(this.capTimer);
    this.capTimer = null;
    if (this.state.caption?.id === id) this.set({ caption: null });
    const d = this.playDone;
    this.playDone = null;
    d?.();
  }

  private async run(req: PlayRequest, id: number) {
    const entry = this.audioIndex()?.resolve(req);
    const clip = entry ? this.pickClip(entry, req) : null;
    if (clip) {
      this.set({ caption: { ...req, voice: /^[fm]\d$/.test(clip.voice) ? (clip.voice as VoiceId) : req.voice, speed: clip.speed as Speed, id, until: Date.now() + captionMs(req), source: 'audio' } });
      try {
        if (await this.playClip(clip.url, req, id, clip.rate)) return;
      } catch {
        /* fall through to the caption */
      }
    }
    if (this.playId !== id) return;
    // no clip, or it would not play: the caption alone
    this.captionFor(req, id);
  }

  /**
   * Web Audio first; an <audio> element if decoding fails (some Safari builds and Ogg Opus).
   * A slowed clip (rate < 1) always uses the element: its preservesPitch keeps the
   * pitch, and so the tones, where a Web Audio playbackRate would lower them.
   */
  private async playClip(url: string, req: PlayRequest, id: number, rate = 1): Promise<boolean> {
    if (rate !== 1) return this.playElement(url, req, id, rate);
    let ctx: AudioContext | null = null;
    try {
      ctx = this.ensureCtx();
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      ctx = null;
    }
    if (ctx && ctx.state === 'running') {
      let buf: AudioBuffer | null = null;
      try {
        buf = await this.load(url);
      } catch {
        buf = null;
      }
      if (this.playId !== id) return true;
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 1;
        src.connect(g).connect(ctx.destination);
        const noise = req.noise ? startNoise(ctx) : null;
        const lead = noise ? 0.35 : 0;
        src.start(ctx.currentTime + lead);
        this.set({ caption: this.state.caption?.id === id ? { ...this.state.caption, until: Date.now() + (buf.duration + lead) * 1000 } : this.state.caption });
        await new Promise<void>((resolve) => {
          const end = () => {
            noise?.stop();
            resolve();
          };
          src.onended = end;
          this.stopPlayback = () => {
            src.onended = null;
            try { src.stop(); } catch { /* */ }
            end();
          };
        });
        this.finishPlay(id);
        return true;
      }
    }
    // media element fallback (also covers a suspended context)
    return this.playElement(url, req, id, 1);
  }

  private async playElement(url: string, req: PlayRequest, id: number, rate: number): Promise<boolean> {
    const el = new Audio(url);
    el.preload = 'auto';
    if (rate !== 1) {
      el.preservesPitch = true;
      (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      el.defaultPlaybackRate = rate;
      el.playbackRate = rate;
    }
    let noise: NoiseBed | null = null;
    if (req.noise) {
      try {
        const ctx = this.ensureCtx();
        if (ctx.state === 'running') noise = startNoise(ctx);
      } catch {
        noise = null;
      }
    }
    el.onloadedmetadata = () => {
      const cap = this.state.caption;
      if (cap?.id === id && Number.isFinite(el.duration)) this.set({ caption: { ...cap, until: Date.now() + (el.duration / rate) * 1000 } });
    };
    const ok = await new Promise<boolean>((resolve) => {
      el.onended = () => resolve(true);
      el.onerror = () => resolve(false);
      this.stopPlayback = () => {
        el.pause();
        resolve(true);
      };
      el.play().catch(() => resolve(false));
    });
    noise?.stop();
    if (this.playId !== id) return true;
    if (!ok) return false;
    this.finishPlay(id);
    return true;
  }

  /** The caption that stands in when there is no clip to play. */
  private captionFor(req: PlayRequest, id: number) {
    const ms = captionMs(req);
    this.set({ caption: { ...req, id, until: Date.now() + ms, source: 'caption' } });
    this.capTimer = setTimeout(() => this.finishPlay(id), ms);
    this.stopPlayback = () => undefined;
  }

  stop() {
    if (this.mode === 'captions') {
      this.captions.stop();
    }
    const id = this.playId;
    const s = this.stopPlayback;
    this.stopPlayback = null;
    s?.();
    if (id) this.finishPlay(id);
    if (this.state.caption) this.set({ caption: null });
  }

  // ---- recording

  /** The learner's range: microphone check, else adapted from past takes, else a default for the speaking identity. */
  private range(): SpeakerRange {
    const s = this.cfg?.settings;
    if (s?.voiceMidHz) return rangeFromMid(s.voiceMidHz);
    const adapted = this.cfg?.store?.get<{ midHz: number; n: number } | null>('voice_adapt', null);
    if (adapted?.midHz && adapted.n >= 3) return rangeFromMid(adapted.midHz);
    return rangeFromMid(DEFAULT_MID_HZ[s?.identity ?? 'm']);
  }

  private adapt(a: ToneAnalysis, n: number) {
    const store = this.cfg?.store;
    if (!store || this.cfg?.settings.voiceMidHz || !a.impliedMidHz || n < 2 || a.tone < 0.45) return;
    const cur = store.get<{ midHz: number; n: number } | null>('voice_adapt', null);
    const alpha = cur ? Math.max(0.1, 1 / (cur.n + 1)) : 1;
    const mid = cur ? Math.exp(Math.log(cur.midHz) * (1 - alpha) + Math.log(a.impliedMidHz) * alpha) : a.impliedMidHz;
    store.set('voice_adapt', { midHz: Math.round(mid * 10) / 10, n: (cur?.n ?? 0) + 1 });
  }

  private referenceFor(target: RecordTarget): (number | null)[][] | null {
    const e = this.audioIndex()?.resolve(target);
    return e?.pitch ?? null;
  }

  record(target: RecordTarget): Promise<Recording | null> {
    if (this.mode === 'captions') return this.captions.record(target);
    this.closeRecording(null);
    this.stop();
    const id = ++this.seq;
    this.set({ recording: { ...target, id, started: Date.now(), phase: 'asking' } });
    const p = new Promise<Recording | null>((resolve) => {
      this.recDone = resolve;
    });
    void this.listen(id);
    return p;
  }

  private current(id: number) {
    return this.state.recording?.id === id;
  }

  private async listen(id: number) {
    let mic: MicSession;
    try {
      mic = await openMic(this.ensureCtx());
    } catch (e) {
      if (!this.current(id)) return;
      const problem = e instanceof MicError ? e.problem : 'error';
      this.set({ recording: { ...this.state.recording!, phase: 'denied', problem } });
      return;
    }
    if (!this.current(id)) {
      mic.cancel();
      return;
    }
    this.mic = mic;
    const r = this.state.recording!;
    this.set({ recording: { ...r, phase: 'listening', started: Date.now(), review: undefined } });
    const n = Math.max(1, r.tones?.length ?? 1);
    const maxMs = r.maxMs ?? Math.min(9000, 2600 + n * 550);
    let spoke = 0;
    let quietSince = 0;
    let noise = 0.004;
    this.vad = setInterval(() => {
      const lv = mic.level();
      const t = mic.elapsed();
      if (t < 300) noise = Math.max(noise, lv * 1.5); // room level in the first moment
      const loud = lv > Math.max(0.02, noise * 3);
      if (loud) {
        spoke += 50;
        quietSince = 0;
      } else if (spoke > 150) {
        quietSince = quietSince || t;
      }
      if ((spoke > 150 && quietSince && t - quietSince > 850) || t > maxMs) void this.endTake(id);
    }, 50);
  }

  private clearTimers() {
    if (this.vad) clearInterval(this.vad);
    this.vad = null;
    if (this.reviewTimer) clearTimeout(this.reviewTimer);
    this.reviewTimer = null;
  }

  private async endTake(id: number) {
    if (!this.current(id) || this.state.recording?.phase !== 'listening') return;
    this.clearTimers();
    const mic = this.mic;
    this.mic = null;
    if (!mic) return;
    this.set({ recording: { ...this.state.recording!, phase: 'analysing' } });
    const cap = await mic.stop();
    // yield so the sheet paints "listening back" before the measurement runs
    await new Promise((r) => setTimeout(r, 16));
    if (!this.current(id)) return;
    const target = this.state.recording!;
    const tones = (target.tones ?? []) as Tone[];
    let analysis: ToneAnalysis | null = null;
    const track = cap.pcm.length ? trackPitch(cap.pcm, cap.sampleRate) : undefined;
    if (track && tones.length) {
      analysis = analyseTones(track, tones, { reference: this.referenceFor(target), range: this.range(), identity: this.cfg?.settings.identity });
    }
    const rec: Recording = { kind: 'audio', ms: cap.ms, blob: cap.blob ?? undefined, pitch: analysis?.pitch, track };
    const take: Take = { rec, analysis };
    this.take = take;
    this.takes.set(rec, take);
    if (analysis) this.adapt(analysis, tones.length);
    // start the (optional) online check now so it is ready when the screen asks
    void this.score(rec, target);
    const heard = !!analysis;
    const review: RecordReview = {
      tone: analysis ? analysis.tone : null,
      tones,
      syllables: analysis ? analysis.syllables.map((s) => s.contour) : tones.map(() => null),
      reference: analysis ? analysis.syllables.map((s) => s.reference) : [],
      heard: analysis ? analysis.syllables.map((s) => s.heard) : [],
      scores: analysis ? analysis.syllables.map((s) => s.score) : [],
      autoMs: heard || !tones.length ? REVIEW_MS : null,
    };
    if (!tones.length && track) review.tone = null;
    this.set({ recording: { ...target, phase: 'review', review } });
    if (review.autoMs != null) this.reviewTimer = setTimeout(() => this.closeRecording(take.rec, id), review.autoMs);
  }

  private closeRecording(result: Recording | null, id?: number) {
    if (id != null && !this.current(id)) return;
    this.clearTimers();
    this.mic?.cancel();
    this.mic = null;
    this.take = null;
    const done = this.recDone;
    this.recDone = null;
    if (this.state.recording) this.set({ recording: null });
    done?.(result);
  }

  finishRecording(skipped = false) {
    if (this.mode === 'captions' || (!this.state.recording && this.captions.getState().recording)) {
      this.captions.finishRecording(skipped);
      if (this.mode === 'captions') return;
    }
    const r = this.state.recording;
    if (!r) return;
    if (skipped) return this.closeRecording(null);
    switch (r.phase) {
      case 'listening':
        void this.endTake(r.id);
        return;
      case 'analysing':
        return;
      case 'review':
        return this.closeRecording(this.take?.rec ?? null);
      default:
        // still asking for the microphone, or it is blocked: "I said it" by tap
        return this.closeRecording({ kind: 'tap', ms: Date.now() - r.started });
    }
  }

  retry() {
    const r = this.state.recording;
    if (!r || this.mode === 'captions') return;
    if (r.phase !== 'review' && r.phase !== 'denied') return;
    this.clearTimers();
    this.take = null;
    const id = ++this.seq;
    this.set({ recording: { ...r, id, started: Date.now(), phase: 'asking', review: undefined, problem: undefined } });
    void this.listen(id);
  }

  /** Hold the review open (the learner is looking at it). */
  holdReview() {
    if (this.reviewTimer) clearTimeout(this.reviewTimer);
    this.reviewTimer = null;
    const r = this.state.recording;
    if (r?.review && r.review.autoMs != null) this.set({ recording: { ...r, review: { ...r.review, autoMs: null } } });
  }

  inputLevel(): number {
    return this.mic ? Math.min(1, this.mic.level() * 6) : 0;
  }

  async score(rec: Recording, target: RecordTarget): Promise<SpeechScore | null> {
    if (rec.kind !== 'audio') return null;
    const cached = this.scores.get(rec);
    if (cached) return cached;
    const p = (async (): Promise<SpeechScore | null> => {
      let a = this.takes.get(rec)?.analysis ?? null;
      if (!a && rec.track && target.tones?.length) {
        a = analyseTones(rec.track, target.tones, { reference: this.referenceFor(target), range: this.range(), identity: this.cfg?.settings.identity });
      }
      if (!a) return null;
      const seg = await onlineSegmental(rec.blob, target.thai);
      return {
        overall: combineScores(a.tone, seg),
        tones: a.syllables.map((s) => s.score),
        pitch: a.pitch,
        phonemes: seg ?? undefined,
        toneOnly: seg == null,
        heard: a.syllables.map((s) => s.heard),
        syllables: a.syllables.map((s) => s.contour),
        reference: a.syllables.map((s) => s.reference),
      };
    })();
    this.scores.set(rec, p);
    return p;
  }
}

/**
 * The course's clips are Ogg Opus. Every current browser plays them; Safari on iPhone and iPad
 * only from iOS / iPadOS 18.4 (March 2025). False on an older device, which then shows captions.
 */
export function clipsPlayable(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    return document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== '';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- offline warm-up

/**
 * The offline audio cache (the service worker serves clips from it; vite.config.ts names the same
 * cache). Its version moves whenever shipped clips change in place, same paths with new sound, so
 * no device keeps playing the old ones.
 */
export const AUDIO_CACHE = 'phi-audio-2';

/** Drop the audio caches of earlier versions. */
export async function dropOldAudioCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  for (const k of await caches.keys()) if (k.startsWith('phi-audio') && k !== AUDIO_CACHE) await caches.delete(k);
}

/** Every clip path the course references. */
export function allAudioPaths(content: Content): string[] {
  const s = new Set<string>();
  const add = (a: Record<string, string | null> | undefined) => {
    for (const v of Object.values(a ?? {})) if (v && !/^(blob:|data:)/.test(v)) s.add(v);
  };
  for (const x of content.items) add(x.media?.audio);
  for (const x of content.letters) add(x.media?.audio);
  for (const x of content.patterns) add(x.media?.audio);
  for (const l of content.lines.values()) add(l.audio);
  return [...s];
}

/**
 * Put every clip in the offline cache (the same cache the service worker
 * serves audio from). Resumable: clips already cached are skipped.
 */
export async function warmAudioCache(paths: string[], onProgress: (done: number, total: number, failed: number) => void, signal?: AbortSignal): Promise<{ done: number; failed: number }> {
  if (typeof caches === 'undefined') throw new Error('This browser has no offline cache.');
  try {
    await navigator.storage?.persist?.();
  } catch { /* optional */ }
  const cache = await caches.open(AUDIO_CACHE);
  let done = 0;
  let failed = 0;
  let next = 0;
  const total = paths.length;
  const worker = async () => {
    while (next < total && !signal?.aborted) {
      const url = urlOf(paths[next++]);
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { signal });
          if (res.ok) await cache.put(url, res);
          else failed++;
        }
      } catch {
        if (signal?.aborted) break;
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === total) onProgress(done, total, failed);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  onProgress(done, total, failed);
  return { done, failed };
}

/** How many of the course's clips are already in the offline cache. */
export async function countCachedAudio(paths: string[]): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(AUDIO_CACHE);
  const keys = new Set((await cache.keys()).map((r) => r.url));
  return paths.reduce((n, p) => n + (keys.has(urlOf(p)) ? 1 : 0), 0);
}
