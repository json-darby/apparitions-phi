// The conversation itself: the NPC's line, the stage direction, 3 to 5 replies
// as rows, the English toggle and "Say it out loud". Used by Talk and by the
// three chapters. All answers go through the branch runner to the engine.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp } from '../../app/context';
import { MicIcon, PlayIcon } from '../../audio/SoundLayer';
import { useKeys } from '../../input/keys';
import { RatingBar } from '../../ui/kit';
import { FitText } from '../../ui/FitText';
import type { Six } from '../../engine/grade';
import type { StreetNode } from '../../content/street-seed';
import type { ChoiceResult, DialogueRun, Outcome } from '../dialogue';
import { voiceFor } from './common';

export interface DialoguePanelProps {
  run: DialogueRun;
  onResult?: (r: ChoiceResult) => void;
  onEnd: (o: Outcome) => void;
  /** true while the NPC "speaks" (the voice tear plays) */
  onSpeaking?: (on: boolean) => void;
  /** a node is now on screen */
  onNode?: (n: StreetNode) => void;
  /** keyboard on (number keys pick replies, space replays) */
  keys?: boolean;
  /** count turning the English on as a hint (Door to Door) */
  hintOnGloss?: boolean;
  onHint?: () => void;
  /** pause between a reply and the next line */
  beat?: number;
  top?: ReactNode;
}

type Phase = 'choose' | 'after' | 'record' | 'rate';

