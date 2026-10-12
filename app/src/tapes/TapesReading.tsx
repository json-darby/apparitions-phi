// A reading lesson from the booklet, and the tone drill built from its syllables.

import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../app/router';
import { Label, Screen, Seg, Toggle, TopBar } from '../ui/kit';
import { LoadPack } from './Tapes';
import { TONE_COLOURS, TONE_NAMES, thaiJoined, type Syl, type ToneDigit } from './pack';
import { Phrase, PlayButton, ToneKey, ToneLine, WhyList, speak, stopTapes, useTapes } from './parts';
import './tapes.css';

export default function TapesReading({ params }: { params: Record<string, string> }) {
  const n = Number(params.n);
  const { pack, state, update } = useTapes();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => () => stopTapes(), []);
  const top = <TopBar mid={`Reading ${n}`} parent="/tapes?tab=reading" />;
  if (pack === undefined || !state) return <Screen top={top} narrow><p className="small">Opening…</p></Screen>;
  if (pack === null) return <Screen top={top} narrow className="tapes"><LoadPack /></Screen>;
  const L = pack.reading.find((x) => x.n === n);
  if (!L) return <Screen top={top} narrow><p className="body">No reading lesson {n} in your study file.</p></Screen>;
  const last = pack.reading[pack.reading.length - 1]?.n ?? n;

  return (
    <Screen top={top} narrow className="tapes">
      <div className="page-head" style={{ marginBottom: 14 }}>
        <Label>Reading · {L.items.length} lines</Label>
        <h1 className="h-page">Lesson {n}</h1>
        <p className="body" style={{ margin: 0 }}>Read each line yourself before you play it. Hide the sounds to test your reading.</p>
      </div>
      <div className="hrow wrap between" style={{ gap: 10 }}>
        <span className="hrow small" style={{ gap: 8 }}>
          <Toggle on={!state.hideRoman} onChange={(v) => update({ hideRoman: !v })} label="Show romanisation" />
          Sounds
        </span>
      </div>
      <ToneKey />
      <div className="rows-end" style={{ marginTop: 8 }}>
        {L.items.map((it, i) => (
          <div key={i} className={`tp-item ${open === i ? 'open' : ''}`}>
            <div className="tp-item-top">
              <button type="button" className="tp-item-main" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                {it.variants.map((v, k) => (
                  <span key={k} className="tp-variant">
                    {k > 0 && <span className="tp-or">or</span>}
                    <Phrase v={v} size="l" hideRoman={state.hideRoman} />
                  </span>
                ))}
                {it.mean && <span className="tp-mean">{it.mean}</span>}
              </button>
              <div className="tp-acts">
                <PlayButton thai={it.variants.map(thaiJoined).join(' ')} />
              </div>
            </div>
            {open === i && <div className="tp-detail"><WhyList variants={it.variants} /></div>}
          </div>
        ))}
      </div>
      <div className="tp-foot" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <button type="button" className="pill" disabled={n <= 1} onClick={() => navigate(`/tapes/reading/${n - 1}`, true)}>← Lesson {n > 1 ? n - 1 : ''}</button>
        <button type="button" className="pill" disabled={n >= last} onClick={() => navigate(`/tapes/reading/${n + 1}`, true)}>Lesson {n < last ? n + 1 : ''} →</button>
      </div>
    </Screen>
  );
}

/** Which tone? A syllable from the reading lessons; work it out from the letters, then hear it. */
export function ToneDrill() {
  const { pack } = useTapes();
  const [upTo, setUpTo] = useState(5);
  const [q, setQ] = useState<Syl | null>(null);
  const [picked, setPicked] = useState<ToneDigit | null>(null);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const pool = useMemo(() => {
    if (!pack) return [];
    const m = new Map<string, Syl>();
    pack.reading.filter((L) => L.n <= upTo).forEach((L) => L.items.forEach((it) => it.variants.forEach((v) => v.flat().forEach((s) => m.set(s.th + s.ro, s)))));
    return [...m.values()];
  }, [pack, upTo]);
  const fresh = () => {
    setPicked(null);
    setQ(pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
  };
  useEffect(fresh, [pool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopTapes(), []);

  const top = <TopBar mid="Tone drill" parent="/tapes?tab=reading" />;
  if (pack === undefined) return <Screen top={top} narrow><p className="small">Opening…</p></Screen>;
  if (pack === null) return <Screen top={top} narrow className="tapes"><LoadPack /></Screen>;
  const max = pack.reading.length;

  const answer = (t: ToneDigit) => {
    if (!q || picked != null) return;
    setPicked(t);
    setScore(([a, b]) => [a + (t === q.t ? 1 : 0), b + 1]);
    speak(q.th);
  };

  return (
    <Screen top={top} narrow className="tapes">
      <div className="page-head" style={{ marginBottom: 14 }}>
        <Label>Score {score[0]} / {score[1]}</Label>
        <h1 className="h-page">Which tone?</h1>
        <p className="body" style={{ margin: 0 }}>Work it out from the letters: class, live or dead, mark.</p>
      </div>
      <div className="row line" style={{ cursor: 'default' }}>
        <span>Lessons 1 to</span>
        <Seg label="Reading lessons up to" value={upTo} onChange={setUpTo} options={[3, 5, 10, max].filter((v, i, a) => v <= max && a.indexOf(v) === i).map((v) => ({ v, label: String(v) }))} />
      </div>
      {q && (
        <div className="tp-card">
          <div className="tp-drill-th" lang="th">{q.th}</div>
          <div className="tp-tones">
            {TONE_NAMES.map((name, t) => {
              const right = picked != null && t === q.t;
              const wrong = picked === t && t !== q.t;
              return (
                <button key={name} type="button" className={`tp-tone ${right ? 'right' : ''} ${wrong ? 'wrong' : ''}`} onClick={() => answer(t as ToneDigit)} disabled={picked != null && !right && !wrong}>
                  <ToneLine t={t as ToneDigit} size={30} />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
          {picked != null && (
            <div className="stack gap-3" style={{ width: '100%' }}>
              <p className="body" style={{ margin: 0 }}>
                <b style={{ color: picked === q.t ? 'var(--good)' : 'var(--amber)' }}>{picked === q.t ? 'Right' : 'Not quite'}:</b>{' '}
                <b style={{ color: TONE_COLOURS[q.t] }}>{q.ro}</b>, {TONE_NAMES[q.t]}. {q.why}
              </p>
              <div className="hrow" style={{ gap: 8 }}>
                <PlayButton thai={q.th} />
                <button type="button" className="pill solid" style={{ flex: 1 }} onClick={fresh}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}
