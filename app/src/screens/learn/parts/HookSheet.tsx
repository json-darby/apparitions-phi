// Leech handling: an item missed four times gets a fresh memory hook, written
// by the learner, and a contrast drill against what it keeps being confused with.

import { useState } from 'react';
import { useApp } from '../../../app/context';
import { Link } from '../../../app/router';
import { Label, Sheet } from '../../../ui/kit';
import { describe } from './common';

export function HookSheet({ refId, contrastWith, onClose }: { refId: string; contrastWith?: string | null; onClose: (saved: boolean) => void }) {
  const { engine, content } = useApp();
  const shown = describe(content, refId);
  const old = engine.hookFor(refId);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const other = contrastWith ? describe(content, contrastWith) : null;
  // a contrast drill: tone pairs for items with a sound-alike, side by side for letters
  const pairRef = shown?.kind === 'item' && (other?.kind === 'item' || shown.item?.contrasts?.length) ? refId : null;

  const save = () => {
    const h = text.trim();
    if (!h) return;
    engine.renewHook(refId, h);
    setSaved(true);
  };

  return (
    <Sheet label="A new memory hook" onClose={() => onClose(saved)}>
      <div className="stack gap-4">
        <div>
          <Label>Missed four times · new memory hook</Label>
          <div className="hrow wrap" style={{ gap: 14, marginTop: 10, alignItems: 'baseline' }}>
            <span className="thai-l" lang="th">{shown?.thai}</span>
            <span className="body">{shown?.roman} · {shown?.en}</span>
          </div>
        </div>
        <p className="body" style={{ margin: 0 }}>
          The old hook is not holding. Write a fresh one in your own words: a picture, a sound-alike, something absurd. Yours sticks better than ours.
        </p>
        {old && <p className="small" style={{ margin: 0 }}>Old hook: {old}</p>}
        {!saved ? (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Your new hook" aria-label="Your new memory hook" autoFocus />
            <div className="hrow between">
              <button className="pill" type="button" onClick={() => onClose(false)}>Later</button>
              <button className="pill solid" type="button" onClick={save} disabled={!text.trim()}>Save hook</button>
            </div>
          </>
        ) : (
          <p className="body good" style={{ margin: 0 }}>Saved. It gets a fresh run of four.</p>
        )}

        {other && (
          <div className="stack gap-2">
            <Label>Keeps getting mixed up with</Label>
            <div className="lookalikes">
              {[shown, other].map((s) =>
                s ? (
                  <div key={s.ref} className="card">
                    <div className="thai-l" lang="th">{s.thai}</div>
                    <div className="small">{s.roman} · {s.en}</div>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        )}
        <div className="hrow wrap" style={{ gap: 10 }}>
          {pairRef && (
            <Link to={`/tone-pairs?contrast=${encodeURIComponent(pairRef)}`} className="pill" style={{ textDecoration: 'none' }}>
              Contrast drill
            </Link>
          )}
          {saved && (
            <button className="pill solid" type="button" onClick={() => onClose(true)}>
              Carry on
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
