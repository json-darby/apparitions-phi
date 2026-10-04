// The stroke tool. Trace each stroke of a letter over its font glyph, in
// writing order, with a stylus or mouse. Strokes are smoothed into SVG path data
// in the 100 x 100 stroke box and saved per letter (`strokes:<letterId>`).
// Export all as JSON to ship them with the content; import a JSON file back.
// This is how the consonants, vowels and tone marks get original stroke paths.

import { useMemo, useRef, useState } from 'react';
import { useApp, useStoreVersion } from '../../app/context';
import { navigate, useRoute } from '../../app/router';
import type { Letter, StrokePath } from '../../content/types';
import { Label, Screen, TopBar } from '../../ui/kit';
import { insideGlyph } from '../../writing/glyph';
import { simplify, smoothPath, smoothPoints, strokePoints, type Pt } from '../../writing/geometry';
import { Pad, type PadHandle } from '../../writing/Pad';
import { StrokePlayer } from '../../writing/StrokePlayer';
import { SOURCE_LABEL } from '../../writing/LetterBits';
import { authoredStrokes, clearStrokes, draftStrokes, exportStrokes, importStrokes, primeStrokes, saveStrokes, strokeInfo } from '../../writing/strokes';
import '../../writing/writing.css';

const cleanStroke = (pts: Pt[]): string | null => {
  if (pts.length < 2) return null;
  const s = simplify(smoothPoints(pts, 2), 0.45);
  return s.length >= 2 ? smoothPath(s) : null;
};

const reverseStroke = (d: string): string => cleanStroke(strokePoints(d).reverse()) ?? d;

export default function StrokeAuthor() {
  const { content, store, reducedMotion } = useApp();
  useStoreVersion();
  const route = useRoute();
  primeStrokes(store);
  const letters = content.letters;
  const qid = route.query.get('letter');
  const letter: Letter | undefined = (qid && content.letter(qid)) || letters[0];

  if (!letter) {
    return (
      <Screen top={<TopBar mid="Stroke tool" parent="/writing" />}>
        <p className="body">No letters in the content.</p>
      </Screen>
    );
  }
  return <Author key={letter.id} letter={letter} letters={letters} reducedMotion={reducedMotion} />;
}

