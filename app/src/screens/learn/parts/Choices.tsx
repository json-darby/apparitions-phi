// A short list of options, keys 1 to n. Shows right and wrong once chosen.
// Every option is one fixed height: a long meaning or a long Thai phrase gets
// smaller type, never a taller button. `rows` keeps room for that many options,
// so a question with three options sits where one with four did.

import type { CSSProperties } from 'react';
import { useKeys } from '../../../input/keys';
import { FitText } from '../../../ui/FitText';

export interface Choice {
  id: string;
  label: string;
  sub?: string;
  /** the label is Thai: set in the Thai face, larger */
  thai?: boolean;
}

export function Choices({ options, answer, chosen, onChoose, enabled = true, rows, withSub }: { options: Choice[]; answer: string; chosen: string | null; onChoose: (id: string) => void; enabled?: boolean; rows?: number; withSub?: boolean }) {
  const done = chosen != null;
  // a sub line on any option (now or once answered) keeps one on every option
  const sub = withSub ?? options.some((o) => o.sub != null);
  useKeys((a) => {
    if (a.type === 'rate' && a.n <= options.length) {
      onChoose(options[a.n - 1].id);
      return true;
    }
  }, enabled && !done);
  return (
    <div className="choices" role="group" style={{ '--rows': rows ?? options.length } as CSSProperties}>
      {options.map((o, i) => {
        const cls = !done ? '' : o.id === answer ? 'right' : o.id === chosen ? 'wrong' : 'dim';
        return (
          <button key={o.id} type="button" className={`choice ${cls}`} onClick={() => !done && onChoose(o.id)} disabled={!enabled || (done && o.id !== answer && o.id !== chosen)}>
            <span className="kbd">{i + 1}</span>
            <span className="choice-text">
              <FitText className={`choice-main ${o.thai ? 'thai' : ''}`} lang={o.thai ? 'th' : undefined} lines={sub ? 1 : 2} min={o.thai ? 14 : 12}>
                {o.label}
              </FitText>
              {sub && <FitText className="small" min={10}>{o.sub ?? ''}</FitText>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
