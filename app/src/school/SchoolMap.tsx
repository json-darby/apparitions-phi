// School of the Night: the section map. All sections on one screen, grouped as
// Foundations, Everyday, Plans and Night (Night only with 18+ on). Nothing is
// locked. Each section shows how many of its lines you can say without help.
// Tick sections or single lines, then start: Build my session (your ticks),
// Pick for me (your weakest lines), or Start section from a section's list.
// Hold the mic and say a section's door phrase to open it at Branches (hidden
// offline). Your custom sections sit under "Mine", with the way to build one.
// Works offline; a lesson needs the live server.

import { useMemo, useState } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { Link } from '../app/router';
import { useLiveHealth } from '../live/LivePanel';
import { liveUsable } from '../live/client';
import { Label, Screen, SectionHead, Seg, TopBar } from '../ui/kit';
import { visibleGroups, visibleSections, type SchoolFile, type SchoolSection } from './content';
import { SCHOOL, TUTOR } from './names';
import { deletePreset, loadPrefs, loadPresets, loadTicks, loadWheels, MINUTES, savePrefs, savePreset, saveTicks, type Minutes, type SchoolPrefs } from './prefs';
import { lineDue, withoutHelp } from './reviews';
import { pickForMe, planSession, startSession } from './session';
import { useSchool } from './useSchool';
import { isCustomSection, MINE } from './custom';
import { customUsable } from './customApi';
import { DoorMic, doorMicUsable } from './DoorMic';
import './school.css';

export default function SchoolMap() {
  const file = useSchool();
  if (file === undefined) return <Screen top={<TopBar mid={SCHOOL.name} parent="/" />}><p className="small">Loading…</p></Screen>;
  if (!file) return <NoFile />;
  return <Map file={file} />;
}

export function NoFile() {
  return (
    <Screen top={<TopBar mid={SCHOOL.name} parent="/" />} narrow>
      <SchoolTitle />
      <p className="body" style={{ maxWidth: '52ch' }}>The lesson file could not be read. Open the app once while online so it is saved for offline use.</p>
    </Screen>
  );
}

/** The name, with its Thai underneath. */
export function SchoolTitle({ sub }: { sub?: string }) {
  return (
    <div>
      <Label className="sn-lead">{sub ?? `Spoken lessons · ${TUTOR.name}`}</Label>
      <div className="sn-name">
        <h1 className="h-l">{SCHOOL.name}</h1>
        <div className="thai-m" lang="th">{SCHOOL.thai}</div>
        <div className="roman">{SCHOOL.roman}</div>
      </div>
    </div>
  );
}

/** Tick state of a set of lines: all, some or none. */
export function tickState(ids: string[], ticks: Set<string>): 'true' | 'mixed' | 'false' {
  const n = ids.filter((id) => ticks.has(id)).length;
  return n === 0 ? 'false' : n === ids.length ? 'true' : 'mixed';
}

export function Tick({ state, onChange, label, disabled }: { state: 'true' | 'mixed' | 'false'; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className="sn-tick" role="checkbox" aria-checked={state} aria-label={label} onClick={onChange} disabled={disabled}>
      {state === 'true' && (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      )}
    </button>
  );
}

