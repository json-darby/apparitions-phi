// Name the tone: five buttons, one syllable at a time. Objective: right or wrong.
// Keys 1 to 5 pick a tone while it is active.

import { useState, type CSSProperties } from 'react';
import { TONE_LABEL } from '../../../audio/sound';
import { TONES, type Tone } from '../../../content/types';
import { useKeys } from '../../../input/keys';
import { ToneShape } from './ToneShape';

export function ToneQuiz({ tones, sylls, onDone, enabled = true }: { tones: Tone[]; sylls?: string[]; onDone: (correct: boolean, picks: Tone[]) => void; enabled?: boolean }) {
  const [picks, setPicks] = useState<Tone[]>([]);
  const done = picks.length >= tones.length;
  const at = picks.length;

  const choose = (t: Tone) => {
    if (done || !enabled) return;
    const next = [...picks, t];
    setPicks(next);
    if (next.length >= tones.length) onDone(next.every((p, i) => p === tones[i]), next);
  };

  useKeys((a) => {
    if (a.type === 'rate' && a.n <= 5) {
      choose(TONES[a.n - 1]);
      return true;
    }
  }, enabled && !done);

  const n = tones.length;
  return (
    <div className="stack gap-3">
      {/* one row of syllable chips, kept (empty) for one-syllable words so the buttons never move */}
      <div className="syl-chips" style={{ '--n': n } as CSSProperties} aria-hidden={n < 2}>
        {n > 1 &&
          tones.map((t, i) => {
            const p = picks[i];
            const cls = p == null ? (i === at ? 'on' : '') : p === t ? 'right' : 'wrong';
            // fewer words in a narrower chip: "Syllable 2 · Falling", "2 · Falling", "Falling"
            const name = sylls?.[i] && done ? sylls[i] : n > 2 ? `${i + 1}` : `Syllable ${i + 1}`;
            return (
              <span key={i} className={`syl-chip ${cls}`}>
                <span className="syl-chip-text">
                  {p && n > 4 ? TONE_LABEL[p] : name}
                  {p && n <= 4 && <b> · {TONE_LABEL[p]}</b>}
                </span>
              </span>
            );
          })}
      </div>
      <div className="tone-btns" role="group" aria-label="Which tone?">
        {TONES.map((t, i) => {
          const isRight = done && tones[at - 1] === t && tones.length === 1;
          const pickedWrong = done && tones.length === 1 && picks[0] === t && picks[0] !== tones[0];
          return (
            <button
              key={t}
              type="button"
              className={`tone-btn ${isRight ? 'right' : ''} ${pickedWrong ? 'wrong' : ''}`}
              onClick={() => choose(t)}
              disabled={done || !enabled}
            >
              <ToneShape tone={t} w={44} h={22} guide={false} strokeWidth={2.5} />
              <span>{TONE_LABEL[t]}</span>
              <span className="kbd">{i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
