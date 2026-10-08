// The step shell: one frame for the four set-up questions and the "How Thai
// works" primer. Logo and "Step N of 5", the segmented rail, an art band (Pim,
// or the primer's tone lines), the page, and Back and Next.
// The shell is one screen tall, whatever the screen:
// - a phone: the art is a band above the words, 176 px when there is room and
//   shrinking first when there is not; Back and Next across the foot;
// - a tablet or desktop: the art fills the left half, the words sit on the right;
// - a short, wide screen (a phone on its side): the art steps aside, the page
//   flows over two columns, and Back and Next stand at the right edge, by the thumb.
// Full screen sits at the top right of every page.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { isShortWide, useDevice } from '../app/device';
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
  const { device, w, h } = useDevice();
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [page]);
  const wide = isShortWide(w, h);
  const split = !wide && device !== 'phone';
  useFitToScreen(shell, () => {
    const box = main.current;
    if (!box) return 0;
    // on its side the page is two columns: what runs past them makes a third, off to the right
    if (wide) {
      const cols = box.querySelector<HTMLElement>('.steps-body > *');
      return cols ? Math.max(cols.scrollWidth - cols.clientWidth, cols.scrollHeight - cols.clientHeight) : 0;
    }
    return stackOverflow(box);
  }, page, wide);
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
    <div ref={shell} className={`steps ${split ? 'split' : ''} ${wide ? 'wide' : ''} ${className}`}>
      {split && artBox}
      <div className="steps-main" ref={main}>
        {head}
        <div className="steps-rail">
          <StepSegments n={rail.n} at={rail.at} part={rail.part} label={rail.label} plain={rail.plain} />
        </div>
        {!split && !wide && artBox}
        <div className="steps-body">{children}</div>
        <div className="steps-foot">{foot}</div>
      </div>
    </div>
  );
}

/** How far a page may close up to fit the screen: 0 as designed, then spacing, boxes, the art, and last the type. */
const FIT_LEVELS = 4;

/**
 * How far a column of parts runs past its box, from layout heights alone: the
 * parts stacked up (with their margins and the column's gaps and padding)
 * against the space they have. A fade-in's slide or a pinned foot do not count,
 * so a page that fits is never mistaken for one that does not.
 */
export function stackOverflow(box: HTMLElement): number {
  const bs = getComputedStyle(box);
  let used = parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom);
  let shown = 0;
  for (const el of Array.from(box.children) as HTMLElement[]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
    // the parts themselves are never transformed (a fade-in is inside them, or on the box), so their boxes are their layout
    used += el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    shown++;
  }
  const gap = parseFloat(bs.rowGap) || 0;
  if (shown > 1) used += gap * (shown - 1);
  return used - box.getBoundingClientRect().height;
}

/**
 * Fits a screen to the window, whatever its size: the layout and the clamp()s
 * in the CSS do most of it; when the page still runs over, this steps up
 * data-fit on the shell one level at a time, smallest change first, until it
 * fits (steps.css says what each level does). If even the last level cannot
 * fit, data-scroll lets the page scroll, with Back and Next still in place.
 * Measured on every page, on every resize, when the fonts arrive and when the
 * page's own words change size, so a big screen keeps the full design and only
 * a small one closes up. Fitting starts from 0 each time and lands on the same
 * level for the same page, so it settles at once.
 */
export function useFitToScreen(shell: { current: HTMLElement | null }, measure: () => number, page: unknown, mode?: unknown) {
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useLayoutEffect(() => {
    const fit = () => {
      const el = shell.current;
      if (!el) return;
      delete el.dataset.scroll;
      for (let level = 0; level <= FIT_LEVELS; level++) {
        el.dataset.fit = String(level);
        // half a pixel is rounding, not a page that runs over
        if (measureRef.current() <= 0.5) return;
      }
      el.dataset.scroll = '1';
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
    // so can the page itself (a longer note, an answer shown)
    const words = shell.current?.querySelector('.steps-body > *, .welcome-body');
    const ro = typeof ResizeObserver !== 'undefined' && words ? new ResizeObserver(later) : null;
    if (ro && words) ro.observe(words);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', later);
      ro?.disconnect();
    };
  }, [shell, page, mode]);
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
