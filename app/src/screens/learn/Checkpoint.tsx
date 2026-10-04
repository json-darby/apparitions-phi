// Checkpoint: the weekly test across skills (days 7, 14, 21) and the final
// assessment (day 30). One task at a time: hear, read, name the tone, say it,
// read a letter. Answers go through engine.answer with source 'checkpoint'; the
// score is saved under 'checkpoints'. ?day= opens any checkpoint for testing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { Link, useRoute } from '../../app/router';
import type { Recording } from '../../audio/sound';
import { MicIcon, PlayIcon, useSoundState } from '../../audio/SoundLayer';
import { sayForm } from '../../content/repo';
import { VOICES, type Item, type Letter, type Skill } from '../../content/types';
import { Six } from '../../engine/grade';
import { useKeys } from '../../input/keys';
import { localDate } from '../../core/dates';
import { CHECKPOINT_DAYS } from '../../path/pathway';
import { FitText } from '../../ui/FitText';
import { KeyHints, Label, RatingBar, Screen, Seg, TopBar } from '../../ui/kit';
import { Choices, type Choice } from './parts/Choices';
import { letterPlay, listenForm, pick, sayTarget, shuffle, syllables } from './parts/common';
import { ToneQuiz } from './parts/ToneQuiz';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

type Kind = 'hear' | 'read' | 'tone' | 'say' | 'letter';
const KIND_LABEL: Record<Kind, string> = { hear: 'Listening', read: 'Reading', tone: 'Tones', say: 'Speaking', letter: 'Letters' };
const KIND_MARK: Record<Kind, string> = { hear: 'L', read: 'R', tone: 'T', say: 'S', letter: 'ก' };
const KIND_SKILL: Record<Kind, Skill> = { hear: 'hear', read: 'read', tone: 'tone', say: 'say', letter: 'read' };

interface Task {
  kind: Kind;
  ref: string;
  item?: Item;
  letter?: Letter;
  options?: Choice[];
  answer?: string;
}

type Saved = Record<string, { score: number; date: string }>;

function itemOptions(it: Item, pool: Item[]): Choice[] {
  const others = shuffle(pool.filter((x) => x.id !== it.id && x.en !== it.en));
  const same = others.filter((x) => x.theme === it.theme);
  const picks = [...same, ...others.filter((x) => !same.includes(x))].slice(0, 3);
  return shuffle([it, ...picks]).map((x) => ({ id: x.id, label: x.en }));
}

function letterOptions(l: Letter, pool: Letter[]): Choice[] {
  const others = shuffle(pool.filter((x) => x.id !== l.id && x.initial !== l.initial)).slice(0, 3);
  return shuffle([l, ...others]).map((x) => ({ id: x.id, label: x.name, sub: `sounds “${x.initial}” · ${x.keyword}` }));
}

