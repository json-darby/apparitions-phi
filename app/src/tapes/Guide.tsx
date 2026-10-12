// The parts of The Tapes that need no study file: the letters, the tone rules
// on one screen, and tips for getting the most from the course on a break.

import { useState } from 'react';
import { useApp } from '../app/context';
import { Link } from '../app/router';
import { ListHead } from '../ui/kit';
import { CONSONANTS, MARKS, VOWELS, type LetterClass } from './letters';
import { TONE_COLOURS, TONE_NAMES, type ToneDigit } from './pack';
import { ToneKey, ToneLine, speak, stopTapes } from './parts';

const CLASS_NOTE: Record<LetterClass, string> = { mid: 'mid class', high: 'high class', low: 'low class' };

export function LettersTab() {
  const { content, sound } = useApp();
  const [only, setOnly] = useState<LetterClass | null>(null);
  const byChar = new Map(content.letters.map((l) => [l.char, l]));
  // the app's own recording of the letter's name (gor gài…), else the device voice
  const hear = (th: string) => {
    stopTapes();
    const l = byChar.get(th);
    if (l) void sound.play({ ref: `letter:${l.id}`, thai: l.char, roman: l.name, en: l.keyword });
    else speak(th);
  };
  return (
    <section style={{ marginTop: 18 }}>
      <p className="body" style={{ marginTop: 0 }}>Tap a letter to hear its name. Under each: its sound at the start of a syllable / at the end. The dot is its class, which sets the tone.</p>
      <div className="tp-classes" role="group" aria-label="Show a class">
        {(['mid', 'high', 'low'] as LetterClass[]).map((c) => (
          <button key={c} type="button" className="pill small" aria-pressed={only === c} onClick={() => setOnly(only === c ? null : c)}>
            <i className={`tp-cls ${c}`} aria-hidden="true" />
            {CLASS_NOTE[c]}
          </button>
        ))}
      </div>
      <div className="tp-letters">
        {CONSONANTS.filter((c) => !only || c[1] === only).map(([th, cls, a, b]) => (
          <button key={th} type="button" className="tp-letter" onClick={() => hear(th)} aria-label={`${th}, ${CLASS_NOTE[cls]}, ${a} at the start, ${b} at the end`}>
            <i className={`tp-cls ${cls}`} aria-hidden="true" />
            <span className="tp-letter-th" lang="th">{th}</span>
            {byChar.get(th) && <span className="tp-letter-name">{byChar.get(th)!.name}</span>}
            <span className="small">{a} / {b}</span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 28 }}>
        <ListHead title="Vowels" note="– is where the consonant goes" />
        <div className="tp-vowels rows-end">
          {VOWELS.map(([th, ro, len]) => (
            <div key={th} className="tp-vowel">
              <span className="tp-vowel-th" lang="th">{th}</span>
              <b>{ro}</b>
              <span className="small">{len}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <ListHead title="Tone marks" note="shown on ก, written above the consonant" />
        <div className="rows-end">
          {MARKS.map((m) => (
            <div key={m.mark} className="tp-vowel">
              <span className="tp-vowel-th" lang="th">{m.mark}</span>
              <b>{m.name}</b>
              <span className="small">{m.does}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const cell = (t: ToneDigit) => (
  <span className="tp-cell" style={{ color: TONE_COLOURS[t] }}>
    <ToneLine t={t} size={18} />
    {TONE_NAMES[t]}
  </span>
);

export function TonesTab() {
  return (
    <section style={{ marginTop: 18 }}>
      <ToneKey />
      <p className="body">Every syllable's tone comes from three things: the first letter's class, whether the syllable is live or dead, and any tone mark.</p>

      <div className="tp-table" role="table" aria-label="Tone rules">
        <div role="row" className="tp-tr head">
          <span role="columnheader" />
          <span role="columnheader">live<br />no mark</span>
          <span role="columnheader">dead<br />short</span>
          <span role="columnheader">dead<br />long</span>
          <span role="columnheader" className="tp-mk"><span lang="th">ก่</span><small>mái èek</small></span>
          <span role="columnheader" className="tp-mk"><span lang="th">ก้</span><small>mái too</small></span>
        </div>
        <div role="row" className="tp-tr">
          <span role="rowheader"><i className="tp-cls mid" aria-hidden="true" />Mid</span>
          {cell(0)}{cell(1)}{cell(1)}{cell(1)}{cell(2)}
        </div>
        <div role="row" className="tp-tr">
          <span role="rowheader"><i className="tp-cls high" aria-hidden="true" />High</span>
          {cell(4)}{cell(1)}{cell(1)}{cell(1)}{cell(2)}
        </div>
        <div role="row" className="tp-tr">
          <span role="rowheader"><i className="tp-cls low" aria-hidden="true" />Low</span>
          {cell(0)}{cell(3)}{cell(2)}{cell(2)}{cell(3)}
        </div>
      </div>

      <div className="stack gap-2" style={{ marginTop: 14 }}>
        <p className="small" style={{ margin: 0 }}><b className="tp-b">Live</b> ends in a long vowel or in m, n, ng, w (o) or y (i). <b className="tp-b">Dead</b> ends in a short vowel or in p, t, k.</p>
        <p className="small" style={{ margin: 0 }}><span lang="th">ก๊</span> is always high and <span lang="th">ก๋</span> always rising; both appear on mid-class letters only.</p>
        <p className="small" style={{ margin: 0 }}>A silent <span lang="th">ห</span> in front of a low-class letter makes it high class (<span lang="th">หนึ่ง, ไหน</span>). A silent <span lang="th">อ</span> before <span lang="th">ย</span> makes it mid (<span lang="th">อยู่</span>).</p>
      </div>

      <div className="card stack gap-2" style={{ marginTop: 20 }}>
        <span className="label">Worked out</span>
        <div className="hrow" style={{ alignItems: 'baseline' }}>
          <span className="thai-l" lang="th">ครับ</span>
          <b style={{ color: TONE_COLOURS[3], fontSize: 20 }}>kráp</b>
        </div>
        <span className="body">ค is low class · ends in p, so dead · short vowel · no mark → <b style={{ color: TONE_COLOURS[3] }}>high</b></span>
        <div className="hrow" style={{ alignItems: 'baseline', marginTop: 8 }}>
          <span className="thai-l" lang="th">ไม่</span>
          <b style={{ color: TONE_COLOURS[2], fontSize: 20 }}>mâi</b>
        </div>
        <span className="body">ม is low class · ก่ on low class → <b style={{ color: TONE_COLOURS[2] }}>falling</b></span>
      </div>

      <p className="small" style={{ marginTop: 18 }}>
        Words that break the rules (like <span lang="th">ไหม</span>, spelled rising but said high) are flagged in each phrase's "why". More on tones in <Link to="/primer">How Thai works</Link>.
      </p>
    </section>
  );
}

const TIPS: { head: string; body: string }[] = [
  { head: 'Copy the tune, in your own voice.', body: "You don't have to sound exaggerated. Speak at your normal pitch and copy the shape: mid is your everyday voice, low sits a little under it, high a little over. Falling and rising are small movements, not shouts." },
  { head: 'Say your own ending.', body: 'Copy the speaker, then finish the way you would: ครับ (kráp, high) if you are a man, ค่ะ (kâ, falling) if you are a woman, คะ (ká, high) for a woman asking a question.' },
  { head: 'Murmur, never whisper.', body: "A whisper has no pitch, so it has no tones. On a quiet break, say it under your breath with your voice on." },
  { head: 'Answer before the speaker.', body: 'The course leaves you a pause: fill it out loud, even if you are unsure. Here too: say it before you tap Show answer.' },
  { head: 'Use the microphone button.', body: "It draws your pitch line over the tone shapes. Look for the same shape, not a perfect score; your voice and the speaker's sit at different heights." },
  { head: 'Look up, then go back.', body: "On a break, open the unit you just heard, read its notes, play the two or three phrases that slipped by. The tapes do the teaching; this is for the gaps." },
  { head: 'Little and often.', body: 'Five minutes on every break does more than an hour once a week. Mark a unit heard and its phrases join the review a few at a time.' },
  { head: 'The spelling is a guide.', body: 'Romanisation is a rough map of the sound. Trust your ears and the clip; the colour and line show the tone.' },
  { head: 'Repeat a unit without guilt.', body: 'If less than about 80% came out right, doing the unit again is the course working as meant, not falling behind.' },
];

export function TipsTab() {
  return (
    <section style={{ marginTop: 18 }}>
      <div className="stack">
        {TIPS.map((t, i) => (
          <div key={i} className="tp-tip">
            <span className="tp-tip-n num">{i + 1}</span>
            <p className="body" style={{ margin: 0 }}><b className="tp-b">{t.head}</b> {t.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
