// Tone lab: two kinds of round, mixed, on words the learner has met. Which
// tone? plays a one-syllable word; the answer is a tone shape, two to choose
// from at first and all five later. Which word? plays one of a pair: words that
// differ in tone alone, or another listed sound-alike. ?contrast=item:x drills
// one leech's pairs. The caption shows the Thai, which gives the answer away,
// so in captions mode answers are logged but do not count.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link, useRoute } from '../../app/router';
import { TONE_LABEL, pitchCurve } from '../../audio/sound';
import { PlayIcon } from '../../audio/SoundLayer';
import { Apparition } from '../../anim';
import { TONES, VOICES, type Item, type Tone } from '../../content/types';
import type { Store } from '../../db/store';
import { useKeys } from '../../input/keys';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RunRail, Screen, TopBar } from '../../ui/kit';
import { TONE_VERB, VOICE_NAME, VOICE_WHO, listenForm } from './parts/common';
import { PairPitch, PitchLine, ToneRow, ToneShape } from './parts/ToneShape';
import { MIN_WORDS, SESSION_ROUNDS, buildSession, labMaterial, makePair, measuredCurve, tallyConfusions, toneDifference, usableWords, type Pair, type Round } from './parts/toneLab';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

/** Tones this learner picked wrongly in the lab lately, for choosing distractors. */
function recentMisses(store: Store): { tone: Tone; picked: Tone }[] {
  const rows = store.all<{ data: string }>("SELECT data FROM log WHERE source = 'tone-pairs' AND correct = 0 ORDER BY seq DESC LIMIT 200");
  const out: { tone: Tone; picked: Tone }[] = [];
  for (const r of rows) {
    try {
      const d = JSON.parse(r.data) as { kind?: string; tone?: Tone; picked?: Tone };
      if (d.kind === 'tone' && d.tone && d.picked) out.push({ tone: d.tone, picked: d.picked });
    } catch {
      /* an older row */
    }
  }
  return out;
}

