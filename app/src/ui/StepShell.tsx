// The step shell: one frame for the four set-up questions and the "How Thai
// works" primer. Logo and "Step N of 5", the segmented rail, an art band (Pim,
// or the primer's tone lines), the page, and Back and Next fixed at the foot.
// The shell is one screen tall. On a phone the art is a band above the words,
// 176 px when there is room and shrinking first when there is not; on a tablet
// or desktop it fills the left half and the words sit on the right. Full screen
// sits at the top right of every page.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useDevice } from '../app/device';
import { FullscreenButton, StepSegments } from './kit';
import './steps.css';

export function StepShell({
  step, rail, art, artCaption, headRight, children, foot, page, className = '',
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
  /** changes with the page shown, so a new page starts at the top */
  page?: string | number;
  className?: string;
}) {
  const { device } = useDevice();
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [page]);
  useFitToScreen(shell, main, page);
  const split = device !== 'phone';
  const head = (
    <header className="steps-head">
      <span className="logo" aria-label="APPARITIONS: PHI">APPARITIONS: PHI</span>
      <span className="steps-head-right">
        {step != null && <span className="label">{step}</span>}
        {headRight}
        <FullscreenButton />
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
    <div ref={shell} className={`steps ${split ? 'split' : ''} ${className}`}>
      {split && artBox}
      <div className="steps-main" ref={main}>
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

/** How far a page may close up to fit the screen: 0 as designed, then spacing, boxes, the art, and last the type. */
const FIT_LEVELS = 4;


/**
 * How far the page runs past the screen, from layout heights alone: the parts
 * of the page stacked up against the space they have. A fade-in's slide or the
 * pinned foot do not count, so a page that fits is never mistaken for one that does not.
 */
function overflow(box: HTMLElement): number {
  let used = 0;
  for (const el of Array.from(box.children) as HTMLElement[]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'absolute') continue;
    // the parts themselves are never transformed (the fade-in is inside the page), so their boxes are their layout
    used += el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  }
  return used - box.getBoundingClientRect().height;
}

/**
 * Fits each page to the screen, whatever its size: the art band and the
 * clamp()s in steps.css do most of it; when a page still overflows, the shell
 * steps up data-fit (steps.css) one level at a time, smallest change first,
 * until it fits. Measured on every page and on every resize, so a big screen
 * keeps the full design and only a small one closes up.
 */
function useFitToScreen(shell: { current: HTMLElement | null }, main: { current: HTMLElement | null }, page: unknown) {
  useLayoutEffect(() => {
    const fit = () => {
      const el = shell.current;
      const box = main.current;
      if (!el || !box) return;
      for (let level = 0; level <= FIT_LEVELS; level++) {
        el.dataset.fit = String(level);
        // half a pixel is rounding, not a page that runs over
        if (overflow(box) <= 0.5) break;
      }
    };
    fit();
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    window.addEventListener('resize', later);
    // the fonts arriving can change a page's height
    void document.fonts?.ready.then(later);
    // so can the page itself (a longer note, an answer shown): fit again when its words change size.
    // Fitting starts from 0 each time and lands on the same level for the same page, so this settles at once.
    const words = main.current?.querySelector('.steps-body')?.firstElementChild;
    const ro = typeof ResizeObserver !== 'undefined' && words ? new ResizeObserver(later) : null;
    if (ro && words) ro.observe(words);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', later);
      ro?.disconnect();
    };
  }, [shell, main, page]);
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
