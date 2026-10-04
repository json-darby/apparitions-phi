// Paper practice. Print a sheet with dotted guides, write on it, then photograph
// it (phone and tablet) or upload a photo (desktop) and rate each letter
// against the models. The photo stays on this screen: nothing is sent or saved.
// A photo check by Gemini is a later online feature.
//
// Deep link: /writing/paper?letters=l-gor,l-jor&step=photo

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { useRoute } from '../../app/router';
import type { Letter, StrokePath } from '../../content/types';
import { SIX_LABELS, Six } from '../../engine/grade';
import { Label, Screen, Seg, TopBar } from '../../ui/kit';
import { GLYPH, glyphTextProps } from '../../writing/glyph';
import { strokePoints } from '../../writing/geometry';
import { letterRef, shuffle, useWritingLetters } from '../../writing/LetterBits';
import { getStrokes } from '../../writing/strokes';
import '../../writing/writing.css';

const MAX_LETTERS = 8;

export default function PaperPractice() {
  const { content, store } = useApp();
  const route = useRoute();
  const { device, touch } = useDevice();
  const { met, today, all } = useWritingLetters();
  const metIds = useMemo(() => new Set(met.map((l) => l.id)), [met]);

  const linked = useMemo(
    () => (route.query.get('letters') ?? '').split(',').map((id) => content.letter(id.trim())).filter((l): l is Letter => !!l),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.query.get('letters'), content],
  );
  const offered = useMemo(() => {
    const ids = new Set([...met, ...today, ...linked].map((l) => l.id));
    const list = all.filter((l) => ids.has(l.id));
    return list.length ? list : all.filter((l) => l.day <= 1);
  }, [met, today, linked, all]);

  const [chosen, setChosen] = useState<string[]>(() => (linked.length ? linked : offered).slice(0, MAX_LETTERS).map((l) => l.id));
  const [traces, setTraces] = useState(4);
  const letters = offered.filter((l) => chosen.includes(l.id)).concat(linked.filter((l) => chosen.includes(l.id) && !offered.includes(l)));
  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_LETTERS ? c : [...c, id]));

  // print only the sheet while this screen is open
  useEffect(() => {
    document.body.classList.add('phi-print-sheet');
    return () => document.body.classList.remove('phi-print-sheet');
  }, []);

  useEffect(() => {
    if (route.query.get('step') === 'photo') document.getElementById('pp-photo')?.scrollIntoView({ block: 'start' });
  }, [route.query]);

  const photoInput = device === 'desktop' && !touch ? 'upload' : 'camera';

  return (
    <Screen top={<TopBar mid="Paper practice" parent="/writing?mode=paper" />}>
      <div className="stack gap-4 no-print" style={{ marginBottom: 'var(--s6)' }}>
        <h1 className="h-l">Paper practice</h1>
        <p className="body" style={{ margin: 0, maxWidth: '60ch' }}>
          Print the sheet. Trace the dotted letters from the numbered dot, fill the blank boxes, then do the last section from the names alone.
        </p>
        <Label>Letters on the sheet, up to {MAX_LETTERS}</Label>
        <div className="pp-picker" role="group" aria-label="Letters on the sheet">
          {offered.map((l) => (
            <button
              key={l.id}
              type="button"
              lang="th"
              className={`letter-chip ${metIds.has(l.id) ? '' : 'unmet'}`}
              aria-pressed={chosen.includes(l.id)}
              aria-label={`${l.char} ${l.name}`}
              onClick={() => toggle(l.id)}
            >
              {l.char}
            </button>
          ))}
        </div>
        <div className="hrow wrap" style={{ gap: 12 }}>
          <Seg label="Dotted boxes per letter" value={traces} options={[{ v: 2, label: '2 dotted' }, { v: 4, label: '4 dotted' }, { v: 6, label: '6 dotted' }]} onChange={setTraces} />
          <button type="button" className="pill solid" onClick={() => window.print()} disabled={!letters.length}>
            Print
          </button>
        </div>
      </div>

      {letters.length ? <Sheet letters={letters} traces={traces} strokesFor={(l) => getStrokes(store, l)} /> : <p className="body">Pick at least one letter.</p>}

      <section id="pp-photo" className="no-print" style={{ marginTop: 'var(--s10)' }}>
        <PhotoCheck letters={letters} metIds={metIds} input={photoInput} />
      </section>
    </Screen>
  );
}

// ---------- the sheet ----------

function CellLines() {
  return (
    <>
      <line x1="0" x2="100" y1={GLYPH.baseline} y2={GLYPH.baseline} className="sheet-line" />
      <line x1="0" x2="100" y1={GLYPH.xHeight} y2={GLYPH.xHeight} className="sheet-line dash" />
    </>
  );
}

function StartDot({ strokes }: { strokes: StrokePath[] | null }) {
  if (!strokes?.length) return null;
  return (
    <>
      {strokes.map((s, i) => {
        const p = strokePoints(s.d)[0];
        if (!p) return null;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.6} className="sheet-start" />
            <text x={p.x} y={p.y + 1.6} textAnchor="middle" className="sheet-start-num">{i + 1}</text>
          </g>
        );
      })}
    </>
  );
}

