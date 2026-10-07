// How Thai works: five short pages for someone who has never seen Thai. The
// five tones, reading the romanisation, polite endings and "I", a quick ear
// check, and how a day works. Every sound is a real clip from the course,
// picked at runtime (pick.ts). Nothing here reaches the memory engine.
// Finishing or skipping sets settings.primerDone; Welcome sends a first run
// here, and the Library has a way back.

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { back as goBack, navigate } from '../app/router';
import { TONE_LABEL } from '../audio/sound';
import { PlayIcon } from '../audio/SoundLayer';
import { sayForm, type Identity } from '../content/repo';
import { TONES, type Item, type Tone, type VoiceId } from '../content/types';
import { useKeys } from '../input/keys';
import { TONE_VERB, listenForm, sayTarget } from '../screens/learn/parts/common';
import { ToneShape } from '../screens/learn/parts/ToneShape';
import { Apparition } from '../anim/Apparition';
import { FullscreenButton, KeyHints, Label } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { StepShell, ToneLines } from '../ui/StepShell';
import { contrastPair, earRounds, politeForms, primerVoice, romanExamples, toneExamples, type EarRound, type RomanPointId, type SpeakerForms } from './pick';
import './primer.css';

const PAGES = ['Tones', 'Romanisation', 'Polite endings', 'Ear check', 'Each day'];
const EAR = 3;

type Play = (it: Item, hideRoman?: boolean) => void;
/** the word last played, so its row shows it */
type Playing = string | null;

export default function Primer() {
  const { content, settings, updateSettings, sound, reducedMotion } = useApp();
  const { device } = useDevice();
  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState<Playing>(null);
  const firstRun = !settings.primerDone;

  const examples = useMemo(() => toneExamples(content.items), [content]);
  const pair = useMemo(() => contrastPair(content.items), [content]);
  const roman = useMemo(() => romanExamples(content.items), [content]);
  const polite = useMemo(() => politeForms(content.items), [content]);
  // one speaker for the tone examples, so their pitches compare
  const voice = useMemo(() => primerVoice([...Object.values(examples), ...(pair ?? [])]), [examples, pair]);

  const play: Play = (it, hideRoman = false) => {
    // words only one sex says get a matching voice
    const v: VoiceId = it.speaker ? (it.speaker === 'm' ? 'm1' : 'f1') : voice;
    if (!hideRoman) setPlaying(it.id);
    void sound.play(listenForm(it, v, hideRoman));
  };

  const finish = () => {
    updateSettings({ primerDone: true });
    navigate('/', true);
  };
  const next = () => (page < PAGES.length - 1 ? setPage(page + 1) : finish());
  const back = () => page > 0 && setPage(page - 1);

  // a new page starts at the top; leaving one stops its sound (before the next page's own plays)
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setPlaying(null);
    return () => sound.stop();
  }, [page, sound]);

  useKeys((a) => {
    if (a.type === 'move' && a.down && a.dx) {
      if (a.dx > 0) next();
      else back();
      return true;
    }
    // the ear check uses Enter for its own next round
    if (a.type === 'confirm' && page !== EAR) {
      next();
      return true;
    }
  });

  const k = `How Thai works · ${page + 1} of ${PAGES.length}`;
  const pages = [
    <TonesPage key="tones" k={k} examples={examples} pair={pair} play={play} playing={playing} />,
    <RomanPage key="roman" k={k} examples={examples} roman={roman} play={play} />,
    <PolitePage key="polite" k={k} polite={polite} identity={settings.identity} hello={content.item('hello')} play={play} playing={playing} />,
    <EarPage key="ear" k={k} examples={examples} play={play} canHear={sound.mode === 'audio'} onNext={next} />,
    <DayPage key="day" k={k} minutes={settings.minutes} />,
  ];

  // a first run: the fifth step of set-up, filling as the pages go; opened again: one segment a page
  const split = device !== 'phone';
  return (
    <StepShell
      step={firstRun ? 'Step 5 of 5' : null}
      rail={firstRun ? { n: 5, at: 4, part: (page + 1) / PAGES.length, label: `Step 5 of 5, page ${page + 1} of ${PAGES.length}` } : { n: PAGES.length, at: page + 1, plain: true, label: `Page ${page + 1} of ${PAGES.length}` }}
      art={
        split ? (
          <Apparition who="pim" mode={reducedMotion ? 'still' : 'idle'} colour="#E8E8E8" style={{ position: 'absolute', inset: 0 }} label="Pim, your guide" />
        ) : (
          <ToneLines on={page === 0 ? 2 : undefined} />
        )
      }
      artCaption={
        <>
          <Label>How Thai works</Label>
          <span className="small">About five minutes</span>
        </>
      }
      headRight={
        <>
          {firstRun ? (
            <button type="button" className="pill text" onClick={finish}>Skip</button>
          ) : (
            <button type="button" className="pill text" onClick={() => goBack('/')}>Close</button>
          )}
          {device !== 'desktop' && !firstRun && <FullscreenButton />}
        </>
      }
      foot={
        <>
          <div className="steps-btns">
            <button type="button" className="pill big" onClick={back} disabled={page === 0}>Back</button>
            <button type="button" className="pill solid big" onClick={next}>
              {page < PAGES.length - 1 ? 'Next' : firstRun ? 'Start day 1' : 'Done'}
            </button>
          </div>
          {device === 'desktop' && <KeyHints hints={[['→', 'Next'], ['←', 'Back'], ['1–5', 'Hear a word'], ['Space', 'Hear it again']]} />}
        </>
      }
    >
      <div key={page} className="stack fade-in primer-page">{pages[page]}</div>
    </StepShell>
  );
}

