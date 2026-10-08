// One section's lines: tick single lines, or start the whole section from the
// top. Each line shows its Thai, romanisation, English, support level, and the
// replies you may hear back; then the section's frames and their slot words.

import { useMemo, useState } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { Link } from '../app/router';
import { Label, Screen, SectionHead, TopBar } from '../ui/kit';
import { frameById, lineIndex, visibleSections, type SchoolFile } from './content';
import { loadPrefs, loadTicks, loadWheels, saveTicks } from './prefs';
import { lineDue } from './reviews';
import { wheelOf } from './runner';
import { planSession, startSession } from './session';
import { NoFile, Tick, tickState } from './SchoolMap';
import { SCHOOL } from './names';
import { useSchool } from './useSchool';
import { deleteCustom, isCustomSection, loadCustom } from './custom';
import { navigate } from '../app/router';
import './school.css';

export default function SchoolSection({ params }: { params: Record<string, string> }) {
  const file = useSchool();
  if (file === undefined) return <Screen top={<TopBar mid={SCHOOL.name} parent="/school" />}><p className="small">Loading…</p></Screen>;
  if (!file) return <NoFile />;
  return <Section file={file} id={params.id} />;
}

const LEVEL_TEXT = { 1: 'New', 2: 'Some help', 3: 'Without help' } as const;

function Section({ file, id }: { file: SchoolFile; id: string }) {
  const { store, settings } = useApp();
  const v = useStoreVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wheels = useMemo(() => loadWheels(store), [store, v]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ticks = useMemo(() => new Set(loadTicks(store)), [store, v]);
  const section = visibleSections(file, settings.adult).find((s) => s.id === id);
  const group = file.groups.find((g) => g.id === section?.group);
  const index = useMemo(() => lineIndex(file), [file]);
  const me = settings.identity;
  const they = loadPrefs(store).they === 'm' ? 'm' : 'f';
  const now = Date.now();
  const custom = !!section && isCustomSection(section);
  const [sure, setSure] = useState(false);

  if (!section) {
    return (
      <Screen top={<TopBar mid={SCHOOL.name} parent="/school" />} narrow>
        <h1 className="h-l">Not here</h1>
        <p className="body">That section does not exist{settings.adult ? '' : ', or it is 18+ and the 18+ setting is off'}.</p>
        <Link to="/school" className="pill" style={{ alignSelf: 'flex-start' }}>Back to the map</Link>
      </Screen>
    );
  }

  const ids = section.lines.map((l) => l.id);
  const toggle = (lineId: string) => saveTicks(store, ticks.has(lineId) ? [...ticks].filter((x) => x !== lineId) : [...ticks, lineId]);
  const all = tickState(ids, ticks);
  const start = () => {
    const prefs = loadPrefs(store);
    startSession(store, planSession(file, { adult: settings.adult, identity: me, minutes: prefs.minutes, title: section.title, lineIds: ids, wheels }));
  };

  return (
    <Screen top={<TopBar mid={SCHOOL.name} parent="/school" />} narrow>
      <Label className="sn-lead">{custom ? `${group?.title ?? 'Mine'} · your lesson${loadCustom(store).find((r) => r.id === section.id)?.adult ? ' · 18+' : ''}` : `${group?.title} · Section ${section.n}${group?.adult ? ' · 18+' : ''}`}</Label>
      <h1 className="h-l" style={{ marginTop: 10 }}>{section.title}</h1>
      {section.note && <p className="body" style={{ maxWidth: '52ch', margin: '12px 0 0' }}>{section.note}</p>}
      {custom && (
        <p className="small sn-unchecked-note">
          <span className="sn-unchecked" aria-hidden /> Written for you and checked by machine, not built from the course’s own recipes. Tones come from the romanisation’s marks.
        </p>
      )}

      {!section.lines.length ? (
        <p className="body" style={{ maxWidth: '52ch' }}>Lines coming. This section is waiting for your lines; it opens as soon as they are agreed and loaded.</p>
      ) : (
        <>
          <div className="hrow wrap" style={{ margin: '20px 0 8px', gap: 10 }}>
            <button type="button" className="pill solid" style={{ background: 'var(--violet)', borderColor: 'var(--violet)' }} onClick={start}>Start section</button>
            <button type="button" className="pill" onClick={() => saveTicks(store, all === 'true' ? [...ticks].filter((x) => !ids.includes(x)) : [...ticks, ...ids])}>
              {all === 'true' ? 'Untick all' : 'Tick all'}
            </button>
            <Link to="/school" className="pill" style={{ textDecoration: 'none' }}>Map</Link>
            {custom && (
              <button
                type="button"
                className="pill"
                onClick={() => {
                  if (!sure) return setSure(true);
                  saveTicks(store, [...ticks].filter((x) => !ids.includes(x)));
                  deleteCustom(store, section.id);
                  navigate('/school', true);
                }}
              >
                {sure ? 'Tap again to delete' : 'Delete lesson'}
              </button>
            )}
          </div>

          <SectionHead title="Lines" note={`${section.lines.length} things you say`} />
          {section.lines.map((l) => {
            const w = wheelOf(wheels, l.id);
            const f = l[me];
            return (
              <div key={l.id} className="sn-line">
                <Tick state={ticks.has(l.id) ? 'true' : 'false'} onChange={() => toggle(l.id)} label={`Tick: ${l.en}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="thai-m" lang="th">{f.thai}</div>
                  <span className="roman">{f.roman}</span>
                  <div className="small" style={{ color: 'var(--fg-2)' }}>
                    {l.en}
                    {l.escape ? <span className="mut"> · escape line</span> : null}
                    {l.id === section.door ? <span className="mut"> · door phrase</span> : null}
                    {l.unverified ? <span className="sn-unchecked" title="Generated Thai: not built from the course" aria-label="unchecked" /> : null}
                  </div>
                  {l.replies.length > 0 && (
                    <ul className="sn-replies">
                      {l.replies.map((r) => (
                        <li key={r.id}>
                          They say <span className="thai" lang="th">{r[they].thai}</span> ({r.en}) → you: {index.get(r.answer)?.line.en ?? r.answer}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="label">{LEVEL_TEXT[w.level]}{lineDue(store, l.id, now) ? ' · due' : ''}</span>
                  <div className="sn-level" aria-label={`Support level ${w.level}`}>
                    {[1, 2, 3].map((n) => <i key={n} className={n <= w.level ? 'on' : ''} />)}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {section.frames.length > 0 && (
        <>
          <SectionHead title="Frames" note="The frame stays, the word changes" />
          {section.frames.map((sf) => {
            const frame = frameById(file, sf.frame);
            if (!frame) return null;
            return (
              <div key={sf.frame} className="sn-frame">
                <div className="hrow between wrap">
                  <span className="thai-m" lang="th">{frame[me].thai}</span>
                  <span className="label">{frame.en}</span>
                </div>
                <span className="roman">{frame[me].roman}</span>
                {sf.words.length > 0 && (
                  <div className="sn-words">
                    {sf.words.map((w) => (
                      <span key={w.id}><span className="thai" lang="th">{w.word.thai}</span>{w.en}</span>
                    ))}
                  </div>
                )}
                {sf.todo && <p className="small" style={{ margin: 0 }}>{sf.todo}: your words still to come.</p>}
              </div>
            );
          })}
        </>
      )}
    </Screen>
  );
}
