// Shared parts: top bar, screen frame, labels, rows, meters, stats, pills,
// rating bar, Thai text with fading romanisation, sheets.

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { useDevice } from '../app/device';
import { Link, back, useRoute } from '../app/router';
import { TAB_ROUTES } from '../app/Nav';
import { fullscreenSupported, isStandalone, toggleFullscreen, useFullscreen } from '../app/fullscreen';
import { SIMPLE_RATINGS, Six, SIX_LABELS } from '../engine/grade';
import { useKeys } from '../input/keys';
import { FitText } from './FitText';

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="APPARITIONS: PHI, home">
      APPARITIONS: PHI
    </Link>
  );
}

/** Full screen on and off: hides the browser's address bar. Not shown where it cannot work (iPhone Safari, installed app). */
export function FullscreenButton({ wide }: { wide?: boolean }) {
  const on = useFullscreen();
  if (!fullscreenSupported() || isStandalone()) return null;
  const label = on ? 'Exit full screen' : 'Full screen';
  return (
    <button className={wide ? 'fs-btn wide' : 'fs-btn'} onClick={() => void toggleFullscreen()} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width={wide ? 18 : 16} height={wide ? 18 : 16} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={wide ? 1.8 : 1.6} strokeLinecap="round" strokeLinejoin="round">
        {on ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
      {wide && <span>{label}</span>}
    </button>
  );
}

export function TopBar({ mid, parent, right, hideLogo }: { mid?: ReactNode; parent?: string; right?: ReactNode; hideLogo?: boolean }) {
  const { device } = useDevice();
  const { path } = useRoute();
  // a main screen on a phone or tablet: the tab bar is the way back, so no Back pill
  const tabbed = device !== 'desktop' && parent === '/' && TAB_ROUTES.includes(path);
  return (
    <header className="topbar">
      {device !== 'desktop' && !hideLogo ? <Logo /> : <span />}
      {mid && <div className="mid label fg">{mid}</div>}
      <div className="right">
        {right}
        {device !== 'desktop' && <FullscreenButton />}
        {parent != null && !tabbed && (
          <button className="pill small" onClick={() => back(parent)}>
            Back
          </button>
        )}
      </div>
    </header>
  );
}

/** A screen: top bar, a stage and an optional side panel (right on tablet and desktop, below on phone). */
export function Screen({
  top, panel, children, full, narrow, className = '',
}: { top?: ReactNode; panel?: ReactNode; children: ReactNode; full?: boolean; narrow?: boolean; className?: string }) {
  return (
    <div className={`screen ${full ? 'full' : ''} ${className}`}>
      {top}
      <div className={`screen-body ${panel ? 'has-panel' : ''}`}>
        <div className={`stage ${narrow ? 'narrow' : ''}`}>{children}</div>
        {panel && <aside className="panel">{panel}</aside>}
      </div>
    </div>
  );
}

export function Label({ children, fg, className = '' }: { children: ReactNode; fg?: boolean; className?: string }) {
  return <div className={`label ${fg ? 'fg' : ''} ${className}`}>{children}</div>;
}

export function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="section-head">
      <h2 className="h-m">{title}</h2>
      {note && <span className="small">{note}</span>}
    </div>
  );
}

/** A label on the left and a note on the right, over a list of rows. */
export function ListHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="list-head">
      <h2 className="label">{title}</h2>
      {note != null && <span className="small">{note}</span>}
    </div>
  );
}

