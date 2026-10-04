// The quick check after a group of new cards: hear a word and pick its meaning,
// then see a meaning and pick the Thai. Letters are picked by name. A miss
// shows the right answer and comes back once more.
//
// Practice only. Nothing here goes to engine.answer and no review date moves:
// the cards were met a moment ago, and their first scheduled look is in Review.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../../app/context';
import { useDevice } from '../../../app/device';
import { PlayIcon } from '../../../audio/SoundLayer';
import type { VoiceId } from '../../../content/types';
import { useKeys } from '../../../input/keys';
import { FitText } from '../../../ui/FitText';
import { KeyHints, Label, RunRail } from '../../../ui/kit';
import { Choices, type Choice } from './Choices';
import { VOICE_ORDER, clipVoices, letterPlay, listenForm, pick, type Shown } from './common';
import { buildCheck, withRetry, type CheckQ } from './lesson';

/** A right answer moves on by itself after this long (and after its clip ends). */
const RIGHT_MS = 700;

export function QuickCheck({ group, earlier, onDone, onBack }: { group: Shown[]; earlier: Shown[]; onDone: () => void; onBack: () => void }) {
  const { sound } = useApp();
  const { device } = useDevice();
  const [queue, setQueue] = useState<CheckQ[]>(() => buildCheck(group, earlier));
  const [at, setAt] = useState(0);
  // the pick belongs to one question, so a late timer can never answer the next
  const [picked, setPicked] = useState<{ at: number; ref: string } | null>(null);
  const byRef = useMemo(() => new Map([...earlier, ...group].map((s) => [s.ref, s])), [group, earlier]);
  const voice = useRef<VoiceId>('f1');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const q: CheckQ | undefined = queue[at];
  // room for the most options any question in this check offers
  const rows = useMemo(() => Math.max(2, ...queue.map((x) => x.options.length)), [queue]);
  const target = q ? byRef.get(q.ref) : undefined;
  const chosen = picked?.at === at ? picked.ref : null;

  const play = (): Promise<void> => {
    if (!target) return Promise.resolve();
    if (target.item) return sound.play(listenForm(target.item, voice.current));
    // the letter itself would give the answer away in a caption, so the caption shows its name
    if (target.letter) return sound.play({ ...letterPlay(target.letter), voice: voice.current, caption: target.letter.name });
    return Promise.resolve();
  };

  // a listening question opens with its sound
  useEffect(() => {
    if (!q) return;
    // a voice with a clean clip of this word, where there is one
    const clean = target?.item ? clipVoices(target.item) : [];
    voice.current = pick(clean.length ? clean : VOICE_ORDER);
    if (q.kind !== 'meaning') void play();
    return () => sound.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  // the last question answered: back to the cards
  const over = at >= queue.length;
  useEffect(() => {
    if (over) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  const next = (from = at) => setAt((i) => (i === from ? i + 1 : i));

  const choose = (ref: string) => {
    if (!q || chosen != null) return;
    const ok = ref === q.ref;
    const from = at;
    setPicked({ at, ref });
    if (!ok) setQueue((all) => withRetry(all, from));
    // picking the Thai is silent until now: the word is said with its answer
    const said = q.kind === 'meaning' && sound.mode === 'audio' ? play() : Promise.resolve();
    if (ok) {
      void Promise.all([said, new Promise((r) => setTimeout(r, RIGHT_MS))]).then(() => {
        if (alive.current) next(from);
      });
    }
  };

  useKeys((a) => {
    if (a.type === 'play' && q?.kind !== 'meaning') {
      void play();
      return true;
    }
    if ((a.type === 'confirm' || (a.type === 'move' && a.down && a.dx === 1)) && chosen != null) {
      next();
      return true;
    }
  }, !over);

  if (!q || !target) return null;

  const options: Choice[] = q.options.map((ref) => {
    const s = byRef.get(ref)!;
    if (q.kind === 'hear') return { id: ref, label: s.en };
    // a letter's sound shows once answered; its line is kept from the start
    if (q.kind === 'letter') return { id: ref, label: s.thai, thai: true, sub: chosen != null ? s.roman : undefined };
    return { id: ref, label: s.thai, thai: true, sub: s.roman };
  });
  const ok = chosen === q.ref;
  const answer = target.letter ? (
    <>
      <span className="thai" lang="th">{target.thai}</span> is {target.roman}.
    </>
  ) : (
    <>
      <span className="thai" lang="th">{target.thai}</span> · {target.roman} · {target.en}.
    </>
  );

  return (
    <>
      <RunRail n={at} total={queue.length} left={`Quick check · ${at + 1} of ${queue.length}`} right="Practice" />
      {/* the question box is one size for both kinds: a meaning to read, or a sound to hear */}
      <div className="qc-prompt">
        <Label>{q.again ? 'Once more · ' : ''}{q.kind === 'meaning' ? 'Pick the Thai' : q.kind === 'letter' ? 'Which letter is it?' : 'What does it mean?'}</Label>
        {q.kind === 'meaning' ? (
          <FitText as="h1" className="h-l" lines={2} min={18}>{target.en}</FitText>
        ) : (
          <div className="play-row">
            <button className="iconbtn" type="button" onClick={() => void play()} aria-label="Play again">
              <PlayIcon />
            </button>
            <span className="small">Listen, then pick. Play it again as often as you like.</span>
          </div>
        )}
      </div>
      <Choices options={options} answer={q.ref} chosen={chosen} onChoose={choose} rows={rows} withSub={q.kind !== 'hear'} />
      {/* the answer line has its place before it is said */}
      <FitText as="p" className="body qc-fb" lines={2} min={11} valign="top">
        {chosen != null && (
          <>
            <span className={ok ? 'good' : 'bad'}>{ok ? 'Right.' : 'Not that one.'}</span> {answer}
            {!ok && !q.again ? ' It comes back once more.' : ''}
          </>
        )}
      </FitText>
      <div className="learn-foot">
        <div className="btn-row">
          <button className="pill" type="button" onClick={onBack}>Back to cards</button>
          <button className="pill solid" type="button" onClick={() => next()} disabled={chosen == null}>
            {at + 1 >= queue.length ? 'Done' : 'Next'}
          </button>
        </div>
        <button className="textlink" type="button" onClick={onDone}>Skip check</button>
        {device === 'desktop' && <KeyHints hints={[[`1–${q.options.length}`, 'Pick'], ['Enter', 'Next'], ['Space', 'Play again']]} />}
      </div>
    </>
  );
}