export default function Checkpoint() {
  const { engine, content, store, settings } = useApp();
  const { device } = useDevice();
  const { query } = useRoute();
  const today = engine.day();
  const fromQuery = Number(query.get('day'));
  const initialDay = CHECKPOINT_DAYS.includes(fromQuery) ? fromQuery : [...CHECKPOINT_DAYS].reverse().find((d) => d <= today) ?? CHECKPOINT_DAYS[0];
  const [day, setDay] = useState(initialDay);
  const [started, setStarted] = useState(false);
  const [seed, setSeed] = useState(0);
  const saved = store.get<Saved>('checkpoints', {});

  const { tasks, practice } = useMemo(() => {
    void seed;
    const allowed = (adult?: boolean) => settings.adult || !adult;
    const met = engine.introducedRefs();
    let items = content.items.filter((it) => allowed(it.adult) && met.has(`item:${it.id}`));
    let letters = content.letters.filter((l) => met.has(`letter:${l.id}`));
    // nothing met yet (testing): use what the course has taught by that day; answers then do not count
    const practice = items.length < 4;
    if (practice) items = content.items.filter((it) => allowed(it.adult) && it.day <= day);
    if (letters.length < 4) letters = practice ? content.letters.filter((l) => l.day <= day) : letters;
    const total = day === 30 ? 20 : 12;
    const share: [Kind, number][] = [['hear', 0.3], ['read', 0.25], ['tone', 0.2], ['say', 0.15], ['letter', 0.1]];
    const out: Task[] = [];
    const used = new Set<string>();
    const take = <T extends { id: string }>(list: T[], prefix: string) => {
      const fresh = shuffle(list).find((x) => !used.has(`${prefix}:${x.id}`)) ?? pick(list);
      used.add(`${prefix}:${fresh.id}`);
      return fresh;
    };
    for (const [kind, f] of share) {
      let n = Math.round(total * f);
      if (kind === 'letter' && letters.length < 4) n = 0;
      for (let i = 0; i < n && items.length; i++) {
        if (kind === 'letter') {
          const l = take(letters, 'letter');
          out.push({ kind, ref: `letter:${l.id}`, letter: l, options: letterOptions(l, content.letters), answer: l.id });
          continue;
        }
        let list = items;
        if (kind === 'tone') {
          const toned = items.filter((it) => it.skills.includes('tone') && it.tones.length <= 2);
          list = toned.length ? toned : items;
        }
        if (kind === 'say') {
          const sayable = items.filter((it) => it.skills.includes('say'));
          list = sayable.length ? sayable : items;
        }
        const it = take(list, kind);
        const t: Task = { kind, ref: `item:${it.id}`, item: it };
        if (kind === 'hear' || kind === 'read') {
          t.options = itemOptions(it, content.items.filter((x) => allowed(x.adult)));
          t.answer = it.id;
        }
        out.push(t);
      }
    }
    while (out.length < total && items.length) {
      const it = take(items, 'read');
      out.push({ kind: 'read', ref: `item:${it.id}`, item: it, options: itemOptions(it, content.items), answer: it.id });
    }
    return { tasks: shuffle(out).slice(0, total), practice };
  }, [content, engine, settings.adult, day, seed]);

  const [at, setAt] = useState(0);
  const [results, setResults] = useState<(boolean | null)[]>([]);
  const finished = started && at >= tasks.length;
  const score = results.filter(Boolean).length / Math.max(1, tasks.length);

  useEffect(() => {
    if (!finished || practice) return;
    const prev = store.get<Saved>('checkpoints', {});
    store.set('checkpoints', { ...prev, [day]: { score, date: localDate(Date.now()) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const restart = (d = day) => {
    setDay(d);
    setAt(0);
    setResults([]);
    setSeed((s) => s + 1);
  };

  // a new ?day= on the same screen opens that checkpoint
  const lastQuery = useRef(fromQuery);
  useEffect(() => {
    if (lastQuery.current === fromQuery) return;
    lastQuery.current = fromQuery;
    if (CHECKPOINT_DAYS.includes(fromQuery)) {
      setStarted(false);
      restart(fromQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromQuery]);

  const title = day === 30 ? 'Final assessment' : `Checkpoint ${day / 7}`;

  const progress = (
    <div className="stack gap-6" style={{ paddingTop: 8 }}>
      <div className="stack gap-2">
        <Label>{title} · {Math.min(at + (finished ? 0 : 1), tasks.length)} of {tasks.length}</Label>
        <div className="cp-tasks">
          {tasks.map((t, i) => (
            <i key={i} className={results[i] === true ? 'right' : results[i] === false ? 'wrong' : i === at && started ? 'on' : ''} title={KIND_LABEL[t.kind]}>
              {KIND_MARK[t.kind]}
            </i>
          ))}
        </div>
      </div>
      <div className="stack">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => {
          const idx = tasks.map((t, i) => (t.kind === k ? i : -1)).filter((i) => i >= 0);
          if (!idx.length) return null;
          const right = idx.filter((i) => results[i] === true).length;
          const done = idx.filter((i) => results[i] != null).length;
          return (
            <div key={k} className="row" style={{ cursor: 'default' }}>
              <span>{KIND_LABEL[k]}</span>
              <span className="row-right num">{right} / {done} of {idx.length}</span>
            </div>
          );
        })}
      </div>
      {practice && <p className="small" style={{ margin: 0 }}>Nothing met yet, so this runs on the course’s words to that day as practice. It is not saved.</p>}
    </div>
  );

  const panel = device === 'phone' ? undefined : progress;

  if (!started || !tasks.length) {
    const prev = saved[day];
    return (
      <Screen top={<TopBar mid="Checkpoint" parent="/" />} panel={panel} narrow={device === 'desktop'}>
        <div className="prompt">
          <Label>Day {day} · {today >= day ? 'open' : `opens on day ${day}`}</Label>
          <h1 className="h-l" style={{ marginTop: 12 }}>{title}</h1>
          <p className="body" style={{ maxWidth: '50ch' }}>
            {tasks.length} tasks across listening, reading, tones and speaking, one at a time. No hints, no timer. Answers count as reviews.
          </p>
          {prev && <p className="body">Last time: <b className="num">{Math.round(prev.score * 100)}%</b> on {prev.date}.</p>}
          <div className="stack gap-2" style={{ marginTop: 18 }}>
            <Label>Open a checkpoint</Label>
            <Seg value={day} label="Checkpoint day" options={CHECKPOINT_DAYS.map((d) => ({ v: d, label: d === 30 ? 'Final' : `Day ${d}` }))} onChange={(d) => restart(d)} />
          </div>
        </div>
        <div className="learn-foot">
          <button className="pill solid big wide" type="button" onClick={() => setStarted(true)} disabled={!tasks.length}>
            Start
          </button>
          {!tasks.length && <p className="small">Nothing to test yet. Meet some items first.</p>}
        </div>
      </Screen>
    );
  }

  if (finished) {
    return (
      <Screen top={<TopBar mid="Checkpoint" parent="/" />} panel={panel} narrow={device === 'desktop'}>
        <div className="prompt">
          <Label>{title} · {practice ? 'practice' : 'saved'}</Label>
          <div className="big-score num" style={{ marginTop: 14 }}>{Math.round(score * 100)}%</div>
          <p className="body">{results.filter(Boolean).length} of {tasks.length} right. Misses come back in Review.</p>
          {device === 'phone' && progress}
        </div>
        <div className="learn-foot">
          <div className="btn-row three">
            <button className="pill" type="button" onClick={() => restart()}>Again</button>
            <Link to="/progress" className="pill" style={{ textDecoration: 'none' }}>Progress</Link>
            <ContinueLink current="checkpoint" />
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen top={<TopBar mid="Checkpoint" parent="/" />} panel={panel} narrow={device === 'desktop'}>
      {device === 'phone' && (
        <div className="stack gap-2" style={{ marginBottom: 18 }}>
          <Label>{title} · {at + 1} of {tasks.length}</Label>
          <div className="meter"><i style={{ width: `${(at / tasks.length) * 100}%` }} /></div>
        </div>
      )}
      <TaskView
        key={`${seed}-${at}`}
        task={tasks[at]}
        practice={practice}
        onDone={(ok) => {
          setResults((r) => {
            const n = r.slice();
            n[at] = ok;
            return n;
          });
        }}
        onNext={() => setAt((i) => i + 1)}
      />
    </Screen>
  );
}

function TaskView({ task, practice, onDone, onNext }: { task: Task; practice: boolean; onDone: (ok: boolean) => void; onNext: () => void }) {
  const { engine, sound, settings } = useApp();
  const { device } = useDevice();
  const { recording } = useSoundState();
  const t0 = useRef(performance.now());
  const [chosen, setChosen] = useState<string | null>(null);
  const [done, setDone] = useState<boolean | null>(null);
  const [rec, setRec] = useState<Recording | null | undefined>(undefined);
  const [speech, setSpeech] = useState<number | null>(null);
  const [rated, setRated] = useState<Six | null>(null);
  const [replays, setReplays] = useState(0);
  const skill = KIND_SKILL[task.kind];
  const it = task.item;

  const play = (counted = true) => {
    if (counted) setReplays((r) => r + 1);
    if (it) sound.play(listenForm(it, pick(VOICES), true));
    else if (task.letter) sound.play({ ...letterPlay(task.letter), hideRoman: true });
  };

  useEffect(() => {
    if (task.kind === 'hear') play(false);
    return () => sound.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (ok: boolean, extra: { own?: Six; speech?: number | null } = {}) => {
    if (done != null) return;
    setDone(ok);
    onDone(ok);
    engine.answer({
      ref: task.ref,
      skill,
      source: 'checkpoint',
      correct: task.kind === 'say' ? undefined : ok,
      own: extra.own,
      ms: Math.round(performance.now() - t0.current),
      replays,
      speechScore: extra.speech,
      counts: practice ? false : undefined,
      data: { kind: task.kind },
    });
  };

  const sayIt = async () => {
    if (!it) return;
    const target = sayTarget(it, settings.identity);
    const r = await sound.record(target);
    setRec(r);
    if (r) setSpeech((await sound.score(r, target))?.overall ?? null);
  };

  useKeys(
    (a) => {
      if (recording) return;
      if (a.type === 'confirm' && done != null) {
        onNext();
        return true;
      }
      if (a.type === 'play' && (task.kind === 'hear' || task.kind === 'tone')) {
        play();
        return true;
      }
      if (a.type === 'confirm' && task.kind === 'say' && rec === undefined) {
        sayIt();
        return true;
      }
    },
  );

  const say = it ? sayForm(it, settings.identity) : null;
  const playBtn = (ghost: boolean) => (
    <button className={`iconbtn ${ghost ? 'ghost' : ''}`} type="button" onClick={() => play()} aria-label="Play again"><PlayIcon /></button>
  );

  // every task is the same three boxes: the question, the answer area, one line of feedback
  return (
    <>
      <div className="cp-prompt">
        <Label>{KIND_LABEL[task.kind]}</Label>
        {task.kind === 'hear' && (
          <>
            <FitText as="h1" className="h-m" min={16}>What did you hear?</FitText>
            <div className="play-row">
              {playBtn(false)}
              <span className="small">Play it as often as you like.</span>
            </div>
          </>
        )}
        {task.kind === 'read' && it && (
          <>
            <FitText as="h1" className="h-m" min={16}>What does it mean?</FitText>
            <FitText className="thai-xl" lang="th" min={22}>{it.thai}</FitText>
          </>
        )}
        {task.kind === 'letter' && task.letter && (
          <>
            <FitText as="h1" className="h-m" min={16}>Which letter is this?</FitText>
            <FitText className="thai-xl" lang="th" min={22}>{task.letter.char}</FitText>
          </>
        )}
        {task.kind === 'tone' && it && (
          <>
            <FitText as="h1" className="h-m" min={16}>{`Name the tone${it.tones.length > 1 ? ' of each syllable' : ''}`}</FitText>
            <div className="rv-thai-row">
              <FitText className="thai-xl" lang="th" min={22}>{it.thai}</FitText>
              {playBtn(true)}
            </div>
          </>
        )}
        {task.kind === 'say' && it && (
          <>
            <FitText as="h1" className="h-l" lines={2} min={18}>{it.en}</FitText>
            <FitText className="small" min={10}>{`Say it aloud${it.polite ? ' with your polite ending' : ''}, then check.`}</FitText>
          </>
        )}
      </div>

      <div className="cp-answer">
        {task.options && task.answer && (
          <Choices options={task.options} answer={task.answer} chosen={chosen} onChoose={(id) => { setChosen(id); finish(id === task.answer); }} rows={4} />
        )}
        {task.kind === 'tone' && it && (
          <ToneQuiz tones={it.tones} sylls={syllables(it.roman)} onDone={(ok) => finish(ok)} enabled={done == null} />
        )}
        {task.kind === 'say' && it && say && (
          rec === undefined ? (
            <div className="rv-hidden" style={{ marginTop: 0, height: '100%' }} aria-hidden>
              <span className="label">Your turn</span>
            </div>
          ) : (
            <div className="cp-said">
              <FitText className="thai-xl" lang="th" min={22}>{say.thai}</FitText>
              <FitText className="roman" min={11}>{say.roman}</FitText>
              <FitText className="small" min={10}>{speech == null ? (rec ? 'Pitch scoring arrives with sound. Rate it yourself.' : 'Skipped.') : ''}</FitText>
              <Label>Did you have it?</Label>
              <RatingBar
                preview={null}
                chosen={rated}
                enabled={done == null && !recording}
                onRate={(s) => {
                  setRated(s);
                  finish(s >= Six.Hard, { own: s, speech });
                }}
              />
            </div>
          )
        )}
      </div>

      {/* the verdict has its line before it is given */}
      <FitText as="p" className="body cp-fb" lines={2} min={11} valign="top">
        {done != null && task.kind !== 'say' && it && (
          <>
            <span className={done ? 'good' : 'bad'}>{done ? 'Right.' : 'No.'}</span> <span className="thai">{it.thai}</span> · {it.roman} · {it.en}
          </>
        )}
        {done != null && task.letter && (
          <>
            <span className={done ? 'good' : 'bad'}>{done ? 'Right.' : 'No.'}</span> <span className="thai">{task.letter.char}</span> is {task.letter.name}, “{task.letter.initial}”.
          </>
        )}
      </FitText>

      <div className="learn-foot">
        {/* one button, always in the same place: Say it, then Next */}
        {task.kind === 'say' && rec === undefined ? (
          <button className="pill solid big wide" type="button" onClick={sayIt}><MicIcon size={16} /> Say it</button>
        ) : (
          <button className="pill solid big wide" type="button" onClick={onNext} disabled={done == null}>Next</button>
        )}
        {device === 'desktop' && (
          <KeyHints
            hints={
              done != null
                ? [['Enter', 'Next']]
                : task.kind === 'tone'
                  ? [['1–5', 'Tone'], ['Space', 'Play']]
                  : task.kind === 'say'
                    ? [['Enter', 'Say it'], ['1–6', 'Rate']]
                    : [['1–4', 'Choose'], ...(task.kind === 'hear' ? ([['Space', 'Play']] as [string, string][]) : [])]
            }
          />
        )}
      </div>
    </>
  );
}