const TICK = (
  <svg className="row-tick" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/**
 * A row: title on the left, meta on the right. In a list with ticks (`ticks`),
 * a done row is muted with a green tick and every title keeps the tick's room;
 * otherwise `done` turns the right-hand note green.
 */
export function Row({
  children, right, onClick, to, disabled, done, ticks,
}: { children: ReactNode; right?: ReactNode; onClick?: () => void; to?: string; disabled?: boolean; done?: boolean; ticks?: boolean }) {
  const inner = (
    <>
      {ticks ? (
        <span className="row-title">
          {done ? TICK : <span className="row-tick" aria-hidden="true" />}
          <span>{children}</span>
          {done && <span className="sr-only">, done</span>}
        </span>
      ) : (
        <span>{children}</span>
      )}
      <span className={`row-right ${done && !ticks ? 'done' : ''}`}>{right}</span>
    </>
  );
  const cls = `row ${ticks && done ? 'is-done' : ''}`;
  if (to && !disabled)
    return (
      <Link to={to} className={cls} style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    );
  return (
    <button className={cls} onClick={onClick} disabled={disabled} type="button">
      {inner}
    </button>
  );
}

export function Meter({ value, colour }: { value: number; colour?: string }) {
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: colour }} />
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      {/* "Just now" and "12 days" share one box: the value shrinks, the column does not */}
      <FitText className="v num" min={11}>{value}</FitText>
    </div>
  );
}

