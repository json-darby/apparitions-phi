// The Street: talk. Face above and replies below on a phone; face left and
// replies right on tablet and desktop, with number keys for replies. Any task
// can be opened here, done or not: a replay logs every answer but pays nothing.
// "Talk live" (Gemini Live through the app's local server) is offered only when the
// server answers /health; scripted is the default and the permanent offline mode.

import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { Link, navigate } from '../app/router';
import { PLACES } from '../content/seed';
import { taskById, type StreetNode } from '../content/street-seed';
import type { Expression } from '../anim';
import { KeyHints, Label, Note, Screen, Seg, StepRail, TopBar } from '../ui/kit';
import { LivePanel, liveOffered, useLiveHealth } from '../live/LivePanel';
import { LiveRun } from '../live/tools';
import { DialogueRun, type ChoiceResult, type Outcome } from './dialogue';
import { DialoguePanel } from './parts/DialoguePanel';
import { Face } from './parts/Face';
import { RepStars } from './parts/RepStars';
import { SequenceOverlay, placeColour, useStreet } from './parts/common';
import { applyRun, clarityFor, repOf, REP_MAX } from './state';
import type { SequenceName } from '../anim';
import './street.css';

export default function Talk({ params }: { params: Record<string, string> }) {
  const { engine, settings, content } = useApp();
  const task = useMemo(() => taskById(params.task, settings.identity), [params.task, settings.identity]);
  const [street, update] = useStreet();
  const [run, setRun] = useState(() => (task ? new DialogueRun(task, engine) : null));
  const [firstMeeting] = useState(() => !!task && !street.met?.includes(task.person));
  const [replay, setReplay] = useState(() => !!task && street.done.includes(task.id));
  const [seq, setSeq] = useState<{ name: SequenceName; then: 'start' | 'end' } | null>(() =>
    task?.id === 'hotel-hello' && !street.seen?.includes('wai') ? { name: 'wai', then: 'start' } : null,
  );
  const [speaking, setSpeaking] = useState(false);
  const [expr, setExpr] = useState<Expression>('neutral');
  const [cue, setCue] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const [node, setNode] = useState<StreetNode | null>(null);
  const [end, setEnd] = useState<{ outcome: Outcome | 'quit'; paid: { baht: number; rep: number }; replay: boolean } | null>(null);
  const health = useLiveHealth();
  const [mode, setMode] = useState<'scripted' | 'live'>('scripted');
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [, bump] = useState(0);

  if (!task || !run)
    return (
      <Screen top={<TopBar mid="The Street" parent="/street" />}>
        <h1 className="h-l">Nobody here</h1>
        <p className="body">That conversation does not exist.</p>
        <Link to="/street" className="pill" style={{ alignSelf: 'flex-start' }}>Back to the street</Link>
      </Screen>
    );
  if (task.adult && !settings.adult) return <AdultOff />;

  const place = PLACES.find((p) => p.id === task.place)!;
  const person = content.person(task.person)!;
  const colour = placeColour(task.place);
  const rep = repOf(street, task.person);

  const onResult = (r: ChoiceResult) => {
    setExpr(r.expression);
    setCue((c) => c + 1);
  };

  const live = mode === 'live' && liveRun ? liveRun : null;
  const active = live ?? run;

  const finish = (outcome: Outcome | 'quit') => {
    let paid = { baht: 0, rep: 0 };
    update((s) => {
      const res = applyRun(s, { taskId: task.id, person: task.person, outcome, baht: active.baht, rep: active.rep, reward: task.reward });
      paid = res.paid;
      return res.state;
    });
    setEnd({ outcome, paid, replay });
    if (outcome === 'done' && (task.place === 'food' || task.place === 'market')) setSeq({ name: 'handover', then: 'end' });
    else if (outcome === 'failed') setSeq({ name: 'walkaway', then: 'end' });
  };

  const seqDone = () => {
    if (seq?.name === 'wai') update((s) => ({ ...s, seen: [...(s.seen ?? []), 'wai'] }));
    setSeq(null);
  };

  const again = (m: 'scripted' | 'live' = mode) => {
    setEnd(null);
    setExpr('neutral');
    setMode(m);
    if (m === 'live') setLiveRun(new LiveRun(task, engine));
    else setRun(new DialogueRun(task, engine));
    setRunKey((k) => k + 1);
    setReplay(street.done.includes(task.id));
  };

  const showMode = !end && (mode === 'live' || liveOffered(health, task, settings.adult));

  const started = !(seq && seq.then === 'start');

  return (
    <Screen top={<TopBar mid={place.name} parent="/street" />}>
      <div className="street-talk">
        <div className="talk-face">
          <Face
            who={task.person}
            colour={colour}
            clarity={clarityFor(rep)}
            speaking={speaking}
            tones={node?.tones}
            expression={expr}
            firstMeeting={firstMeeting}
            cue={cue}
            className="talk-app"
          />
          <RepStars rep={rep} name={person.name} colour={colour} style={{ top: '14%', right: '22%' }} />
          <div className="talk-name">
            <Label>
              The Street · <span lang="th">{place.thaiSign}</span>
            </Label>
            <h1 className="h-l">{person.name}</h1>
          </div>
        </div>
        <div className="talk-main">
          <div className="hrow between wrap">
            <Label fg>{task.title}</Label>
            {replay && <span className="label">Replay · no reward</span>}
          </div>
          <StepRail steps={task.steps} at={end ? task.steps.length : active.step} />
          {showMode && (
            <Seg
              label="Conversation mode"
              value={mode}
              options={[{ v: 'scripted', label: 'Scripted' }, { v: 'live', label: 'Talk live' }]}
              onChange={(m) => m !== mode && again(m)}
            />
          )}
          <hr className="rule" />
          {end ? (
            <TalkEnd
              outcome={end.outcome}
              name={person.name}
              paid={end.paid}
              replay={end.replay}
              accuracy={active.accuracy()}
              onAgain={() => again()}
            />
          ) : started && live ? (
            <LivePanel key={runKey} run={live} onEnd={finish} onFallback={() => again('scripted')} onChange={() => bump((n) => n + 1)} onSpeaking={setSpeaking} />
          ) : started ? (
            <DialoguePanel
              key={runKey}
              run={run}
              onResult={onResult}
              onEnd={finish}
              onSpeaking={setSpeaking}
              onNode={(n) => {
                setNode(n);
                setExpr(n.expression ?? 'neutral');
              }}
            />
          ) : null}
          <div className="talk-foot">
            <span className="small num">
              ฿ {street.baht} · Reputation with {person.name} {rep} of {REP_MAX}
              {!live && run.patience < run.startPatience && !end ? ` · patience ${run.patience} of ${run.startPatience}` : ''}
            </span>
            {!end && (
              <button type="button" className="pill small" onClick={() => (active.history.length ? finish('quit') : navigate('/street'))}>
                Walk away
              </button>
            )}
          </div>
          <KeyHints hints={live ? [['Space (hold)', 'talk'], ['R', 'hear again'], ['T', 'try again'], ['G', 'English']] : [['1–5', 'reply'], ['Space', 'hear again'], ['G', 'English']]} />
          {task.note && <Note>{task.note}</Note>}
        </div>
      </div>
      {seq && <SequenceOverlay name={seq.name} who={task.person} colour={colour} onDone={seqDone} />}
    </Screen>
  );
}

