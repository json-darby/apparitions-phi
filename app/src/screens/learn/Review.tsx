// Review: today's due cards plus same-session retests. Each card asks for its
// skill (hear, say, read, tone, write), measures the answer time, hints and
// replays, then takes the learner's own rating: three buttons in the first
// weeks, six after (the ratings setting). Every answer goes to engine.answer.
// No animation here apart from the word-strength drawing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useStoreVersion } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link, useRoute } from '../../app/router';
import { TONE_LABEL, type Recording } from '../../audio/sound';
import { MicIcon, PlayIcon, useSoundState } from '../../audio/SoundLayer';
import { DotWord } from '../../anim';
import { sayForm, bothForms } from '../../content/repo';
import { SKILLS, VOICES, type Skill, type Tone } from '../../content/types';
import { cardKey, type AnswerResult } from '../../engine/engine';
import { SIX_LABELS, Six, ratingScale } from '../../engine/grade';
import type { CardRow } from '../../db/store';
import { useKeys } from '../../input/keys';
import { handwritingScore, type Ink } from '../../writing/recognise';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RatingBar, RunRail, Screen, Stat, TopBar } from '../../ui/kit';
import { describe, fmtAgo, fmtSecs, formsDiffer, letterPlay, listenForm, patternThai, pick, sayTarget, syllables, type Shown } from './parts/common';
import { HookSheet } from './parts/HookSheet';
import { ToneQuiz } from './parts/ToneQuiz';
import { ToneRow } from './parts/ToneShape';
import { WritePad } from './parts/WritePad';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

interface QueueEntry {
  id: number;
  key: string;
  retest: boolean;
}

let seq = 0;

export default function Review() {
  // ?free=1: free practice of any met items, weakest first, even when nothing is due
  const free = useRoute().query.get('free') === '1';
  return <ReviewRun key={free ? 'free' : 'due'} free={free} />;
}

const FREE_COUNT = 30;

