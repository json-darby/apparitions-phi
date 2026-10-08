// Small shared pieces for The Street screens.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp, useStoreVersion } from '../../app/context';
import { Link } from '../../app/router';
import { Sequence, type SequenceName } from '../../anim';
import { Label, Screen, TopBar } from '../../ui/kit';
import { PLACE_COLOURS, type PlaceId, type VoiceId } from '../../content/types';
import { NPC_SEX } from '../../content/street-seed';
import { loadStreet, updateStreet, type StreetState } from '../state';

/** The Street state, re-read whenever the store changes. */
export function useStreet(): [StreetState, (fn: (s: StreetState) => StreetState | void) => StreetState] {
  const { store } = useApp();
  useStoreVersion();
  return [loadStreet(store), (fn) => updateStreet(store, fn)];
}

export function placeColour(place: PlaceId | null | undefined): string {
  return place ? PLACE_COLOURS[place] : PLACE_COLOURS.default;
}

export function voiceFor(person: string): VoiceId {
  return NPC_SEX[person] === 'm' ? 'm1' : 'f1';
}

const SEQ_TEXT: Record<SequenceName, string> = {
  wai: 'A wai. Palms together, a small bow. Return it.',
  handover: 'She passes it across.',
  glance: 'The driver looks back over his shoulder.',
  walkaway: 'They turn and walk into the dark.',
  palm: 'She raises her palm to the glass, and goes.',
};

/**
 * A frame sequence over the screen. Ends when the sequence reports done, on a
 * tap, or after a few seconds (the placeholder sequence never reports done).
 */
export function SequenceOverlay({ name, who, colour, caption, onDone, ms = 2600 }: { name: SequenceName; who?: string; colour?: string; caption?: string; onDone: () => void; ms?: number }) {
  const { reducedMotion } = useApp();
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  useEffect(() => {
    const t = setTimeout(finish, reducedMotion ? Math.min(ms, 1400) : ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button type="button" className="street-seq" onClick={finish} aria-label="Continue">
      <Sequence name={name} who={who} colour={colour} onDone={finish} style={{ width: 'min(420px, 80vw)', height: 'min(420px, 50vh)' }} />
      <p className="body center" style={{ margin: 0 }}>{caption ?? SEQ_TEXT[name]}</p>
      <span className="label">Tap to continue</span>
    </button>
  );
}

// ---------- seven-segment fare meter ----------

const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

function Digit({ ch, on }: { ch: string; on: string }) {
  const lit = SEG[ch] ?? '';
  const s = (k: string) => ({ fill: lit.includes(k) ? on : 'rgba(255,255,255,0.06)' });
  return (
    <svg viewBox="0 0 24 40" width="0.6em" height="1em" aria-hidden>
      <polygon points="5,2 19,2 16,5 8,5" style={s('a')} />
      <polygon points="20,3 20,18 17,16 17,6" style={s('b')} />
      <polygon points="20,22 20,37 17,34 17,24" style={s('c')} />
      <polygon points="5,38 19,38 16,35 8,35" style={s('d')} />
      <polygon points="4,22 4,37 7,34 7,24" style={s('e')} />
      <polygon points="4,3 4,18 7,16 7,6" style={s('f')} />
      <polygon points="5,20 8,18 16,18 19,20 16,22 8,22" style={s('g')} />
    </svg>
  );
}

export function SevenSeg({ value, digits = 4, colour = '#FFB03A', label = 'Fare' }: { value: number | string; digits?: number; colour?: string; label?: string }) {
  const text = String(value).padStart(digits, ' ').slice(-digits);
  return (
    <div className="sevenseg" role="img" aria-label={`${label} ${value} baht`} style={{ color: colour, borderColor: colour }}>
      <span className="label" style={{ color: colour }}>{label}</span>
      <span className="sevenseg-digits">
        <span className="baht-sign">฿</span>
        {text.split('').map((c, i) => (
          <Digit key={i} ch={c} on={colour} />
        ))}
      </span>
    </div>
  );
}

export function HudStat({ label, value, align }: { label: string; value: ReactNode; align?: 'right' | 'center' }) {
  return (
    <div className="street-stat" style={{ textAlign: align }}>
      <div className="label">{label}</div>
      <div className="v num">{value}</div>
    </div>
  );
}

/** Lives as dots. */
export function Lives({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="dots" aria-label={`${n} of ${of} lives`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Seconds since mount, for answer times. */
export function useStopwatch(key: unknown): () => number {
  const t0 = useRef(Date.now());
  useEffect(() => {
    t0.current = Date.now();
  }, [key]);
  return () => Date.now() - t0.current;
}

/** A chapter part whose script is not in the loaded course: said plainly, never the placeholder Thai. */
export function NotReady({ chapter, onParts }: { chapter: string; onParts?: () => void }) {
  return (
    <Screen top={<TopBar mid={chapter} parent="/street" />} narrow>
      <Label className="lead-label">{chapter}</Label>
      <h1 className="h-l" style={{ marginTop: 10 }}>This part is not ready yet</h1>
      <p className="body" style={{ maxWidth: '52ch' }}>
        Its conversation is not in this version of the course. Nothing is lost: your progress is kept, and the part opens when a course that has it is loaded.
      </p>
      <div className="hrow wrap">
        <Link to="/street" className="pill solid">Back to the street</Link>
        {onParts && <button type="button" className="pill" onClick={onParts}>Other parts</button>}
      </div>
    </Screen>
  );
}

/** A gentle one-line notice that clears itself. */
export function useToast(ms = 2200): [string | null, (s: string) => void] {
  const [t, set] = useState<string | null>(null);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => set(null), ms);
    return () => clearTimeout(id);
  }, [t, ms]);
  return [t, set];
}