function Map({ file }: { file: SchoolFile }) {
  const { store, settings } = useApp();
  const v = useStoreVersion();
  const health = useLiveHealth();
  const online = liveUsable(health ?? null);
  const [prefs, setPrefs] = useState<SchoolPrefs>(() => loadPrefs(store));
  const [presetName, setPresetName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wheels = useMemo(() => loadWheels(store), [store, v]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ticks = useMemo(() => new Set(loadTicks(store)), [store, v]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const presets = useMemo(() => loadPresets(store), [store, v]);
  const sections = visibleSections(file, settings.adult);
  const visibleIds = new Set(sections.flatMap((s) => s.lines.map((l) => l.id)));
  const ticked = [...ticks].filter((id) => visibleIds.has(id));
  const now = Date.now();

  const setPref = (p: Partial<SchoolPrefs>) => setPrefs(savePrefs(store, p));
  const toggleSection = (s: SchoolSection) => {
    const ids = s.lines.map((l) => l.id);
    const all = tickState(ids, ticks) === 'true';
    saveTicks(store, all ? [...ticks].filter((id) => !ids.includes(id)) : [...ticks, ...ids]);
  };
  const base = { adult: settings.adult, identity: settings.identity, minutes: prefs.minutes };
  const go = (plan: ReturnType<typeof planSession>) => {
    if (!plan.lineIds.length) return setNote('Nothing to practise there yet.');
    startSession(store, plan);
  };
  const build = () => go(planSession(file, { ...base, title: 'Your session', lineIds: ticked, wheels }));

  return (
    <Screen top={<TopBar mid={SCHOOL.name} parent="/" />}>
      <SchoolTitle />
      <p className="body" style={{ maxWidth: '56ch', margin: '14px 0 0' }}>
        Your own lines, the replies you are likely to hear back, and frames you can fill with new words. {TUTOR.name} speaks Thai; the English sits on screen and fades as you get each line right.
      </p>

      <section className="card sn-setup" aria-label="Session">
        <div className="sn-field">
          <Label>Session length</Label>
          <Seg label="Session length" value={prefs.minutes} options={MINUTES.map((m) => ({ v: m, label: `${m} min` }))} onChange={(m) => setPref({ minutes: m as Minutes })} />
        </div>
        <div className="sn-field">
          <Label>They speak as</Label>
          <Seg label="They speak as" value={prefs.they} options={[{ v: 'f', label: 'Women' }, { v: 'm', label: 'Men' }, { v: 'mixed', label: 'Mixed' }]} onChange={(t) => setPref({ they: t })} />
        </div>
        <p className="small" style={{ margin: 0 }}>
          You speak as a {settings.identity === 'm' ? 'man (ครับ, ผม)' : 'woman (ค่ะ, ฉัน)'}. <Link to="/settings">Change in Settings</Link>.
        </p>
        <div className="sn-start">
          <button type="button" className="pill solid" disabled={!ticked.length} onClick={build}>
            Build my session{ticked.length ? ` · ${ticked.length}` : ''}
          </button>
          <button type="button" className="pill" onClick={() => go(pickForMe(file, store, base))}>Pick for me</button>
          <button type="button" className="pill" disabled={!ticked.length} onClick={() => saveTicks(store, [...ticks].filter((id) => !visibleIds.has(id)))}>Clear ticks</button>
        </div>
        {!online && (
          <p className="small" style={{ margin: 0 }} role="status">
            {health === undefined ? 'Checking the live server…' : 'Lessons need a connection to the live server (Settings → Talk live). The map, line lists and summaries work offline.'}
          </p>
        )}
        {note && <p className="small" style={{ margin: 0, color: 'var(--amber)' }} role="status">{note}</p>}
        {doorMicUsable(health) && <DoorMic file={file} />}
      </section>

      {visibleGroups(file, settings.adult).map((g) => (
        <section key={g.id}>
          <SectionHead title={g.title} note={g.adult ? '18+' : g.id === MINE ? 'Built for your situations' : undefined} />
          {sections.filter((s) => s.group === g.id).map((s) => {
            const ids = s.lines.map((l) => l.id);
            const due = s.lines.filter((l) => lineDue(store, l.id, now)).length;
            const right = !s.lines.length ? 'Lines coming' : `${withoutHelp(s, wheels)} of ${s.lines.length} without help${due ? ` · ${due} due` : ''}`;
            return (
              <div key={s.id} className={`sn-row sn-sec ${s.lines.length ? '' : 'empty'}`}>
                <Tick state={tickState(ids, ticks)} onChange={() => toggleSection(s)} label={`Tick ${s.title}`} disabled={!s.lines.length} />
                <Link to={`/school/section/${s.id}`} className="sn-title">
                  {isCustomSection(s) ? <span className="sn-n" aria-hidden><span className="sn-mine-dot" /></span> : <span className="sn-n">{s.n}</span>}
                  <span>{s.title}</span>
                </Link>
                <span className={`row-right ${s.lines.length && withoutHelp(s, wheels) === s.lines.length ? 'done' : ''}`}>{right}</span>
              </div>
            );
          })}
          {g.id === MINE && (
            <Link to="/school/custom" className="sn-row sn-new">
              <span className="sn-plus" aria-hidden>+</span>
              <span className="sn-row-main">Build a lesson for a situation</span>
              <span className="row-right">{customUsable(health) ? 'Describe it, check it, save it' : 'Needs a connection'}</span>
            </Link>
          )}
        </section>
      ))}

      <section>
        <SectionHead title="Presets" note="Saved sets of lines" />
        {!presets.length && <p className="small" style={{ margin: 0 }}>None yet. Tick some lines, name them, and save: “Night out”, “Tomorrow: market and taxi”.</p>}
        {presets.map((p) => {
          const n = p.lineIds.filter((id) => visibleIds.has(id)).length;
          return (
            <div key={p.id} className="sn-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
              <span className="sn-row-main">{p.name} <span className="small">· {n} line{n === 1 ? '' : 's'}</span></span>
              <button type="button" className="pill small" disabled={!n} onClick={() => go(planSession(file, { ...base, title: p.name, lineIds: p.lineIds, wheels }))}>Start</button>
              <button type="button" className="pill small" onClick={() => deletePreset(store, p.id)} aria-label={`Delete ${p.name}`}>Delete</button>
            </div>
          );
        })}
        <form
          className="sn-presets"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ticked.length) return;
            savePreset(store, presetName, ticked);
            setPresetName('');
          }}
        >
          <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name the ticked lines" aria-label="Preset name" maxLength={60} />
          <button type="submit" className="pill small" disabled={!ticked.length}>Save preset</button>
        </form>
      </section>
    </Screen>
  );
}
