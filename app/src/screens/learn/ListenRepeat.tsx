// Listen and repeat: hear a line, pause, say it, compare. A shell until Phase 4:
// the comparison shows the target pitch line and says what will arrive with
// sound. The learner rates their own attempt; it is logged as a 'say' answer.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link } from '../../app/router';
import type { Recording, SpeechScore } from '../../audio/sound';
import { MicIcon, PlayIcon, useSoundState } from '../../audio/SoundLayer';
import type { Item } from '../../content/types';
import { Six } from '../../engine/grade';
import { useKeys } from '../../input/keys';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RatingBar, RunRail, Screen, TopBar } from '../../ui/kit';
import { listenForm, sayTarget, speakerOf, syllables } from './parts/common';
import { PitchLine } from './parts/ToneShape';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

type Phase = 'ready' | 'playing' | 'pause' | 'recording' | 'compare' | 'done';

export default function ListenRepeat() {
  const { engine, content, sound, settings } = useApp();
  const { device } = useDevice();
  const { recording } = useSoundState();

  // met items only; phrases first, due first
  const [lines] = useState<Item[]>(() => {
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const g of engine.forGame({ skills: ['say', 'hear'], kinds: ['item'], count: 80 })) {
      if (seen.has(g.ref)) continue;
      seen.add(g.ref);
      const it = content.item(g.ref);
      // you repeat what you would say: skip words only the other sex uses
      const sp = it && speakerOf(it);
      if (it && (!sp || sp === settings.identity)) out.push(it);
    }
    return out.sort((a, b) => Number(b.kind === 'phrase') - Number(a.kind === 'phrase')).slice(0, 12);
  });
  const [at, setAt] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [plays, setPlays] = useState(0);
  const [rec, setRec] = useState<Recording | null>(null);
  const [score, setScore] = useState<SpeechScore | null>(null);
  const [rated, setRated] = useState<Record<string, Six>>({});
  const [chosen, setChosen] = useState<Six | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sound.stop();
    };
  }, [sound]);

  const line = lines[at];
  const target = useMemo(() => (line ? sayTarget(line, settings.identity) : null), [line, settings.identity]);
  const hasSayCard = line ? !!engine.card(`item:${line.id}`, 'say') : false;
  const preview = useMemo(() => (phase === 'compare' && line && hasSayCard ? engine.preview(`item:${line.id}`, 'say') : null), [phase, line, hasSayCard, engine]);

  const reset = () => {
    setPhase('ready');
    setPlays(0);
    setRec(null);
    setScore(null);
    setChosen(null);
  };

  const play = async (slow = false, thenSay = true) => {
    if (!line) return;
    setPlays((p) => p + 1);
    const voice = settings.identity === 'm' ? (plays % 2 ? 'm2' : 'm1') : plays % 2 ? 'f2' : 'f1';
    setPhase((p) => (p === 'compare' ? p : 'playing'));
    await sound.play({ ...listenForm(line, voice), speed: slow ? 'slow' : 'normal' });
    if (!alive.current || !thenSay) return;
    setPhase((p) => (p === 'playing' ? 'pause' : p));
  };

  // the pause: a beat to hold the sound in your head, then your turn
  useEffect(() => {
    if (phase !== 'pause') return;
    const t = setTimeout(() => say(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const say = async () => {
    if (!target) return;
    setPhase('recording');
    const r = await sound.record(target);
    if (!alive.current) return;
    setRec(r);
    setScore(r ? await sound.score(r, target) : null);
    setPhase('compare');
  };

  const rate = (s: Six) => {
    if (!line || chosen != null || phase !== 'compare') return;
    setChosen(s);
    engine.answer({
      ref: `item:${line.id}`,
      skill: 'say',
      source: 'listen-repeat',
      own: s,
      blank: rec == null ? true : undefined,
      ms: rec?.ms,
      replays: Math.max(0, plays - 1),
      speechScore: score?.overall ?? null,
      data: { mode: sound.mode, said: !!rec },
    });
    setRated((r) => ({ ...r, [line.id]: s }));
    setTimeout(() => next(), 260);
  };

  const next = () => {
    reset();
    setAt((i) => i + 1);
  };

  const jump = (i: number) => {
    sound.stop();
    reset();
    setAt(i);
  };

  useKeys(
    (a) => {
      if (recording) return;
      if (a.type === 'play') {
        play(false, phase === 'ready');
        return true;
      }
      if (a.type === 'confirm') {
        if (phase === 'compare') return;
        say();
        return true;
      }
      if (a.type === 'move' && a.down && a.dx === 1 && phase === 'compare' && chosen == null) {
        next();
        return true;
      }
    },
    !!line,
  );

  if (!lines.length) {
    return (
      <Screen top={<TopBar mid="Listen and repeat" parent="/" />} narrow>
        <div className="prompt">
          <Label>Listen and repeat</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>Nothing to repeat yet.</h1>
          <p className="body">Lines come from words and phrases you have met. Meet today’s new items first.</p>
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

  if (!line || !target) {
    const n = Object.keys(rated).length;
    return (
      <Screen top={<TopBar mid="Listen and repeat" parent="/" />} narrow>
        <div className="prompt">
          <Label>Listen and repeat · done</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>{n} line{n === 1 ? '' : 's'} said.</h1>
          <p className="body">Speaking answers go to the schedule for each item you can already say.</p>
        </div>
        <div className="learn-foot">
          <div className="btn-row">
            <button className="pill" type="button" onClick={() => jump(0)}>Again</button>
            <ContinueLink current="listen" />
          </div>
        </div>
      </Screen>
    );
  }

  const step = { ready: 0, playing: 0, pause: 1, recording: 2, compare: 3, done: 3 }[phase];
  const showLine = phase === 'compare' || plays > 0;

  const transcript = (
    <div className="stack gap-2" style={{ paddingTop: 8 }}>
      <Label>Transcript · {lines.length} lines</Label>
      <div className="np-list">
        {lines.map((l, i) => {
          const t = sayTarget(l, settings.identity);
          return (
            <button key={l.id} type="button" aria-current={i === at} onClick={() => jump(i)} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span className="hrow between" style={{ width: '100%' }}>
                <span className="thai">{i <= at || rated[l.id] ? t.thai : '· · ·'}</span>
                <span className="row-right">{rated[l.id] ? 'Said' : i === at ? 'Now' : ''}</span>
              </span>
              <span className="small">{i <= at || rated[l.id] ? `${t.roman} · ${l.en}` : l.en}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const sylls = syllables(target.roman ?? '');
  const note =
    phase === 'pause'
      ? 'Your turn in a moment. Hold the sound.'
      : phase === 'compare' && !score
        ? rec
          ? 'Pitch comparison arrives with sound. For now, compare against the line: where did your voice rise and fall?'
          : 'Skipped. Rate it Blank, or play it again and have another go.'
        : '';

  // the same boxes in every phase: the line, the pitch drawing, one note, the controls, the ratings
  return (
    <Screen top={<TopBar mid="Listen and repeat" parent="/" />} panel={device === 'phone' ? undefined : transcript} narrow={device === 'desktop'}>
      <RunRail n={at} total={lines.length} left={`Listen and repeat · ${at + 1} of ${lines.length}`} right={hasSayCard ? 'Counts' : 'Practice'} />
      <div className="hrow" style={{ gap: '8px 18px', marginBottom: 18 }}>
        {['Hear', 'Pause', 'Say', 'Compare'].map((s, i) => (
          <span key={s} className={`radio ${i === step ? 'on' : i < step ? 'done' : ''}`}><i />{s}</span>
        ))}
      </div>

      <div className="lr-line">
        <FitText className="label" min={8}>{line.en}</FitText>
        <div className="lr-said">
          {showLine ? (
            <>
              <FitText className="thai-xl" lang="th" min={22}>{target.thai}</FitText>
              <FitText className="roman" min={11}>{target.roman}</FitText>
            </>
          ) : (
            <FitText as="h1" className="h-l" lines={0} min={20}>Hear it first.</FitText>
          )}
        </div>
      </div>

      <div className="stack gap-3">
        <div className="hrow between">
          <Label>{phase === 'compare' ? 'Target and you' : 'Target pitch'}</Label>
          <span className="label fg num">{phase === 'compare' && score ? `${Math.round(score.overall * 100)}%` : ''}</span>
        </div>
        <PitchLine tones={target.tones} learner={score?.pitch} w={device === 'phone' ? 340 : 520} h={device === 'phone' ? 84 : 140} />
        {/* each syllable under its own stretch of the line, one row whatever the length */}
        <div className="lr-sylls" style={{ '--n': Math.max(1, sylls.length) } as CSSProperties}>
          {sylls.map((s, i) => (
            <span key={i} className="small">{s}</span>
          ))}
        </div>
        <FitText as="p" className="small" lines={2} min={10} valign="top">{note}</FitText>
      </div>

      <div className="learn-foot">
        <div className="lr-actions">
          {phase !== 'compare' ? (
            <div className="hrow" style={{ gap: 12, justifyContent: device === 'phone' ? 'center' : 'flex-start', height: '100%' }}>
              <button className="iconbtn ghost" type="button" onClick={() => play(false, phase === 'ready')} aria-label="Play the line" disabled={phase === 'playing'}>
                <PlayIcon />
              </button>
              <button className="pill" type="button" onClick={() => play(true, false)} disabled={phase === 'playing'}>Slow</button>
              <button className="pill solid big" type="button" onClick={say} disabled={phase === 'playing' || phase === 'recording'}>
                <MicIcon size={16} /> Say it
              </button>
            </div>
          ) : (
            <div className="btn-row three">
              <button className="pill" type="button" onClick={() => play(false, false)}><PlayIcon size={14} /> Again</button>
              <button className="pill" type="button" onClick={say}><MicIcon size={14} /> Retry</button>
              <button className="pill" type="button" onClick={next} disabled={chosen != null}>Skip</button>
            </div>
          )}
        </div>
        {/* the ratings are always here; they wake up once there is something to compare */}
        <div className="stack gap-2">
          <FitText className="label" lines={2} min={9} valign="bottom">
            {phase === 'compare' ? `How close was it?${hasSayCard ? ' Next review' : ' Practice: not yet scheduled for speaking'}` : 'Say it, then rate how close it was'}
          </FitText>
          <RatingBar preview={preview} onRate={rate} chosen={chosen} enabled={phase === 'compare' && chosen == null && !recording} />
        </div>
        {device === 'desktop' && <KeyHints hints={[['Space', 'Play'], ['Enter', 'Record'], ['1–6', 'Rate'], ['→', 'Skip']]} />}
      </div>
    </Screen>
  );
}
