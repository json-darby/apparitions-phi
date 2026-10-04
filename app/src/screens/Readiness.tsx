// Trip readiness: what you will be able to handle on the trip date, place by
// place, with a range; ahead or behind in days; the cheapest fix; and how the
// forecast was worked out, in plain words.

import { useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { personalRetention } from '../engine/calibrate';
import type { Forecast, Status } from '../engine/forecast';
import { READY } from '../engine/situations';
import { useForecast } from '../engine/useForecast';
import { Label, Note, Screen, SectionHead, TopBar } from '../ui/kit';

const STATUS: Record<Status, { title: string; tone: string }> = {
  ahead: { title: 'Ahead', tone: 'var(--good)' },
  'on-track': { title: 'On track', tone: 'var(--good)' },
  'at-risk': { title: 'At risk', tone: 'var(--amber)' },
  behind: { title: 'Behind', tone: 'var(--bad)' },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

function fmtDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function statusLine(f: Forecast): string {
  const when = f.horizonKind === 'trip' ? `On ${fmtDate(f.horizonDate)}` : 'At the end of the course';
  const reach = f.daysMargin == null
    ? 'At this pace you would not reach the bar within a month of it.'
    : f.daysMargin > 0
      ? `You reach the bar ${f.daysMargin} day${f.daysMargin === 1 ? '' : 's'} early.`
      : f.daysMargin === 0
        ? 'You reach the bar just in time.'
        : `You reach the bar ${-f.daysMargin} day${f.daysMargin === -1 ? '' : 's'} late.`;
  const early = f.profile.daysObserved < 3 ? 'Early estimate, from your settings until a few days of study are in. ' : '';
  return `${early}${when} you should handle about ${pct(f.overall.p50)} of what the course covers by then (likely ${pct(f.overall.p10)} to ${pct(f.overall.p90)}). ${reach}`;
}

export default function Readiness() {
  const { forecast: f, busy, refresh } = useForecast();
  const { settings } = useApp();

  if (!f)
    return (
      <Screen top={<TopBar mid="Readiness" parent="/" />} narrow>
        <h1 className="h-l">Readiness</h1>
        <p className="body">{busy ? 'Working out your forecast. It replays the days to your trip a few dozen times, so it takes a moment.' : 'No forecast yet.'}</p>
      </Screen>
    );

  const st = STATUS[f.status];
  const p = f.profile;
  const retention = personalRetention(0.9, p.k);
  const panel = (
    <div className="stack gap-6">
      <section>
        <SectionHead title="How it is worked out" />
        <div className="stack gap-3 small" style={{ color: 'var(--fg-2)' }}>
          <p style={{ margin: 0 }}>
            The forecast replays the {f.daysLeft} days to {f.horizonKind === 'trip' ? 'your trip' : 'the end of the course'} {f.runs} times, using
            your own habits and memory, and the same rules the app uses to plan each day. The range is the middle 80% of those futures.
          </p>
          <Fact label="Days you study" value={p.daysObserved ? `${p.daysStudied} of the last ${p.daysObserved}` : 'No history yet'} />
          <Fact label="Plans finished" value={pct(p.completion)} />
          <Fact label="Time you have" value={p.availableMinutes == null ? 'Enough to finish each plan' : `About ${Math.round(p.availableMinutes)} min a session`} />
          <Fact
            label="How you remember"
            value={
              p.calibrationN < 30
                ? 'Not enough reviews to tell yet'
                : p.k > 1.15
                  ? `You forget faster than the model expected (×${p.k.toFixed(2)})`
                  : p.k < 0.87
                    ? `You remember better than the model expected (×${p.k.toFixed(2)})`
                    : `About as the model expects (×${p.k.toFixed(2)})`
            }
          />
          {p.calibrationN >= 30 && (
            <p style={{ margin: 0 }}>
              From {p.calibrationN} reviews: the model predicted {pct(p.predictedRecall)} recall and you managed {pct(p.actualRecall)}.
              Reviews are now timed to keep your real recall near 90%, which means asking the scheduler for {pct(retention)}.
            </p>
          )}
          <Fact label="Answer speed" value={`${Math.round(p.secs.hear)} s to hear, ${Math.round(p.secs.say)} s to say`} />
          <p style={{ margin: 0 }}>
            Ready means {pct(READY)}: most of the words for that place come to you when you need them, both hearing and saying. A learner
            following every plan exactly would reach {pct(f.plan)}.
          </p>
        </div>
      </section>
      <button className="pill small" onClick={refresh} disabled={busy}>{busy ? 'Updating' : 'Recalculate'}</button>
    </div>
  );

  return (
    <Screen top={<TopBar mid="Readiness" parent="/" />} panel={panel}>
      <Label>
        {f.horizonKind === 'trip' ? `Trip on ${fmtDate(f.horizonDate)} · ${f.daysLeft} days` : `Course ends · ${f.daysLeft} days`}
        {busy ? ' · updating' : ''}
      </Label>
      <h1 className="h-xl" style={{ margin: '10px 0 14px', color: st.tone }}>{st.title}</h1>
      <p className="body" style={{ margin: 0, maxWidth: '58ch' }}>{statusLine(f)}</p>
      {!settings.tripDate && (
        <p className="small" style={{ marginTop: 8 }}>No trip date is set, so this measures against the end of the course. Set one in Settings.</p>
      )}

      {f.fix && (
        <div className="card" style={{ marginTop: 22 }}>
          <Label>{f.fix.reaches ? 'The smallest change that gets you there' : 'The change that helps most'}</Label>
          <div className="h-s" style={{ marginTop: 8 }}>{f.fix.lever.label}</div>
          <p className="small" style={{ margin: '6px 0 0' }}>
            Takes the forecast to about {pct(f.fix.p50)}{f.fix.reaches ? ', over the bar.' : `. Still short of ${pct(f.target)}; consider the 60-day course or a later trip.`}
          </p>
        </div>
      )}

      <SectionHead title="The road to the trip" />
      <ReadinessChart f={f} />

      <SectionHead title="Place by place" note="Now → on the day" />
      <div className="stack">
        {f.by.map((s) => (
          <div key={s.id} className="row" style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <div className="hrow between" style={{ width: '100%' }}>
              <span>{s.name}</span>
              <span className="label num">{pct(s.now)} → {pct(s.band.p50)}</span>
            </div>
            <BandMeter now={s.now} band={s.band} target={f.target} />
            <span className="small">{s.canDo}</span>
          </div>
        ))}
      </div>

      <SectionHead title="By then" />
      <div className="stats">
        <div className="stat"><div className="label">Met</div><div className="v num">{Math.round(f.met.p50)}</div></div>
        <div className="stat"><div className="label">Can say</div><div className="v num">{Math.round(f.sayable.p50)}</div></div>
        <div className="stat"><div className="label">Ready now</div><div className="v num">{pct(f.now)}</div></div>
      </div>
      <Note>
        Readiness counts the words, phrases and letters the course teaches up to {f.horizonKind === 'trip' ? 'your trip' : 'its end'},
        weighting survival phrases three times. Phase 1 to 3 run on a small placeholder set, so the numbers are a working demonstration
        until the full course arrives.
      </Note>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="hrow between" style={{ gap: 16 }}>
      <span className="label">{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

/** A range bar: now as a hollow tick, the trip-day range as a band, the middle as a solid tick, the bar as a hairline. */
function BandMeter({ now, band, target }: { now: number; band: { p10: number; p50: number; p90: number }; target: number }) {
  const x = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div style={{ position: 'relative', height: 14, width: '100%' }} role="img" aria-label={`Now ${pct(now)}, on the day ${pct(band.p50)}, likely ${pct(band.p10)} to ${pct(band.p90)}`}>
      <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 2, background: 'var(--rule)' }} />
      <div style={{ position: 'absolute', top: 3, height: 8, left: x(band.p10), width: `calc(${x(band.p90)} - ${x(band.p10)})`, background: 'rgba(242,242,242,.28)', borderRadius: 4 }} />
      <div style={{ position: 'absolute', top: 0, height: 14, width: 2, left: x(band.p50), background: 'var(--fg)', borderRadius: 1 }} />
      <div style={{ position: 'absolute', top: 2, height: 10, width: 10, marginLeft: -5, left: x(now), border: '2px solid var(--mut)', borderRadius: '50%', background: 'var(--bg)' }} />
      <div style={{ position: 'absolute', top: -2, bottom: -2, width: 1, left: x(target), background: 'var(--amber)', opacity: 0.8 }} />
    </div>
  );
}

/** Readiness over the coming days: the middle forecast as a line, the likely range as a band, the bar and the trip marked. Hover for values. */
function ReadinessChart({ f }: { f: Forecast }) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const pts = f.curve;
  const n = pts.length;
  const xs = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const ys = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const today = useMemo(() => new Date(), []);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.p50).toFixed(1)}`).join('');
  const area = `${pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.p90).toFixed(1)}`).join('')}${[...pts].reverse().map((p, j) => `L${xs(n - 1 - j).toFixed(1)},${ys(p.p10).toFixed(1)}`).join('')}Z`;
  const tripX = xs(f.daysLeft - 1);
  const dateOf = (i: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i + 1);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((x - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Forecast readiness rising to ${pct(f.overall.p50)} on the trip day`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ display: 'block', touchAction: 'pan-y' }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={ys(v)} y2={ys(v)} stroke="rgba(255,255,255,.08)" />
            <text x={pad.l - 6} y={ys(v) + 4} fontSize="10" fill="var(--mut)" textAnchor="end">{Math.round(v * 100)}</text>
          </g>
        ))}
        <path d={area} fill="rgba(242,242,242,.14)" />
        <line x1={pad.l} x2={W - pad.r} y1={ys(f.target)} y2={ys(f.target)} stroke="var(--amber)" strokeDasharray="4 4" strokeWidth="1" />
        <text x={W - pad.r} y={ys(f.target) - 5} fontSize="10" fill="var(--fg-2)" textAnchor="end">ready</text>
        <line x1={tripX} x2={tripX} y1={pad.t} y2={H - pad.b} stroke="var(--fg-2)" strokeWidth="1" />
        <text x={tripX + 4} y={pad.t + 10} fontSize="10" fill="var(--fg-2)">{f.horizonKind === 'trip' ? 'trip' : 'course end'}</text>
        <path d={line} fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx={xs(f.daysLeft - 1)} cy={ys(f.overall.p50)} r="4" fill="var(--fg)" stroke="var(--bg)" strokeWidth="2" />
        <text x={pad.l} y={H - 8} fontSize="10" fill="var(--mut)">{dateOf(0)}</text>
        <text x={W - pad.r} y={H - 8} fontSize="10" fill="var(--mut)" textAnchor="end">{dateOf(n - 1)}</text>
        {hover != null && (
          <g>
            <line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--fg-2)" strokeWidth="1" />
            <circle cx={xs(hover)} cy={ys(pts[hover].p50)} r="4" fill="var(--fg)" stroke="var(--bg)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="card"
          style={{
            position: 'absolute', top: 0, pointerEvents: 'none', background: 'var(--bg-2)', padding: '8px 10px', fontSize: 12,
            left: `min(calc(${(xs(hover) / W) * 100}% + 10px), calc(100% - 150px))`,
          }}
        >
          <div className="label">{dateOf(hover)}{hover === f.daysLeft - 1 ? ' · trip' : ''}</div>
          <div><b className="num">{pct(pts[hover].p50)}</b> <span className="mut">likely {pct(pts[hover].p10)}–{pct(pts[hover].p90)}</span></div>
        </div>
      )}
      <details style={{ marginTop: 8 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>Show as a table</summary>
        <table className="small num" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Date</th><th>Low</th><th>Middle</th><th>High</th></tr>
          </thead>
          <tbody>
            {pts.filter((_, i) => i % 3 === 0 || i === f.daysLeft - 1).map((p) => (
              <tr key={p.day}>
                <td>{dateOf(p.day - 1)}{p.day === f.daysLeft ? ' (trip)' : ''}</td>
                <td style={{ textAlign: 'center' }}>{pct(p.p10)}</td>
                <td style={{ textAlign: 'center' }}>{pct(p.p50)}</td>
                <td style={{ textAlign: 'center' }}>{pct(p.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

