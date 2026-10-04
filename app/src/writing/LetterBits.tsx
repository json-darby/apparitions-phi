// Small shared pieces for the writing screens: which letters to offer, the
// letter picker, letter facts, the letter-name prompt, and whether this device
// draws.

import { useEffect, useMemo, useState } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { useDevice } from '../app/device';
import type { SoundService } from '../audio/sound';
import { ref } from '../content/repo';
import type { Letter } from '../content/types';
import type { Store } from '../db/store';
import { glyphTextProps } from './glyph';
import { polylineD, splitByLength, strokePoints } from './geometry';
import { draftParts, primeStrokes, strokeInfo, type StrokePart, type StrokeSource } from './strokes';

export const letterRef = (l: Letter) => ref('letter', l.id);

/** Letters met so far and letters on today's plan (not yet met). */
export function useWritingLetters(): { met: Letter[]; today: Letter[]; all: Letter[] } {
  const { engine, content, store } = useApp();
  const v = useStoreVersion();
  return useMemo(() => {
    primeStrokes(store);
    const introduced = engine.introducedRefs();
    const met = content.letters.filter((l) => introduced.has(letterRef(l)));
    const plan = engine.planDay();
    const todayRefs = new Set(plan.newRefs.filter((r) => r.startsWith('letter:')));
    const today = content.letters.filter((l) => todayRefs.has(letterRef(l)) && !introduced.has(letterRef(l)));
    return { met, today, all: content.letters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, engine, content, store]);
}

/**
 * Whether to offer drawing. Touch screens draw; a mouse-only desktop does not.
 * A pen seen anywhere on the page also counts (pen laptops report a fine pointer).
 */
export function useCanDraw(): boolean {
  const { touch } = useDevice();
  const [pen, setPen] = useState(false);
  const anyCoarse = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;
  useEffect(() => {
    if (pen) return;
    const on = (e: PointerEvent) => {
      if (e.pointerType === 'pen') setPen(true);
    };
    window.addEventListener('pointermove', on, { passive: true });
    window.addEventListener('pointerdown', on, { passive: true });
    return () => {
      window.removeEventListener('pointermove', on);
      window.removeEventListener('pointerdown', on);
    };
  }, [pen]);
  return touch || anyCoarse || pen;
}

/** Play a letter's name. Until Phase 4 the caption shows the romanised name, not the letter, so it gives nothing away. */
export function playName(sound: SoundService, l: Letter, speed: 'normal' | 'slow' = 'normal') {
  return sound.play({ ref: letterRef(l), thai: l.name, en: l.keyword, speaker: 'Letter name', speed });
}

export function LetterChips({ letters, value, onPick, metIds, label = 'Letter' }: { letters: Letter[]; value: string | null; onPick: (id: string) => void; metIds?: Set<string>; label?: string }) {
  return (
    <div className="letter-chips" role="group" aria-label={label}>
      {letters.map((l) => (
        <button
          key={l.id}
          type="button"
          lang="th"
          className={`letter-chip ${metIds && !metIds.has(l.id) ? 'unmet' : ''}`}
          aria-pressed={l.id === value}
          aria-label={`${l.char} ${l.name}${metIds && !metIds.has(l.id) ? ', not met yet' : ''}`}
          onClick={() => onPick(l.id)}
        >
          {l.char}
        </button>
      ))}
    </div>
  );
}

const CLASS_LABEL: Record<Letter['cls'], string> = {
  mid: 'Mid class', high: 'High class', low: 'Low class', vowel: 'Vowel', tonemark: 'Tone mark',
};

export const SOURCE_LABEL: Record<StrokeSource | 'none', string> = {
  authored: 'Authored in the stroke tool',
  content: 'Bundled stroke path',
  draft: 'Draft path, not yet checked by a Thai writer',
  none: 'No stroke path yet; the font outline stands in',
};

/** Name, class, sounds, key word, and the printed and handwritten forms side by side. */
export function LetterFacts({ letter, onPlay, compact }: { letter: Letter; onPlay?: () => void; compact?: boolean }) {
  const { store } = useApp();
  useStoreVersion();
  const info = strokeInfo(store, letter);
  return (
    <div className="facts">
      <div className="facts-forms">
        <div>
          <svg viewBox="12 6 76 76" aria-hidden>
            <text {...glyphTextProps()} className="facts-print" lang="th">{letter.char}</text>
          </svg>
          <div className="label">Printed</div>
        </div>
        <div>
          <svg viewBox="12 6 76 76" aria-hidden>
            {info ? info.strokes.map((s, i) => <path key={i} d={s.d} className="facts-hand" />) : <text {...glyphTextProps()} className="facts-print" opacity={0.4} lang="th">{letter.char}</text>}
          </svg>
          <div className="label">Hand</div>
        </div>
      </div>
      <div className="hrow between">
        <div>
          <div className="h-s">{letter.name}</div>
          <div className="small">{letter.keyword}</div>
        </div>
        {onPlay && (
          <button type="button" className="pill small" onClick={onPlay}>
            Name
          </button>
        )}
      </div>
      {!compact && (
        <dl>
          <dt>Class</dt>
          <dd>{CLASS_LABEL[letter.cls]}</dd>
          <dt>Starts a syllable</dt>
          <dd>{letter.initial}</dd>
          <dt>Ends a syllable</dt>
          <dd>{letter.final ?? 'Not used at the end'}</dd>
          <dt>Key word</dt>
          <dd>{letter.keyword}</dd>
          <dt>Stroke path</dt>
          <dd className="small">{SOURCE_LABEL[info?.source ?? 'none']}</dd>
        </dl>
      )}
    </div>
  );
}

/**
 * The pieces of a letter for "build from parts": named draft pieces, else one
 * piece per stroke for multi-stroke paths, else a single stroke cut in three.
 */
export function partsFor(store: Store, letter: Letter): StrokePart[] | null {
  const info = strokeInfo(store, letter);
  if (!info) return null;
  if (info.source === 'draft') return draftParts(letter);
  if (info.strokes.length > 1) return info.strokes.map((s, i) => ({ label: `Stroke ${i + 1}`, d: s.d }));
  const pts = strokePoints(info.strokes[0].d);
  const names = ['Start', 'Middle', 'End'];
  return splitByLength(pts, [0.3, 0.68]).map((p, i) => ({ label: names[i], d: polylineD(p) }));
}

export function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

