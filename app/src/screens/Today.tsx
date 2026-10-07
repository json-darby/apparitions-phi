// Today: Pim and the day's focus, one "Next up" card with one button, then
// everything as a free menu: Learn, then The Street and Drills (beside it in
// the panel on a tablet or desktop).

import { useMemo } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { useDevice } from '../app/device';
import { Apparition } from '../anim/Apparition';
import { addDays, localDate } from '../core/dates';
import { DRILLS, STREET, checkpointDays, dayBlocks, spineFor, type ChapterId, type Unlock } from '../path/pathway';
import { addMark, dayGuide, guideLine, marksOn, type Guide } from '../path/guide';
import { useForecast } from '../engine/useForecast';
import type { Forecast } from '../engine/forecast';
import { Label, ListHead, Row, TopBar } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { Link, navigate } from '../app/router';
import { chapterReady, streetProgress } from '../street/state';
import { clipsPlayable } from '../audio/AudioSound';
import { downloadSave, lastSave, shareSave, canShareFiles } from '../db/saveDevice';
import { saveDue } from '../db/saveFile';
import { savedAgo } from './settings/SaveFiles';
import { lessonFor } from '../content/lessons';
import { promptInstall, useInstall } from '../app/install';
import { SCHOOL } from '../school/names';
import { schoolDueCount } from '../school/reviews';
import { PLACE_COLOURS } from '../content/types';
import { useKeys } from '../input/keys';
import './today.css';

const STATUS_WORD = { ahead: 'Ahead', 'on-track': 'On track', 'at-risk': 'At risk', behind: 'Behind' } as const;
const STATUS_TONE = { ahead: 'var(--good)', 'on-track': 'var(--good)', 'at-risk': 'var(--amber)', behind: 'var(--bad)' } as const;

/** Readiness in a line: when you reach the bar, and the change that helps most. */
function readyLine(f: Forecast): string {
  const m = f.daysMargin;
  const reach = m == null ? 'Not within a month of the trip at this pace.' : m > 0 ? `Ready ${m} day${m === 1 ? '' : 's'} early.` : m === 0 ? 'Ready just in time.' : `Ready ${-m} day${m === -1 ? '' : 's'} late.`;
  return f.fix ? `${reach} ${f.fix.lever.label}.` : reach;
}