export function DialoguePanel({ run, onResult, onEnd, onSpeaking, onNode, keys = true, hintOnGloss, onHint, beat = 1000, top }: DialoguePanelProps) {
  const { sound, content, reducedMotion } = useApp();
  const [shown, setShown] = useState<string | null>(run.node);
  const [visit, setVisit] = useState(0);
  const [phase, setPhase] = useState<Phase>('choose');
  const [gloss, setGloss] = useState(false);
  const [sayMode, setSayMode] = useState(false);
  const [tried, setTried] = useState<Record<number, 'right' | 'wrong'>>({});
  const [last, setLast] = useState<ChoiceResult | null>(null);
  const [pending, setPending] = useState<{ index: number; ms: number } | null>(null);
  const t0 = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const node = shown ? run.task.nodes[shown] : null;
  const person = node ? content.person(node.speaker) : undefined;
  // room for the most replies any line of this task offers
  const maxReplies = useMemo(() => Math.max(1, ...Object.values(run.task.nodes).map((n) => n.options.length)), [run]);

  const speak = (n: StreetNode) => {
    onSpeaking?.(true);
    sound
      .play({
        // the line's own clip, in the character's own voice (course line ids are <task>.<node>)
        ref: `line:${run.task.id}.${n.id}`, thai: n.thai, roman: n.roman, en: n.en, tones: n.tones,
        speaker: person?.name ?? n.speaker, voice: voiceFor(n.speaker), castVoice: n.speaker,
      })
      .then(() => onSpeaking?.(false));
  };

  // a new line: say it, start the clock
  useEffect(() => {
    if (!node) return;
    t0.current = Date.now();
    setTried({});
    onNode?.(node);
    speak(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, visit]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      sound.stop();
    },
    [sound],
  );

  const toggleGloss = () => {
    setGloss((g) => {
      if (!g && hintOnGloss) {
        run.hint();
        setTimeout(() => onHint?.(), 0);
      }
      return !g;
    });
  };

  const commit = (index: number, ms: number) => {
    const before = run.node;
    const r = run.choose(index, { glossShown: gloss, ms });
    setLast(r);
    setTried((t) => ({ ...t, [index]: r.correct ? 'right' : 'wrong' }));
    onResult?.(r);
    const wait = reducedMotion ? beat * 0.6 : beat + (r.feedback ? 700 : 0);
    if (r.outcome) {
      setPhase('after');
      timer.current = setTimeout(() => onEnd(r.outcome!), wait);
    } else if (r.next !== before) {
      setPhase('after');
      timer.current = setTimeout(() => {
        setLast(null);
        setShown(run.node);
        setVisit((v) => v + 1);
        setPhase('choose');
      }, wait);
    } else {
      setPhase('choose');
    }
  };

  const choose = async (index: number) => {
    if (phase !== 'choose' || !node || run.ended || tried[index] === 'wrong') return;
    const ms = Date.now() - t0.current;
    const o = node.options[index];
    if (!o) return;
    if (sayMode) {
      setPhase('record');
      const rec = await sound.record({ thai: o.thai, roman: o.roman, en: gloss ? o.en : undefined, tones: o.tones });
      if (rec) {
        setPending({ index, ms });
        setPhase('rate');
        return;
      }
      setPhase('choose');
    }
    commit(index, ms);
  };

  const rate = (six: Six) => {
    if (!pending || !node) return;
    run.say(node.options[pending.index], six, pending.ms);
    const p = pending;
    setPending(null);
    commit(p.index, p.ms);
  };

  useKeys(
    (a) => {
      if (phase !== 'choose' || !node) return;
      if (a.type === 'rate' && a.n <= node.options.length) {
        void choose(a.n - 1);
        return true;
      }
      if (a.type === 'play') {
        speak(node);
        return true;
      }
      if (a.type === 'key' && a.down && a.key.toLowerCase() === 'g') {
        toggleGloss();
        return true;
      }
    },
    keys && phase === 'choose',
  );

  if (!node) return null;
  const fb = last?.feedback ?? (last && !last.correct ? 'Not quite.' : null);

  // Every box here is one fixed size for the whole conversation: the line (two lines of
  // Thai, two of romanisation, two of stage direction), the feedback line, and room for
  // the most replies any line in this task has. Longer text gets smaller type; nothing
  // under it moves from one line to the next.
  return (
    <div className="dlg" style={{ '--rows': maxReplies } as CSSProperties}>
      {top}
      <div className="dlg-head">
        <FitText className="label" min={8}>{person ? `${person.name} · ${person.role}` : node.speaker}</FitText>
        <div className="hrow" style={{ gap: 8, flex: 'none' }}>
          <button type="button" className="pill small" onClick={() => speak(node)} aria-label="Hear the line again">
            <PlayIcon size={12} /> Again
          </button>
          <button type="button" className="pill small" aria-pressed={gloss} onClick={toggleGloss} title="English (G)">
            EN
          </button>
        </div>
      </div>
      <div className="dlg-line" key={`${shown}-${visit}`}>
        <FitText className="thai-l" lang="th" lines={2} min={16} valign="bottom">{node.thai}</FitText>
        <FitText className="roman" lines={2} min={10} valign="top">
          {node.roman}
          {gloss && <span className="mut"> · {node.en}</span>}
        </FitText>
        <FitText as="p" className="dlg-stage" lines={2} min={10} valign="top">{node.stage ?? ''}</FitText>
      </div>
      <FitText as="p" className={`dlg-fb ${last?.correct ? '' : 'bad'}`} lines={2} min={10} valign="top">
        {fb ?? ''}
      </FitText>
      <div className={`dlg-body ${gloss ? 'glossed' : ''}`}>
        {phase === 'rate' && pending ? (
          <div className="stack gap-3 fade-in">
            <div>
              <div className="label">You said</div>
              <FitText className="thai-m" lang="th" min={14}>{node.options[pending.index].thai}</FitText>
            </div>
            <div className="label fg">How did that feel?</div>
            <RatingBar preview={null} onRate={rate} />
          </div>
        ) : (
          <div className="dlg-replies" role="group" aria-label="Replies">
            {node.options.map((o, i) => (
              <button
                key={i}
                type="button"
                className={`dlg-reply ${tried[i] ?? ''}`}
                disabled={phase !== 'choose' || tried[i] === 'wrong'}
                onClick={() => void choose(i)}
              >
                <span className="kbd">{i + 1}</span>
                <span className="grow dlg-reply-text">
                  <FitText as="span" className="thai-m" lang="th" min={14}>{o.thai}</FitText>
                  <FitText as="span" className="roman" lines={gloss ? 2 : 1} min={10} valign="top">
                    {o.roman}
                    {gloss && <span className="mut"> · {o.en}</span>}
                  </FitText>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className={`dlg-say ${sayMode ? 'on' : ''}`} aria-pressed={sayMode} onClick={() => setSayMode((s) => !s)} disabled={phase === 'rate'}>
        <span className="iconbtn" aria-hidden>
          <MicIcon size={22} />
        </span>
        <span className="grow">
          <b>Say it out loud</b>
          <FitText as="span" className="small" min={10}>
            {sayMode ? 'On. Pick your line, say it, then rate yourself.' : 'Pick a line and say it, instead of tapping it.'}
          </FitText>
        </span>
      </button>
      {/* kept (hidden) while the English is off, so turning it on moves nothing below */}
      <p className={`small ${gloss ? '' : 'keep'}`} style={{ margin: 0 }} aria-hidden={!gloss}>English is on. Choices are logged but not scheduled.</p>
    </div>
  );
}
