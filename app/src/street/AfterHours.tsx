// After Hours (18+). A bar, late. Small talk, a compliment, asking to sit, and
// hearing a no. Rapport rewards reading cues and respecting a no; pushing
// drops her comfort, and at zero she leaves (Palm on the glass). Clothed,
// non-explicit, consent-forward. Fah and Bank are in their late twenties.
// "Talk live" is offered only with the 18+ setting on and the local server up;
// the scripted scene stays the default and the offline mode.

import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { Link, useRoute } from '../app/router';
import { taskById, type StreetNode } from '../content/street-seed';
import type { Expression } from '../anim';
import { Label, Meter, Note, Row, Screen, Seg, StepRail, TopBar } from '../ui/kit';
import { LivePanel, liveOffered, useLiveHealth } from '../live/LivePanel';
import { LiveRun } from '../live/tools';
import { COMFORT_MAX, DialogueRun, type ChoiceResult, type Outcome } from './dialogue';
import { DialoguePanel } from './parts/DialoguePanel';
import { Face } from './parts/Face';
import { NotReady, SequenceOverlay, placeColour, useStreet } from './parts/common';
import { afterHoursParts, applyRun, clarityFor, repOf } from './state';
import { AdultOff } from './Talk';
import './street.css';

const RAPPORT_FULL = 12;
const START_COMFORT = 6;

export default function AfterHours() {
  const { settings } = useApp();
  const route = useRoute();
  const [street] = useStreet();
  // every part the chapter has; one whose script this course lacks is not ready
  const parts = useMemo(() => afterHoursParts(), []);
  const q = Number(route.query.get('part'));
  const [part, setPart] = useState<number | null>(q >= 1 && q <= parts.length ? q : null);
  const [key, setKey] = useState(0);
  if (!settings.adult) return <AdultOff />;
  const ch = street.chapters['after-hours'] ?? {};
  const endings = ch.endings ?? [];

  if (part != null && !parts[part - 1].ready) return <NotReady chapter="After Hours · 18+" onParts={() => setPart(null)} />;

  if (part == null)
    return (
      <Screen top={<TopBar mid="After Hours · 18+" parent="/street" />} narrow>
        <Label>Street chapter · Bar · 18+</Label>
        <h1 className="h-xl" style={{ margin: '10px 0 14px' }}>After Hours</h1>
        <p className="body" style={{ maxWidth: '54ch', marginTop: 0 }}>
          Late at the bar. Read the room. A no is an answer, and taking it well is the best thing you can do here.
        </p>
        {parts.map((p) => (
          <Row
            key={p.task}
            onClick={() => { setPart(p.part); setKey((k) => k + 1); }}
            disabled={!p.ready}
            right={!p.ready ? 'Not ready yet' : street.done.includes(p.task) ? 'Replay' : `Day ${p.day}`}
            done={p.ready && street.done.includes(p.task)}
          >
            {p.title}
            {p.person && <span className="mut"> · {p.person === 'fah' ? 'Fah' : 'Bank and Fah'}</span>}
          </Row>
        ))}
        <p className="small" style={{ marginTop: 18 }}>Endings found: {endings.length} of {parts.length * 4}.</p>
      </Screen>
    );

  return <Scene key={key} taskId={parts[part - 1].task} onPick={() => setPart(null)} onAgain={() => setKey((k) => k + 1)} />;
}

function endingFor(taskId: string, outcome: Outcome | 'quit', rapport: number): string {
  const p = taskId.slice(-1);
  if (outcome === 'left') return `p${p}-left`;
  if (outcome !== 'done') return `p${p}-walked`;
  return rapport >= 8 ? `p${p}-warm` : `p${p}-polite`;
}

const ENDING_TEXT: Record<string, string> = {
  warm: 'Warm. You read the room and took the no well. She will say hello next time.',
  polite: 'Polite. Nothing went wrong. Nothing much went right either.',
  left: 'She left. Comfort ran out. A no is the end of the question, not the start of a negotiation.',
  walked: 'You walked away. Fine. Sometimes that is the move.',
};