function Cell({ kind, letter, strokes }: { kind: 'model' | 'dotted' | 'blank'; letter?: Letter; strokes?: StrokePath[] | null }) {
  return (
    <div className="sheet-cell">
      <svg viewBox="0 0 100 100" aria-hidden>
        <CellLines />
        {kind === 'model' && letter && (
          <>
            <text {...glyphTextProps()} className="sheet-model" lang="th">{letter.char}</text>
            <StartDot strokes={strokes ?? null} />
          </>
        )}
        {kind === 'dotted' && letter && (
          <>
            {strokes?.length ? (
              <>
                <text {...glyphTextProps()} className="sheet-outline" lang="th" style={{ opacity: 0.55 }}>{letter.char}</text>
                {strokes.map((s, i) => <path key={i} d={s.d} className="sheet-dotted" />)}
              </>
            ) : (
              <text {...glyphTextProps()} className="sheet-outline" lang="th" style={{ strokeWidth: 1 }}>{letter.char}</text>
            )}
            <StartDot strokes={strokes ?? null} />
          </>
        )}
      </svg>
    </div>
  );
}

function Sheet({ letters, traces, strokesFor }: { letters: Letter[]; traces: number; strokesFor: (l: Letter) => StrokePath[] | null }) {
  const blanks = Math.max(1, 6 - traces) + 1;
  const cells = 1 + traces + blanks;
  const memory = useMemo(() => shuffle(letters), [letters]);
  return (
    <div className="sheet-paper" style={{ ['--cells' as string]: cells }}>
      <h2>APPARITIONS: PHI · letter practice</h2>
      <div className="sheet-sub">Start at the numbered dot. Keep the body of each letter between the lines.</div>
      {letters.map((l) => {
        const strokes = strokesFor(l);
        return (
          <div className="sheet-row" key={l.id}>
            <div className="sheet-label">
              <b>{l.name}</b>
              <span>{l.keyword}</span>
            </div>
            <Cell kind="model" letter={l} strokes={strokes} />
            {Array.from({ length: traces }, (_, i) => <Cell key={`d${i}`} kind="dotted" letter={l} strokes={strokes} />)}
            {Array.from({ length: blanks }, (_, i) => <Cell key={`b${i}`} kind="blank" />)}
          </div>
        );
      })}
      <div className="sheet-section">From memory: write each letter from its name</div>
      {memory.map((l) => (
        <div className="sheet-row" key={`m${l.id}`}>
          <div className="sheet-label">
            <b>{l.name}</b>
            <span>{l.keyword}</span>
          </div>
          {Array.from({ length: 3 }, (_, i) => <Cell key={i} kind="blank" />)}
        </div>
      ))}
      <div className="sheet-foot">Stroke paths marked draft are not yet checked by a Thai writer.</div>
    </div>
  );
}

// ---------- photo and self-rating ----------

function PhotoCheck({ letters, metIds, input }: { letters: Letter[]; metIds: Set<string>; input: 'camera' | 'upload' }) {
  const { engine, store } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [rated, setRated] = useState<Record<string, { six: Six; counted: boolean }>>({});

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setUrl(URL.createObjectURL(f));
    setRated({});
  };

  const rate = (l: Letter, six: Six) => {
    if (rated[l.id]) return;
    const res = engine.answer({
      ref: letterRef(l), skill: 'write', source: 'paper', own: six, counts: metIds.has(l.id), data: { mode: 'paper-photo' },
    });
    setRated((r) => ({ ...r, [l.id]: { six, counted: res.counted } }));
  };

  return (
    <div className="stack gap-4">
      <h2 className="h-m">Check your sheet</h2>
      <p className="body" style={{ margin: 0, maxWidth: '60ch' }}>
        {input === 'camera' ? 'Photograph the sheet,' : 'Upload a photo of the sheet,'} then compare it with the models and rate each letter on the from-memory section.
      </p>
      <p className="small" style={{ margin: 0, maxWidth: '60ch' }}>
        A photo check by Gemini comes later as an online feature. For now you judge by eye. The photo stays on this screen; it is not sent anywhere or saved.
      </p>
      <div>
        <label className="pill file-btn">
          {url ? (input === 'camera' ? 'Retake' : 'Choose another') : input === 'camera' ? 'Take photo' : 'Upload photo'}
          {input === 'camera' ? (
            <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
          ) : (
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
          )}
        </label>
      </div>
      {url && (
        <div className="pp-capture">
          <div>
            <img
              src={url}
              alt="Your practice sheet"
              className={`pp-photo ${big ? 'big' : ''}`}
              onClick={() => setBig((b) => !b)}
              style={big ? { position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#050505', zIndex: 400, borderRadius: 0 } : undefined}
            />
          </div>
          <div className="pp-rate">
            <Label>Rate each letter</Label>
            {letters.map((l) => {
              const r = rated[l.id];
              const strokes = getStrokes(store, l);
              return (
                <div className="pp-rate-row" key={l.id}>
                  <svg viewBox="15 10 70 70" width={56} height={56} aria-label={`${l.char} ${l.name}`} role="img">
                    <text {...glyphTextProps()} fill="rgba(255,255,255,0.18)" lang="th">{l.char}</text>
                    {strokes?.map((s, i) => <path key={i} d={s.d} fill="none" stroke="var(--fg)" strokeWidth={3} strokeLinecap="round" />)}
                  </svg>
                  <div className="stack gap-2">
                    <div className="small">
                      {l.name}
                      {r ? ` · ${r.counted ? 'logged' : 'practice only'}` : metIds.has(l.id) ? '' : ' · not met yet, practice only'}
                    </div>
                    <div className="six" role="group" aria-label={`Rate ${l.name}`}>
                      {([1, 2, 3, 4, 5, 6] as Six[]).map((s) => (
                        <button key={s} type="button" aria-pressed={r?.six === s} disabled={!!r && r.six !== s} onClick={() => rate(l, s)}>
                          {SIX_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
