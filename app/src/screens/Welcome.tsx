// Opening and set-up: Pim gathering out of light, then four questions in the
// step shell the primer shares (the primer is step 5 on a first run).

import { useRef, useState } from 'react';
import { useApp } from '../app/context';
import { isShortWide, useDevice } from '../app/device';
import { navigate } from '../app/router';
import { Apparition } from '../anim/Apparition';
import { addDays, daysBetween, localDate } from '../core/dates';
import { planWords } from '../path/pathway';
import { FullscreenButton, Label, OptionCards } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { StepShell, stackOverflow, useFitToScreen } from '../ui/StepShell';
import { useKeys } from '../input/keys';
import '../ui/steps.css';

/** Pim comes clearer with every answer. */
const CLARITY = [0.6, 0.72, 0.86, 1];

function fmt(date: string, weekday = false) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { ...(weekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short' }).replace(',', '');
}

/** Pim's box in the art: the right of the band on a phone, the whole left half on a tablet (steps.css sizes it). */
const FACE = { position: 'absolute', top: 0, right: 0, width: 'var(--face-w, 56%)', height: '100%' } as const;

export default function Welcome() {
  const { settings, updateSettings, reducedMotion } = useApp();
  const { device, w, h } = useDevice();
  const today = localDate(Date.now());
  const wide = isShortWide(w, h);
  const split = !wide && device !== 'phone';
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState(settings.identity);
  const [minutes, setMinutes] = useState(settings.minutes);
  const [courseDays, setCourseDays] = useState(settings.courseDays);
  const [trip, setTrip] = useState(settings.tripDate ?? addDays(today, 30));
  const [noTrip, setNoTrip] = useState(false);
  const [adult, setAdult] = useState(settings.adult);
  // the opening fits the screen the way the step pages do
  const opening = useRef<HTMLDivElement>(null);
  useFitToScreen(opening, () => {
    const el = opening.current;
    const body = el?.querySelector<HTMLElement>('.welcome-body');
    if (!el || !body) return 0;
    if (wide) return body.scrollHeight - body.clientHeight;
    return split ? stackOverflow(body) : stackOverflow(el);
  }, step, `${wide}${split}`);
  // the primer is the fifth step on a first run; set-up opened again from Settings is four
  const total = settings.primerDone ? 4 : 5;

  const finish = () => {
    updateSettings({
      onboarded: true, identity, minutes, adult, courseDays,
      tripDate: noTrip ? null : trip,
      // set-up opened again from Settings (onboarded is false by then, the primer long done) keeps day 1 where it was
      startDate: settings.onboarded || settings.primerDone ? settings.startDate : today,
    });
    // first run: the "How Thai works" primer comes before day 1
    navigate(settings.primerDone ? '/' : '/primer', true);
  };
  const next = () => (step < 4 ? setStep(step + 1) : finish());
  const back = () => step > 0 && setStep(step - 1);
  useKeys((a) => {
    if (a.type === 'confirm') {
      next();
      return true;
    }
    if (a.type === 'back' && step > 0) {
      back();
      return true;
    }
  });

  if (step === 0) {
    return (
      <div ref={opening} className={`welcome ${split ? 'split' : ''} ${wide ? 'wide' : ''}`}>
        <span className="welcome-fs"><FullscreenButton /></span>
        {/* the face fills the space above the words (beside them on a tablet), never behind them */}
        <div className="welcome-art">
          <Apparition who="pim" mode={reducedMotion ? 'still' : 'gather'} colour="#E8E8E8" style={{ position: 'absolute', inset: 0 }} label="Pim, your guide, gathering out of light" />
        </div>
        <div className="welcome-body fade-in">
          <Label>Apparitions · Thai, a little every day</Label>
          <div className="welcome-name">
            <h1>Phi</h1>
            <span className="thai" lang="th">ผี</span>
          </div>
          <p className="body" style={{ margin: 0, maxWidth: '42ch' }}>
            Thai from the street up. One street, eight people to talk to, a short session a day.
          </p>
          {/* tones in one word: the first thing you learn to hear */}
          <div className="tone-hook" role="group" aria-label="One sound, two tones">
            <div>
              <svg width="34" height="24" viewBox="0 0 34 24" fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 16 C 10 20, 18 18, 32 3" /></svg>
              <span>
                <b><span className="thai" lang="th">ผี</span> phǐi</b>
                <span className="small">rising · spirit</span>
              </span>
            </div>
            <div>
              <svg width="34" height="24" viewBox="0 0 34 24" fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 8 C 12 2, 20 6, 32 21" /></svg>
              <span>
                <b><span className="thai" lang="th">พี่</span> phîi</b>
                <span className="small">falling · older sibling</span>
              </span>
            </div>
          </div>
          {/* Begin sits where Next does on the pages after it */}
          <div className="welcome-go">
            <span className="small">{settings.primerDone ? 'Four questions' : 'Four questions, then five minutes on how Thai works'}</span>
            <button type="button" className="pill solid big wide" onClick={next}>Begin</button>
          </div>
        </div>
      </div>
    );
  }

  const start = settings.onboarded || settings.primerDone ? settings.startDate : today;
  const courseEnd = addDays(start, courseDays - 1);
  const words = planWords(courseDays, minutes);

  const questions = [
    {
      title: 'How do you speak?',
      body: 'Thai changes a few words by who is speaking. This sets the ones you say. You will hear both.',
      control: (
        <>
          <OptionCards
            label="Speaking identity"
            value={identity}
            onChange={setIdentity}
            options={[
              { v: 'm', title: 'Male forms', sub: <>End polite sentences with <span className="thai fg2" lang="th">ครับ</span> khráp</> },
              { v: 'f', title: 'Female forms', sub: <>End polite sentences with <span className="thai fg2" lang="th">ค่ะ</span> khâ</> },
            ]}
          />
          <div className="step-facts">
            <div>
              <Label>You say “I”</Label>
              <span style={{ fontSize: 15 }}>
                <span className="thai" lang="th" style={{ fontSize: 20 }}>{identity === 'm' ? 'ผม' : 'ฉัน'}</span> {identity === 'm' ? 'phǒm' : 'chǎn'}
              </span>
            </div>
            <div>
              <Label>Change later</Label>
              <span style={{ fontSize: 15, color: 'var(--fg-2)' }}>Settings · You</span>
            </div>
          </div>
        </>
      ),
    },
    {
      title: 'How long, and how far?',
      body: 'Both change later. Progress stays when you do.',
      control: (
        <>
          <div className="stack gap-2">
            <Label>Each day</Label>
            <OptionCards
              big
              label="Daily minutes"
              value={minutes}
              onChange={setMinutes}
              options={[
                { v: 60, title: <>60<small> min</small></>, sub: `About ${planWords(courseDays, 60)} words` },
                { v: 30, title: <>30<small> min</small></>, sub: `About ${planWords(courseDays, 30)} words` },
              ]}
            />
          </div>
          <div className="stack gap-2">
            <Label>Course</Label>
            <OptionCards
              big
              label="Course length"
              value={courseDays}
              onChange={setCourseDays}
              options={[
                { v: 30, title: <>30<small> days</small></>, sub: 'Speak and get by' },
                { v: 60, title: <>60<small> days</small></>, sub: minutes === 60 ? `About ${planWords(60, 60)}, and reading` : `About ${planWords(60, 30)} words` },
              ]}
            />
          </div>
          <div className="step-total">
            <span className="small">By day {courseDays}</span>
            <b>≈ {words} words and phrases</b>
          </div>
        </>
      ),
    },
    {
      title: 'When do you fly?',
      body: 'Nothing is scheduled past this date, and the words you need first are held stronger.',
      control: <TripPicker today={today} trip={trip} setTrip={setTrip} noTrip={noTrip} setNoTrip={setNoTrip} courseEnd={courseEnd} courseDays={courseDays} start={start} wide={device !== 'phone'} />,
    },
    {
      title: 'Nightlife and 18+?',
      body: 'Bar talk, dating and the cannabis-shop scene. Non-explicit and consent-forward. Every character is an adult.',
      control: (
        <>
          <OptionCards
            label="18+ content"
            value={adult ? 'on' : 'off'}
            onChange={(v) => setAdult(v === 'on')}
            options={[
              { v: 'off', title: 'Off', sub: 'Those scenes and words stay out' },
              { v: 'on', title: 'On', sub: 'Adds After Hours, with Fah and Bank', glow: 'var(--pink)' },
            ]}
          />
          <p className="small step-note">Change it any time in Settings, under Content.</p>
        </>
      ),
    },
  ];
  const q = questions[step - 1];

  return (
    <StepShell
      step={`Step ${step} of ${total}`}
      rail={{ n: total, at: step, plain: true, label: `Step ${step} of ${total}` }}
      page={step}
      art={<Apparition who="pim" mode={reducedMotion ? 'still' : 'idle'} colour="#E8E8E8" clarity={CLARITY[step - 1]} style={FACE} label="Pim, your guide" />}
      artCaption={
        <>
          <Label>Pim · your guide</Label>
          <span className="small">Clearer with every answer</span>
        </>
      }
      foot={
        <div className="steps-btns">
          <button type="button" className="pill big" onClick={back}>Back</button>
          <button type="button" className="pill solid big" onClick={next}>
            {step < 4 ? 'Next' : settings.primerDone ? 'Done' : 'On to how Thai works'}
          </button>
        </div>
      }
    >
      <div key={step} className="stack fade-in" style={{ gap: 'inherit' }}>
        {/* the same title box on every question: the words below never jump */}
        <FitText as="h1" className="h-l steps-title" lines={2} min={22} valign="top">{q.title}</FitText>
        <p className="body">{q.body}</p>
        {q.control}
      </div>
    </StepShell>
  );
}

function TripPicker({
  today, trip, setTrip, noTrip, setNoTrip, courseEnd, courseDays, start, wide,
}: { today: string; trip: string; setTrip: (d: string) => void; noTrip: boolean; setNoTrip: (v: boolean) => void; courseEnd: string; courseDays: number; start: string; wide: boolean }) {
  // Today, the course's last day and the flight on one line, to scale
  const last = noTrip ? courseEnd : trip > courseEnd ? trip : courseEnd;
  const span = Math.max(1, daysBetween(today, last));
  const at = (d: string) => `${Math.max(0, Math.min(1, daysBetween(today, d) / span)) * 100}%`;
  const spare = daysBetween(courseEnd, trip);
  const marks = [
    { k: 'today', d: today, text: `Today · ${fmt(today)}` },
    { k: 'end', d: courseEnd, text: `Day ${courseDays} · ${fmt(courseEnd)}` },
    ...(noTrip ? [] : [{ k: 'fly', d: trip, text: wide ? `Fly · ${fmt(trip)}` : 'Fly' }]),
  ].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.k === 'fly' ? 1 : -1));
  const flyDay = daysBetween(start, trip) + 1;
  const note = noTrip
    ? `Readiness measures against day ${courseDays} until you set a date.`
    : spare > 0
      ? `${courseDays} days of course, ${spare === 1 ? 'one' : spare} spare. You land knowing it.`
      : spare === 0
        ? `You fly on day ${courseDays}, the course’s last day.`
        : `You fly on day ${Math.max(1, flyDay)}, before the course ends. The words you need first come first.`;
  return (
    <>
      <label className="date-field">
        <span className="label">Trip date</span>
        <span className={`date-box ${noTrip ? 'off' : ''}`}>
          <span className="v">{fmt(trip, true)}</span>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--fg-2)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
          <input
            type="date"
            value={trip}
            min={today}
            disabled={noTrip}
            aria-label="Trip date"
            onChange={(e) => e.target.value && setTrip(e.target.value)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // a browser without showPicker opens its own picker
              }
            }}
          />
        </span>
      </label>
      <div className="trip-line" aria-hidden="true">
        <div className="trip-track">
          {marks.map((m) => <i key={m.k} className={m.k} style={{ left: `calc(6px + (100% - 12px) * ${parseFloat(at(m.d)) / 100})` }} />)}
        </div>
        <div className="trip-labels">
          {marks.map((m) => <span key={m.k} className={m.k}>{m.text}</span>)}
        </div>
      </div>
      <p className="small" style={{ margin: 0 }}>{note}</p>
      <label className="check-line">
        <input type="checkbox" checked={noTrip} onChange={(e) => setNoTrip(e.target.checked)} /> No date yet
      </label>
    </>
  );
}