function ReviewRun({ free }: { free: boolean }) {
  const { engine, store } = useApp();
  const build = (): QueueEntry[] =>
    free
      ? engine
          .forGame({ skills: SKILLS, count: 500 })
          .sort((a, b) => a.retrievability - b.retrievability)
          .slice(0, FREE_COUNT)
          .map((g) => ({ id: ++seq, key: cardKey(g.ref, g.skill), retest: false }))
      : engine.planDay().reviews.map((r) => ({ id: ++seq, key: r.key, retest: false }));
  const [queue, setQueue] = useState<QueueEntry[]>(build);
  const [at, setAt] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [retestTimes, setRetestTimes] = useState<number[]>([]);
  const [hook, setHook] = useState<{ ref: string; contrast: string | null } | null>(null);
  const hooked = useRef(new Set<string>());
  const [, tick] = useState(0);

  // same-session retests: misses come back after a short gap
  useEffect(() => {
    const pull = () => {
      const keys = engine.retestsDue();
      if (keys.length) setQueue((q) => [...q, ...keys.map((key) => ({ id: ++seq, key, retest: true }))]);
      tick((n) => n + 1);
    };
    pull();
    const iv = setInterval(pull, 5_000);
    return () => clearInterval(iv);
  }, [engine]);

  const entry = queue[at];
  const row = entry ? store.getCard(entry.key) : null;

  // a leech: offer a fresh hook before the card
  const entryId = entry?.id;
  const missing = !!entry && !row;
  useEffect(() => {
    if (missing) {
      // the card vanished (content changed): skip it
      setAt((i) => i + 1);
      return;
    }
    const r = entry ? store.getCard(entry.key) : null;
    if (!r || hooked.current.has(r.ref)) return;
    const meta = engine.meta(r);
    if (meta.needsHook) {
      hooked.current.add(r.ref);
      setHook({ ref: r.ref, contrast: meta.contrastWith ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, missing]);

  const onAnswered = (r: AnswerResult, ref: string) => {
    setAnswered((n) => n + 1);
    if (r.retestAt) setRetestTimes((t) => [...t, r.retestAt!]);
    if (r.becameLeech && !hooked.current.has(ref)) {
      hooked.current.add(ref);
      const c = store.cardsForRef(ref).map((x) => engine.meta(x).contrastWith).find(Boolean) ?? null;
      setHook({ ref, contrast: c });
    }
    const more = engine.retestsDue();
    if (more.length) setQueue((q) => [...q, ...more.map((key) => ({ id: ++seq, key, retest: true }))]);
    setAt((i) => i + 1);
  };

  const sheet = hook && <HookSheet refId={hook.ref} contrastWith={hook.contrast} onClose={() => setHook(null)} />;

  if (missing) return null;
  if (!entry || !row) {
    const now = Date.now();
    const waiting = retestTimes.filter((t) => t > now).sort((a, b) => a - b);
    // a third button only when there is one to offer: two fill the row, as on the other learn screens
    const middle =
      free && queue.length ? (
        <button className="pill" type="button" onClick={() => { setQueue(build()); setAt(0); setAnswered(0); }}>More practice</button>
      ) : engine.introducedRefs().size > 0 && !free ? (
        <Link to="/review?free=1" className="pill" style={{ textDecoration: 'none' }}>Free practice</Link>
      ) : null;
    return (
      <Screen top={<TopBar mid={free ? 'Practice' : 'Review'} parent="/" />} narrow>
        <div className="prompt">
          <Label>{free ? 'Free practice' : 'Review'}</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>{queue.length ? (free ? 'Practice done.' : 'Clear for now.') : free ? 'Nothing met yet.' : 'Nothing due.'}</h1>
          <p className="body">
            {queue.length
              ? `${answered} answer${answered === 1 ? '' : 's'} logged.`
              : 'Meet today’s new items first; they come straight back here for a first look.'}
          </p>
          {!free && engine.introducedRefs().size > 0 && (
            <p className="body">
              Want more? Free practice runs your weakest met items now. Early answers still go to the schedule, which allows for them.
            </p>
          )}
          {waiting.length > 0 && (
            <p className="body">
              {waiting.length} miss{waiting.length === 1 ? '' : 'es'} come back for a second look, the next in{' '}
              {Math.max(1, Math.ceil((waiting[0] - now) / 60_000))} min. Stay here, or carry on and they wait.
            </p>
          )}
        </div>
        <div className="learn-foot">
          <div className={`btn-row ${middle ? 'three' : ''}`}>
            {queue.length ? <Link to="/tone-pairs" className="pill" style={{ textDecoration: 'none' }}>Tone lab</Link> : <Link to="/new" className="pill" style={{ textDecoration: 'none' }}>New items</Link>}
            {middle}
            {free ? <Link to="/" className="pill solid" style={{ textDecoration: 'none' }}>Today</Link> : <ContinueLink current="review" />}
          </div>
        </div>
        {sheet}
      </Screen>
    );
  }

  return (
    <>
      <ReviewCard key={entry.id} row={row} n={at + 1} total={queue.length} retest={entry.retest} free={free} onAnswered={onAnswered} paused={!!hook} />
      {sheet}
    </>
  );
}

// ---------------------------------------------------------------------------

function ReviewCard({ row, n, total, retest, free, onAnswered, paused }: { row: CardRow; n: number; total: number; retest: boolean; free: boolean; onAnswered: (r: AnswerResult, ref: string) => void; paused: boolean }) {
  const { engine, content, sound, store, settings } = useApp();
  useStoreVersion();
  const { device } = useDevice();
  const { recording } = useSoundState();
  const skill = row.skill as Skill;
  const shown = useMemo(() => describe(content, row.ref), [content, row.ref]);
  const t0 = useRef(performance.now());
  const [revealed, setRevealed] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [hints, setHints] = useState(0);
  const [replays, setReplays] = useState(0);
  const [rec, setRec] = useState<Recording | null | undefined>(undefined);
  const [speech, setSpeech] = useState<number | null>(null);
  const [toneOk, setToneOk] = useState<boolean | null>(null);
  const [tonePicks, setTonePicks] = useState<Tone[]>([]);
  const [ink, setInk] = useState<Ink>([]);
  const [hand, setHand] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Six | null>(null);
  const [lastSeen] = useState(() => store.logForRef(row.ref, 1)[0]?.at ?? null);
  const [lastSpeech] = useState<number | null>(() => {
    for (const l of store.logForRef(row.ref, 30)) {
      const d = JSON.parse(l.data || '{}') as { speech?: number | null };
      if (typeof d.speech === 'number') return d.speech;
    }
    return null;
  });
  const preview = useMemo(() => (revealed ? engine.preview(row.ref, skill) : null), [revealed, engine, row.ref, skill]);
  // three buttons in the first weeks, six after (or as set)
  const scale = ratingScale(settings.ratings, engine.day());

  const play = (slow = false, counted = true) => {
    if (!shown) return;
    if (counted) setReplays((r) => r + 1);
    const voice = pick(VOICES);
    // tone-marked romanisation would give the answer away before the reveal
    const hideRoman = !revealed;
    if (shown.item) sound.play({ ...listenForm(shown.item, voice, hideRoman), speed: slow ? 'slow' : 'normal' });
    else if (shown.letter) sound.play({ ...letterPlay(shown.letter), hideRoman, speed: slow ? 'slow' : 'normal' });
    else sound.play({ ref: shown.ref, thai: shown.thai, roman: shown.roman, hideRoman, speed: slow ? 'slow' : 'normal' });
  };

  // hear and tone cards open with the sound
  useEffect(() => {
    if (skill === 'hear' || skill === 'tone') play(false, false);
    return () => sound.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = () => {
    if (revealed) return;
    setMs((m) => m ?? Math.round(performance.now() - t0.current));
    setRevealed(true);
  };

  const sayIt = async () => {
    if (!shown) return;
    setMs((m) => m ?? Math.round(performance.now() - t0.current));
    const target = shown.item ? sayTarget(shown.item, settings.identity) : { ref: shown.ref, thai: shown.thai, roman: shown.roman, en: shown.en };
    const r = await sound.record(target);
    setRec(r);
    if (r) {
      const s = await sound.score(r, target);
      setSpeech(s?.overall ?? null);
    }
    setRevealed(true);
  };

  const checkWriting = (paper: boolean) => {
    if (!paper && shown?.letter && ink.length) setHand(handwritingScore(ink, shown.letter));
    reveal();
  };

  const rate = (s: Six) => {
    if (chosen != null || !revealed) return;
    setChosen(s);
    const res = engine.answer({
      ref: row.ref,
      skill,
      source: retest ? 'review:retest' : free ? 'practice' : 'review',
      own: s,
      correct: skill === 'tone' ? toneOk ?? undefined : undefined,
      ms: ms ?? undefined,
      hints,
      replays,
      speechScore: skill === 'say' ? speech : undefined,
      handwritingScore: skill === 'write' ? hand : undefined,
      data: skill === 'say' ? { said: !!rec, mode: sound.mode } : undefined,
    });
    setTimeout(() => onAnswered(res, row.ref), 220);
  };

  useKeys(
    (a) => {
      if (recording) return;
      if (a.type === 'play' && (skill === 'hear' || skill === 'tone' || revealed)) {
        play();
        return true;
      }
      if (a.type === 'confirm' && !revealed) {
        if (skill === 'tone') return;
        if (skill === 'write') checkWriting(false);
        else reveal();
        return true;
      }
    },
    !paused && chosen == null,
  );

  if (!shown) return null;

  const saidAloud = skill === 'say'
    ? rec === undefined ? '—' : rec === null ? 'No' : speech != null ? `${Math.round(speech * 100)}%` : 'Yes'
    : lastSpeech != null ? `${Math.round(lastSpeech * 100)}%` : '—';
  const stats = (
    <div className={`stats learn-stats ${device === 'phone' ? 'four' : ''}`}>
      <Stat label="Answer time" value={revealed ? fmtSecs(ms) : '—'} />
      <Stat label="Said aloud" value={saidAloud} />
      <Stat label="Last seen" value={fmtAgo(lastSeen)} />
      {device === 'phone' && <Stat label="Strength" value={`${Math.round(engine.strengthOf(row.ref) * 100)}%`} />}
    </div>
  );

  // the two buttons under the card: always there, so the ratings never move
  const actions: [ReactNode, ReactNode] = !revealed
    ? skill === 'say'
      ? [
          <button key="a" className="pill" type="button" onClick={reveal}>Reveal</button>,
          <button key="b" className="pill solid" type="button" onClick={sayIt}><MicIcon size={16} /> Say it</button>,
        ]
      : skill === 'write'
        ? [
            <button key="a" className="pill" type="button" onClick={() => checkWriting(true)}>I wrote it on paper</button>,
            <button key="b" className="pill solid" type="button" onClick={() => checkWriting(false)} disabled={!ink.length}>Check</button>,
          ]
        : skill === 'tone'
          ? [
              <button key="a" className="pill" type="button" onClick={() => play()}><PlayIcon size={14} /> Again</button>,
              <button key="b" className="pill" type="button" onClick={() => play(true)}>Slow</button>,
            ]
          : [
              <button key="a" className="pill" type="button" onClick={() => play()}><PlayIcon size={14} /> {skill === 'hear' ? 'Again' : 'Hear it'}</button>,
              <button key="b" className="pill solid" type="button" onClick={reveal}>Reveal</button>,
            ]
    : skill === 'say' && rec === undefined
      ? [
          <button key="a" className="pill" type="button" onClick={() => play()}><PlayIcon size={14} /> Hear it</button>,
          <button key="b" className="pill" type="button" onClick={sayIt}><MicIcon size={16} /> Say it</button>,
        ]
      : [
          <button key="a" className="pill" type="button" onClick={() => play()}><PlayIcon size={14} /> Hear it</button>,
          <button key="b" className="pill" type="button" onClick={() => play(true)}>Slow</button>,
        ];

  const card = (
    <>
      <RunRail n={n - 1} total={total} left={`${free ? 'Practice' : 'Review'} · ${n} of ${total}`} right={retest ? 'Second look' : skillTag(skill)} />
      {/* one card, one size: the question on the front, the answer on the back */}
      <div className={`rv-card ${revealed ? 'is-back' : 'is-front'}`}>
        {revealed ? (
          <Reveal shown={shown} skill={skill} toneOk={toneOk} tonePicks={tonePicks} hand={hand} />
        ) : (
          <>
            <Prompt shown={shown} skill={skill} hints={hints} onHint={() => setHints((h) => h + 1)} onPlay={() => play()} onSlow={() => play(true)} replays={replays} />
            {skill === 'tone' && (
              <div className="rv-quiz">
                <ToneQuiz
                  tones={shown.tones}
                  sylls={syllables(shown.roman)}
                  enabled={!paused}
                  onDone={(ok, picks) => {
                    setToneOk(ok);
                    setTonePicks(picks);
                    reveal();
                  }}
                />
              </div>
            )}
            {skill === 'write' && (
              <div className="rv-pad">
                <WritePad size={device === 'phone' ? 200 : 228} onInk={setInk} />
              </div>
            )}
            {skill !== 'tone' && skill !== 'write' && (
              <div className="rv-hidden" aria-hidden>
                <span className="label">Answer</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="learn-foot">
        <div className="btn-row">{actions}</div>
        <div className="stack gap-2">
          <Label>{revealed ? 'How did that feel? Next review' : 'Recall first, then reveal'}</Label>
          <RatingBar preview={preview} onRate={rate} chosen={chosen} enabled={revealed && chosen == null && !paused} scale={scale} />
          <FitText as="p" className="small" lines={2} min={10} valign="top">
            {scale === 'simple' ? 'Not sure, or only half right? Didn’t know brings it straight back. ' : ''}
            {skill === 'say' ? 'Your rating, answer time and speech score' : skill === 'write' ? 'Your rating, answer time and handwriting score' : 'Your rating and answer time'} set the next date together.
          </FitText>
        </div>
        {device === 'phone' && stats}
        {device === 'desktop' && (
          <KeyHints
            hints={
              revealed
                ? [[scale === 'simple' ? '1–3' : '1–6', 'Rate'], ['Space', 'Hear it']]
                : skill === 'tone'
                  ? [['1–5', 'Pick the tone'], ['Space', 'Play again']]
                  : [['Enter', skill === 'write' ? 'Check' : 'Reveal'], ['Space', skill === 'hear' ? 'Play again' : 'Hear it']]
            }
          />
        )}
      </div>
    </>
  );

  const panel = device !== 'phone' && (
    <div className="stack gap-6" style={{ paddingTop: 8 }}>
      <div className="stack gap-2">
        <Label>Word strength</Label>
        {/* drawn after the reveal: before it, the word would give the answer away */}
        {revealed ? (
          <DotWord text={shown.thai} strength={engine.strengthOf(row.ref)} size={dotSize(shown.thai, device === 'desktop' ? 64 : 52)} style={{ height: 110, minWidth: 0, justifyItems: 'start', overflow: 'hidden' }} />
        ) : (
          <div className="hidden-answer" style={{ height: 110, minHeight: 0 }}>
            <span className="h-m num">{Math.round(engine.strengthOf(row.ref) * 100)}%</span>
          </div>
        )}
      </div>
      {stats}
      <History refId={row.ref} />
    </div>
  );

  return (
    <Screen top={<TopBar mid={free ? 'Practice' : 'Review'} parent="/" />} panel={panel || undefined} narrow={device === 'desktop'}>
      {card}
    </Screen>
  );
}

/** The dot word's size: as large as it can be while the whole word fits the side panel's width. */
function dotSize(thai: string, max: number): number {
  // combining vowels and tone marks take no width of their own
  const cells = thai.replace(/[ัิ-ฺ็-๎\s]/g, '').length;
  return Math.max(20, Math.min(max, Math.floor(280 / (cells * 0.62 + 0.3))));
}

function skillTag(s: Skill) {
  return { hear: 'Listen', say: 'Speak', read: 'Read', write: 'Write', tone: 'Tone' }[s];
}

/** The label over a card, front and back alike. */
function promptLabel(shown: Shown, skill: Skill): string {
  const { letter, pattern } = shown;
  if (skill === 'say') return 'How do you say';
  if (skill === 'hear') return 'What did you hear?';
  if (skill === 'tone') return `Name the tone${shown.tones.length > 1 ? ` · ${shown.tones.length} syllables` : ''}`;
  if (skill === 'write') return 'Write it';
  return letter ? 'What sound does it make?' : pattern ? 'What does it say?' : 'What does it mean?';
}

function Prompt({ shown, skill, hints, onHint, onPlay, onSlow, replays }: { shown: Shown; skill: Skill; hints: number; onHint: () => void; onPlay: () => void; onSlow: () => void; replays: number }) {
  const { settings } = useApp();
  const { item, letter, pattern } = shown;
  const label = <Label>{promptLabel(shown, skill)}</Label>;

  if (skill === 'say') {
    const target = item ? sayForm(item, settings.identity) : { thai: shown.thai, roman: shown.roman };
    const sylls = syllables(target.roman);
    const prompt = pattern ? `${pattern.en}: ${patternThai(pattern).en}` : shown.en;
    return (
      <div className="rv-front">
        {label}
        <FitText as="h1" className="h-l rv-head" lines={2} min={20}>{prompt}</FitText>
        <FitText className="small rv-sub" min={10}>
          {item?.polite ? `With your polite ending (${settings.identity === 'm' ? 'male' : 'female'} speaker).` : ''}
        </FitText>
        <div className="rv-hint">
          <button className="pill small" type="button" onClick={onHint} disabled={hints >= sylls.length}>
            Hint
          </button>
          <FitText className="roman" min={10}>{hints > 0 ? `${sylls.slice(0, hints).join(' ')} …` : ''}</FitText>
        </div>
      </div>
    );
  }

  if (skill === 'hear') {
    return (
      <div className="rv-front">
        {label}
        <FitText as="h1" className="h-m rv-head" min={16}>{letter ? 'Which letter is this?' : pattern ? 'What does it say?' : 'What does it mean?'}</FitText>
        <div className="play-row rv-play">
          <button className="iconbtn" type="button" onClick={onPlay} aria-label="Play again"><PlayIcon /></button>
          <button className="pill small" type="button" onClick={onSlow}>Slow</button>
          <span className="small num">{replays ? `Played ${replays + 1} times` : 'Play again as often as you like'}</span>
        </div>
      </div>
    );
  }

  if (skill === 'tone') {
    return (
      <div className="rv-front">
        {label}
        <div className="rv-thai-row">
          <FitText className="thai-xl" lang="th" min={22}>{shown.thai}</FitText>
          <button className="iconbtn ghost" type="button" onClick={onPlay} aria-label="Play again"><PlayIcon /></button>
        </div>
        <FitText className="small rv-sub" min={10}>Listen, or read it from the spelling.</FitText>
      </div>
    );
  }

  if (skill === 'write') {
    return (
      <div className="rv-front">
        {label}
        <FitText as="h1" className="h-l rv-head" min={18}>{letter ? letter.name : shown.en}</FitText>
        <FitText className="body rv-sub" min={10}>
          {letter
            ? `The ${letter.cls === 'vowel' || letter.cls === 'tonemark' ? letter.cls : `${letter.cls}-class consonant`} for “${letter.initial}”, as in ${letter.keyword}.`
            : ''}
        </FitText>
      </div>
    );
  }

  // read
  return (
    <div className="rv-front">
      {label}
      <FitText className="thai-xl rv-thai" lang="th" min={22}>{shown.thai}</FitText>
    </div>
  );
}

function Reveal({ shown, skill, toneOk, tonePicks, hand }: { shown: Shown; skill: Skill; toneOk: boolean | null; tonePicks: Tone[]; hand: number | null }) {
  const { settings, engine } = useApp();
  const { item, letter, pattern } = shown;
  const hookText = engine.hookFor(shown.ref);
  const label = <Label>{promptLabel(shown, skill)}</Label>;
  const hook = (
    <FitText as="p" className="small hook rv-hook" lines={2} min={10} valign="top">{hookText ?? ''}</FitText>
  );

  if (item) {
    const said = skill === 'say' ? sayForm(item, settings.identity) : { thai: item.thai, roman: item.roman };
    const names = (ts: Tone[]) => ts.map((t) => TONE_LABEL[t].toLowerCase()).join(', ');
    const note =
      skill === 'tone' && toneOk != null ? (
        <span className={toneOk ? 'good' : 'bad'}>
          {toneOk ? `Right: ${names(shown.tones)}.` : `Not quite: ${names(shown.tones)}. You picked ${names(tonePicks)}.`}
        </span>
      ) : skill === 'say' && formsDiffer(item) ? (
        <>
          {settings.identity === 'm' ? 'Female' : 'Male'} speakers say{' '}
          <span className="thai" lang="th">{bothForms(item)[settings.identity === 'm' ? 'f' : 'm'].thai}</span>.
        </>
      ) : null;
    return (
      <div className="rv-back">
        {label}
        <FitText className="thai-xl rv-thai" lang="th" min={22}>{said.thai}</FitText>
        <FitText className="roman" min={11}>{said.roman}</FitText>
        <FitText className="h-s" min={13}>{item.en}</FitText>
        <div className="rv-detail">
          <ToneRow tones={item.tones} sylls={syllables(item.roman)} size={52} />
        </div>
        <FitText className="small rv-note" min={10}>{note}</FitText>
        {hook}
      </div>
    );
  }

  if (letter) {
    const cls = letter.cls === 'vowel' || letter.cls === 'tonemark' ? letter.cls : `${letter.cls} class`;
    return (
      <div className="rv-back">
        {label}
        <FitText className="thai-xl rv-thai" lang="th" min={22}>{letter.char}</FitText>
        <FitText className="h-s" min={13}>{letter.name}</FitText>
        <FitText className="roman" min={11}>
          {cls} · starts “{letter.initial}”{letter.final ? ` · ends “${letter.final}”` : ''}
        </FitText>
        <div className="rv-detail">
          <FitText className="small" lines={4} min={10} valign="top">Key word: {letter.keyword}.</FitText>
        </div>
        <FitText className="small rv-note" min={10}>
          {skill === 'write' ? (hand != null ? `Handwriting match ${Math.round(hand * 100)}%.` : 'Paper: compare your letter with this one and rate it.') : ''}
        </FitText>
        {hook}
      </div>
    );
  }

  if (pattern) {
    return (
      <div className="rv-back">
        {label}
        <FitText className="thai-xl rv-thai" lang="th" min={20}>{pattern.frame}</FitText>
        <FitText className="roman" min={10}>
          <span className="thai" lang="th">{shown.thai}</span> · {shown.roman}
        </FitText>
        <FitText className="h-s" min={13}>{pattern.en}</FitText>
        <div className="rv-detail">
          <FitText className="small" lines={4} min={10} valign="top">{pattern.note}</FitText>
        </div>
        <FitText className="small rv-note" min={10}>{''}</FitText>
        {hook}
      </div>
    );
  }
  return null;
}

function History({ refId }: { refId: string }) {
  const { store } = useApp();
  useStoreVersion();
  const rows = store.logForRef(refId, 12);
  return (
    <div className="stack gap-2">
      <Label>History</Label>
      {rows.length === 0 ? (
        <p className="small">No answers yet.</p>
      ) : (
        <div className="history">
          {rows.map((l) => (
            <div key={l.seq} className="h-row">
              <span className="num">{fmtAgo(l.at)}</span>
              <span>
                {l.source === 'new' ? 'Met' : l.skill ? skillTag(l.skill as Skill) : '—'}
                <span className="mut"> · {l.source.replace('review:retest', 'retest')}</span>
              </span>
              <span className="label">
                {l.rating ? SIX_LABELS[l.rating as Six] : l.correct == null ? '' : l.correct ? 'Right' : 'Wrong'}
                {!l.counted && l.source !== 'new' ? ' · not counted' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