function Author({ letter, letters, reducedMotion }: { letter: Letter; letters: Letter[]; reducedMotion: boolean }) {
  const { store } = useApp();
  const pad = useRef<PadHandle>(null);
  const saved = authoredStrokes(store, letter.id);
  const [list, setList] = useState<StrokePath[]>(() => saved?.strokes ?? []);
  const [past, setPast] = useState<StrokePath[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [cue, setCue] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const change = (next: StrokePath[]) => {
    setPast((p) => [...p.slice(-40), list]);
    setList(next);
    setDirty(true);
    setMsg(null);
  };
  const undo = () => {
    if (!past.length) return;
    setList(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };

  const fit = useMemo(() => {
    if (!list.length) return null;
    const pts = list.flatMap((s) => strokePoints(s.d, 16));
    return insideGlyph(letter.char, pts);
  }, [list, letter.char]);

  const status = (l: Letter) => {
    const info = strokeInfo(store, l);
    return info?.source ?? 'none';
  };

  const save = () => {
    try {
      saveStrokes(store, letter, list);
      setDirty(false);
      setMsg('Saved.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const removeSaved = () => {
    if (!saved) return;
    if (!window.confirm(`Delete the saved strokes for ${letter.char}? The draft or font outline takes over again.`)) return;
    clearStrokes(store, letter.id);
    setMsg('Saved strokes deleted.');
  };
  const exportAll = () => {
    const data = exportStrokes(store, letters);
    const n = Object.keys(data.letters).length;
    if (!n) {
      setMsg('Nothing authored yet, so nothing to export.');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `phi-strokes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg(`Exported ${n} letter${n === 1 ? '' : 's'}.`);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = importStrokes(store, letters, await f.text());
      setMsg(`Imported ${r.imported.length}${r.imported.length ? `: ${r.imported.join(' ')}` : ''}.${r.skipped.length ? ` Skipped ${r.skipped.join(' ')}.` : ''}`);
      const now = authoredStrokes(store, letter.id);
      if (now) {
        setList(now.strokes);
        setDirty(false);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const draft = draftStrokes(letter);
  const src = status(letter);

  const tools = (
    <div className="stack gap-4" style={{ paddingTop: 'var(--s2)' }}>
      <div className="stack gap-2">
        <Label>Strokes, in writing order</Label>
        {list.length ? (
          <div className="sa-list">
            {list.map((s, i) => (
              <div className="sa-row" key={`${i}${s.d.length}`}>
                <span className="n num">{i + 1}</span>
                <svg viewBox="10 0 80 80" aria-hidden>
                  <path d={s.d} />
                </svg>
                <span className="grow" />
                <button type="button" className="pill small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move stroke ${i + 1} up`}>Up</button>
                <button type="button" className="pill small" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move stroke ${i + 1} down`}>Down</button>
                <button type="button" className="pill small" onClick={() => change(list.map((x, k) => (k === i ? { d: reverseStroke(x.d) } : x)))} aria-label={`Reverse stroke ${i + 1}`}>Flip</button>
                <button type="button" className="pill small" onClick={() => change(list.filter((_, k) => k !== i))} aria-label={`Remove stroke ${i + 1}`}>Cut</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>None yet. Trace the first stroke from its start, over the glyph.</p>
        )}
      </div>
      <div className="hrow wrap" style={{ gap: 8 }}>
        <button type="button" className="pill" onClick={undo} disabled={!past.length}>Undo</button>
        <button type="button" className="pill" onClick={() => change([])} disabled={!list.length}>Clear</button>
        {draft && <button type="button" className="pill" onClick={() => change(draft.map((s) => ({ d: s.d })))}>Start from draft</button>}
        <button type="button" className="pill solid" onClick={save} disabled={!list.length || !dirty}>Save</button>
      </div>
      <div className="small">
        {fit != null ? `Fit: ${Math.round(fit * 100)}% of the path sits inside the glyph.` : list.length ? 'Fit: waiting for the font.' : ''}
        {dirty ? ' Not saved.' : ''}
      </div>
      <div className="small">Now in use: {SOURCE_LABEL[src]}.</div>
      {msg && <div className="small" aria-live="polite" style={{ color: 'var(--fg)' }}>{msg}</div>}

      <div className="stack gap-2">
        <Label>Preview</Label>
        <button type="button" onClick={() => setCue((c) => c + 1)} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 6, padding: 0, width: 180 }} aria-label="Replay preview">
          <StrokePlayer char={letter.char} strokes={list.length ? list : null} cue={cue} still={reducedMotion} />
        </button>
      </div>

      <div className="stack gap-2">
        <Label>All letters</Label>
        <div className="hrow wrap" style={{ gap: 8 }}>
          <button type="button" className="pill" onClick={exportAll}>Export JSON</button>
          <label className="pill file-btn">
            Import JSON
            <input type="file" accept="application/json,.json" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {saved && <button type="button" className="pill" onClick={removeSaved}>Delete saved</button>}
        </div>
      </div>
    </div>
  );

  return (
    <Screen top={<TopBar mid="Stroke tool" parent="/writing" />}>
      <div className="stack gap-4" style={{ marginBottom: 'var(--s6)' }}>
        <h1 className="h-l">Stroke tool</h1>
        <p className="body" style={{ margin: 0, maxWidth: '64ch' }}>
          Trace each stroke over the glyph in the order it is written, starting where the pen starts. Each stroke is smoothed and numbered. Mouse works; a stylus is better.
        </p>
        <div className="sa-letters" role="group" aria-label="Letter">
          {letters.map((l) => {
            const s = status(l);
            return (
              <button
                key={l.id}
                type="button"
                lang="th"
                className="letter-chip"
                aria-pressed={l.id === letter.id}
                aria-label={`${l.char} ${l.name}, ${s}`}
                onClick={() => {
                  if (dirty && !window.confirm('Leave without saving these strokes?')) return;
                  navigate(`/writing/author?letter=${encodeURIComponent(l.id)}`, true);
                }}
              >
                {l.char}
                {s !== 'none' && <i className={`tag ${s === 'authored' ? 'authored' : 'draft'}`} />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="sa-layout">
        <div className="stack gap-3">
          <div className="hrow between">
            <span className="h-s">
              <span lang="th" className="thai">{letter.char}</span> {letter.name}
            </span>
            <span className="small">{list.length} stroke{list.length === 1 ? '' : 's'}</span>
          </div>
          <Pad
            ref={pad}
            guide={letter.char}
            ghost
            overlay={list}
            marks={list}
            className="sa-pad"
            label={`Trace strokes for ${letter.char}`}
            onInk={(ink) => {
              const last = ink[ink.length - 1];
              if (!last) return;
              const d = cleanStroke(last);
              pad.current?.clear();
              if (d) change([...list, { d }]);
            }}
          />
        </div>
        {tools}
      </div>
    </Screen>
  );
}