export default function TonePairs() {
  const { engine, content, sound, settings, store, reducedMotion } = useApp();
  const { device } = useDevice();
  const { query } = useRoute();
  const focus = query.get('contrast');
  // with real audio only clean clips are played; with captions any met word will do
  const needClip = sound.mode === 'audio';

  const plan = useMemo(() => {
    const metRefs = engine.introducedRefs();
    const isMet = (it: Item) => metRefs.has(`item:${it.id}`) && (settings.adult || !it.adult);
    const material = labMaterial(content.items, isMet, needClip);
    const fi = focus ? content.item(focus) : undefined;
    let focusPairs: Pair[] = [];
    if (fi && isMet(fi)) {
      // the learner's own confusion first, then the item's listed contrasts; met partners only
      const own = engine.store.cardsForRef(`item:${fi.id}`).map((r) => engine.meta(r).contrastWith).find(Boolean);
      const ids = new Set<string>([...(own?.startsWith('item:') ? [own.slice(5)] : []), ...(fi.contrasts ?? [])]);
      focusPairs = [...ids]
        .map((id) => content.item(id))
        .filter((b): b is Item => !!b && isMet(b))
        .map((b) => makePair(fi, b, needClip))
        .filter((p): p is Pair => !!p);
    }
    return { material, focusItem: fi ?? null, focusPairs };
  }, [content, engine, focus, settings.adult, needClip]);

  const makeSession = (): Round[] => {
    const confused = tallyConfusions(recentMisses(store));
    if (plan.focusPairs.length) {
      return buildSession({ words: [], pairs: plan.focusPairs }, { needClip, confused, rounds: Math.min(SESSION_ROUNDS, 10 * plan.focusPairs.length) });
    }
    return usableWords(plan.material) < MIN_WORDS ? [] : buildSession(plan.material, { needClip, confused });
  };

  const [rounds, setRounds] = useState<Round[]>(makeSession);
  const [n, setN] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [right, setRight] = useState(0);
  const [replays, setReplays] = useState(0);
  const [tear, setTear] = useState(0);
  const t0 = useRef(performance.now());
  const [speaking, setSpeaking] = useState(false);
  const round: Round | null = rounds[n] ?? null;

  const restart = () => {
    setN(0);
    setRight(0);
    setSel(null);
    setChecked(false);
    setReplays(0);
    setRounds(makeSession());
  };

  // a new ?contrast= on the same screen starts a fresh run
  const lastFocus = useRef(focus);
  useEffect(() => {
    if (lastFocus.current === focus) return;
    lastFocus.current = focus;
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, plan]);

  const target = round ? (round.kind === 'tone' ? round.item : round.cards[round.target]) : null;

  const play = async (slow = false, counted = true) => {
    if (!round || !target) return;
    if (counted) setReplays((r) => r + 1);
    setSpeaking(true);
    // tone-marked romanisation would give the answer away
    await sound.play({ ...listenForm(target, round.voice, true), speed: slow ? 'slow' : 'normal' });
    setSpeaking(false);
  };

  // each round opens with the sound
  useEffect(() => {
    t0.current = performance.now();
    if (round) void play(false, false);
    return () => sound.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const check = () => {
    if (!round || !target || sel == null || checked) return;
    const ref = `item:${target.id}`;
    const ms = Math.round(performance.now() - t0.current);
    let ok: boolean;
    if (round.kind === 'tone') {
      const tone = target.tones[0];
      const picked = round.choices[sel];
      ok = picked === tone;
      engine.answer({
        ref,
        skill: 'tone',
        source: 'tone-pairs',
        correct: ok,
        ms,
        replays,
        // two or three tones are too easy to guess between to move a date: it
        // counts once all five are offered (and never when the caption shows the Thai)
        counts: sound.mode !== 'captions' && round.choices.length === TONES.length,
        data: { kind: 'tone', tone, picked, choices: round.choices, voice: round.voice, mode: sound.mode },
      });
    } else {
      const other = round.cards[1 - round.target];
      ok = sel === round.target;
      const skill = engine.card(ref, 'tone') ? 'tone' : 'hear';
      engine.answer({
        ref,
        skill,
        source: 'tone-pairs',
        correct: ok,
        ms,
        replays,
        confusedWith: ok ? undefined : `item:${other.id}`,
        // the caption shows the Thai, so the answer did not need the ear
        counts: sound.mode !== 'captions' && engine.isIntroduced(ref),
        data: { kind: 'pair', pair: [round.cards[0].id, round.cards[1].id], tonal: round.tonal, voice: round.voice, mode: sound.mode },
      });
    }
    if (ok) setRight((r) => r + 1);
    setChecked(true);
    setTear((t) => t + 1);
  };

  const next = () => {
    if (!checked) return;
    setN((x) => x + 1);
    setSel(null);
    setChecked(false);
    setReplays(0);
  };

  const optionCount = round ? (round.kind === 'tone' ? round.choices.length : 2) : 0;
  useKeys((a) => {
    if (a.type === 'rate' && a.n <= optionCount && !checked) {
      setSel(a.n - 1);
      return true;
    }
    if (a.type === 'play') {
      void play();
      return true;
    }
    if (a.type === 'confirm') {
      if (checked) next();
      else check();
      return true;
    }
  }, !!round);

  if (!rounds.length) {
    return (
      <Screen top={<TopBar mid="Tone lab" parent="/" />} narrow>
        <div className="prompt">
          <Label>Tone lab</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>Not enough words yet.</h1>
          <p className="body">
            The lab only uses words you have met, and it needs {MIN_WORDS} short ones to start. Meet today’s new items first and come back.
          </p>
        </div>
        <div className="learn-foot">
          <div className="btn-row">
            <Link to="/" className="pill" style={{ textDecoration: 'none' }}>Today</Link>
            <Link to="/new" className="pill solid" style={{ textDecoration: 'none' }}>New items</Link>
          </div>
        </div>
      </Screen>
    );
  }

  if (!round || !target) {
    return (
      <Screen top={<TopBar mid="Tone lab" parent="/" />} narrow>
        <div className="prompt">
          <Label>Tone lab · done</Label>
          <div className="big-score" style={{ marginTop: 14 }}>{right}/{rounds.length}</div>
          <p className="body">
            {sound.mode === 'captions'
              ? 'Practice only while sound is off: the caption shows the Thai, so these did not move the schedule.'
              : 'Picking the word counts as a listening review. Naming the tone counts once all five tones are on offer.'}
          </p>
        </div>
        <div className="learn-foot">
          <div className="btn-row">
            <button className="pill" type="button" onClick={restart}>Again</button>
            <ContinueLink current="tonelab" />
          </div>
        </div>
      </Screen>
    );
  }

  const vIdx = VOICES.indexOf(round.voice) + 1;
  const ok = checked && (round.kind === 'tone' ? round.choices[sel!] === target.tones[0] : sel === round.target);
  const focusNote = plan.focusItem && !plan.focusPairs.length ? `No sound-alike met yet for ${plan.focusItem.en}, so this runs the usual mix.` : null;

  // ---- which tone? ----
  const toneRound = round.kind === 'tone' ? round : null;
  const toneAnswer = toneRound && (
    <ToneAnswer item={toneRound.item} w={device === 'phone' ? 320 : 300} />
  );
  const toneButtons = toneRound && (
    <div className="tone-btns" role="group" aria-label="Which tone did you hear?" style={{ gridTemplateColumns: `repeat(${toneRound.choices.length}, minmax(0, 1fr))` }}>
      {toneRound.choices.map((t, i) => {
        const fb = checked ? (t === target.tones[0] ? 'right' : i === sel ? 'wrong' : '') : '';
        const wide = toneRound.choices.length <= 3;
        return (
          <button key={t} type="button" className={`tone-btn ${fb}`} aria-pressed={!checked && sel === i} onClick={() => !checked && setSel(i)} disabled={checked}>
            <ToneShape tone={t} w={wide ? 88 : 44} h={wide ? 36 : 22} guide={false} strokeWidth={2.5} />
            <span>{TONE_LABEL[t]}</span>
            <span className="kbd">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );

  // ---- which word? ----
  const pairRound = round.kind === 'pair' ? round : null;
  const [a, b] = pairRound ? pairRound.cards : [target, target];
  const diff = pairRound?.tonal ? toneDifference(a, b) : null;
  const pairNote = diff
    ? `${diff.syllable > 0 ? `Syllable ${diff.syllable + 1}: ` : ''}${a.thai} ${TONE_VERB[diff.a]}; ${b.thai} ${TONE_VERB[diff.b]}.`
    : pairRound
      ? 'Two words that are easy to mix up. Listen for which one it is.'
      : '';
  const cards = pairRound && (
    <div className="pair-cards" role="group" aria-label="Which one did you hear?">
      {pairRound.cards.map((it, i) => {
        const fb = checked ? (i === pairRound.target ? 'right' : i === sel ? 'wrong' : '') : '';
        return (
          <button
            key={it.id}
            type="button"
            className={`pair-card ${fb}`}
            aria-pressed={!checked && sel === i}
            onClick={() => !checked && setSel(i)}
            disabled={checked}
          >
            <span className="kbd">{i + 1}</span>
            {/* one card size for every pair: a longer word gets smaller type */}
            <FitText as="span" className="thai-xl pair-thai" lang="th" min={20}>{it.thai}</FitText>
            <FitText as="span" className="small" lines={2} min={10} valign="top">{`${it.roman} · ${it.en}`}</FitText>
            {pairRound.tonal && (
              <>
                <span className="pair-shape">
                  {it.tones.length === 1 ? (
                    <ToneShape tone={it.tones[0]} w={device === 'phone' ? 110 : 140} h={34} colour={!checked && sel === i ? '#050505' : 'currentColor'} />
                  ) : (
                    <ToneRow tones={it.tones} size={40} showNames={false} />
                  )}
                </span>
                <FitText as="span" className="label" min={8}>{`${it.tones.map((t) => TONE_LABEL[t]).join(' · ')} tone`}</FitText>
              </>
            )}
          </button>
        );
      })}
    </div>
  );

  const pitchPanel = (
    <div className="stack gap-6" style={{ paddingTop: 8 }}>
      {pairRound?.tonal && (
        <div className="stack gap-3">
          <Label>Pitch drawing</Label>
          <PairPitch a={a.tones} b={b.tones} w={300} h={140} />
          <div className="hrow wrap" style={{ gap: 16 }}>
            <span className="legend"><i style={{ background: 'var(--fg)' }} /><span className="thai">{a.thai}</span> {a.tones.map((t) => TONE_LABEL[t]).join(' · ')}</span>
            <span className="legend"><i style={{ background: 'var(--blue)' }} /><span className="thai">{b.thai}</span> {b.tones.map((t) => TONE_LABEL[t]).join(' · ')}</span>
          </div>
        </div>
      )}
      {toneRound && (
        <div className="stack gap-3">
          <Label>Pitch drawing</Label>
          {/* drawn after the answer: the shape would give it away */}
          <div className="lab-panel-answer">{checked ? toneAnswer : <div className="hidden-answer" style={{ minHeight: 0, height: 110 }}><span className="small">Shown after you answer</span></div>}</div>
        </div>
      )}
      <div className="art" style={{ height: 200 }}>
        {/* the voice tear follows the target's pitch, so it only plays once the answer is in */}
        <Apparition
          who={VOICE_WHO[round.voice]}
          mode={reducedMotion ? 'still' : checked ? 'tear' : 'idle'}
          pitch={checked ? pitchCurve(target.tones) : null}
          cue={tear}
          colour={content.person(VOICE_WHO[round.voice])?.colour}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <div className="stack gap-1">
        <Label>Score</Label>
        <div className="h-m num">{right} / {n + (checked ? 1 : 0)}</div>
      </div>
    </div>
  );

  // the verdict, then the word heard: both lines have their place before the answer
  const verdict = toneRound ? (
    checked ? (
      <>
        <span className={ok ? 'good' : 'bad'}>{ok ? 'Right.' : 'No.'}</span> {TONE_LABEL[target.tones[0]]} tone: it {TONE_VERB[target.tones[0]]}.
      </>
    ) : (
      'Pick the shape that matches what you heard, then check.'
    )
  ) : checked ? (
    <>
      <span className={ok ? 'good' : 'bad'}>{ok ? 'Right.' : 'No.'}</span> You heard <span className="thai" lang="th">{target.thai}</span>, {target.en}. {diff ? pairNote : ''}
    </>
  ) : (
    pairNote
  );
  const measured = toneRound ? measuredCurve(toneRound.item.media?.pitch) : null;

  return (
    <Screen top={<TopBar mid="Tone lab" parent="/" />} panel={device === 'phone' ? undefined : pitchPanel} narrow={device === 'desktop'}>
      <RunRail n={n} total={rounds.length} left={`Tone lab · ${n + 1} of ${rounds.length}`} right={plan.focusPairs.length ? `Drill: ${plan.focusItem?.en}` : 'No timer'} />
      {focusNote && <p className="small" style={{ marginTop: 0 }}>{focusNote}</p>}
      <FitText as="h1" className="h-l" min={20}>{toneRound ? 'Which tone did you hear?' : 'Which one did you hear?'}</FitText>
      <div className="play-row lab-play">
        <button className="iconbtn" type="button" onClick={() => void play()} aria-label="Play again" disabled={speaking}>
          <PlayIcon />
        </button>
        <span className="small num">
          Play again as often as you like.
          <br />
          Voice {vIdx} of 4 · {VOICE_NAME[round.voice].endsWith('female') ? 'female' : 'male'}
        </span>
      </div>
      {/* tone buttons and word cards share one box: the rounds alternate, the box does not change */}
      <div className="lab-answers">
        {toneButtons}
        {cards}
      </div>
      <div className="lab-fb">
        <FitText as="p" className="body" lines={2} min={11} valign="top">{verdict}</FitText>
        <div className="lab-heard">
          {checked && (
            <>
              <FitText className="thai-l lab-heard-thai" lang="th" min={16}>{target.thai}</FitText>
              <FitText className="body" lines={2} min={10}>{`${target.roman} · ${target.en}`}</FitText>
              {toneRound && device === 'phone' && (
                <span className="lab-mini" title={measured ? 'Textbook shape, and the pitch measured from this recording' : 'Textbook shape'}>
                  <PitchLine tones={[target.tones[0]]} learner={measured} w={110} h={48} label={measured ? 'Textbook shape and measured pitch' : 'Textbook shape'} />
                </span>
              )}
            </>
          )}
        </div>
        {sound.mode === 'captions' && (
          <p className="small" style={{ margin: 0 }}>Sound is off, so the caption shows the Thai. This is practice and does not count.</p>
        )}
      </div>
      <div className="learn-foot">
        <div className="btn-row">
          <button className="pill" type="button" onClick={() => void play(true)} disabled={speaking}>Slow it down</button>
          {checked ? (
            <button className="pill solid" type="button" onClick={next}>{n + 1 >= rounds.length ? 'Finish' : 'Next'}</button>
          ) : (
            <button className="pill solid" type="button" onClick={check} disabled={sel == null}>Check</button>
          )}
        </div>
        {device === 'desktop' && (
          <KeyHints hints={toneRound ? [[`1–${optionCount}`, 'Tone'], ['Enter', checked ? 'Next' : 'Check'], ['Space', 'Play']] : [['1', 'Left'], ['2', 'Right'], ['Enter', checked ? 'Next' : 'Check'], ['Space', 'Play']]} />
        )}
      </div>
    </Screen>
  );
}

/** The textbook shape of the word's tone, with the pitch measured from its recordings over it when there is one. */
function ToneAnswer({ item, w }: { item: Item; w: number }) {
  const tone = item.tones[0];
  const measured = measuredCurve(item.media?.pitch);
  return (
    <div className="stack gap-2">
      <PitchLine tones={[tone]} learner={measured} w={w} h={110} label={measured ? 'Textbook shape and measured pitch' : 'Textbook shape'} />
      <div className="hrow wrap" style={{ gap: 16 }}>
        <span className="legend"><i style={{ background: 'var(--fg)' }} />Textbook {TONE_LABEL[tone].toLowerCase()} tone</span>
        {measured && <span className="legend"><i style={{ background: 'var(--blue)' }} />This word, as recorded</span>}
      </div>
    </div>
  );
}
