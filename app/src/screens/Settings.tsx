// Settings: speaking identity, daily minutes, trip date, 18+, motion,
// romanisation, desktop drills. Plus backup, reset and the 30-day simulator.

import { useEffect, useState, type ReactNode } from 'react';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { useApp } from '../app/context';
import { Link } from '../app/router';
import { SaveFiles } from './settings/SaveFiles';
import { ResetProgress } from './settings/ResetProgress';
import { formatSim, simulate } from '../engine/simulator';
import { planWords } from '../path/pathway';
import { Label, Screen, SectionHead, Seg, Toggle, TopBar } from '../ui/kit';
import { fullscreenSupported, isStandalone } from '../app/fullscreen';
import { SoundSettings } from '../audio/SoundSettings';
import { LiveSettings } from '../live/LiveSettings';
import { FACE_COLOURS, faceColourLabel } from '../anim/tint';
import { promptInstall, useInstall } from '../app/install';

function Line({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="row line" style={{ cursor: 'default' }}>
      {/* on a phone a wide control drops below its words instead of squeezing them */}
      <span className="line-text">
        <span>{title}</span>
        {note && <span className="small">{note}</span>}
      </span>
      <span className="line-control">{children}</span>
    </div>
  );
}

function fmtDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** A date as plain words and a chevron, over the browser's own date picker. */
function DateValue({ value, onChange, label, empty = 'Not set' }: { value: string | null; onChange: (v: string) => void; label: string; empty?: string }) {
  return (
    <span className="date-value">
      <span>{value ? fmtDate(value) : empty}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      <input
        type="date"
        value={value ?? ''}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // a browser without showPicker opens its own picker
          }
        }}
      />
    </span>
  );
}

interface Credit {
  what?: string;
  creator?: string;
  license?: string;
  licensed?: boolean;
  source_url?: string;
  ai_generated?: boolean;
  changes?: string;
}

