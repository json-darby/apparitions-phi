// Mock Live: no network, no credentials. The character answers from the task
// script the app sends: it says the start line, listens for a reply, calls
// slotFilled when the reply matches a right option, moves along the script,
// gives a hint (Thai, then English) after two stuck tries, calls questComplete
// at the end, and calls flagUnsafe on obviously off-limits requests.
//
// Learner audio cannot be transcribed here, so a held talk button with at
// least 0.3 s of audio is "heard" as the first right reply of the current node
// (a learner who said the right thing); shorter is heard as silence (stuck).
// Typed text is matched against the options for real.
//
// MockTutor plays School of the Night's tutor the same way: it says the Thai
// each directive gives, then listens. A held talk button is heard as the
// directive's first expected line (0.8 s of audio or more), as a mumble that
// fits nothing (0.3 to 0.8 s, so a miss can be tried), or as silence; it then
// calls lineHeard. Asking for a repeat calls repeatAsked and says the line
// again. Typed text is matched for real.

import { similarity } from '../thai.ts';
import type { Directive, ScriptNode, ScriptOption, TaskScript } from './protocol.ts';
import type { Upstream, UpstreamEvents } from './upstream.ts';

const MATCH = 0.75;
const UNSAFE: [RegExp, string][] = [
  [/\b(sex|nude|naked|porn)\b|เซ็กส์|โป๊/i, 'sexual'],
  [/\b(cocaine|meth|heroin|mdma|ecstasy|buy (weed|drugs)|dealer)\b|ยาบ้า|ยาเสพติด/i, 'drugs'],
  [/\b(prime minister|king|queen|taylor swift|elon musk)\b/i, 'real_person'],
];

