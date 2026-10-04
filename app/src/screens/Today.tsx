// Today: the guided day (one "Next up" card with one button), then everything
// as a free menu in three sections, Learn, Drills and The Street.

import { useMemo } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { useDevice } from '../app/device';
import { Apparition } from '../anim/Apparition';
import { addDays, localDate } from '../core/dates';
import { DRILLS, STREET, checkpointDays, dayBlocks, spineFor, type ChapterId, type Unlock } from '../path/pathway';
import { addMark, dayGuide, guideLine, marksOn, type Guide } from '../path/guide';
import { useForecast } from '../engine/useForecast';
import { statusLine } from './Readiness';
import { Label, Row, SectionHead, TopBar } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { Link } from '../app/router';
import { chapterReady, streetProgress } from '../street/state';
import { clipsPlayable } from '../audio/AudioSound';
import { downloadSave, lastSave, shareSave, canShareFiles } from '../db/saveDevice';
import { saveDue } from '../db/saveFile';
import { savedAgo } from './settings/SaveFiles';
import { lessonFor } from '../content/lessons';
import { promptInstall, useInstall } from '../app/install';

export default function Today() {
  const { engine, settings, store, content, reducedMotion } = useApp();
  const v = useStoreVersion();
  const { device } = useDevice();
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

  const locked = (u: Unlock) => day < u.day || (u.adult && !settings.adult);
  const lockText = (u: Unlock) => (u.adult && !settings.adult ? '18+ off' : `Day ${u.day}`);

  const learn = (
    <section>
      <SectionHead title="Learn" note="No games. This is the daily core." />
      <Row to="/review" right={plan.reviews.length ? `${plan.reviews.length} due` : 'Clear'} done={!plan.reviews.length}>Review</Row>
      <Row to="/new" right={plan.newRefs.length ? `${plan.newRefs.length} new` : 'Done'} done={!plan.newRefs.length}>New items</Row>
      <Row to="/listen" right={`${Math.round(blocks[1].minutes / 2)} min`} done={blockDone('new')}>Listen and repeat</Row>
      <Row to="/tone-pairs" right="Your ear" done={blockDone('tonelab')}>Tone lab</Row>
      <Row to="/sentence" right="Patterns">Sentence builder</Row>
      <Row to="/writing" right="Letters" done={blockDone('writing')}>Writing studio</Row>
      {culture && <Row to="/culture" right={culture.title}>Culture note</Row>}
      {isCheckpoint && <Row to="/checkpoint" right={day === lastDay ? 'Final' : day === 30 ? 'Midpoint' : `Day ${day}`}>Checkpoint</Row>}
      {day < lastDay && <Row to={`/new?peek=${day + 1}`} right={`Day ${day + 1}`}>Sneak peek</Row>}
      <Row to="/library" right="Replay anything">Library</Row>
    </section>
  );
  const drills = (
    <section>
      <SectionHead title="Drills" note="Fast rounds, 3 to 5 minutes." />
      {desktopNoDrills ? (
        <p className="small">Drills are set to phone and tablet only.</p>
      ) : (
        DRILLS.map((d) => (
          <Row key={d.id} to={locked(d) ? undefined : `/drill/${d.id}`} disabled={locked(d)} right={locked(d) ? lockText(d) : d.tag}>
            {d.title}
          </Row>
        ))
      )}
    </section>
  );
  const streetSection = (
    <section>
      <SectionHead title="The Street" note="One street, your character, people to talk to." />
      {STREET.map((s) => {
        if (s.id === 'street') {
          const right = street.total === 0 ? 'No task yet' : street.done >= street.total ? 'All done' : `Task ${street.done + 1} of ${street.total}`;
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
      <Row to="/cast" right="8 people">Cast</Row>
    </section>
  );

  return (
    <div className="screen">
      <div className="hero" style={{ minHeight: device === 'phone' ? 230 : 260 }}>
        <div className="hero-art" aria-hidden>
          <Apparition who="pim" mode={reducedMotion ? 'still' : 'idle'} colour="#E8E8E8" clarity={0.9} style={device === 'phone' ? { position: 'absolute', right: '-16%', top: 24, width: '74%', height: 'calc(100% - 24px)' } : { position: 'absolute', right: '-6%', top: 0, width: '62%', height: '100%' }} />
        </div>
        {/* phone and tablet reach Progress from the tab bar */}
        <TopBar right={device === 'desktop' ? <Link to="/progress" className="label" style={{ textDecoration: 'none' }}>Progress</Link> : undefined} />
        <div style={{ paddingTop: device === 'phone' ? 8 : 24 }}>
          <Label>
            Day {Math.min(day, lastDay)} / {lastDay} · {minsToday} of {settings.minutes} min
            {engine.daysToTrip() != null ? ` · ${engine.daysToTrip()} days to the trip` : ''}
          </Label>
          <h1 className="h-xl" style={{ marginTop: 10 }}>Today</h1>
          <p className="body" style={{ margin: '14px 0 0', maxWidth: '52ch' }}>
            {spine.focus}. <span className="mut">{spine.situation}.</span>
          </p>
        </div>
      </div>
      <div className="stage">
        <NextUp guide={guide} minutes={minsToday} peekDay={day < lastDay ? day + 1 : null} onSkip={(id) => addMark(store, today, `skip:${id}`)} />
        {!clipsPlayable() && (
          <p className="card small" role="status" style={{ margin: '4px 0 16px' }}>
            This device cannot play the app’s recordings, so the Thai shows as text only. Update to iOS or iPadOS 18.4 or
            later (or open the app in a current Chrome, Edge or Firefox) to hear every word.
          </p>
        )}
        <InstallCard />
        <SaveReminder day={day} />
        {forecast && (
          <Link to="/readiness" className="card" style={{ display: 'block', textDecoration: 'none', margin: '4px 0 16px' }}>
            <div className="hrow between">
              <span className="label" style={{ color: forecast.status === 'behind' ? 'var(--bad)' : forecast.status === 'at-risk' ? 'var(--amber)' : 'var(--good)' }}>
                {forecast.status === 'ahead' ? 'Ahead' : forecast.status === 'on-track' ? 'On track' : forecast.status === 'at-risk' ? 'At risk' : 'Behind'}
              </span>
              <span className="label">Readiness</span>
            </div>
            <p className="small" style={{ margin: '6px 0 0', color: 'var(--fg-2)' }}>
              {statusLine(forecast)}
              {forecast.fix ? ` ${forecast.fix.lever.label}.` : ''}
            </p>
          </Link>
        )}
        {(plan.newCut > 0 || plan.deferred > 0 || leeches > 0) && (
          <div className="stack gap-1" style={{ marginBottom: 8 }}>
            {plan.newCut > 0 && (
              <p className="small" style={{ margin: 0 }}>
                Reviews are heavy today, so {plan.newCut} new item{plan.newCut === 1 ? ' is' : 's are'} held back until they clear.
              </p>
            )}
            {plan.deferred > 0 && <p className="small" style={{ margin: 0 }}>{plan.deferred} of the least urgent reviews move to tomorrow.</p>}
            {leeches > 0 && <p className="small" style={{ margin: 0 }}>{leeches} item{leeches === 1 ? ' needs' : 's need'} a new memory hook. It comes up in Review.</p>}
          </div>
        )}
        <Label className="everything">Everything</Label>
        <div className="cols three">
          {learn}
          {drills}
          {streetSection}
        </div>
      </div>
    </div>
  );
}

/** The one thing to do next, with the day's steps as dots. A step can be skipped for today. */
function NextUp({ guide, minutes, peekDay, onSkip }: { guide: Guide; minutes: number; peekDay: number | null; onSkip: (id: string) => void }) {
  const next = guide.next;
  return (
    // one card size for every step and for the end of the day: the title is one line,
    // the note two, the buttons one row; longer words get smaller type, never a taller card
    <section className="card nextup" aria-label={next ? `Next up: ${guideLine(guide)}` : 'Today is done'}>
      <div className="nextup-top">
        <FitText className="label fg num" min={8}>{next ? `Next up · Step ${guide.at} of ${guide.steps.length}` : 'Today'}</FitText>
        <ol className="step-dots" aria-hidden>
          {guide.steps.map((s, i) => (
            <li key={s.id} className={s.done ? 'done' : i + 1 === guide.at ? 'now' : ''} title={s.title} />
          ))}
        </ol>
      </div>
      {next ? (
        <>
          <FitText as="h2" className="h-m" min={16}>{next.title}</FitText>
          <FitText as="p" className="body" lines={2} min={11} valign="top">{next.note}</FitText>
          <div className="nextup-btns">
            <Link to={next.to} className="pill solid big">Start</Link>
            {next.id !== 'primer' && (
              <button type="button" className="pill small" onClick={() => onSkip(next.id)}>Skip for today</button>
            )}
          </div>
        </>
      ) : (
        <>
          <FitText as="h2" className="h-m" min={16}>Today is done</FitText>
          <FitText as="p" className="body" lines={2} min={11} valign="top">
            {`${minutes} minute${minutes === 1 ? '' : 's'} studied. Anything below is extra; tomorrow brings the next day.`}
            {peekDay != null ? ' A sneak peek changes nothing: tomorrow’s words still come as new tomorrow.' : ''}
          </FitText>
          <div className="nextup-btns">
            {peekDay != null && <Link to={`/new?peek=${peekDay}`} className="pill big">Sneak peek at tomorrow</Link>}
          </div>
        </>
      )}
    </section>
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