/** Image credits for the packs, read from packs/credits.json at runtime. */
function ImageCredits() {
  const [list, setList] = useState<Credit[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    let on = true;
    fetch(`${import.meta.env.BASE_URL}packs/credits.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { images?: Credit[]; note?: string; people_note?: string } | null) => {
        if (!on) return;
        setList(Array.isArray(j?.images) ? j.images : []);
        setNotes([j?.note, j?.people_note].filter((x): x is string => typeof x === 'string' && x.length > 0));
      })
      .catch(() => on && setList([]));
    return () => {
      on = false;
    };
  }, []);
  if (!list || list.length === 0) return null;
  return (
    <details>
      <summary style={{ cursor: 'pointer' }}>Image credits ({list.length})</summary>
      <div className="stack gap-2" style={{ marginTop: 8 }}>
        {(notes.length ? notes : ['All images are AI-generated for this app.']).map((n) => (
          <p key={n} style={{ margin: 0 }}>{n}</p>
        ))}
        {list.map((c, i) => (
          <p key={i} style={{ margin: 0, overflowWrap: 'anywhere' }}>
            {c.what ?? 'Image'}
            {c.ai_generated ? ' (AI-generated)' : ''} · {c.creator || 'unknown author'} · {c.license || 'licence unknown'}
            {c.licensed === false ? ' (not licensed for this use)' : ''}
            {c.changes ? ` · ${c.changes}` : ''}
            {c.source_url ? <span style={{ display: 'block', opacity: 0.7 }}>{c.source_url}</span> : null}
          </p>
        ))}
      </div>
    </details>
  );
}

/** Install as an app: a button where the browser offers it, otherwise how to do it by hand. */
function InstallLine() {
  const st = useInstall();
  const note =
    st === 'installed'
      ? 'Installed. It opens full screen from your home screen and works offline.'
      : st === 'ready'
        ? 'Puts it on your home screen. It opens full screen, with no address bar, and works offline.'
        : st === 'ios'
          ? 'In Safari: the Share button, then Add to Home Screen. Open it from the new icon: full screen, and it works offline.'
          : 'In Chrome or Edge: the menu (⋮), then Add to Home screen or Install app. It then opens full screen and works offline.';
  return (
    <Line title="Install as an app" note={note}>
      {st === 'ready' && <button className="pill small" onClick={() => void promptInstall()}>Install</button>}
    </Line>
  );
}

export default function Settings() {
  const { settings: s, updateSettings: set } = useApp();
  const [sim, setSim] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runSim = async (track: 30 | 60) => {
    setBusy(true);
    setSim(null);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const r = await simulate({ days: 30, track, seed: 11 }, undefined, SQL);
    const over = r.days.filter((d) => d.plannedReviewMin > d.capacityMin + 1e-9 || d.actualMin > d.budgetMin * 1.1).length;
    setSim(`${formatSim(r)}\n\n${over === 0 ? 'Every day inside budget.' : `${over} day(s) over budget.`}`);
    setBusy(false);
  };

  return (
    <Screen top={<TopBar mid="Settings" parent="/" />} narrow className="settings">
      <div className="page-head" style={{ marginBottom: 20 }}>
        <h1 className="h-page">Settings</h1>
      </div>

      <SectionHead title="You" />
      <Line title="Speaking" note="You hear both">
        <Seg label="Speaking identity" value={s.identity} onChange={(v) => set({ identity: v })} options={[{ v: 'm', label: 'Male' }, { v: 'f', label: 'Female' }]} />
      </Line>
      <Line title="Daily minutes">
        <Seg label="Daily minutes" value={s.minutes} onChange={(v) => set({ minutes: v })} options={[{ v: 60, label: '60' }, { v: 30, label: '30' }]} />
      </Line>
      <Line title="Course length" note={`Sixty goes further: about ${planWords(60, s.minutes)} words${s.minutes === 60 ? ' and reading' : ''}. Progress stays if you switch.`}>
        <Seg label="Course length" value={s.courseDays} onChange={(v) => set({ courseDays: v })} options={[{ v: 30, label: '30 d' }, { v: 60, label: '60 d' }]} />
      </Line>
      <Line title="Trip date" note="Nothing is scheduled past it">
        <DateValue label="Trip date" value={s.tripDate} onChange={(v) => set({ tripDate: v || null })} />
      </Line>
      <Line title="Day 1 was" note="Moves you along the course">
        <DateValue label="Start date" value={s.startDate} onChange={(v) => v && set({ startDate: v })} />
      </Line>
      <Line title="Name in The Street">
        <input type="text" className="line-input" value={s.name} placeholder="You" onChange={(e) => set({ name: e.target.value })} aria-label="Name" />
      </Line>

      <SoundSettings />
      <LiveSettings />

      <SectionHead title="Content" />
      <Line title="18+ content" note="After Hours and nightlife words, non-explicit">
        <Toggle label="18+ content" on={s.adult} onChange={(v) => set({ adult: v })} />
      </Line>
      <Line title="Fading romanisation" note="Fades as each word gets stronger. Tap to see it">
        <Toggle label="Fading romanisation" on={s.romanFade} onChange={(v) => set({ romanFade: v })} />
      </Line>
      <Line title="Review ratings" note="Simple is three buttons: didn’t know, hard, knew it. Auto keeps it simple for your first 14 days, then shows all six.">
        <Seg label="Review ratings" value={s.ratings ?? 'auto'} onChange={(v) => set({ ratings: v })} options={[{ v: 'auto', label: 'Auto' }, { v: 'simple', label: 'Simple' }, { v: 'detailed', label: 'Detailed' }]} />
      </Line>
      <Line title="Drills on desktop" note="Off keeps desktop to Learn and The Street.">
        <Toggle label="Drills on desktop" on={s.desktopDrills} onChange={(v) => set({ desktopDrills: v })} />
      </Line>
      <InstallLine />
      <Line
        title="Full screen"
        note={
          fullscreenSupported()
            ? 'Hides the address bar. The button in the top bar (or the side rail) turns it on and off; Esc also leaves. With this on, the app goes full screen on your first tap each time it opens.'
            : isStandalone()
              ? 'Already open as an installed app, with no address bar.'
              : 'This browser cannot hide its address bar for a page. On iPhone and iPad: Share, then Add to Home Screen, and open it from there. On Android: the menu, then Add to Home screen or Install app.'
        }
      >
        {fullscreenSupported() && !isStandalone() && <Toggle label="Open full screen" on={s.fullscreen} onChange={(v) => set({ fullscreen: v })} />}
      </Line>
      <div className="row line" style={{ cursor: 'default' }}>
        <span className="line-text">
          <span>Face colour</span>
          <span className="small">{faceColourLabel(s.faceColour ?? 'own')} · or double-tap any face</span>
        </span>
        <div className="swatches line-control" role="group" aria-label="Face colour">
          {FACE_COLOURS.map((c) => (
            <button key={c.id} type="button" className="swatch" aria-pressed={(s.faceColour ?? 'own') === c.id} aria-label={c.label} title={c.label} onClick={() => set({ faceColour: c.id })}>
              <i className={c.hex ? undefined : 'own'} style={c.hex ? { background: c.hex } : undefined} />
            </button>
          ))}
        </div>
      </div>
      <Line title="Reduced motion" note="Shows still dotted images instead of animation.">
        <Seg label="Reduced motion" value={s.reducedMotion} onChange={(v) => set({ reducedMotion: v })} options={[{ v: 'auto', label: 'Auto' }, { v: 'on', label: 'On' }, { v: 'off', label: 'Off' }]} />
      </Line>

      <SectionHead title="Your progress" note="Kept on this device" />
      <SaveFiles />
      <ResetProgress />
      <Line title="Set-up questions again">
        <button className="pill small" onClick={() => { set({ onboarded: false }); }}>Open</button>
      </Line>

      <SectionHead title="Checks" />
      <Line title="30-day simulator" note="Runs 30 synthetic days of reviews through the real engine.">
        <span className="hrow">
          <button className="pill small" disabled={busy} onClick={() => void runSim(60)}>60 min</button>
          <button className="pill small" disabled={busy} onClick={() => void runSim(30)}>30 min</button>
        </span>
      </Line>
      {busy && <p className="small">Running…</p>}
      {sim && (
        <pre className="card" style={{ fontSize: 11, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre', marginTop: 12 }}>
          {sim}
        </pre>
      )}
      <Line title="Animation catalogue" note="Every animation placement, for checking on this device.">
        <Link to="/anim" className="pill small" style={{ textDecoration: 'none' }}>Open</Link>
      </Line>

      <SectionHead title="About" />
      <div className="stack gap-3 small" style={{ paddingBottom: 40 }}>
        <p style={{ margin: 0 }}>
          The Thai text and audio are made and checked by machine: rule checks on spelling, tones and taught words, a
          second AI model, and every clip transcribed back. No native speaker has reviewed them yet, and the letter stroke
          orders are drafts.
        </p>
        <p style={{ margin: 0 }}>All people shown are AI-generated or drawn in code. No real person is depicted.</p>
        <ImageCredits />
        <Label>APPARITIONS: PHI · build {__BUILD__}</Label>
      </div>
    </Screen>
  );
}
