// Quick navigation: every unit number as a tap target. Heard units are ticked,
// the one you are on is filled. On the hub it sits open; inside a unit it opens
// from the top bar as a sheet.

import { useState } from 'react';
import { navigate } from '../app/router';
import { Sheet } from '../ui/kit';

export function UnitGrid({ nums, heard, current, onPick }: { nums: number[]; heard: number[]; current?: number | null; onPick: (n: number) => void }) {
  const done = new Set(heard);
  return (
    <div className="tp-jump" role="group" aria-label="Go to a unit">
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          className={`tp-jump-n num ${n === current ? 'on' : ''} ${done.has(n) ? 'heard' : ''}`}
          aria-current={n === current ? 'page' : undefined}
          aria-label={`Unit ${n}${done.has(n) ? ', heard' : ''}`}
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** The "Units" button for a unit page's top bar, opening the grid. */
export function JumpButton({ nums, heard, current }: { nums: number[]; heard: number[]; current: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pill small" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Units
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)} label="Go to a unit">
          <div className="stack gap-4">
            <div className="list-head" style={{ paddingBottom: 0 }}>
              <h2 className="h-m">Go to a unit</h2>
              <span className="small">{heard.length} of {nums.length} heard</span>
            </div>
            <UnitGrid nums={nums} heard={heard} current={current} onPick={(n) => { setOpen(false); navigate(`/tapes/unit/${n}`, true); }} />
            <button type="button" className="pill text" onClick={() => setOpen(false)}>Close</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
