// Progress: the day path, streak and minutes, items by strength, strengths by
// skill, weekly checkpoints and the weakest words.

import { useMemo, type ReactNode } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { addDays, localDate } from '../core/dates';
import { SKILLS, type Skill } from '../content/types';
import { checkpointDays, spineFor } from '../path/pathway';
import { Label, ListHead, Meter, Screen, Stat, TopBar } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { Link } from '../app/router';

const SKILL_LABEL: Record<Skill, string> = { hear: 'Hear it', say: 'Say it', read: 'Read it', write: 'Write it', tone: 'Name its tone' };

export default function Progress() {
  const { engine, store, content, settings } = useApp();
  const v = useStoreVersion();
  const day = engine.day();

  const data = useMemo(() => {
    const activity = store.activity();
    const today = localDate(Date.now());
    const weekAgo = addDays(today, -6);
    const minsToday = (activity.find((a) => a.date === today)?.ms ?? 0) / 60_000;
    const minsWeek = activity.filter((a) => a.date >= weekAgo).reduce((s, a) => s + a.ms, 0) / 60_000;
    const minsAll = activity.reduce((s, a) => s + a.ms, 0) / 60_000;
    const cards = store.allCards();
    const bySkill = SKILLS.map((k) => {
      const rows = cards.filter((c) => c.skill === k);
      const r = rows.length ? rows.reduce((s, c) => s + engine.retrievability(c), 0) / rows.length : 0;
      return { skill: k, n: rows.length, r };
    });
    const refs = [...engine.introducedRefs()];
    const weak = refs
      .map((r) => ({ r, s: engine.strengthOf(r) }))
      .sort((a, b) => a.s - b.s)
      .slice(0, 8);
    const activeDays = new Set(activity.filter((a) => a.ms > 60_000).map((a) => a.date));
    const checkpoints = store.get<Record<string, { score: number; date: string }>>('checkpoints', {});
    return { minsToday, minsWeek, minsAll, bySkill, weak, activeDays, checkpoints, bands: engine.strengthBands(), met: refs.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const total = data.bands.new + data.bands.weak + data.bands.ok + data.bands.strong || 1;

  const panel = (
    <div className="stack gap-6">
      <section>
        <ListHead title="Weakest" />
        {data.weak.length === 0 && <p className="small">Nothing met yet.</p>}
        {data.weak.map(({ r, s }) => {
          const it = content.item(r);
          const l = content.letter(r);
          const p = content.pattern(r);
          return (
            <div key={r} className="row" style={{ cursor: 'default' }}>
              <span className="hrow" style={{ gap: 10 }}>
                <span className="thai">{it?.thai ?? l?.char ?? p?.frame}</span>
                <span className="small">{it?.en ?? l?.name ?? p?.en}</span>
              </span>
              <span className="row-right num">{Math.round(s * 100)}%</span>
            </div>
          );
        })}
      </section>
      <section>
        <ListHead title="Checkpoints" />
        {checkpointDays(settings.courseDays).map((d) => {
          const c = data.checkpoints[d];
          return (
            <div key={d} className="row" style={{ cursor: 'default' }}>
              <span>{d === settings.courseDays ? 'Final assessment' : d === 30 ? 'Midpoint' : `Day ${d}`}</span>
              <span className="row-right">{c ? `${Math.round(c.score * 100)}%` : day >= d ? 'Open' : `Day ${d}`}</span>
            </div>
          );
        })}
      </section>
    </div>
  );

  const cps = checkpointDays(settings.courseDays);
  const daysDone = Array.from({ length: settings.courseDays }, (_, i) => addDays(settings.startDate, i)).filter((d) => data.activeDays.has(d)).length;
  const hours = data.minsAll / 60;

  return (
    <Screen top={<TopBar mid="Progress" parent="/" right={<Link to="/readiness" className="pill text small" style={{ textDecoration: 'none' }}>Readiness</Link>} />} panel={panel}>
      <div className="page-head">
        <Label>Day {Math.min(day, settings.courseDays)} of {settings.courseDays} · {settings.minutes}-minute track</Label>
        <h1 className="h-page">Progress</h1>
      </div>
      <div className="bigstats">
        <BigStat value={data.met} label="items met" />
        <BigStat value={data.bands.strong} label="known well" />
        <BigStat value={<>{hours < 10 ? hours.toFixed(1) : Math.round(hours)}<small> h</small></>} label="practised" />
      </div>
      <p className="small" style={{ margin: '10px 0 0' }}>
        {engine.streak()} day streak · {Math.round(data.minsToday)} min today · {Math.round(data.minsWeek)} min this week
      </p>

      <section className="page-section">
        <ListHead title="The path" note={`${daysDone} of ${settings.courseDays} days`} />
        <div className="path-dots" role="list" aria-label={`${settings.courseDays}-day path`}>
          {Array.from({ length: settings.courseDays }, (_, i) => {
            const d = i + 1;
            const did = data.activeDays.has(addDays(settings.startDate, i));
            const isToday = d === day;
            const cp = cps.includes(d);
            const state = did ? 'done' : isToday ? 'now' : d < day ? 'missed' : '';
            return (
              <span
                key={d}
                role="listitem"
                className={`path-dot ${cp ? 'cp' : ''} ${state}`}
                title={`Day ${d}: ${spineFor(d, settings.courseDays).focus}`}
                aria-label={`Day ${d}${cp ? ', checkpoint' : ''}${did ? ', done' : isToday ? ', today' : ''}`}
              />
            );
          })}
        </div>
        <div className="path-key small" aria-hidden>
          <span><i className="path-dot done" />Done</span>
          <span><i className="path-dot now" />Today</span>
          <span><i className="path-dot cp" />Checkpoint</span>
        </div>
      </section>

      <section className="page-section">
        <ListHead title="By skill" note="Recall right now" />
        <div className="stack gap-4">
          {data.bySkill.map((s) => (
            <div key={s.skill} className="skill-meter">
              <div className="hrow between">
                <span>{SKILL_LABEL[s.skill]}</span>
                <span className="num fg2">{s.n ? `${Math.round(s.r * 100)}%` : '—'}</span>
              </div>
              <Meter value={s.r} />
            </div>
          ))}
        </div>
      </section>

      <section className="page-section">
        <ListHead title="Items by strength" />
        <div style={{ display: 'flex', height: 6, gap: 2, marginBottom: 12, borderRadius: 3, overflow: 'hidden' }} aria-hidden>
          {(['new', 'weak', 'ok', 'strong'] as const).map((k, i) => (
            <div key={k} style={{ flex: data.bands[k] / total, background: ['#3a3a3a', 'var(--bad)', 'var(--amber)', 'var(--good)'][i] }} />
          ))}
        </div>
        <div className="stats four" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Stat label="Just met" value={data.bands.new} />
          <Stat label="Weak" value={data.bands.weak} />
          <Stat label="Holding" value={data.bands.ok} />
          <Stat label="Strong" value={data.bands.strong} />
        </div>
      </section>
    </Screen>
  );
}

function BigStat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="bigstat">
      <FitText className="v num" min={16}>{value}</FitText>
      <span className="small">{label}</span>
    </div>
  );
}
