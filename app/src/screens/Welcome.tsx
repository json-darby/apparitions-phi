// Opening and set-up: a full-screen face, then four questions.

import { useState } from 'react';
import { useApp } from '../app/context';
import { navigate } from '../app/router';
import { Apparition } from '../anim/Apparition';
import { addDays, localDate } from '../core/dates';
import { Label, Seg } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { useKeys } from '../input/keys';

export default function Welcome() {
  const { settings, updateSettings, reducedMotion } = useApp();
  const today = localDate(Date.now());
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState(settings.identity);
  const [minutes, setMinutes] = useState(settings.minutes);
  const [courseDays, setCourseDays] = useState(settings.courseDays);
  const [trip, setTrip] = useState(settings.tripDate ?? addDays(today, 30));
  const [noTrip, setNoTrip] = useState(false);
  const [adult, setAdult] = useState(settings.adult);

  const finish = () => {
    updateSettings({
      onboarded: true, identity, minutes, adult, courseDays,
      tripDate: noTrip ? null : trip,
      startDate: settings.onboarded ? settings.startDate : today,
    });
    // first run: the "How Thai works" primer comes before day 1
    navigate(settings.primerDone ? '/' : '/primer', true);
  };
  const next = () => (step < 4 ? setStep(step + 1) : finish());
  useKeys((a) => {
    if (a.type === 'confirm') {
      next();
      return true;
    }
  });

  const questions = [
    {
      label: 'Question 1 of 4',
      title: 'How do you speak?',
      body: 'Thai changes a few words by the speaker. You will hear both forms; this sets the ones you say.',
      control: (
        <Seg label="Speaking identity" value={identity} onChange={setIdentity} options={[{ v: 'm', label: 'Male forms' }, { v: 'f', label: 'Female forms' }]} />
      ),
      note: identity === 'm' ? 'You end polite sentences with ครับ khráp, and say ผม phǒm for I.' : 'You end polite sentences with ค่ะ khâ (คะ khá in questions), and say ฉัน chǎn for I.',
    },
    {
      label: 'Question 2 of 4',
      title: 'How long, and how far?',
      body: 'Sixty minutes a day gets you about 360 words and phrases in 30 days; thirty gets you about 170. The 60-day course keeps going: about 620 words, every vowel and tone mark written, and running text. You can change both later.',
      control: (
        <div className="stack gap-3">
          <Seg label="Daily minutes" value={minutes} onChange={setMinutes} options={[{ v: 60, label: '60 minutes' }, { v: 30, label: '30 minutes' }]} />
          <Seg label="Course length" value={courseDays} onChange={setCourseDays} options={[{ v: 30, label: '30 days' }, { v: 60, label: '60 days' }]} />
        </div>
      ),
    },
    {
      label: 'Question 3 of 4',
      title: 'When do you fly?',
      body: 'Nothing is scheduled past this date, and the words you need first are held stronger.',
      control: (
        <div className="stack gap-3" style={{ maxWidth: 320 }}>
          <input type="date" value={trip} min={today} disabled={noTrip} onChange={(e) => setTrip(e.target.value)} aria-label="Trip date" />
          <label className="hrow small">
            <input type="checkbox" checked={noTrip} onChange={(e) => setNoTrip(e.target.checked)} /> No date yet
          </label>
        </div>
      ),
    },
    {
      label: 'Question 4 of 4',
      title: 'Nightlife and 18+?',
      body: 'Bar talk, dating and the cannabis-shop scene. Non-explicit and consent-forward, all characters adults. Off keeps those scenes and words out.',
      control: <Seg label="18+ content" value={adult ? 'on' : 'off'} onChange={(v) => setAdult(v === 'on')} options={[{ v: 'off', label: 'Off' }, { v: 'on', label: 'On' }]} />,
    },
  ];

  return (
    <div className="screen" style={{ minHeight: '100dvh' }}>
      {step === 0 ? (
        <div className="stack" style={{ flex: 1, position: 'relative' }}>
          {/* the face fills the space above the words, never behind them */}
          <Apparition who="pim" mode={reducedMotion ? 'still' : 'gather'} colour="#E8E8E8" style={{ flex: '1 1 auto', minHeight: '38dvh', marginTop: 'env(safe-area-inset-top)' }} label="Pim, your guide, drawn in light" />
          <div className="stack gap-4 over-art" style={{ padding: '8px var(--gutter) calc(40px + env(safe-area-inset-bottom))', position: 'relative', maxWidth: 640 }}>
            <Label>Thai · a little every day</Label>
            <FitText as="h1" className="h-xl" min={26} style={{ fontSize: 'clamp(34px, 11vw, 96px)' }}>APPARITIONS: PHI</FitText>
            <p className="body" style={{ maxWidth: '42ch', margin: 0 }}>
              Thai from the street up. One street, eight people to talk to, a short session a day. Four questions first.
            </p>
            <p className="small" style={{ maxWidth: '44ch', margin: 0 }}>
              <span lang="th">ผี</span> <i>phǐi</i>, rising tone, is a spirit. Say it falling, <span lang="th">พี่</span> <i>phîi</i>, and it is an
              older brother or sister. That is tones in one word, and the first thing you will learn to hear.
            </p>
            <div>
              <button className="pill solid big" onClick={next}>Begin</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="stack gap-6 fade-in" key={step} style={{ flex: 1, padding: 'calc(28px + env(safe-area-inset-top)) var(--gutter) calc(32px + env(safe-area-inset-bottom))', maxWidth: 680, width: '100%', margin: '0 auto' }}>
          <div className="hrow between">
            <span className="logo">APPARITIONS: PHI</span>
            <Label>{questions[step - 1].label}</Label>
          </div>
          <div className="meter"><i style={{ width: `${(step / 4) * 100}%` }} /></div>
          {/* the same boxes for all four questions, sized for the longest: Next and Back never move */}
          <FitText as="h1" className="h-l" lines={2} min={22} valign="top" style={{ marginTop: 24 }}>{questions[step - 1].title}</FitText>
          <p className="body" style={{ margin: 0, maxWidth: '48ch', minHeight: 'calc(6 * 1.4em)' }}>{questions[step - 1].body}</p>
          <div style={{ minHeight: 100 }}>{questions[step - 1].control}</div>
          <FitText as="p" className="small" lines={2} min={10} valign="top">{questions[step - 1].note ?? ''}</FitText>
          <div className="hrow" style={{ marginTop: 'auto', paddingTop: 24 }}>
            <button className="pill" onClick={() => setStep(step - 1)}>Back</button>
            <button className="pill solid grow" onClick={next}>{step === 4 ? 'Start day 1' : 'Next'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
