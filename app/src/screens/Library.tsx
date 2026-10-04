// The library: everything you have met, replayable any time. The daily path
// prompts; the library lets you go back to anything, practise freely, or learn
// ahead.

import { useMemo, useState } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { Link, navigate, useRoute } from '../app/router';
import { CastFinale, Constellation, Sequence, SEQUENCES, SEQ_INFO, type SequenceName } from '../anim';
import { lessonsUpTo } from '../content/lessons';
import { sayForm } from '../content/repo';
import { DRILLS } from '../path/pathway';
import { chapterList, doneTasks } from '../street/state';
import { Label, Screen, Seg, Sheet, TopBar } from '../ui/kit';
import { PlayIcon } from '../audio/SoundLayer';

type Tab = 'words' | 'letters' | 'patterns' | 'lessons' | 'notes' | 'scenes' | 'drills' | 'moments';
const TABS: { v: Tab; label: string }[] = [
  { v: 'words', label: 'Words' },
  { v: 'letters', label: 'Letters' },
  { v: 'patterns', label: 'Patterns' },
  { v: 'lessons', label: 'Lessons' },
  { v: 'notes', label: 'Notes' },
  { v: 'scenes', label: 'Scenes' },
  { v: 'drills', label: 'Drills' },
  { v: 'moments', label: 'Moments' },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function Library() {
  const { engine, content, settings, sound, store } = useApp();
  const v = useStoreVersion();
  const route = useRoute();
  const tab = (route.query.get('tab') as Tab) || 'words';
  const setTab = (t: Tab) => navigate(`/library?tab=${t}`, true);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'met' | 'all'>('met');
  const [moment, setMoment] = useState<{ kind: 'seq'; name: SequenceName } | { kind: 'finale' } | { kind: 'constellation' } | null>(null);
  const [cue, setCue] = useState(0);
  const day = engine.day();

  const met = useMemo(() => engine.introducedRefs(), [engine, v]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return content.items
      .filter((it) => settings.adult || !it.adult)
      .filter((it) => (show === 'met' ? met.has(`item:${it.id}`) : true))
      .filter((it) => !needle || it.en.toLowerCase().includes(needle) || it.thai.includes(needle) || it.roman.toLowerCase().includes(needle))
      .map((it) => ({ it, strength: met.has(`item:${it.id}`) ? engine.strengthOf(`item:${it.id}`) : null }));
  }, [content, met, q, show, settings.adult, engine]);

  const scenes = doneTasks(store);
  const chapters = chapterList(content).filter((c) => settings.adult || !c.adult);
  const notes = content.culture.filter((c) => c.day <= day);
  const lessons = lessonsUpTo(Math.min(day, settings.courseDays));

  return (
    <Screen top={<TopBar mid="Library" parent="/" />}>
      <Label>Everything you have met · replay any time</Label>
      <h1 className="h-l" style={{ margin: '10px 0 18px' }}>Library</h1>
      <Link to="/primer" className="row" style={{ textDecoration: 'none', marginBottom: 14 }}>
        <span>How Thai works</span>
        <span className="row-right">Tones, romanisation, polite endings</span>
      </Link>
      <div className="lib-tabs">
        <Seg label="Library section" value={tab} onChange={setTab} options={TABS} />
      </div>

      {tab === 'words' && (
        <section style={{ marginTop: 18 }}>
          <div className="hrow wrap" style={{ gap: 10, marginBottom: 12 }}>
            <input type="text" placeholder="Search Thai, romanisation or English" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} aria-label="Search" />
            <Seg label="Show" value={show} onChange={setShow} options={[{ v: 'met', label: `Met · ${[...met].filter((r) => r.startsWith('item:')).length}` }, { v: 'all', label: 'Whole course' }]} />
          </div>
          <div className="hrow wrap" style={{ gap: 10, marginBottom: 8 }}>
            <Link to="/review?free=1" className="pill small" style={{ textDecoration: 'none' }}>Practise, weakest first</Link>
            {engine.day() < settings.courseDays && <Link to={`/new?peek=${engine.day() + 1}`} className="pill small" style={{ textDecoration: 'none' }}>Sneak peek at tomorrow</Link>}
            <Link to="/listen" className="pill small" style={{ textDecoration: 'none' }}>Listen and repeat</Link>
          </div>
          {words.length === 0 && <p className="small">{show === 'met' ? 'Nothing met yet. New items is where you start.' : 'No matches.'}</p>}
          {words.map(({ it, strength }) => {
            const form = sayForm(it, settings.identity);
            return (
              <div key={it.id} className="row" style={{ cursor: 'default' }}>
                <span className="hrow grow" style={{ gap: 12, minWidth: 0 }}>
                  <button
                    className="iconbtn ghost"
                    style={{ width: 36, height: 36 }}
                    aria-label={`Play ${it.en}`}
                    onClick={() => void sound.play({ ref: `item:${it.id}`, thai: form.thai, roman: form.roman, tones: it.tones, en: it.en })}
                  >
                    <PlayIcon size={14} />
                  </button>
                  <Link to={`/new?ref=item:${it.id}`} style={{ textDecoration: 'none', minWidth: 0 }}>
                    <span className="thai" lang="th" style={{ fontSize: 19 }}>{it.thai}</span>{' '}
                    <span className="small">{it.roman} · {it.en}</span>
                  </Link>
                </span>
                <span className="row-right num">{strength == null ? `Day ${it.day}` : pct(strength)}</span>
              </div>
            );
          })}
        </section>
      )}

      {tab === 'letters' && (
        <section style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {content.letters.map((l) => {
            const isMet = met.has(`letter:${l.id}`);
            return (
              <Link
                key={l.id}
                to={`/writing?letter=${l.id}&mode=${isMet ? 'memory' : 'watch'}`}
                className="card"
                style={{ textDecoration: 'none', textAlign: 'center', opacity: isMet ? 1 : 0.5, borderStyle: isMet ? 'solid' : 'dashed' }}
              >
                <div className="thai" lang="th" style={{ fontSize: 40 }}>{l.char}</div>
                <div className="small">{l.name}</div>
                <div className="label" style={{ marginTop: 4 }}>{isMet ? pct(engine.strengthOf(`letter:${l.id}`)) : `Day ${l.day}`}</div>
              </Link>
            );
          })}
        </section>
      )}

      {tab === 'patterns' && (
        <section style={{ marginTop: 18 }}>
          {content.patterns.map((p) => {
            const isMet = met.has(`pattern:${p.id}`);
            return (
              <div key={p.id} className="row" style={{ cursor: 'default' }}>
                <span className="stack gap-1">
                  <span><span className="thai" lang="th">{p.frame}</span> <span className="small">· {p.en}</span></span>
                  <span className="small">{p.note}</span>
                </span>
                <span className="hrow" style={{ flex: 'none' }}>
                  {isMet && <Link to={`/new?ref=pattern:${p.id}`} className="pill small" style={{ textDecoration: 'none' }}>Look again</Link>}
                  <Link to="/sentence" className="pill small" style={{ textDecoration: 'none' }}>{isMet ? 'Build' : `Day ${p.day}`}</Link>
                </span>
              </div>
            );
          })}
        </section>
      )}

      {tab === 'lessons' && (
        <section style={{ marginTop: 18 }}>
          <p className="small" style={{ marginTop: 0 }}>How Thai works, a day at a time: one short lesson for each day so far.</p>
          {lessons.map((l) => (
            <Link key={l.day} to={`/lesson?day=${l.day}&from=library`} className="row" style={{ textDecoration: 'none' }}>
              <span>{l.title}</span>
              <span className="row-right">{l.day === day ? 'Today' : `Day ${l.day}`}</span>
            </Link>
          ))}
        </section>
      )}

      {tab === 'notes' && (
        <section style={{ marginTop: 18 }}>
          {notes.length === 0 && <p className="small">The first note opens on day 1.</p>}
          {notes.map((n) => (
            <Link key={n.id} to={`/culture?id=${n.id}`} className="row" style={{ textDecoration: 'none' }}>
              <span>{n.title}</span>
              <span className="row-right">Day {n.day}</span>
            </Link>
          ))}
        </section>
      )}

      {tab === 'scenes' && (
        <section style={{ marginTop: 18 }}>
          <Label>Street tasks you have done</Label>
          {scenes.length === 0 && <p className="small">None yet. Walk the street.</p>}
          {scenes.map((s) => (
            <Link key={s.id} to={s.to} className="row" style={{ textDecoration: 'none' }}>
              <span>{s.title}</span>
              <span className="row-right">{content.person(s.person)?.name ?? s.person} · replay</span>
            </Link>
          ))}
          <div style={{ height: 20 }} />
          <Label>Chapters</Label>
          {chapters.map((c) => (
            <Link key={`${c.id}-${c.part}`} to={day >= c.day ? c.to : '/library?tab=scenes'} className="row" style={{ textDecoration: 'none', opacity: day >= c.day ? 1 : 0.45 }}>
              <span>{c.title}</span>
              <span className="row-right">{day >= c.day ? (c.adult ? '18+' : 'Play') : `Day ${c.day}`}</span>
            </Link>
          ))}
        </section>
      )}

      {tab === 'drills' && (
        <section style={{ marginTop: 18 }}>
          {DRILLS.map((d) => (
            <Link key={d.id} to={day >= d.day ? `/drill/${d.id}` : '/library?tab=drills'} className="row" style={{ textDecoration: 'none', opacity: day >= d.day ? 1 : 0.45 }}>
              <span>{d.title}</span>
              <span className="row-right">{day >= d.day ? d.tag : `Day ${d.day}`}</span>
            </Link>
          ))}
          <Link to="/tone-pairs" className="row" style={{ textDecoration: 'none' }}><span>Tone lab</span><span className="row-right">Hear the tones</span></Link>
          <Link to="/checkpoint" className="row" style={{ textDecoration: 'none' }}><span>Checkpoints</span><span className="row-right">Any week</span></Link>
        </section>
      )}

      {tab === 'moments' && (
        <section style={{ marginTop: 18 }}>
          <p className="small" style={{ marginTop: 0 }}>The moments from the street, to watch again.</p>
          {SEQUENCES.filter((n) => settings.adult || n !== 'palm').map((n) => (
            <button key={n} className="row" onClick={() => { setMoment({ kind: 'seq', name: n }); setCue((c) => c + 1); }}>
              <span>{SEQ_INFO[n]?.label ?? n}</span>
              <span className="row-right">Play</span>
            </button>
          ))}
          <button className="row" onClick={() => { setMoment({ kind: 'constellation' }); setCue((c) => c + 1); }}>
            <span>Everyone you have spoken to</span><span className="row-right">Play</span>
          </button>
          <button className="row" onClick={() => { setMoment({ kind: 'finale' }); setCue((c) => c + 1); }}>
            <span>The whole cast</span><span className="row-right">Play</span>
          </button>
        </section>
      )}

      {moment && (
        <Sheet label="Moment" onClose={() => setMoment(null)}>
          <div style={{ height: 'min(60vh, 460px)', position: 'relative' }}>
            {moment.kind === 'seq' && <Sequence name={moment.name} cue={cue} style={{ position: 'absolute', inset: 0 }} />}
            {moment.kind === 'constellation' && <Constellation cue={cue} style={{ position: 'absolute', inset: 0 }} />}
            {moment.kind === 'finale' && <CastFinale cue={cue} style={{ position: 'absolute', inset: 0 }} />}
          </div>
          <div className="hrow" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="pill" onClick={() => setCue((c) => c + 1)}>Again</button>
            <button className="pill solid" onClick={() => setMoment(null)}>Close</button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
