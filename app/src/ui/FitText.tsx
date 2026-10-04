// Text that fits its box. The box keeps one size (its width from its parent,
// its height a set number of lines at the full size); the text inside steps
// down from that full size to `min` until it fits, wrapping onto more lines at
// smaller sizes where that reads better than one squeezed line. Moving from a
// short word to a long phrase changes the type size, never the box.
//
// The full size is the box's own CSS font size (its class: thai-xl, h-l ...),
// so clamp() and the device classes keep working. Measured before paint
// (useLayoutEffect, so no flicker) and again when the box is resized or a web
// font arrives. The box never depends on the text's size, so a fit cannot
// trigger another: no loops.

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { fitSize, sameFit, type FitKey } from './fit';

export interface FitTextProps {
  children: ReactNode;
  /** smallest font size in px (default 12) */
  min?: number;
  /** largest font size in px; default the box's own computed font size */
  max?: number;
  /** the box is this many lines tall at the full size (default 1); 0 = the parent sets the height */
  lines?: number;
  /** where a shorter text sits in the box (default centre) */
  valign?: 'top' | 'center' | 'bottom';
  as?: 'div' | 'span' | 'h1' | 'h2' | 'p' | 'b';
  className?: string;
  style?: CSSProperties;
  lang?: string;
  id?: string;
  title?: string;
}

/** Fonts that arrive after the first fit change the measures: refit every box then. */
const boxes = new Set<() => void>();
let fontsHooked = false;
function hookFonts() {
  if (fontsHooked || typeof document === 'undefined' || !document.fonts) return;
  fontsHooked = true;
  const all = () => boxes.forEach((f) => f());
  document.fonts.addEventListener?.('loadingdone', all);
  void document.fonts.ready.then(all);
}

export function FitText({ children, min = 12, max, lines = 1, valign = 'center', as: Tag = 'div', className = '', style, lang, id, title }: FitTextProps) {
  const box = useRef<HTMLElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const last = useRef<FitKey | null>(null);

  const fit = (force = false) => {
    const b = box.current;
    const t = inner.current;
    if (!b || !t) return;
    const w = b.clientWidth;
    const h = b.clientHeight;
    if (!w || !h) return; // not laid out (hidden): the observer calls again when it shows
    const cs = getComputedStyle(b);
    const top = max ?? parseFloat(cs.fontSize);
    const key: FitKey = { text: t.textContent ?? '', w, h, max: top, min };
    if (!force && sameFit(last.current, key)) return;
    // measure in the box's own fixed height
    b.classList.remove('fit-grow');
    t.classList.remove('fit-break');
    const availH = b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + 0.5;
    const fits = (px: number) => {
      t.style.fontSize = `${px}px`;
      return t.scrollWidth <= t.clientWidth + 0.5 && t.offsetHeight <= availH;
    };
    const r = fitSize(fits, top, min);
    t.style.fontSize = `${r.size}px`;
    // even the smallest size is too big: long words break, and the box grows rather than
    // letting the text run over what is below it or off the screen (sized boxes make this rare)
    if (!r.fits) {
      t.classList.add('fit-break');
      if (lines > 0) b.classList.add('fit-grow');
    }
    last.current = { ...key, w: b.clientWidth, h: b.clientHeight };
  };

  // every render: cheap when nothing changed (sameFit), a new text refits before paint
  useLayoutEffect(() => {
    fit();
  });

  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const refit = () => fit(true);
    boxes.add(refit);
    hookFonts();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit());
      ro.observe(b);
    }
    return () => {
      boxes.delete(refit);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s: CSSProperties = lines > 0 ? { ['--fit-lines' as string]: lines, ...style } : style ?? {};
  return (
    <Tag ref={box as never} className={`fit fit-${valign} ${lines > 0 ? '' : 'fit-fill'} ${className}`} style={s} lang={lang} id={id} title={title}>
      <span ref={inner} className="fit-in">
        {children}
      </span>
    </Tag>
  );
}
