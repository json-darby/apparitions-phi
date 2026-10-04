// New items: meet today's new words, letters and patterns, one per page, in
// groups of four with a quick check after each group. Meaning, script,
// romanisation and voices come first on a card; tones, speech forms, an
// example and a memory hook follow. Moving on introduces the item to the
// memory engine. This is the only screen that introduces anything.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link, useRoute } from '../../app/router';
import { pitchCurve } from '../../audio/sound';
import { PlayIcon } from '../../audio/SoundLayer';
import { Apparition, FaceToWord, LetterFromDots } from '../../anim';
import { bothForms } from '../../content/repo';
import type { Item, Letter, Pattern, VoiceId } from '../../content/types';
import { myVoiceFor } from '../../core/settings';
import { useKeys } from '../../input/keys';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RunRail, Screen, TopBar } from '../../ui/kit';
import { VOICE_NAME, VOICE_ORDER, VOICE_WHO, describe, formsDiffer, isFemale, letterPlay, listenForm, patternThai, syllables, voiceFor, type Shown } from './parts/common';
import { GROUP_SIZE, landing, lessonSteps, otherSpeaker, teachingOrder, type Step } from './parts/lesson';
import { QuickCheck } from './parts/QuickCheck';
import { ToneRow } from './parts/ToneShape';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

type Art = { mode: 'gather' | 'idle' | 'tear' | 'word'; who: string; pitch: number[] | null; cue: number };

/** A card opens with its word after this pause, so the meaning is read first. */
const AUTOPLAY_MS = 500;

/** The learner's own voice for a card, or the other voice of that sex when only it has a clip. */
function ownVoice(s: Shown, mine: VoiceId): VoiceId {
  const twin = (isFemale(mine) ? ['f1', 'f2'] : ['m1', 'm2']).find((v) => v !== mine) as VoiceId;
  // a word only the other sex says is moved to a matching voice by listenForm
  const wanted = [mine, twin].map((v) => (s.item ? voiceFor(s.item, v) : v));
  const audio = (s.item ?? s.letter)?.media?.audio;
  return wanted.find((v) => !!audio?.[`${v}.normal`]) ?? wanted[0];
}