export function Dots({ n, of }: { n: number; of: number }) {
  return (
    <span className="dots" aria-label={`${n} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          aria-pressed={o.v === value}
          onClick={() => onChange(o.v)}
          type="button"
          // when the options scroll sideways (a phone), the chosen one stays in view
          ref={o.v === value ? (el) => { if (el && el.parentElement && el.parentElement.scrollWidth > el.parentElement.clientWidth) el.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function KeyHints({ hints }: { hints: [string, string][] }) {
  return (
    <div className="keyhints">
      {hints.map(([k, v]) => (
        <span key={k + v}>
          <span className="kbd">{k}</span>
          {v}
        </span>
      ))}
    </div>
  );
}

export function Sheet({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  useKeys((a) => {
    if (a.type === 'back') {
      onClose();
      return true;
    }
  });
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="placeholder-note">{children}</div>;
}

/** The segmented step rail: one segment a step, done, now and to come. `part` (0..1) fills the current segment that far. */
export function StepSegments({ n, at, part, label, plain }: { n: number; at: number; part?: number; label?: string; plain?: boolean }) {
  return (
    <ol className="steprail" aria-label={label ?? `Step ${Math.min(at + 1, n)} of ${n}`}>
      {Array.from({ length: n }, (_, i) => {
        // plain: no "now" shade, only done and to come (the set-up steps count the one in hand as done)
        const cls = i < at ? 'done' : i === at && !plain ? 'now' : '';
        const style = i === at && part != null && part > 0
          ? { background: `linear-gradient(90deg, var(--fg) ${Math.round(part * 100)}%, var(--rule) ${Math.round(part * 100)}%)` }
          : undefined;
        return <li key={i} className={cls} style={style} />;
      })}
    </ol>
  );
}

/**
 * Option cards: a choice as radio cards with a dot (or, `big`, a large value
 * and a note in a two-column grid). Arrow keys move the choice, as in any radio group.
 */
export function OptionCards<T extends string | number>({
  value, options, onChange, label, big,
}: { value: T; options: { v: T; title: ReactNode; sub?: ReactNode; glow?: string }[]; onChange: (v: T) => void; label: string; big?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const j = (i + d + options.length) % options.length;
    onChange(options[j].v);
    refs.current[j]?.focus();
  };
  return (
    <div className={`opts ${big ? 'two' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.v === value;
        return (
          <button
            key={String(o.v)}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`opt ${big ? 'big' : ''}`}
            onClick={() => onChange(o.v)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {big ? (
              <>
                <span className="opt-title">{o.title}</span>
                {o.sub && <span className="opt-sub">{o.sub}</span>}
              </>
            ) : (
              <>
                <span className="opt-dot" aria-hidden="true" />
                <span className="opt-text">
                  <span className="opt-title">{o.title}</span>
                  {o.sub && <span className="opt-sub">{o.sub}</span>}
                </span>
                {o.glow && <span className="opt-glow" aria-hidden="true" style={{ background: o.glow, boxShadow: `0 0 14px ${o.glow}` }} />}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A step rail: done, current, to come. */
export function StepRail({ steps, at }: { steps: string[]; at: number }) {
  return (
    <div className="hrow wrap" style={{ gap: '10px 22px' }}>
      {steps.map((s, i) => (
        <span key={s} className={`radio ${i === at ? 'on' : i < at ? 'done' : ''}`}>
          <i />
          {s}
        </span>
      ))}
    </div>
  );
}

/** The progress bar along the top of a run: n of total. */
export function RunRail({ n, total, left, right }: { n: number; total: number; left: ReactNode; right?: ReactNode }) {
  // one line, always: a long theme or drill name shrinks instead of pushing the meter down
  return (
    <div className="run-rail">
      <div className="run-rail-top">
        <FitText className="label num" min={8}>{left}</FitText>
        {right && <FitText className="label run-rail-right" min={8}>{right}</FitText>}
      </div>
      <Meter value={total ? n / total : 0} />
    </div>
  );
}

// ---------- Thai text ----------

/**
 * Thai with tone-marked romanisation underneath. The romanisation fades as the
 * item gets stronger (if the setting is on); tap to see it again.
 */
export function ThaiText({ thai, roman, en, refId, size = 'l', align }: { thai: string; roman?: string; en?: string; refId?: string; size?: 'xl' | 'l' | 'm'; align?: 'center' }) {
  const { settings, engine } = useApp();
  useStoreVersion();
  const [peek, setPeek] = useState(false);
  const strength = refId ? engine.strengthOf(refId) : 0;
  const fade = settings.romanFade && !peek ? Math.max(0.08, Math.min(1, 1 - (strength - 0.55) * 2.4)) : 1;
  return (
    <div style={{ textAlign: align }}>
      <div className={`thai-${size}`} lang="th">
        {thai}
      </div>
      {roman && (
        <button
          type="button"
          className="roman"
          style={{ opacity: fade, background: 'none', border: 0, padding: 0, textAlign: 'inherit' }}
          onClick={() => setPeek((p) => !p)}
          aria-label={`Romanisation: ${roman}`}
        >
          {roman}
          {en ? <span className="mut"> · {en}</span> : null}
        </button>
      )}
    </div>
  );
}

// ---------- ratings ----------

export function fmtInterval(ms: number): string {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  const h = m / 60;
  if (h < 20) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`;
  return `${Math.round(d / 30)} mo`;
}

/**
 * Rating buttons with the next-review time under each. The detailed scale is
 * the six ratings, keys 1 to 6; the simple scale is three of them (see
 * SIMPLE_RATINGS), keys 1 to 3.
 */
export function RatingBar({ preview, onRate, chosen, enabled = true, scale = 'detailed' }: { preview: Record<Six, number> | null; onRate: (s: Six) => void; chosen?: Six | null; enabled?: boolean; scale?: 'simple' | 'detailed' }) {
  const now = Date.now();
  const { device, touch } = useDevice();
  // a keyboard shows which number rates
  const keyed = device === 'desktop' && !touch;
  const buttons = scale === 'simple' ? SIMPLE_RATINGS : ([1, 2, 3, 4, 5, 6] as Six[]).map((six) => ({ six, label: SIX_LABELS[six] }));
  useKeys((a) => {
    if (a.type === 'rate' && a.n <= buttons.length) {
      onRate(buttons[a.n - 1].six);
      return true;
    }
  }, enabled);
  return (
    <div className={`ratings ${scale === 'simple' ? 'simple' : ''}`} role="group" aria-label="How did that feel?">
      {buttons.map((b, i) => (
        <button key={b.six} className={`rating ${chosen === b.six ? 'on' : ''}`} onClick={() => onRate(b.six)} disabled={!enabled} type="button">
          <b>{b.label}</b>
          <span>{preview ? `${keyed ? `${i + 1} · ` : ''}${fmtInterval(preview[b.six] - now)}` : `key ${i + 1}`}</span>
        </button>
      ))}
    </div>
  );
}