const WAVE = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 9v6M10 6v12M14 8v8M18 10v4" />
  </svg>
);

/**
 * A word on one row: the tone's name, the word, and play. With a `note` (a
 * role such as "ends a question") the note sits on a line above the word.
 */
function WordRow({ item, tone, note, play, playing }: { item: Item | undefined; tone: Tone; note?: string; play: Play; playing?: Playing }) {
  const on = !!item && playing === item.id;
  return (
    <button
      type="button"
      className={`primer-tone ${note ? 'two' : ''} ${on ? 'on' : ''}`}
      onClick={() => item && play(item)}
      disabled={!item}
      title={`${TONE_LABEL[tone]} · ${TONE_VERB[tone]}`}
      aria-label={item ? `${note ? `${note}: ` : ''}${TONE_LABEL[tone]} tone: ${item.roman}, ${item.en}` : `${TONE_LABEL[tone]} tone, no recorded word`}
    >
      {!note && <span className="primer-tone-name">{TONE_LABEL[tone]}</span>}
      {/* every row one height: the word line shrinks to fit, never wraps */}
      <span className="grow primer-tone-text">
        {note && <FitText as="span" className="label" min={8}>{note}</FitText>}
        {item ? (
          <FitText as="span" className="primer-word" min={11}>
            <span className="thai-m" lang="th">{item.thai}</span> <span className="roman">{item.roman} <span className="mut">· {item.en}</span></span>
          </FitText>
        ) : (
          <FitText as="span" className="small primer-word" min={10}>No recorded word for this tone in this course.</FitText>
        )}
      </span>
      {item && <span className="play">{on ? WAVE : <PlayIcon size={16} />}</span>}
    </button>
  );
}