/** A soft hum per syllable so playback can be heard working: PCM16 LE, 24 kHz. */
export function synthVoice(thai: string, voice: 'f' | 'm'): Buffer {
  const rate = 24000;
  const syl = Math.max(1, Math.min(12, Math.round([...thai.replace(/\s/g, '')].length / 3)));
  const sylS = Math.round(rate * 0.17);
  const gapS = Math.round(rate * 0.05);
  const total = syl * (sylS + gapS);
  const buf = Buffer.alloc(total * 2);
  const base = voice === 'f' ? 230 : 130;
  let i = 0;
  for (let s = 0; s < syl; s++) {
    const f = base * (1 + 0.08 * Math.sin(s * 1.7));
    for (let k = 0; k < sylS; k++, i++) {
      const env = Math.sin((Math.PI * k) / sylS);
      const v = 0.06 * env * (Math.sin((2 * Math.PI * f * k) / rate) + 0.3 * Math.sin((4 * Math.PI * f * k) / rate));
      buf.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    i += gapS;
  }
  return buf;
}

export class MockUpstream implements Upstream {
  connections = 0;
  private node: ScriptNode | null;
  private nodes: Map<string, ScriptNode>;
  private tries = 0;
  private bytes = 0;
  private talking = false;
  private waiting: { id: string; then: () => void } | null = null;
  private seq = 0;
  private closed = false;
  private ev: UpstreamEvents;
  private voice: 'f' | 'm';
  private delay: number;

  constructor(script: TaskScript | undefined, voice: 'f' | 'm', ev: UpstreamEvents, delayMs = 30) {
    this.nodes = new Map((script?.nodes ?? []).map((n) => [n.id, n]));
    this.node = script ? this.nodes.get(script.start) ?? null : null;
    this.ev = ev;
    this.voice = voice;
    this.delay = delayMs;
  }

  async open() {
    this.connections++;
    this.later(() => {
      if (this.node) this.say(this.node.thai);
      else this.say('สวัสดี');
    });
  }

  private later(fn: () => void) {
    setTimeout(() => {
      if (!this.closed) fn();
    }, this.delay);
  }

  private say(text: string) {
    const pcm = synthVoice(text, this.voice);
    for (let o = 0; o < pcm.length; o += 9600) this.ev.audio(pcm.subarray(o, o + 9600));
    this.ev.outputText(text, true);
    this.ev.turnComplete();
  }

  private call(name: string, args: Record<string, unknown>, then: () => void) {
    const id = `mock-${++this.seq}`;
    this.waiting = { id, then };
    this.ev.toolCall([{ id, name, args }]);
  }

  activity(on: boolean) {
    if (on) {
      this.talking = true;
      this.bytes = 0;
      return;
    }
    if (!this.talking) return;
    this.talking = false;
    const seconds = this.bytes / 32000;
    const heard = seconds >= 0.3 ? this.node?.options.find((o) => o.correct)?.thai ?? '' : '';
    this.later(() => {
      this.ev.inputText(heard, true);
      this.respond(heard);
    });
  }

  audio(pcm: Buffer) {
    if (this.talking) this.bytes += pcm.length;
  }

  text(t: string) {
    // a direction from the app (try that step again): go back to the line it names and say it
    if (t.startsWith('[App:')) {
      const back = [...this.nodes.values()].find((n) => t.includes(`"${n.thai}"`)) ?? this.node;
      this.later(() => {
        if (back) {
          this.node = back;
          this.say(back.thai);
        }
      });
      return;
    }
    this.later(() => this.respond(t));
  }

  directive(d: Directive) {
    this.text(d.text);
  }

  toolResponse(id: string) {
    const w = this.waiting;
    if (!w || w.id !== id) return;
    this.waiting = null;
    this.later(w.then);
  }

  private best(said: string): ScriptOption | null {
    if (!this.node || !said.trim()) return null;
    let top: ScriptOption | null = null;
    let score = 0;
    for (const o of this.node.options) {
      const s = similarity(said, o.thai);
      if (s > score) {
        score = s;
        top = o;
      }
    }
    return score >= MATCH ? top : null;
  }

  private respond(said: string) {
    if (this.waiting) return;
    for (const [re, category] of UNSAFE) {
      if (re.test(said)) {
        this.call('flagUnsafe', { category, note: 'mock' }, () => this.say(this.node?.thai ?? 'ขอโทษ'));
        return;
      }
    }
    const node = this.node;
    if (!node) {
      this.say('สวัสดี');
      return;
    }
    const opt = this.best(said);
    if (opt && opt.correct) {
      this.tries = 0;
      this.call('slotFilled', { slot: node.slot, value: opt.en, learnerThai: said }, () => {
        const next = opt.next ? this.nodes.get(opt.next) ?? null : null;
        if (!next) {
          this.node = null;
          this.call('questComplete', { summary: 'mock' }, () => this.ev.turnComplete());
          return;
        }
        this.node = next;
        this.say(next.thai);
      });
      return;
    }
    this.tries++;
    if (this.tries >= 2) {
      this.tries = 0;
      const right = node.options.find((o) => o.correct);
      this.say(right ? `${right.thai} … Hint: say "${right.thai}" (${right.en})` : node.thai);
      return;
    }
    this.say(node.thai);
  }

  close() {
    this.closed = true;
  }
}

/** The learner asking to hear it again: พูดอีกที, ไม่เข้าใจ, พูดช้าๆ. */
const ASK_AGAIN = /พูดอีกที|ไม่เข้าใจ|ช้า\s?ๆ|ช้าลง/;
/** What a short press is heard as: fits no line. */
export const MOCK_MUMBLE = 'เอ่อ';

export class MockTutor implements Upstream {
  connections = 0;
  private expect: { lineId: string; thai: string }[] = [];
  private last: string | null = null;
  private bytes = 0;
  private talking = false;
  private waiting: { id: string; then: () => void } | null = null;
  private seq = 0;
  private closed = false;
  private ev: UpstreamEvents;
  private voice: 'f' | 'm';
  private delay: number;

  constructor(voice: 'f' | 'm', ev: UpstreamEvents, delayMs = 30) {
    this.ev = ev;
    this.voice = voice;
    this.delay = delayMs;
  }

  async open() {
    // the tutor waits for the first directive
    this.connections++;
  }

  private later(fn: () => void) {
    setTimeout(() => {
      if (!this.closed) fn();
    }, this.delay);
  }

  private say(text: string) {
    const pcm = synthVoice(text, this.voice);
    for (let o = 0; o < pcm.length; o += 9600) this.ev.audio(pcm.subarray(o, o + 9600));
    this.ev.outputText(text, true);
    this.ev.turnComplete();
  }

  private call(name: string, args: Record<string, unknown>, then: () => void) {
    const id = `mock-${++this.seq}`;
    this.waiting = { id, then };
    this.ev.toolCall([{ id, name, args }]);
  }

  directive(d: Directive) {
    this.expect = d.expect ?? [];
    const say = d.say;
    if (say) this.last = say;
    this.later(() => (say ? this.say(say) : this.ev.turnComplete()));
  }

  activity(on: boolean) {
    if (on) {
      this.talking = true;
      this.bytes = 0;
      return;
    }
    if (!this.talking) return;
    this.talking = false;
    const seconds = this.bytes / 32000;
    const heard = seconds >= 0.8 ? this.expect[0]?.thai ?? '' : seconds >= 0.3 ? MOCK_MUMBLE : '';
    this.later(() => {
      this.ev.inputText(heard, true);
      this.heard(heard);
    });
  }

  audio(pcm: Buffer) {
    if (this.talking) this.bytes += pcm.length;
  }

  text(t: string) {
    // a direction without a directive's fields: say the Thai it quotes
    if (t.startsWith('[App:')) {
      const quoted = t.match(/"([^"]*[฀-๿][^"]*)"/)?.[1];
      if (quoted) {
        this.last = quoted;
        this.later(() => this.say(quoted));
      }
      return;
    }
    this.later(() => this.heard(t));
  }

  toolResponse(id: string) {
    const w = this.waiting;
    if (!w || w.id !== id) return;
    this.waiting = null;
    this.later(w.then);
  }

  private heard(said: string) {
    if (this.waiting) return;
    for (const [re, category] of UNSAFE) {
      if (re.test(said)) {
        this.call('flagUnsafe', { category, note: 'mock' }, () => this.ev.turnComplete());
        return;
      }
    }
    let top: { lineId: string; thai: string } | null = null;
    let score = 0;
    for (const e of this.expect) {
      const s = similarity(said, e.thai);
      if (s > score) {
        score = s;
        top = e;
      }
    }
    if (said.trim() && (!top || score < MATCH) && ASK_AGAIN.test(said)) {
      const slower = /ช้า/.test(said);
      this.call('repeatAsked', { slower }, () => (this.last ? this.say(this.last) : this.ev.turnComplete()));
      return;
    }
    const right = !!top && score >= MATCH;
    const verdict = !said.trim() ? 'none' : right ? 'right' : 'wrong';
    const lineId = (right ? top?.lineId : this.expect[0]?.lineId) ?? '';
    this.call('lineHeard', { lineId, verdict, heardThai: said }, () => this.ev.turnComplete());
  }

  close() {
    this.closed = true;
  }
}