export default function Today() {
  const { engine, settings, store, content, reducedMotion } = useApp();
  const v = useStoreVersion();
  const { device, w } = useDevice();
  const day = engine.day();
  const spine = spineFor(day, settings.courseDays);
  const { forecast } = useForecast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => engine.planDay(), [v, settings]);
  const today = localDate(Date.now());
  const act = store.activity().find((a) => a.date === today);
  const minsToday = Math.round((act?.ms ?? 0) / 60_000);
  const blocks = dayBlocks(settings.minutes);
  const blockMinutes = (id: string) => blocks.find((b) => b.id === id)?.minutes ?? 99;
  const blockSpent = (id: string) => (act?.blocks[id] ?? 0) / 60_000;
  const blockDone = (id: string) => blockSpent(id) >= blockMinutes(id) * 0.8;
  const leeches = engine.leeches().length;
  const culture = content.cultureForDay(day);
  const street = streetProgress(store, day, settings.adult);
  const isCheckpoint = checkpointDays(settings.courseDays).includes(day);
  const lastDay = settings.courseDays;
  const desktopNoDrills = device === 'desktop' && !settings.desktopDrills;
  const toTrip = engine.daysToTrip();

  // the guided day, from what this screen already knows
  const guide = useMemo<Guide>(() => {
    const block = (id: 'tonelab' | 'writing') => ({ done: blockDone(id), minutes: blockMinutes(id), spent: blockSpent(id) });
    const patternMet = !!store.one("SELECT 1 AS n FROM cards WHERE ref LIKE 'pattern:%' LIMIT 1");
    const checkpoints = store.get<Record<string, { score: number; date: string }>>('checkpoints', {});
    return dayGuide({
      day,
      primerDone: settings.primerDone,
      lesson: lessonFor(Math.min(day, lastDay))?.title ?? null,
      reviews: plan.reviews.length,
      fresh: plan.newRefs.length,
      patterns: patternMet || plan.newRefs.some((r) => r.startsWith('pattern:')),
      tone: block('tonelab'),
      writing: block('writing'),
      street: { left: street.total - street.done, today: street.today, next: street.next?.title ?? null },
      culture: culture?.day === day ? culture.title : null,
      checkpoint: isCheckpoint ? { done: Object.values(checkpoints).some((c) => c.date === today) } : null,
      marks: marksOn(store, today),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, settings, plan, day]);

  // a keyboard starts the next step with Enter
  useKeys((a) => {
    if (a.type === 'confirm' && guide.next) {
      navigate(guide.next.to);
      return true;
    }
  }, device === 'desktop');

  const locked = (u: Unlock) => day < u.day || (u.adult && !settings.adult);
  const lockText = (u: Unlock) => (u.adult && !settings.adult ? '18+ off' : `Day ${u.day}`);

  const learn = (
    <section className="today-learn">
      <ListHead title="Learn" note="The daily core" />
      <div className="today-learn-rows">
        <Row ticks to="/review" right={plan.reviews.length ? `${plan.reviews.length} due` : 'Clear'} done={!plan.reviews.length}>Review</Row>
        <Row ticks to="/new" right={plan.newRefs.length ? `${plan.newRefs.length} new` : 'Done'} done={!plan.newRefs.length}>New items</Row>
        <Row ticks to="/listen" right={`${Math.round(blocks[1].minutes / 2)} min`} done={blockDone('new')}>Listen and repeat</Row>
        <Row ticks to="/tone-pairs" right="Your ear" done={blockDone('tonelab')}>Tone lab</Row>
        <Row ticks to="/sentence" right="Patterns">Sentence builder</Row>
        <Row ticks to="/writing" right="Letters" done={blockDone('writing')}>Writing studio</Row>
        {culture && <Row ticks to="/culture" right={culture.title}>Culture note</Row>}
        {isCheckpoint && <Row ticks to="/checkpoint" right={day === lastDay ? 'Final' : day === 30 ? 'Midpoint' : `Day ${day}`}>Checkpoint</Row>}
        {day < lastDay && <Row ticks to={`/new?peek=${day + 1}`} right={`Day ${day + 1}`}>Sneak peek</Row>}
        <Row ticks to="/library" right="Replay anything">Library</Row>
      </div>
    </section>
  );
  const drills = (
    <section>
      <ListHead title="Drills" note="3 to 5 min" />
      {desktopNoDrills ? (
        <p className="small" style={{ margin: 0, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>Drills are set to phone and tablet only.</p>
      ) : (
        DRILLS.map((d) => (
          <Row key={d.id} to={locked(d) ? undefined : `/drill/${d.id}`} disabled={locked(d)} right={locked(d) ? lockText(d) : d.tag}>
            {d.title}
          </Row>
        ))
      )}
      <div className="rows-end" />
    </section>
  );
  const nextTask = street.next;
  const streetSection = (
    <section>
      <ListHead
        title="The Street"
        note={street.total === 0 ? 'No task yet' : street.done >= street.total ? 'All done' : `Task ${street.done + 1} of ${street.total}`}
      />
      {/* the next street task, in its place's colour */}
      {nextTask && (
        <Link to="/street" className="today-task">
          <span className="today-task-title">
            <i style={{ background: PLACE_COLOURS[nextTask.place], boxShadow: `0 0 10px ${PLACE_COLOURS[nextTask.place]}` }} aria-hidden="true" />
            <span>{nextTask.title}</span>
          </span>
          <span className="small">
            {content.places.find((p) => p.id === nextTask.place)?.name ?? 'The street'}, with {content.person(nextTask.person)?.name ?? nextTask.person}
          </span>
        </Link>
      )}
      {STREET.map((s) => {
        if (s.id === 'street') {
          const right = street.total === 0 ? 'No task yet' : street.done >= street.total ? 'All done' : device === 'desktop' ? 'A D to walk' : 'Walk';
          return <Row key={s.id} to="/street" right={right} done={street.total > 0 && street.done >= street.total}>{s.title}</Row>;
        }
        // a chapter with no part in this course is not ready yet
        const ready = chapterReady(s.id as ChapterId, content);
        const off = locked(s) || !ready;
        const right = locked(s) ? lockText(s) : ready ? s.tag : 'Not ready yet';
        return (
          <Row key={s.id} to={off ? undefined : `/street/${s.id}`} disabled={off} right={right}>
            {s.title}
          </Row>
        );
      })}
      <Row to="/cast" right="9 people">Cast</Row>
      <SchoolRow />
      <div className="rows-end" />
    </section>
  );

  const wide = device !== 'phone';
  // Drills and The Street sit beside the day in a panel once there is room (an upright tablet keeps one column)
  const side = device === 'desktop' || (wide && w >= 1000);
  const label = [
    `Day ${Math.min(day, lastDay)} of ${lastDay}`,
    toTrip != null ? `${toTrip} day${toTrip === 1 ? '' : 's'} to the trip` : `${Math.max(0, lastDay - day)} days to go`,
    ...(wide ? [`${minsToday} of ${settings.minutes} min`] : []),
  ].join(' · ');

  return (
    <div className={`screen today ${wide ? 'wide' : ''}`}>
      <div className={`screen-body ${side ? 'has-panel' : ''}`}>
        <div className="stage today-stage">
          <div className="today-hero">
            <div className="today-art" aria-hidden>
              <Apparition who="pim" mode={reducedMotion ? 'still' : 'idle'} colour="#E8E8E8" clarity={0.9} style={{ position: 'absolute', inset: 0 }} />
            </div>
            {/* the desktop rail carries the name; phone and tablet show it here */}
            {device !== 'desktop' ? <TopBar /> : <div className="today-top" />}
            <div className="today-head">
              <Label className="today-label">{label}</Label>
              <h1 className="h-xl">Today</h1>
              <p className="body today-focus">
                {spine.focus}. <span className="mut">{spine.situation}.</span>
              </p>
            </div>
          </div>
          <NextUp guide={guide} minutes={minsToday} budget={settings.minutes} wide={wide} keyed={device === 'desktop'} peekDay={day < lastDay ? day + 1 : null} onSkip={(id) => addMark(store, today, `skip:${id}`)} />
          {!clipsPlayable() && (
            <p className="card small" role="status" style={{ margin: '0 0 16px' }}>
              This device cannot play the app’s recordings, so the Thai shows as text only. Update to iOS or iPadOS 18.4 or
              later (or open the app in a current Chrome, Edge or Firefox) to hear every word.
            </p>
          )}
          <InstallCard />
          <SaveReminder day={day} />
          {forecast && (
            <Link to="/readiness" className="today-ready">
              <span className="label">Readiness</span>
              <span className="today-ready-word" style={{ color: STATUS_TONE[forecast.status] }}>{STATUS_WORD[forecast.status]}</span>
              <FitText as="span" className="small" min={10}>{readyLine(forecast)}</FitText>
            </Link>
          )}
          {(plan.newCut > 0 || plan.deferred > 0 || leeches > 0) && (
            <div className="stack gap-1" style={{ marginBottom: 16 }}>
              {plan.newCut > 0 && (
                <p className="small" style={{ margin: 0 }}>
                  Reviews are heavy today, so {plan.newCut} new item{plan.newCut === 1 ? ' is' : 's are'} held back until they clear.
                </p>
              )}
              {plan.deferred > 0 && <p className="small" style={{ margin: 0 }}>{plan.deferred} of the least urgent reviews move to tomorrow.</p>}
              {leeches > 0 && <p className="small" style={{ margin: 0 }}>{leeches} item{leeches === 1 ? ' needs' : 's need'} a new memory hook. It comes up in Review.</p>}
            </div>
          )}
          {learn}
          {!side && (
            <div className={wide ? 'today-more' : 'today-more one'}>
              {streetSection}
              {drills}
            </div>
          )}
        </div>
        {side && (
          <aside className="panel today-panel">
            {device === 'desktop' ? streetSection : drills}
            {device === 'desktop' ? drills : streetSection}
          </aside>
        )}
      </div>
    </div>
  );
}

/** The one thing to do next, with the day's steps as a rail. A step can be skipped for today. */
function NextUp({ guide, minutes, budget, wide, keyed, peekDay, onSkip }: { guide: Guide; minutes: number; budget: number; wide: boolean; keyed: boolean; peekDay: number | null; onSkip: (id: string) => void }) {
  const next = guide.next;
  const rail = (
    <ol className="steprail nextup-rail" aria-hidden>
      {guide.steps.map((s, i) => (
        <li key={s.id} className={s.done ? 'done' : i + 1 === guide.at && next ? 'now' : ''} title={s.title} />
      ))}
    </ol>
  );
  return (
    // one card size for every step and for the end of the day: the title is one line,
    // the note one, the buttons one row; longer words get smaller type, never a taller card
    <section className={`card nextup ${wide ? 'wide' : ''}`} aria-label={next ? `Next up: ${guideLine(guide)}` : 'Today is done'}>
      <div className="nextup-text">
        <div className="nextup-top">
          <FitText className="label num" min={8}>{next ? `Next up · ${guide.at} of ${guide.steps.length}` : 'Today'}</FitText>
          {!wide && <span className="small num">{minutes} of {budget} min</span>}
        </div>
        {!wide && rail}
        {next ? (
          <>
            <div className="nextup-title">
              <FitText as="h2" className="h-m" min={16}>{next.title}</FitText>
              {/* a phone keeps Start full width: Skip sits by the title */}
              {!wide && next.id !== 'primer' && (
                <button type="button" className="pill text small" onClick={() => onSkip(next.id)}>Skip</button>
              )}
            </div>
            <FitText as="p" className="small nextup-note" min={10}>{next.note}</FitText>
          </>
        ) : (
          <>
            <FitText as="h2" className="h-m" min={16}>Today is done</FitText>
            <FitText as="p" className="small nextup-note" lines={2} min={10} valign="top">
              {`${minutes} minute${minutes === 1 ? '' : 's'} studied. Anything below is extra; tomorrow brings the next day.`}
              {peekDay != null ? ' A sneak peek changes nothing: tomorrow’s words still come as new tomorrow.' : ''}
            </FitText>
          </>
        )}
        {wide && rail}
      </div>
      <div className="nextup-btns">
        {next ? (
          <>
            <Link to={next.to} className="pill solid big nextup-go">
              Start{keyed && <span className="kbd dark">Enter</span>}
            </Link>
            {wide && next.id !== 'primer' && (
              <button type="button" className="pill text" onClick={() => onSkip(next.id)}>Skip for today</button>
            )}
          </>
        ) : (
          peekDay != null && <Link to={`/new?peek=${peekDay}`} className="pill big nextup-go">Sneak peek at tomorrow</Link>
        )}
      </div>
    </section>
  );
}

/** School of the Night: its name with the Thai underneath, and line cards due. */
function SchoolRow() {
  const { store } = useApp();
  useStoreVersion();
  const due = schoolDueCount(store);
  return (
    <Row to="/school" right={due ? `${due} due` : 'Spoken lessons'}>
      <span style={{ display: 'block' }}>{SCHOOL.name}</span>
      <span className="small thai" lang="th" style={{ display: 'block' }}>{SCHOOL.thai}</span>
    </Row>
  );
}

/** After a week without a save file (once there is something worth keeping), one line and one button. */
function SaveReminder({ day }: { day: number }) {
  const { store } = useApp();
  useStoreVersion();
  const today = localDate(Date.now());
  const last = lastSave(store);
  const studied = store.activity().filter((a) => a.ms > 0).length;
  if (!saveDue(last, today, studied)) return null;
  const ago = savedAgo(last, today);
  const save = () => void (canShareFiles() ? shareSave(store, day) : downloadSave(store, day));
  return (
    <section className="card" style={{ margin: '4px 0 16px' }} aria-label="Save your progress">
      <div className="hrow between wrap" style={{ gap: 10 }}>
        <p className="small" style={{ margin: 0, color: 'var(--fg-2)', maxWidth: '46ch' }}>
          {ago ? `Your last save file was ${ago}.` : 'Your progress lives only on this device.'} A save file keeps a copy you can load anywhere.
        </p>
        <button type="button" className="pill small" onClick={save}>Save a file</button>
      </div>
    </section>
  );
}

/**
 * The browser's install offer, as one line and one button (taking the offer
 * hides the browser's own banner, so this is where it lives). "Not now" hides
 * it for two weeks.
 */
function InstallCard() {
  const { store } = useApp();
  useStoreVersion();
  const st = useInstall();
  const today = localDate(Date.now());
  const until = store.get<string | null>('install_hidden_until', null);
  if (st !== 'ready' || (until && until > today)) return null;
  return (
    <section className="card" style={{ margin: '4px 0 16px' }} aria-label="Install the app">
      <div className="hrow between wrap" style={{ gap: 10 }}>
        <p className="small" style={{ margin: 0, color: 'var(--fg-2)', maxWidth: '46ch' }}>
          Put APPARITIONS: PHI on your home screen: full screen, no address bar, and it works offline.
        </p>
        <span className="hrow" style={{ gap: 8 }}>
          <button type="button" className="pill small" onClick={() => store.set('install_hidden_until', addDays(today, 14))}>Not now</button>
          <button type="button" className="pill small solid" onClick={() => void promptInstall()}>Install</button>
        </span>
      </div>
    </section>
  );
}