function Scene({ taskId, onPick, onAgain }: { taskId: string; onPick: () => void; onAgain: () => void }) {
  const { engine, settings, content } = useApp();
  const [street, update] = useStreet();
  const task = useMemo(() => taskById(taskId, settings.identity)!, [taskId, settings.identity]);
  const [scripted, setScripted] = useState(() => new DialogueRun(task, engine, { patience: Infinity, comfort: START_COMFORT }));
  const health = useLiveHealth();
  const [mode, setMode] = useState<'scripted' | 'live'>('scripted');
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [runKey, setRunKey] = useState(0);
  const live = mode === 'live' && liveRun ? liveRun : null;
  const run = live ?? scripted;
  const [, force] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [node, setNode] = useState<StreetNode | null>(null);
  const [expr, setExpr] = useState<Expression>('neutral');
  const [delta, setDelta] = useState<{ rep: number; comfort: number } | null>(null);
  const [palm, setPalm] = useState(false);
  const [end, setEnd] = useState<{ ending: string } | null>(null);
  const [firstMeeting] = useState(() => !street.met?.includes(task.person));
  const [replay] = useState(() => street.done.includes(task.id));
  const colour = placeColour('bar');
  const speaker = node?.speaker ?? task.person;
  const person = content.person(speaker)!;

  const onResult = (r: ChoiceResult) => {
    setExpr(r.expression);
    setDelta({ rep: r.option.rep ?? 0, comfort: r.option.comfort ?? 0 });
    force((n) => n + 1);
  };

  const finish = (outcome: Outcome | 'quit') => {
    const ending = endingFor(task.id, outcome, run.rep);
    update((s) => {
      const res = applyRun(s, { taskId: task.id, person: task.person, outcome, baht: run.baht, rep: Math.round(run.rep / 3), reward: task.reward });
      const prev = s.chapters['after-hours'] ?? {};
      const endings = prev.endings?.includes(ending) ? prev.endings : [...(prev.endings ?? []), ending];
      res.state.chapters = { ...s.chapters, 'after-hours': { ...prev, endings, runs: (prev.runs ?? 0) + 1, done: res.state.done.filter((d) => d.startsWith('after-hours')).length >= 2 } };
      return res.state;
    });
    setEnd({ ending });
    if (outcome === 'left') setPalm(true);
  };

  const comfort = run.comfort ?? START_COMFORT;
  // live is offered only with the 18+ setting on (this whole chapter is behind it too)
  const showMode = !end && settings.adult && (mode === 'live' || liveOffered(health, task, settings.adult));
  const switchMode = (m: 'scripted' | 'live') => {
    if (m === mode) return;
    setMode(m);
    setDelta(null);
    setExpr('neutral');
    if (m === 'live') setLiveRun(new LiveRun(task, engine, { comfort: START_COMFORT }));
    else setScripted(new DialogueRun(task, engine, { patience: Infinity, comfort: START_COMFORT }));
    setRunKey((k) => k + 1);
  };
  const kind = end?.ending.split('-')[1] ?? '';

  return (
    <Screen top={<TopBar mid={`After Hours · ${task.title.split(', ')[1] ?? ''} · 18+`} parent="/street" right={<button type="button" className="pill small" onClick={onPick}>Parts</button>} />}>
      <div className="ah">
        <div className="ah-face">
          <Face
            who={speaker}
            colour={colour}
            clarity={clarityFor(repOf(street, speaker))}
            speaking={speaking}
            tones={node?.tones}
            expression={comfort <= 3 && expr === 'neutral' ? 'sad' : expr}
            firstMeeting={firstMeeting}
            style={{ position: 'absolute', inset: 0 }}
          />
          <div style={{ position: 'absolute', left: 0, bottom: 10 }}>
            <Label>Story · {task.title}</Label>
            <h1 className="h-l" style={{ marginTop: 6 }}>{person.name}</h1>
          </div>
        </div>
        <div className="stack gap-4" style={{ minWidth: 0, paddingTop: 8 }}>
          <div className="ah-meters">
            <div>
              <div className="hrow"><Label>Rapport</Label>{delta && delta.rep !== 0 && <span className={`label ${delta.rep > 0 ? 'good' : 'bad'}`}>{delta.rep > 0 ? '+' : ''}{delta.rep}</span>}</div>
              <Meter value={Math.max(0, run.rep) / RAPPORT_FULL} />
            </div>
            <div>
              <div className="hrow"><Label>Comfort</Label>{delta && delta.comfort !== 0 && <span className={`label ${delta.comfort > 0 ? 'good' : 'bad'}`}>{delta.comfort > 0 ? '+' : ''}{delta.comfort}</span>}</div>
              <Meter value={comfort / COMFORT_MAX} colour={comfort <= 3 ? 'var(--bad)' : undefined} />
            </div>
          </div>
          <StepRail steps={task.steps} at={end ? task.steps.length : run.step} />
          {showMode && (
            <Seg
              label="Conversation mode"
              value={mode}
              options={[{ v: 'scripted', label: 'Scripted' }, { v: 'live', label: 'Talk live' }]}
              onChange={switchMode}
            />
          )}
          <hr className="rule" />
          {end ? (
            <div className="stack gap-4 fade-in">
              <h2 className="h-m">{kind === 'warm' ? 'A good night.' : kind === 'left' ? 'She left.' : kind === 'walked' ? 'You left.' : 'A quiet night.'}</h2>
              <p className="body" style={{ margin: 0 }}>{ENDING_TEXT[kind]}</p>
              <p className="small" style={{ margin: 0 }}>
                {replay ? 'Replay: reputation stays as it was.' : 'Reputation updated.'} Endings found: {(street.chapters['after-hours']?.endings ?? []).length}.
              </p>
              <div className="hrow wrap">
                <button type="button" className="pill solid" onClick={onAgain}>Play it again</button>
                <button type="button" className="pill" onClick={onPick}>Parts</button>
                <Link to="/street" className="pill">Street</Link>
              </div>
            </div>
          ) : live ? (
            <LivePanel
              key={runKey}
              run={live}
              onEnd={finish}
              onFallback={() => switchMode('scripted')}
              onChange={() => {
                setDelta(null);
                force((n) => n + 1);
              }}
              onSpeaking={setSpeaking}
            />
          ) : (
            <DialoguePanel
              key={runKey}
              run={scripted}
              onResult={onResult}
              onEnd={finish}
              onSpeaking={setSpeaking}
              onNode={(n) => {
                setNode(n);
                setExpr(n.expression ?? 'neutral');
              }}
              beat={1200}
            />
          )}
          {!end && (
            <div className="talk-foot">
              <span className="small">Comfort at zero ends the scene. Respecting a no raises rapport.</span>
              <button type="button" className="pill small" onClick={() => finish('quit')}>Walk away</button>
            </div>
          )}
          {task.note && <Note>{task.note}</Note>}
        </div>
      </div>
      {palm && <SequenceOverlay name="palm" who={task.person} colour={colour} ms={3400} onDone={() => setPalm(false)} />}
    </Screen>
  );
}