export default function NewItems() {
  const { engine, content, sound, settings, store, reducedMotion } = useApp();
  const { device } = useDevice();
  const { query } = useRoute();
  // ?ref= replays one met item's card: nothing is introduced, today's queue is untouched
  const replayRef = query.get('ref');
  const replay = !!replayRef;
  // ?peek=N is a sneak peek at day N's words (?ahead=1, the old link, peeks at tomorrow): the cards
  // and their checks, but nothing is introduced and no date moves, so day N still brings them as new
  const today = engine.day();
  const peekParam = query.get('peek') ?? (query.get('ahead') === '1' ? String(today + 1) : null);
  const peekDay = peekParam == null ? null : Math.min(settings.courseDays, Math.max(today + 1, Number(peekParam) || today + 1));
  const peek = peekDay != null && !replay;
  const refsFor = () => (replayRef ? [replayRef] : peek ? peekRefs(engine, peekDay!) : engine.planDay().newRefs);
  // today's set is fixed when the screen opens: introducing changes the plan
  const [refs, setRefs] = useState(refsFor);
  // a new ?ref= or ?peek= on the same screen swaps the set
  const lastKey = useRef(`${replayRef}|${peekDay}`);
  useEffect(() => {
    const key = `${replayRef}|${peekDay}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    setRefs(refsFor());
    setPos(0);
    setChecked(new Set());
    setMet(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayRef, peekDay, engine]);
  // remember what was peeked at, so the real day can say so
  useEffect(() => {
    if (peek && refs.length) addPeeked(store, refs);
  }, [peek, refs, store]);
  const peeked = useMemo(() => (peek ? new Set<string>() : peekedRefs(store)), [peek, store]);
  // the learner's own words first, the other sex's last
  const shown = useMemo(
    () => teachingOrder(refs.map((r) => describe(content, r)).filter((s): s is Shown => !!s), settings.identity),
    [refs, content, settings.identity],
  );
  const steps = useMemo<Step[]>(() => (replay ? shown.map((_, at) => ({ kind: 'card', at })) : lessonSteps(shown)), [shown, replay]);
  const [pos, setPos] = useState(0);
  /** groups whose check is done or skipped */
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [met, setMet] = useState<Set<string>>(() => new Set());
  const [art, setArt] = useState<Art>({ mode: 'gather', who: 'pim', pitch: null, cue: 0 });
  const [voiceAt, setVoiceAt] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const step: Step | undefined = steps[pos];
  const cur = step?.kind === 'card' ? shown[step.at] : undefined;
  const at = step?.kind === 'card' ? step.at : 0;
  const finished = pos >= steps.length;

  // the first page gathers; later pages idle until a voice speaks
  useEffect(() => {
    setArt((a) => ({ mode: pos === 0 ? 'gather' : 'idle', who: 'pim', pitch: null, cue: a.cue + 1 }));
    setVoiceAt(0);
    return () => sound.stop();
  }, [pos, sound]);

  const introduceCurrent = () => {
    if (!cur || met.has(cur.ref) || replay) return;
    if (peek) {
      // a sneak peek counts the card as seen here, and changes nothing in the memory engine
      setMet((m) => new Set(m).add(cur.ref));
      return;
    }
    if (!engine.isIntroduced(cur.ref)) engine.introduce(cur.ref);
    setMet((m) => new Set(m).add(cur.ref));
  };
  /** Move to a step. Forward moves stop at a check not yet done; a check is left only by finishing or skipping it, or by going back. */
  const go = (to: number) => {
    if (replay || !step) return;
    if (step.kind === 'check' && to > pos) return;
    const next = landing(steps, checked, pos, Math.max(0, Math.min(to, steps.length)));
    if (next === pos) return;
    introduceCurrent();
    setPos(next);
  };
  const goCard = (i: number) => go(steps.findIndex((s) => s.kind === 'card' && s.at === i));
  const leaveCheck = (group: number) => {
    const done = new Set(checked).add(group);
    setChecked(done);
    setPos(landing(steps, done, pos, pos + 1));
  };

  const hear = async (voice: VoiceId, s: Shown | undefined = cur) => {
    if (!s) return;
    const req = s.item
      ? listenForm(s.item, voice)
      : s.letter
        ? { ...letterPlay(s.letter), voice, speaker: VOICE_WHO[voice][0].toUpperCase() + VOICE_WHO[voice].slice(1) }
        : { ref: s.ref, thai: s.thai, roman: s.roman, en: s.en, voice, speaker: VOICE_WHO[voice][0].toUpperCase() + VOICE_WHO[voice].slice(1) };
    const who = VOICE_WHO[voice];
    setArt((a) => ({ mode: 'tear', who, pitch: req.tones?.length ? pitchCurve(req.tones) : null, cue: a.cue + 1 }));
    await sound.play(req);
    setArt((a) => (a.who === who && a.mode === 'tear' ? { ...a, mode: 'word', cue: a.cue + 1 } : a));
  };

  // a word or letter card opens with its sound, once, in the learner's own
  // voice where there is a clip. Not with sound off, and never over a clip
  // that is already playing. The timer is cleared when the card changes, so a
  // card that re-renders (or mounts twice in development) plays once.
  useEffect(() => {
    if (!cur || cur.pattern || sound.mode !== 'audio') return;
    const card = cur;
    const t = setTimeout(() => {
      if (!sound.getState().caption) void hear(ownVoice(card, myVoiceFor(settings)), card);
    }, AUTOPLAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, cur?.ref, sound]);

  /** The next day after this one that a peek can show (null past the end of the course). */
  const nextPeek = (() => {
    const from = peek ? peekDay! : today;
    for (let d = from + 1; d <= settings.courseDays; d++) if (peekRefs(engine, d).length) return d;
    return null;
  })();

  useKeys((a) => {
    if (a.type === 'move' && a.down && a.dx) {
      if (replay) return;
      go(pos + a.dx);
      return true;
    }
    if (a.type === 'confirm' && !replay) {
      go(pos + 1);
      return true;
    }
    if (a.type === 'play' && cur) {
      const v = VOICE_ORDER[voiceAt % 4];
      setVoiceAt((n) => n + 1);
      void hear(v);
      return true;
    }
    if (a.type === 'rate' && a.n <= 4 && cur) {
      void hear(VOICE_ORDER[a.n - 1]);
      return true;
    }
  }, !finished && !!cur);

  const peekLink = nextPeek != null && !replay ? (
    <Link to={`/new?peek=${nextPeek}`} className="pill" style={{ textDecoration: 'none' }}>
      {nextPeek === today + 1 ? 'Sneak peek' : `Peek: day ${nextPeek}`}
    </Link>
  ) : null;

  if (!shown.length) {
    return (
      <Screen top={<TopBar mid={peek ? 'Sneak peek' : 'New items'} parent="/" />} narrow>
        <div className="prompt">
          <Label>{peek ? `Sneak peek · Day ${peekDay}` : 'New items'}</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>{replay ? 'Not found.' : peek ? 'Nothing new that day.' : 'Nothing new today.'}</h1>
          <p className="body" style={{ maxWidth: '46ch' }}>
            {replay
              ? 'That item is not in the course.'
              : peek
                ? 'Every word of that day is already in your reviews.'
                : 'Either today’s set is in, or reviews filled the time and new items wait until they clear.'}
          </p>
        </div>
        <div className="learn-foot">
          <div className={`btn-row ${peekLink ? 'three' : ''}`}>
            <Link to="/review" className="pill" style={{ textDecoration: 'none' }}>Review</Link>
            {peekLink}
            <ContinueLink current="new" />
          </div>
        </div>
      </Screen>
    );
  }

  if (finished && peek) {
    return (
      <Screen top={<TopBar mid="Sneak peek" parent="/" />} narrow>
        <div className="prompt">
          <Label>{`Sneak peek · Day ${peekDay} · done`}</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>A first look at {shown.length}.</h1>
          <p className="body" style={{ maxWidth: '46ch' }}>
            That was a sneak peek: nothing joined your reviews and no dates moved. On day {peekDay} these come to you as
            new, as planned, and count from then. You will have a head start.
          </p>
          <div className="stack" style={{ marginTop: 18 }}>
            {shown.map((s) => (
              <div key={s.ref} className="row" style={{ cursor: 'default' }}>
                <span className="thai">{s.thai}</span>
                <span className="row-right">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="learn-foot">
          <div className={`btn-row ${peekLink ? 'three' : ''}`}>
            <button className="pill" type="button" onClick={() => setPos(landing(steps, checked, steps.length, steps.length - 1))}>Back</button>
            {peekLink}
            <Link to="/" className="pill solid" style={{ textDecoration: 'none' }}>Today</Link>
          </div>
        </div>
      </Screen>
    );
  }

  if (finished) {
    return (
      <Screen top={<TopBar mid="New items" parent="/" />} narrow>
        <div className="prompt">
          <Label>New items · done</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>{met.size} in.</h1>
          <p className="body" style={{ maxWidth: '46ch' }}>
            They come straight back in Review for a first look, then again tomorrow. Listening and reading open first; saying and tones follow once those hold.
          </p>
          <div className="stack" style={{ marginTop: 18 }}>
            {shown.map((s) => (
              <div key={s.ref} className="row" style={{ cursor: 'default' }}>
                <span className="thai">{s.thai}</span>
                <span className="row-right">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="learn-foot">
          <div className="btn-row three">
            <button className="pill" type="button" onClick={() => setPos(landing(steps, checked, steps.length, steps.length - 1))}>Back</button>
            <Link to="/review" className="pill" style={{ textDecoration: 'none' }}>Review</Link>
            <ContinueLink current="new" />
          </div>
          {peekLink && (
            <p className="small">
              Want more? <Link to={`/new?peek=${nextPeek}`}>Take a sneak peek at day {nextPeek}</Link>. It changes nothing in your
              plan: those words still come as new on their own day.
            </p>
          )}
        </div>
      </Screen>
    );
  }

  if (step.kind === 'check') {
    const from = step.group * GROUP_SIZE;
    return (
      <Screen top={<TopBar mid={peek ? 'Sneak peek' : 'New items'} parent="/" />} narrow>
        <QuickCheck key={step.group} group={shown.slice(from, from + GROUP_SIZE)} earlier={shown.slice(0, from)} onDone={() => leaveCheck(step.group)} onBack={() => go(pos - 1)} />
      </Screen>
    );
  }
  if (!cur) return null;

  const colour = art.mode === 'gather' || art.who === 'pim' ? '#E8E8E8' : content.person(art.who)?.colour ?? '#2E9BFF';
  const artNode = (
    // one art box for words, letters and patterns alike, so nothing under it moves between cards
    <div className="art np-art" aria-hidden={false}>
      {cur.letter ? (
        <LetterFromDots key={cur.ref} char={cur.letter.char} strokes={cur.letter.strokes} size={device === 'phone' ? 160 : 220} cue={art.cue} />
      ) : art.mode === 'word' && !reducedMotion ? (
        <FaceToWord who={art.who} thai={cur.item ? cur.item.thai : cur.thai} colour={colour} cue={art.cue} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Apparition
          who={art.who}
          mode={reducedMotion ? 'still' : art.mode === 'word' ? 'idle' : art.mode}
          pitch={art.pitch}
          cue={art.cue}
          colour={colour}
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </div>
  );

  const voices = (
    <div className="stack gap-2">
      <Label>Hear it · 4 voices</Label>
      <div className="voices four">
        {VOICE_ORDER.map((v, i) => (
          <button key={v} className="pill small" type="button" onClick={() => void hear(v)} aria-label={`Hear it, ${VOICE_NAME[v]}`}>
            <PlayIcon size={12} /> {isFemale(v) ? 'F' : 'M'}
            {(i % 2) + 1}
          </button>
        ))}
      </div>
    </div>
  );

  const hookBlock = <HookBlock shown={cur} />;

  const main = (
    <div
      className="stack gap-4 fade-in"
      key={cur.ref}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(pos + (dx < 0 ? 1 : -1));
      }}
    >
      {artNode}
      {cur.item && <ItemFace item={cur.item} other={otherSpeaker(cur, settings.identity)} voices={voices} />}
      {cur.letter && <LetterFace letter={cur.letter} voices={voices} />}
      {cur.pattern && <PatternFace pattern={cur.pattern} voices={voices} />}
      {device !== 'tablet' && hookBlock}
    </div>
  );

  // the buttons are docked: the same place on every card, however long the card
  const nav = replay ? (
    <div className="learn-foot dock">
      <FitText as="p" className="small" min={10}>
        {engine.isIntroduced(cur.ref) ? 'Replay: looking again logs nothing and moves no dates.' : 'Not met yet: it joins your reviews when the path introduces it.'}
      </FitText>
      <div className="btn-row">
        <button className="pill" type="button" onClick={() => history.back()}>Back</button>
        <Link to="/library" className="pill solid" style={{ textDecoration: 'none' }}>Library</Link>
      </div>
    </div>
  ) : (
    <div className="learn-foot dock">
      <div className="btn-row">
        <button className="pill" type="button" onClick={() => go(pos - 1)} disabled={pos === 0}>Previous</button>
        <button className="pill solid" type="button" onClick={() => go(pos + 1)}>
          {nextLabel(steps[pos + 1], checked)}
        </button>
      </div>
      {device === 'desktop' && (
        <KeyHints hints={[['→', 'Next'], ['←', 'Previous'], ['Space', 'Hear it'], ['1–4', 'Voice']]} />
      )}
    </div>
  );

  const list = (
    <div className="stack gap-2" style={{ paddingTop: 8 }}>
      <Label>Today’s new set · {shown.length}</Label>
      <div className="np-list">
        {shown.map((s, i) => (
          <button key={s.ref} type="button" aria-current={i === at} onClick={() => goCard(i)}>
            <span className="thai np-list-thai">{s.thai.length > 14 ? s.pattern?.frame ?? s.thai : s.thai}</span>
            <span className="row-right">{met.has(s.ref) || engine.isIntroduced(s.ref) ? 'Met' : s.kind}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const panel =
    device === 'tablet' ? (
      <div className="stack gap-6" style={{ paddingTop: 8 }}>
        {hookBlock}
      </div>
    ) : device === 'desktop' && !replay ? (
      <div className="stack gap-6">{list}</div>
    ) : undefined;

  return (
    <Screen top={<TopBar mid={replay ? 'Replay' : peek ? 'Sneak peek' : 'New items'} parent={replay ? '/library' : '/'} />} panel={panel} narrow={device === 'desktop'}>
      <RunRail
        n={replay ? 1 : at}
        total={shown.length}
        left={replay ? 'Replay' : peek ? `Day ${peekDay} · peek ${at + 1} of ${shown.length}` : `New · ${at + 1} of ${shown.length}`}
        right={peeked.has(cur.ref) ? 'Seen in a sneak peek' : cur.kind === 'item' ? cur.item?.theme : cur.kind}
      />
      {main}
      {nav}
    </Screen>
  );
}

/** What the forward button leads to: a quick check, the next card, or the end. */
function nextLabel(next: Step | undefined, checked: ReadonlySet<number>): string {
  if (!next) return 'Done';
  return next.kind === 'check' && !checked.has(next.group) ? 'Quick check' : 'Next';
}

// Every card is built from the same boxes, each one fixed size: the headline
// (two lines), the script (the Thai line and its romanisation), the four
// voices, then the rest (tone shapes and the details under them). A long
// meaning or a long phrase gets smaller type; the boxes, and so everything
// under them, stay where they are from card to card. Patterns alone may run
// longer: their worked examples are what they are for.

function ItemFace({ item, other, voices }: { item: Item; other: boolean; voices: ReactNode }) {
  const { settings } = useApp();
  const both = bothForms(item);
  const mine = both[settings.identity];
  const theirs = both[settings.identity === 'm' ? 'f' : 'm'];
  const sayBoth = item.polite || formsDiffer(item);
  return (
    <div className="np-face">
      <FitText as="h1" className="h-l" lines={2} min={18}>{item.en}</FitText>
      <div className="np-script">
        <FitText className="thai-xl" lang="th" min={22}>{item.thai}</FitText>
        <FitText className="roman" min={11}>{item.roman}</FitText>
      </div>
      {voices}
      <div className="np-rest">
        <div className="np-shape">
          <ToneRow tones={item.tones} sylls={syllables(item.roman)} size={56} />
        </div>
        <div className="np-detail">
          {other && <FitText className="small" min={10}>{`Said by ${item.speaker === 'f' ? 'women' : 'men'}. Learn to recognise it.`}</FitText>}
          {sayBoth && (
            <div className="np-forms">
              <Label>{other ? 'Said in full' : 'You say'}</Label>
              <FitText className="thai-m" lang="th" min={14}>{mine.thai}</FitText>
              <FitText className="small" min={10}>{mine.roman}</FitText>
              {mine.thai !== theirs.thai && (
                <FitText className="small" min={10}>
                  {settings.identity === 'm' ? 'Women' : 'Men'} say <span className="thai fg2" lang="th">{theirs.thai}</span> · {theirs.roman}
                </FitText>
              )}
            </div>
          )}
          {item.example && (
            <FitText as="p" className="small np-example" lines={2} min={10} valign="top">
              <span className="thai fg2" lang="th">{item.example.thai}</span> · {item.example.roman} · {item.example.en}
            </FitText>
          )}
        </div>
      </div>
    </div>
  );
}

function LetterFace({ letter, voices }: { letter: Letter; voices: ReactNode }) {
  const { content } = useApp();
  const look = letter.lookalikes.map((id) => content.letter(id)).filter((l): l is Letter => !!l);
  const cls = letter.cls === 'vowel' || letter.cls === 'tonemark' ? letter.cls : `${letter.cls}-class consonant`;
  return (
    <div className="np-face">
      <FitText as="h1" className="h-l" lines={2} min={18}>{letter.name}</FitText>
      <div className="np-script">
        <FitText as="p" className="body" lines={0} min={11} valign="top">
          A {cls}. Starts a syllable as “{letter.initial}”{letter.final ? `, ends one as “${letter.final}”` : ''}. Its key word is {letter.keyword}.
        </FitText>
      </div>
      {voices}
      <div className="np-rest">
        {look.length > 0 && (
          <div className="stack gap-2">
            <Label>Do not confuse with</Label>
            <div className="lookalikes">
              {[letter, ...look].slice(0, 2).map((l) => (
                <div key={l.id} className="card">
                  <div className="thai-xl" lang="th" style={{ lineHeight: 1 }}>{l.char}</div>
                  <FitText className="small" min={10}>{`${l.name} · ${l.initial}`}</FitText>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PatternFace({ pattern, voices }: { pattern: Pattern; voices: ReactNode }) {
  return (
    <div className="np-face">
      <FitText as="h1" className="h-l" lines={2} min={18}>{pattern.en}</FitText>
      <div className="np-script">
        <FitText className="thai-xl" lang="th" min={20}>{pattern.frame}</FitText>
        <FitText className="roman" min={10}>{patternThai(pattern, 0).roman}</FitText>
      </div>
      {voices}
      <div className="np-rest np-rest-grow">
        <p className="body" style={{ margin: 0 }}>{pattern.note}</p>
        <div className="stack gap-3">
          <Label>Examples</Label>
          {pattern.examples.map((ex, i) => (
            <div key={i} className="stack gap-2">
              <div className="tiles" style={{ minHeight: 0 }}>
                {ex.map((t, j) => (
                  <span key={j} className={`tile ${t.slot ? 'slot' : ''}`}>
                    <span className="thai" lang="th">{t.thai}</span>
                    <span className="small">{t.roman}</span>
                    <span className="small mut">{t.en}</span>
                  </span>
                ))}
              </div>
              <div className="small">{patternThai(pattern, i).roman}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HookBlock({ shown }: { shown: Shown }) {
  const { engine } = useApp();
  const hook = engine.hookFor(shown.ref);
  const text =
    hook ??
    (shown.letter
      ? `${shown.letter.char} is “${shown.letter.initial}” for ${shown.letter.keyword}. Picture the ${shown.letter.keyword} in the shape.`
      : shown.pattern
        ? 'Read the frame, then swap a word into the slot.'
        : null);
  return (
    <div className="stack gap-2">
      <Label>Memory hook</Label>
      {/* three lines kept for every hook, short or long */}
      {text ? (
        <FitText as="p" className="body hook" lines={3} min={11} valign="top">{text}</FitText>
      ) : (
        <FitText as="p" className="small" lines={3} min={10} valign="top">No hook yet. Make one up as you go; your own sticks best.</FitText>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sneak peeks

const PEEKED = 'peeked_refs';
type PeekStore = { get<T>(key: string, fallback: T): T; set<T>(key: string, value: T): void };

/** Day N's own words, letters and patterns not met yet: what a sneak peek at day N shows. */
export function peekRefs(engine: { newCandidates(day: number): { ref: string; day: number }[] }, day: number): string[] {
  return engine.newCandidates(day).filter((e) => e.day === day).map((e) => e.ref);
}

/** Refs the learner has had a sneak peek at; their real day labels them "Seen in a sneak peek". */
export function peekedRefs(store: PeekStore): Set<string> {
  return new Set(store.get<string[]>(PEEKED, []));
}

export function addPeeked(store: PeekStore, refs: string[]) {
  const had = store.get<string[]>(PEEKED, []);
  const all = [...new Set([...had, ...refs])];
  if (all.length !== had.length) store.set(PEEKED, all);
}