function TalkEnd({ outcome, name, paid, replay, accuracy, onAgain }: { outcome: Outcome | 'quit'; name: string; paid: { baht: number; rep: number }; replay: boolean; accuracy: number; onAgain: () => void }) {
  const head =
    outcome === 'done' ? 'Done.' : outcome === 'failed' ? `${name} has stopped listening.` : outcome === 'left' ? `${name} left.` : 'You walked away.';
  const sub =
    outcome === 'done'
      ? replay
        ? 'A replay. Every answer was logged; baht and reputation stay as they were.'
        : `${paid.baht >= 0 ? '+' : '−'}฿${Math.abs(paid.baht)} · ${paid.rep >= 0 ? '+' : '−'}${Math.abs(paid.rep)} rep with ${name}.`
      : outcome === 'quit'
        ? 'No harm done. The task is still open.'
        : 'Come back later. The task is still open.';
  return (
    <div className="stack gap-4 fade-in" style={{ padding: '8px 0 16px' }}>
      <h2 className="h-m">{head}</h2>
      <p className="body" style={{ margin: 0 }}>{sub}</p>
      {outcome !== 'quit' && <p className="small" style={{ margin: 0 }}>First-try accuracy {Math.round(accuracy * 100)}%.</p>}
      <div className="hrow wrap">
        <Link to="/street" className="pill solid">Back to the street</Link>
        <button type="button" className="pill" onClick={onAgain}>Play it again</button>
      </div>
    </div>
  );
}

export function AdultOff() {
  return (
    <Screen top={<TopBar mid="After Hours" parent="/" />} narrow>
      <Label className="lead-label">18+ · Off</Label>
      <h1 className="h-l" style={{ marginTop: 10 }}>After Hours is off</h1>
      <p className="body" style={{ maxWidth: '52ch' }}>
        This chapter is for adults: bar conversation, a little flirting, saying no and hearing one. It stays non-explicit.
        Turn on 18+ content in Settings to open it.
      </p>
      <Link to="/settings" className="pill" style={{ alignSelf: 'flex-start' }}>Settings</Link>
    </Screen>
  );
}
