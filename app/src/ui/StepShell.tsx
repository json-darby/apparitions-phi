// The step shell: one frame for the four set-up questions and the "How Thai
// works" primer. Logo and "Step N of 5", the segmented rail, an art band (Pim,
// or the primer's tone lines), the page, and Back and Next fixed at the foot.
// On a phone the art is a 176 px band above the words; on a tablet or desktop
// it fills the left half and the words sit on the right.

import type { ReactNode } from 'react';
import { useDevice } from '../app/device';
import { StepSegments } from './kit';
import './steps.css';

export function StepShell({
  step, rail, art, artCaption, headRight, children, foot, className = '',
}: {
  /** "Step 2 of 5"; null when the primer is opened again (its pages name themselves) */
  step: ReactNode;
  rail: { n: number; at: number; part?: number; label?: string; plain?: boolean };
  art: ReactNode;
  /** under the art, tablet and desktop only */
  artCaption?: ReactNode;
  headRight?: ReactNode;
  children: ReactNode;
  foot: ReactNode;
  className?: string;
}) {
  const { device } = useDevice();
  const split = device !== 'phone';
  const head = (
    <header className="steps-head">
      <span className="logo" aria-label="APPARITIONS: PHI">APPARITIONS: PHI</span>
      <span className="steps-head-right">
        {step != null && <span className="label">{step}</span>}
        {headRight}
      </span>
    </header>
  );
  const artBox = (
    <div className="steps-art" aria-hidden={split ? undefined : true}>
      {art}
      {split && artCaption && <div className="steps-art-caption">{artCaption}</div>}
    </div>
  );
  return (
    <div className={`steps ${split ? 'split' : ''} ${className}`}>
      {split && artBox}
      <div className="steps-main">
        {head}
        <div className="steps-rail">
          <StepSegments n={rail.n} at={rail.at} part={rail.part} label={rail.label} plain={rail.plain} />
        </div>
        {!split && artBox}
        <div className="steps-body">{children}</div>
        <div className="steps-foot">{foot}</div>
      </div>
    </div>
  );
}

/** The primer's art: the five tone lines, the one in hand brighter. */
export function ToneLines({ on }: { on?: number }) {
  const paths = [
    'M8 66 C 40 66, 50 64, 62 64',
    'M78 82 C 100 88, 115 96, 132 104',
    'M148 46 C 165 34, 178 50, 202 108',
    'M218 48 C 238 40, 255 30, 272 18',
    'M288 90 C 305 104, 318 96, 342 24',
  ];
  const cx = on == null ? null : [35, 105, 175, 245, 315][on];
  return (
    <svg className="tone-lines" viewBox="0 0 350 132" fill="none" strokeLinecap="round" aria-hidden="true">
      <path d="M0 33H350M0 66H350M0 99H350" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      {cx != null && <circle cx={cx} cy="70" r="40" fill="rgba(242,242,242,0.05)" />}
      {paths.map((d, i) => (
        <path key={d} d={d} stroke={i === on ? '#f2f2f2' : '#c9c9c9'} strokeWidth={i === on ? 3.5 : 2.5} />
      ))}
    </svg>
  );
}