function TonesPage({ k, examples, pair, play, playing }: { k: string; examples: Partial<Record<Tone, Item>>; pair: [Item, Item] | null; play: Play; playing: Playing }) {
  useKeys((a) => {
    if (a.type === 'rate' && a.n <= 5) {
      const it = examples[TONES[a.n - 1]];
      if (it) play(it);
      return true;
    }
  });
  return (
    <>
      <PageHead k={k} title="Five tones." />
      <p className="body" style={{ margin: 0, maxWidth: '52ch' }}>
        Thai is a tonal language: the pitch a syllable is said at is part of the word, like a vowel. One sound said at five different pitches is five different words. Tap each one and listen for the shape of the line.
      </p>
      <div className="primer-list">
        {TONES.map((t) => (
          <WordRow key={t} item={examples[t]} tone={t} play={play} playing={playing} />
        ))}
      </div>
      {pair && (
        <div className="stack gap-2">
          <Label>Same sound, different tone, different word</Label>
          <div className="primer-list">
            {pair.map((it) => (
              <WordRow key={it.id} item={it} tone={it.tones[0]} play={play} playing={playing} />
            ))}
          </div>
          <p className="small" style={{ margin: 0 }}>Get the tone wrong and you have said a different word. The shape of the line is what to listen for.</p>
        </div>
      )}
    </>
  );
}

const MARK: Record<Tone, string> = { mid: 'a', low: 'à', falling: 'â', high: 'á', rising: 'ǎ' };

const POINTS: { id: RomanPointId; title: string; body: string }[] = [
  { id: 'long', title: 'A doubled vowel is long', body: 'a is short; aa is held about twice as long. Length changes the word, as tone does.' },
  { id: 'aspirated', title: 'kh, ph, th have a puff of air', body: 'Like the k, p, t at the start of kit, pit, tip. ph is never f, and th is never the English th.' },
  { id: 'plain', title: 'g, bp, dt have no puff', body: 'Hard, with no breath behind them: the k in skin, the p in spin, the t in stop.' },
  { id: 'ng', title: 'ng can start a word', body: 'The sound at the end of sing, but at the front. Start with the back of the tongue up.' },
  { id: 'ue', title: 'ʉ is oo with the lips spread', body: 'Say oo, then flatten the lips into a smile without moving the tongue.' },
  { id: 'aw', title: 'aw as in law', body: 'An open o, as in law or saw. Not the ow in cow.' },
  { id: 'er', title: 'ə as in her, without the r', body: 'The vowel of her or bird, with the tongue kept still and no r at the end.' },
  { id: 'final', title: 'A final p, t or k is cut short', body: 'The mouth closes on it and no air comes out. It sounds swallowed; that is right.' },
];

