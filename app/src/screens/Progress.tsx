// Progress: the day path, streak and minutes, items by strength, strengths by
// skill, weekly checkpoints and the weakest words.

import { useMemo } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { addDays, localDate } from '../core/dates';
import { SKILLS, type Skill } from '../content/types';
import { checkpointDays, spineFor } from '../path/pathway';
import { Label, Meter, Screen, SectionHead, Stat, TopBar } from '../ui/kit';
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
        <SectionHead title="Weakest" />
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
        <SectionHead title="Checkpoints" />
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

  return (
    <Screen top={<TopBar mid="Progress" parent="/" right={<Link to="/readiness" className="label" style={{ textDecoration: 'none' }}>Readiness</Link>} />} panel={panel}>
      <Label>Day {Math.min(day, settings.courseDays)} of {settings.courseDays} · {settings.minutes}-minute track</Label>
      <h1 className="h-l" style={{ margin: '10px 0 24px' }}>Progress</h1>
      <div className="stats">
        <Stat label="Day streak" value={engine.streak()} />
        <Stat label="Today" value={`${Math.round(data.minsToday)} min`} />
        <Stat label="This week" value={`${Math.round(data.minsWeek)} min`} />
      </div>

      <SectionHead title="The path" note={`${data.met} met`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }} role="list" aria-label="30-day path">
        {Array.from({ length: settings.courseDays }, (_, i) => {
          const d = i + 1;
          const date = addDays(settings.startDate, i);
          const did = data.activeDays.has(date);
          const isToday = d === day;
          const cp = checkpointDays(settings.courseDays).includes(d);
          return (
            <div
              key={d}
              role="listitem"
              title={`Day ${d}: ${spineFor(d, settings.courseDays).focus}`}
              style={{
                aspectRatio: '1', borderRadius: cp ? '50%' : 3, display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 600,
                border: `1px solid ${isToday ? 'var(--fg)' : 'var(--rule)'}`,
                background: did ? 'var(--fg)' : 'transparent', color: did ? '#050505' : d < day ? 'var(--mut-2)' : 'var(--mut)',
              }}
            >
              {d}
            </div>
          );
        })}
      </div>

      <SectionHead title="Items by strength" />
      <div style={{ display: 'flex', height: 10, gap: 2, marginBottom: 10 }} aria-hidden>
        {(['new', 'weak', 'ok', 'strong'] as const).map((k, i) => (
          <div key={k} style={{ flex: data.bands[k] / total, background: ['#3a3a3a', 'var(--bad)', 'var(--amber)', 'var(--good)'][i] }} />
        ))}
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Just met" value={data.bands.new} />
        <Stat label="Weak" value={data.bands.weak} />
        <Stat label="Holding" value={data.bands.ok} />
        <Stat label="Strong" value={data.bands.strong} />
      </div>

      <SectionHead title="By skill" note="Average recall now" />
      <div className="stack gap-4">
        {data.bySkill.map((s) => (
          <div key={s.skill} className="stack gap-2">
            <div className="hrow between">
              <span>{SKILL_LABEL[s.skill]}</span>
              <span className="label num">{s.n ? `${Math.round(s.r * 100)}% · ${s.n}` : '—'}</span>
            </div>
            <Meter value={s.r} />
          </div>
        ))}
      </div>
    </Screen>
  );
}