function RomanPage({ k, examples, roman, play }: { k: string; examples: Partial<Record<Tone, Item>>; roman: Record<RomanPointId, Item | null>; play: Play }) {
  return (
    <>
      <PageHead k={k} title="Reading the romanisation" />
      <p className="body" style={{ margin: 0, maxWidth: '52ch' }}>
        Under every Thai word you will see it spelt in Latin letters, with the tone marked over the vowel. The romanisation is a crutch: use it to get the sound right, and read the Thai script beside it. The script is taught alongside from day 1, and the romanisation fades as a word gets stronger.
      </p>
      <div className="stack gap-2">
        <Label>The five marks, over the vowel</Label>
        <div className="primer-marks" role="group" aria-label="Tone marks">
          {TONES.map((t) => {
            const it = examples[t];
            return (
              <button key={t} type="button" className="primer-mark" onClick={() => it && play(it)} disabled={!it} aria-label={`${MARK[t]}: ${TONE_LABEL[t]}${it ? `, ${it.roman}` : ''}`}>
                <span className="big">{MARK[t]}</span>
                <span className="label">{t === 'mid' ? 'Mid · none' : TONE_LABEL[t]}</span>
                {it && <span className="roman">{it.roman}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="primer-list">
        {POINTS.map((p) => {
          const it = roman[p.id];
          return (
            <div key={p.id} className="primer-point">
              <b>{p.title}</b>
              <span className="small">{p.body}</span>
              {it && (
                <button type="button" className="primer-ex" onClick={() => play(it)} aria-label={`Hear ${it.roman}, ${it.en}`}>
                  <span className="play"><PlayIcon size={12} /></span>
                  <span className="thai" lang="th">{it.thai}</span>
                  <span className="roman">{it.roman} · {it.en}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

const ROLE: Record<string, string> = {
  khrap: 'ends any polite sentence',
  'kha-statement': 'ends a statement',
  'kha-question': 'ends a question',
  'i-male': 'I',
  'i-female': 'I',
};

function FormRows({ forms, play, playing }: { forms: SpeakerForms; play: Play; playing: Playing }) {
  const items = [...forms.endings, ...(forms.i ? [forms.i] : [])];
  if (!items.length) return <p className="small" style={{ margin: 0 }}>These words are not in this course yet.</p>;
  return (
    <div className="primer-list">
      {items.map((it) => (
        <WordRow key={it.id} item={it} tone={it.tones[0]} note={ROLE[it.id] ?? it.en} play={play} playing={playing} />
      ))}
    </div>
  );
}

function PolitePage({ k, polite, identity, hello, play, playing }: { k: string; playing: Playing; polite: Record<Identity, SpeakerForms>; identity: Identity; hello: Item | undefined; play: Play }) {
  const { sound } = useApp();
  const other: Identity = identity === 'm' ? 'f' : 'm';
  const who = (id: Identity) => (id === 'm' ? 'men' : 'women');
  const said = hello ? sayForm(hello, identity) : null;
  const hearHello = () => hello && void sound.play({ ...sayTarget(hello, identity), voice: identity === 'm' ? 'm1' : 'f1' });
  return (
    <>
      <PageHead k={k} title="Polite endings and “I”" />
      <p className="body" style={{ margin: 0, maxWidth: '52ch' }}>
        Most polite sentences end with a short word. Which one depends on who is speaking, not who is spoken to. “I” changes the same way.
      </p>
      <div className="stack gap-2">
        <Label fg>You say · {identity === 'm' ? 'male' : 'female'} forms</Label>
        <FormRows forms={polite[identity]} play={play} playing={playing} />
        {said && (
          <button type="button" className="primer-ex" onClick={hearHello} aria-label={`Hear ${said.roman}`}>
            <span className="play"><PlayIcon size={12} /></span>
            <span className="thai" lang="th">{said.thai}</span>
            <span className="roman">{said.roman} · hello, said politely</span>
          </button>
        )}
      </div>
      <div className="stack gap-2">
        <Label>You will hear from {who(other)}</Label>
        <FormRows forms={polite[other]} play={play} playing={playing} />
      </div>
      <p className="small" style={{ margin: 0 }}>You chose {identity === 'm' ? 'male' : 'female'} forms in set-up. Change it any time in Settings.</p>
    </>
  );
}

function EarPage({ k, examples, play, canHear, onNext }: { k: string; examples: Partial<Record<Tone, Item>>; play: Play; canHear: boolean; onNext: () => void }) {
  const [rounds] = useState<EarRound[]>(() => earRounds(examples));
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<Tone | null>(null);
  const round: EarRound | undefined = rounds[at];
  const done = rounds.length > 0 && at >= rounds.length;
  const live = canHear && !!round;

  // a round starts by playing the word, with the romanisation hidden (its mark gives the tone away)
  useEffect(() => {
    if (live) play(round.item, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, live]);

  const choose = (t: Tone) => {
    if (picked || !round) return;
    setPicked(t);
  };
  const nextRound = () => {
    setPicked(null);
    setAt(at + 1);
  };

  useKeys((a) => {
    if (!live) {
      // nothing to check, or all done: Enter moves on
      if (a.type === 'confirm') {
        onNext();
        return true;
      }
      return;
    }
    if (a.type === 'rate' && a.n <= 2 && !picked) {
      choose(round.shapes[a.n - 1]);
      return true;
    }
    if (a.type === 'play') {
      play(round.item, !picked);
      return true;
    }
    if (a.type === 'confirm' && picked) {
      nextRound();
      return true;
    }
  });

  if (!canHear || !rounds.length) {
    return (
      <>
        <PageHead k={k} title="A quick ear check" />
        <p className="body" style={{ margin: 0, maxWidth: '52ch' }}>
          {canHear ? 'This course has too few recorded words for the check.' : 'The check needs the course sound, which is off or not in this build.'} Skip ahead: the tone lab does the same job every day.
        </p>
      </>
    );
  }
  if (done) {
    return (
      <>
        <PageHead k={`${k} · done`} title="That is the idea." />
        <p className="body" style={{ margin: 0, maxWidth: '52ch' }}>
          Hearing tones takes a while. The tone lab trains it every day, and review brings words back before they fade. Nothing here was saved.
        </p>
      </>
    );
  }
  const right = picked === round!.tone;
  return (
    <>
      <PageHead k={`${k} · word ${at + 1} of ${rounds.length}`} title="Which shape did you hear?" />
      <div>
        <button type="button" className="pill" onClick={() => play(round!.item, !picked)}>
          <PlayIcon size={12} /> Hear it again
        </button>
      </div>
      <div className="primer-pick" role="group" aria-label="Which tone?">
        {round!.shapes.map((t, i) => {
          const cls = !picked ? '' : t === round!.tone ? 'right' : t === picked ? 'wrong' : 'dim';
          return (
            <button key={t} type="button" className={`primer-choice ${cls}`} onClick={() => choose(t)} disabled={!!picked} aria-label={`${TONE_LABEL[t]} tone`}>
              <ToneShape tone={t} w={120} h={56} />
              <span className="label">{TONE_LABEL[t]}</span>
              <span className="kbd">{i + 1}</span>
            </button>
          );
        })}
      </div>
      {/* the answer's room is kept (hidden) until a shape is picked: nothing below moves */}
      <div className={`stack gap-3 ${picked ? 'fade-in' : 'keep'}`} aria-hidden={!picked}>
        <p className={right ? 'good' : 'bad'} style={{ margin: 0 }}>{picked ? (right ? 'Right.' : `It was ${TONE_LABEL[round!.tone].toLowerCase()}.`) : ' '}</p>
        <FitText as="p" className="body primer-word" min={11}>
          <span className="thai-m" lang="th">{round!.item.thai}</span> <span className="roman">{round!.item.roman} · {round!.item.en}</span>
        </FitText>
        <div>
          <button type="button" className="pill solid" onClick={nextRound} disabled={!picked} tabIndex={picked ? 0 : -1}>{at + 1 < rounds.length ? 'Next word' : 'Finish'}</button>
        </div>
      </div>
      <p className="small" style={{ margin: 0 }}>Nothing here is saved or scored.</p>
    </>
  );
}

function DayPage({ k, minutes }: { k: string; minutes: number }) {
  return (
    <>
      <PageHead k={k} title="How a day works" />
      <p className="body" style={{ margin: 0, maxWidth: '52ch' }}>
        About {minutes} minutes, in this order. Today shows the next step with one button; everything else stays open below it.
      </p>
      <ol className="primer-day">
        <li>
          <b>New words</b>
          <span>Meet the day’s words and letters, with their sound and a memory hook.</span>
        </li>
        <li>
          <b>Practise</b>
          <span>The tone lab for your ear, and the sentence builder for word order.</span>
        </li>
        <li>
          <b>A real conversation on the street</b>
          <span>Use the words with one of the eight people on the street.</span>
        </li>
        <li>
          <b>Writing</b>
          <span>A few letters a day, stroke by stroke, so the script stops being a wall.</span>
        </li>
        <li>
          <b>Review</b>
          <span>Review brings back what you are about to forget, just before you forget it. It is what makes the words stay, so it comes every day.</span>
        </li>
      </ol>
      <p className="small" style={{ margin: 0 }}>On day 1 the words come first and review last, because there is nothing to review yet.</p>
    </>
  );
}

/** A page's label and title, in the place every set-up step keeps them. */
function PageHead({ k, title }: { k: string; title: string }) {
  return (
    <div className="stack gap-2">
      <Label>{k}</Label>
      <h1 className="h-l primer-title">{title}</h1>
    </div>
  );
}
