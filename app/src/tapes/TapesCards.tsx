// Flashcards: pick a unit (or everything due), then go through its cards in
// one sitting. Front and back, five answers, the spacing worked out in
// flash.ts. Your long-term card for each phrase is kept with your other Tapes
// marks, so it travels in the app's save file.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link } from '../app/router';
import { useApp } from '../app/context';
import { useKeys } from '../input/keys';
import { Label, ListHead, Meter, Screen, Seg, Sheet, TopBar } from '../ui/kit';
import type { Card, TapesState } from './db';
import { GRADES, SITTING, answer, comeBack, streak, hardest, nextPick, progress, schedule, startSession, type FlashGrade, type FlashPick, type Session, type Side } from './flash';
import { LoadPack } from './Tapes';
import { plainMeaning, thaiJoined, unitNumbers, unitTitle, type Pack } from './pack';
import { NoteText, Phrase, PlayButton, SayButton, WHO_LABEL, playClip, speak, stopTapes, useTapes } from './parts';
import { dayNumber, deckOf, type Deck } from './review';
import './tapes.css';

const SIDES: { v: Side; label: string }[] = [
  { v: 'en', label: 'English first' },
  { v: 'th', label: 'Thai first' },
  { v: 'audio', label: 'Listen first' },
];
const OTHER: Record<Side, Side> = { en: 'th', th: 'en', audio: 'en' };

/** Two cards, a question behind and รู้ ("to know") in front: the flashcards' mark. */
export function CardsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" strokeWidth="2.8" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="10" width="22" height="31" rx="3" transform="rotate(-12 17 25)" stroke="var(--cyan)" />
      <g transform="rotate(8 29 22)">
        <rect x="18" y="7" width="22" height="31" rx="3" stroke="var(--pink)" fill="var(--bg)" />
        <text x="29" y="28" textAnchor="middle" fontSize="14" fill="var(--pink)" stroke="none" fontFamily="var(--thai)" fontWeight="600">รู้</text>
      </g>
    </svg>
  );
}

/** The link into the cards, for top bars. */
export function CardsLink({ to = '/tapes/cards', label = 'Cards' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="pill text small tp-cards-link" style={{ textDecoration: 'none' }} aria-label="Flashcards">
      <CardsIcon size={22} />
      <span>{label}</span>
    </Link>
  );
}

/**
 * The cards you get from a unit: its lines, minus the other speaker's versions
 * when you've chosen to say it as a man or a woman (the same Speaker setting
 * as the unit pages), and minus the single words if you've turned those off.
 */
export function cardsOf(pack: Pack, units: number[], s: TapesState): Deck[] {
  const who = s.who ?? 'all';
  const words = s.cardWords !== false;
  return deckOf(pack, units).filter((c) => (who === 'all' || c.item.who === '-' || c.item.who === who) && (words || c.item.variants[0].length > 1));
}

const isDue = (c: Deck, s: TapesState, today: number) => !!s.cards[c.id] && s.cards[c.id].due <= today;
const allDue = (pack: Pack, s: TapesState, today: number) => cardsOf(pack, unitNumbers(pack), s).filter((c) => isDue(c, s, today));

/** One sitting: what is due first (the least known first), then the unit's next new phrases, up to SITTING cards. */
function sittingFor(pack: Pack, which: string, s: TapesState, today: number): Deck[] {
  const ease = (c: Deck) => s.cards[c.id]?.ease ?? 2.5;
  if (which === 'due') return allDue(pack, s, today).sort((a, b) => ease(a) - ease(b)).slice(0, SITTING);
  const all = cardsOf(pack, [Number(which)], s);
  const due = all.filter((c) => isDue(c, s, today)).sort((a, b) => ease(a) - ease(b));
  const fresh = all.filter((c) => !s.cards[c.id]);
  return [...due, ...fresh].slice(0, SITTING);
}

/** Nothing due: a practice round on the unit's least-known phrases, not scheduled. */
function practiceFor(pack: Pack, which: string, s: TapesState): Deck[] {
  const all = cardsOf(pack, [Number(which)], s);
  return [...all].sort((a, b) => (s.cards[a.id]?.ease ?? 2.5) - (s.cards[b.id]?.ease ?? 2.5)).slice(0, SITTING);
}

export default function TapesCards({ params }: { params: Record<string, string> }) {
  const which = params.n;
  return which ? <CardSession which={which} /> : <CardsHome />;
}

// ---- choosing a deck ----

/** Forget the flashcard progress of some units (or all): the cards start again as new. Units heard stay ticked. */
function resetCards(update: ReturnType<typeof useTapes>['update'], units: number[] | 'all') {
  update((st) => {
    if (units === 'all') return { cards: {} };
    const pre = units.map((n) => `u${n}.`);
    return { cards: Object.fromEntries(Object.entries(st.cards).filter(([id]) => !pre.some((p) => id.startsWith(p)))) };
  });
}

function CardsHome() {
  const { pack, state, update } = useTapes();
  const [ask, setAsk] = useState<number | 'all' | null>(null);
  const top = <TopBar mid="Flashcards" parent="/tapes" />;
  if (pack === undefined || !state) return <Screen top={top} narrow><p className="small">Opening…</p></Screen>;
  if (pack === null) return <Screen top={top} narrow className="tapes"><LoadPack /></Screen>;
  const today = dayNumber();
  const nums = unitNumbers(pack);
  const due = allDue(pack, state, today).length;
  const heard = new Set(state.heard);
  const side = state.cardFront ?? 'en';
  const who = state.who ?? 'all';
  const words = state.cardWords !== false;
  const metAll = Object.keys(state.cards).length;
  const todayN = state.cardDays?.[String(today)] ?? 0;
  const run = streak(state.cardDays, today);

  return (
    <Screen top={top} narrow className="tapes">
      <div className="page-head" style={{ marginBottom: 14 }}>
        <Label>The Tapes · one unit at a time</Label>
        <h1 className="h-page tp-fc-title"><CardsIcon size={40} /> Flashcards</h1>
        <p className="body" style={{ margin: 0 }}>Pick a unit and go through its phrases in one sitting. The ones you find hard come back more, spaced out so you have to remember them. Each card then comes back on a later day, when it's due.</p>
        {(todayN > 0 || run > 0) && (
          <p className="small tp-fc-today" style={{ margin: '10px 0 0' }}>
            <b className="num">{todayN}</b> card{todayN === 1 ? '' : 's'} today{run > 1 ? <> · <b className="num">{run}</b> days in a row</> : ''}
          </p>
        )}
      </div>

      {due > 0 && (
        <Link to="/tapes/cards/due" className="card tp-fc-due" style={{ textDecoration: 'none' }}>
          <span className="stack gap-1"><span className="label">Due today</span><span className="h-m">{due} card{due === 1 ? '' : 's'} from earlier units</span></span>
          <span className="pill solid">Start</span>
        </Link>
      )}

      <div className="row line tp-fc-side" style={{ cursor: 'default', marginTop: 10 }}>
        <span>Front of the card</span>
        <Seg label="Front of the card" value={side} onChange={(v) => update({ cardFront: v })} options={SIDES} />
      </div>
      <div className="row line tp-fc-side" style={{ cursor: 'default' }}>
        <span className="stack gap-1"><span>Say it as</span><span className="small">Most sentences come twice, a man's and a woman's way</span></span>
        <Seg label="Say it as" value={who} onChange={(v) => update({ who: v })} options={[{ v: 'all', label: 'Both' }, { v: 'm', label: 'Man' }, { v: 'f', label: 'Woman' }]} />
      </div>
      <div className="row line tp-fc-side" style={{ cursor: 'default' }}>
        <span className="stack gap-1"><span>Single words</span><span className="small">The pieces the course builds phrases from</span></span>
        <Seg label="Single words" value={words ? 'on' : 'off'} onChange={(v) => update({ cardWords: v === 'on' })} options={[{ v: 'on', label: 'Include' }, { v: 'off', label: 'Skip' }]} />
      </div>

      <section style={{ marginTop: 18 }}>
        <ListHead title="Units" note={`${SITTING} cards a sitting`} />
        <div className="rows-end">
          {nums.map((n) => {
            const deck = cardsOf(pack, [n], state);
            if (!deck.length) return null;
            const started = deck.filter((c) => state.cards[c.id]).length;
            const dueN = deck.filter((c) => state.cards[c.id] && state.cards[c.id].due <= today).length;
            const state_ = dueN > 0 ? 'due' : started === 0 ? 'new' : started < deck.length ? 'part' : 'done';
            return (
              <div key={n} className={`tp-unit tp-fc-unit ${heard.has(n) ? 'is-done' : ''}`}>
                <Link to={`/tapes/cards/${n}`} className="tp-unit-main" style={{ textDecoration: 'none' }}>
                  <span className="tp-unit-n num">{n}</span>
                  <span className="tp-unit-t">{unitTitle(pack, n)}</span>
                  <span className={`small num tp-fc-state ${state_}`}>{started ? `${started}/${deck.length}` : `${deck.length} cards`}{dueN ? ` · ${dueN} due` : state_ === 'done' ? ' · ✓' : ''}</span>
                </Link>
                {started > 0 && (
                  <button type="button" className="tp-fc-reset" aria-label={`Reset unit ${n}'s flashcards`} title="Reset this unit's cards" onClick={() => setAsk(n)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {metAll > 0 && (
          <button type="button" className="pill text small" style={{ marginTop: 16 }} onClick={() => setAsk('all')}>Reset all flashcards</button>
        )}
      </section>

      {ask != null && (
        <Sheet label={ask === 'all' ? 'Reset all flashcards?' : `Reset unit ${ask}'s flashcards?`} onClose={() => setAsk(null)}>
          <div className="stack gap-4">
            <h2 className="h-m" style={{ margin: 0 }}>{ask === 'all' ? 'Reset all flashcards?' : `Reset unit ${ask}?`}</h2>
            <p className="body" style={{ margin: 0 }}>
              {ask === 'all'
                ? `All ${metAll} cards you've met start again as new, in every unit. Your ticks for units heard stay.`
                : `Unit ${ask}'s cards start again as new. Other units and your ticks for units heard stay.`}
            </p>
            <div className="hrow wrap" style={{ gap: 10 }}>
              <button type="button" className="pill" onClick={() => setAsk(null)}>Cancel</button>
              <button type="button" className="pill solid grow" onClick={() => { resetCards(update, ask === 'all' ? 'all' : [ask]); setAsk(null); }}>
                {ask === 'all' ? 'Reset all' : `Reset unit ${ask}`}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}

// ---- a session ----

function CardSession({ which }: { which: string }) {
  const { pack, state, update } = useTapes();
  const { reducedMotion } = useApp();
  const title = which === 'due' ? 'Due today' : `Unit ${which} cards`;
  const top = <TopBar mid={title} parent="/tapes/cards" />;

  // the deck and the long-term cards as they stood when the session began
  const [deck, setDeck] = useState<Deck[] | null>(null);
  const [practice, setPractice] = useState(false);
  const startCards = useRef<Record<string, Card>>({});
  const [s, setS] = useState<Session | null>(null);
  const [pick, setPick] = useState<FlashPick | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [wait, setWait] = useState(0);
  const shownAt = useRef(0);
  // each answer, so the last one can be taken back
  const history = useRef<{ s: Session; pick: FlashPick; id: string; prev: Card | undefined; fresh: boolean; day: number; logged: boolean }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const restore = useRef<FlashPick | null>(null);
  // the long-term cards this sitting has written so far
  const written = useRef<Record<string, Card>>({});
  // the card under a finger: how far it has been pulled sideways
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    if (!pack || !state || deck) return;
    const d = sittingFor(pack, which, state, dayNumber());
    startCards.current = { ...state.cards };
    written.current = {};
    history.current = [];
    setCanUndo(false);
    setDeck(d);
    setS(startSession(d.map((c) => c.id)));
  }, [pack, state, deck, which]);

  // choose the next card whenever the session moves on
  useEffect(() => {
    if (!s) return;
    // an answer taken back: the same card, answer side up, ready to grade again
    if (restore.current) {
      setPick(restore.current);
      restore.current = null;
      setFlipped(true);
      setWait(0);
      setDrag(0);
      return;
    }
    const p = nextPick(s, Date.now());
    setPick(p);
    setFlipped(false);
    setDrag(0);
    shownAt.current = Date.now();
    setWait(p.kind === 'flip' ? Math.ceil(p.waitMs / 1000) : 0);
  }, [s]);

  // the short wait before the same card comes round the other way
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => () => stopTapes(), []);

  const byId = useMemo(() => new Map((deck ?? []).map((c) => [c.id, c])), [deck]);
  const side: Side = state?.cardFront ?? 'en';
  const card = pick && pick.kind !== 'done' ? byId.get(pick.id) : undefined;
  const face: Side = pick?.kind === 'flip' ? OTHER[side] : side;
  const it = card?.item;
  const v = it?.variants[0];
  const clip = card && it?.clip ? `${card.n}.${card.i}` : null;

  const hear = () => {
    if (!v) return;
    if (clip) void playClip(clip).then((ok) => ok || speak(thaiJoined(v)));
    else speak(thaiJoined(v));
  };

  // listen-first cards play as they appear
  useEffect(() => {
    if (card && face === 'audio' && wait === 0) hear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, face, wait === 0]);

  const flip = () => {
    if (!card || flipped || wait > 0) return;
    setFlipped(true);
    if (face !== 'audio') hear();
  };

  const rate = (g: FlashGrade) => {
    if (!s || !pick || pick.kind === 'done' || !flipped || !card) return;
    stopTapes();
    const isCheck = pick.kind === 'check';
    const next = answer(s, card.id, g, Date.now(), isCheck);
    const today = dayNumber();
    const prev = written.current[card.id] ?? startCards.current[card.id];
    const fresh = !prev;
    history.current.push({ s, pick, id: card.id, prev, fresh, day: today, logged: !practice });
    if (history.current.length > 30) history.current.shift();
    setCanUndo(true);
    const bump = (days: Record<string, number> | undefined, by: number) => ({ ...(days ?? {}), [today]: Math.max(0, (days?.[String(today)] ?? 0) + by) });
    if (!practice) {
      const c = schedule(startCards.current[card.id], next.entries[card.id], today);
      written.current[card.id] = c;
      update((st) => ({
        cards: { ...st.cards, [card.id]: c },
        intro: fresh ? { ...st.intro, [today]: (st.intro[String(today)] ?? 0) + 1 } : st.intro,
        cardDays: bump(st.cardDays, 1),
      }));
    } else {
      update((st) => ({ cardDays: bump(st.cardDays, 1) }));
    }
    setS(next);
  };

  /** Take back the last answer: the session, the card's schedule and the day's count go back as they were. */
  const undo = () => {
    const h = history.current.pop();
    if (!h) return;
    stopTapes();
    setCanUndo(history.current.length > 0);
    if (h.logged) {
      if (h.prev) written.current[h.id] = h.prev;
      else delete written.current[h.id];
    }
    update((st) => {
      const days = { ...(st.cardDays ?? {}), [h.day]: Math.max(0, (st.cardDays?.[String(h.day)] ?? 0) - 1) };
      if (!h.logged) return { cardDays: days };
      const cards = { ...st.cards };
      if (h.prev) cards[h.id] = h.prev;
      else delete cards[h.id];
      const intro = h.fresh ? { ...st.intro, [h.day]: Math.max(0, (st.intro[String(h.day)] ?? 0) - 1) } : st.intro;
      return { cards, intro, cardDays: days };
    });
    restore.current = h.pick;
    setS(h.s);
  };

  useKeys((a) => {
    if (a.type === 'rate' && a.n <= 5 && flipped) {
      rate(a.n as FlashGrade);
      return true;
    }
    if (a.type === 'key' && a.down && (a.key === 'u' || a.key === 'U' || a.key === 'Backspace') && canUndo) {
      undo();
      return true;
    }
    if ((a.type === 'play' || a.type === 'confirm') && pick && pick.kind !== 'done') {
      if (!flipped) flip();
      else hear();
      return true;
    }
  });

  // drag the answer side: it follows the finger; let go far enough right for Good, left for don't know
  const swipe = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null);
  const FLING = 90;
  const down = (e: RPointerEvent) => {
    if (!flipped || e.button > 0) return;
    swipe.current = { x: e.clientX, y: e.clientY, sideways: null };
  };
  const move = (e: RPointerEvent) => {
    const st = swipe.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    // decide once whether this is a sideways pull or a scroll
    if (st.sideways == null && Math.abs(dx) + Math.abs(dy) > 10) {
      st.sideways = Math.abs(dx) > Math.abs(dy);
      if (st.sideways) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (st.sideways) {
      const was = Math.abs(drag) >= FLING;
      setDrag(dx);
      if (!was && Math.abs(dx) >= FLING) navigator.vibrate?.(8);
    }
  };
  const up = () => {
    const st = swipe.current;
    swipe.current = null;
    if (!st?.sideways) return setDrag(0);
    if (Math.abs(drag) >= FLING) rate(drag > 0 ? 4 : 1);
    else setDrag(0);
  };

  if (pack === undefined || !state) return <Screen top={top} narrow><p className="small">Opening…</p></Screen>;
  if (pack === null) return <Screen top={top} narrow className="tapes"><LoadPack /></Screen>;
  if (!deck || !s || !pick) return <Screen top={top} narrow className="tapes"><p className="small">Shuffling…</p></Screen>;

  if (deck.length === 0) {
    const extra = which === 'due' ? [] : practiceFor(pack, which, state);
    return (
      <Screen top={top} narrow className="tapes">
        <div className="page-head">
          <h1 className="h-page">{extra.length ? 'Nothing due' : 'Nothing here'}</h1>
          <p className="body" style={{ margin: 0 }}>
            {which === 'due' ? 'No cards are due today.' : extra.length ? `You've met every card in unit ${which} and none is due today. Spacing them out is what makes them stick, so they'll be back when they're due.` : 'This unit has no phrases to make cards from.'}
          </p>
        </div>
        <div className="stack gap-2">
          {extra.length > 0 && (
            <button type="button" className="pill big wide" onClick={() => { setPractice(true); setDeck(extra); setS(startSession(extra.map((c) => c.id))); }}>
              Practise anyway · not scheduled
            </button>
          )}
          <Link to="/tapes/cards" className="pill solid big wide" style={{ textDecoration: 'none' }}>Back to the units</Link>
        </div>
      </Screen>
    );
  }

  if (pick.kind === 'done') {
    const hard = hardest(s);
    const back = comeBack(Object.values(written.current));
    const carried = Object.values(s.entries).filter((e) => e.carried).length;
    const easyFirst = Object.values(s.entries).filter((e) => (e.first ?? 0) >= 4).length;
    // what is left of this unit (or of the due pile) for another sitting
    const more = practice ? 0 : which === 'due' ? allDue(pack, state, dayNumber()).length : cardsOf(pack, [Number(which)], state).filter((c) => !state.cards[c.id] || isDue(c, state, dayNumber())).length;
    return (
      <Screen top={top} narrow className="tapes">
        <div className="page-head">
          <Label>{practice ? 'Extra round · not scheduled' : `${deck.length} cards · ${s.step} goes`}</Label>
          <h1 className="h-page tp-fc-title"><CardsIcon size={40} /> Deck done</h1>
          <p className="body" style={{ margin: 0 }}>
            {easyFirst} of {deck.length} you knew on first sight.{carried ? ` ${carried} carried to tomorrow for a fresh go.` : ''}
          </p>
        </div>
        {!practice && back.tomorrow + back.soon + back.later > 0 && (
          <div className="bigstats tp-fc-back">
            <div className="bigstat"><span className="label">Back tomorrow</span><span className="h-m num">{back.tomorrow}</span></div>
            <div className="bigstat"><span className="label">In 2–4 days</span><span className="h-m num">{back.soon}</span></div>
            <div className="bigstat"><span className="label">Later</span><span className="h-m num">{back.later}</span></div>
          </div>
        )}
        {hard.length > 0 && (
          <section style={{ marginTop: 6 }}>
            <ListHead title="Gave you the most trouble" />
            <div className="rows-end">
              {hard.map((e) => {
                const c = byId.get(e.id);
                if (!c) return null;
                return (
                  <div key={e.id} className="tp-item tp-item-top">
                    <span className="tp-item-main">
                      <Phrase v={c.item.variants[0]} hideRoman={state.hideRoman} lines={false} />
                      <span className="small">{plainMeaning(c.item.mean)} · {e.answers} go{e.answers === 1 ? '' : 'es'}{e.carried ? ' · tomorrow' : ''}</span>
                    </span>
                    <PlayButton clip={c.item.clip ? `${c.n}.${c.i}` : null} thai={thaiJoined(c.item.variants[0])} />
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <div className="stack gap-2" style={{ marginTop: 18 }}>
          {hard.length > 0 && (
            <button type="button" className="pill solid big wide" onClick={() => { setPractice(true); setS(startSession(hard.map((e) => e.id))); }}>
              One more round on these
            </button>
          )}
          {more > 0 && (
            <button type="button" className={`pill big wide ${hard.length ? '' : 'solid'}`} onClick={() => { setPractice(false); setDeck(null); setS(null); setPick(null); }}>
              Next sitting · {Math.min(more, SITTING)} cards{which !== 'due' ? ` (${more} left in unit ${which})` : ''}
            </button>
          )}
          <Link to="/tapes/cards" className={`pill big wide ${hard.length || more ? '' : 'solid'}`} style={{ textDecoration: 'none' }}>Back to the units</Link>
          {canUndo && <button type="button" className="pill text small" onClick={undo}>↶ Undo the last answer</button>}
          {which !== 'due' && <Link to={`/tapes/unit/${which}`} className="pill text small" style={{ textDecoration: 'none' }}>Open unit {which}</Link>}
        </div>
      </Screen>
    );
  }

  if (!card || !it || !v) return null;
  const pr = progress(s);
  const label = pick.kind === 'check' ? 'Quick check · still got it?' : pick.kind === 'flip' ? 'Same card, the other way round' : pick.fresh ? 'New' : `Again · ${s.entries[card.id]?.need ?? 0} to go`;
  const enFace = (
    <>
      {it.who !== '-' && <span className={`label tp-who-l ${it.who}`}>Say it as a {WHO_LABEL[it.who]}</span>}
      <div className="h-l tp-q">{plainMeaning(it.mean)}</div>
    </>
  );
  const thFace = <Phrase v={v} size="l" hideRoman={face === 'th' && !flipped ? true : state.hideRoman} />;
  const audioFace = (
    <div className="stack gap-2" style={{ alignItems: 'center' }}>
      <PlayButton clip={clip} thai={thaiJoined(v)} big />
      <span className="small">What does it mean?</span>
    </div>
  );

  return (
    <Screen top={top} narrow className="tapes tp-fc">
      <div className="stack gap-2">
        <div className="list-head" style={{ paddingBottom: 0 }}>
          <span className="label">{which === 'due' ? `Unit ${card.n} · ` : ''}{label}</span>
          <span className="small num">{pr.left} left · ~{pr.mins} min</span>
        </div>
        <Meter value={pr.total ? pr.cleared / pr.total : 0} colour="var(--pink)" />
      </div>

      <div className={`tp-fc-card ${flipped ? 'flipped' : ''} ${reducedMotion ? 'still' : ''} k-${pick.kind} ${drag >= FLING ? 'pull-good' : drag <= -FLING ? 'pull-blank' : ''} ${drag ? 'pulling' : ''}`}
        style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 22}deg)` } : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClick={() => !flipped && flip()} role={flipped ? undefined : 'button'} tabIndex={flipped ? -1 : 0} aria-label={flipped ? undefined : 'Turn the card over'}>
        {drag !== 0 && <span className={`tp-fc-pull ${drag > 0 ? 'good' : 'blank'}`} style={{ opacity: Math.min(1, Math.abs(drag) / FLING) }} aria-hidden="true">{drag > 0 ? 'Good' : '?'}</span>}
        <div className="tp-fc-inner" key={`${card.id}-${s.step}`}>
          <div className="tp-fc-face front" aria-hidden={flipped}>
            <span className="tp-fc-corner tl" aria-hidden="true">ผ</span>
            <span className="tp-fc-corner br" aria-hidden="true">ผ</span>
            {face === 'en' ? enFace : face === 'th' ? thFace : audioFace}
            {wait > 0 ? <span className="small tp-fc-hint">Ready in {wait}…</span> : <span className="small tp-fc-hint">{face === 'audio' ? 'Say what it means, then turn it over' : face === 'en' ? 'Say it out loud, then turn it over' : 'Say what it means, then turn it over'}</span>}
          </div>
          <div className="tp-fc-face back" aria-hidden={!flipped}>
            <span className="tp-fc-corner tl" aria-hidden="true">ผ</span>
            <span className="tp-fc-corner br" aria-hidden="true">ผ</span>
            {flipped && (
              <>
                <div className="tp-fc-answer">
                  <Phrase v={v} size="l" hideRoman={state.hideRoman} />
                  <div className="tp-fc-en">{plainMeaning(it.mean)}{it.who !== '-' && <span className={`tp-who ${it.who}`}>{WHO_LABEL[it.who]}</span>}</div>
                  {it.variants.length > 1 && <span className="small">or <span lang="th">{it.variants.slice(1).map((x) => x.map((w) => w.map((sy) => sy.th).join('')).join(' ')).join(', ')}</span></span>}
                </div>
                <div className="tp-fc-actions" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  <PlayButton clip={clip} thai={thaiJoined(v)} big />
                  <SayButton v={v} en={plainMeaning(it.mean)} clip={clip} pitch={it.pitch} melody={it.melody} big />
                </div>
                {(it.words.length > 1 || it.note) && (
                  <div className="tp-fc-detail">
                    {it.words.length > 1 && (
                      <dl className="tp-fc-words">
                        {it.words.map(([th, ro, g], k) => (
                          <div key={k}>
                            <dt lang="th">{th}</dt>
                            <dd><span className="tp-fc-ro">{ro}</span> {g}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {it.note && <p className="tp-fc-note"><NoteText html={it.note} /></p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="tp-review-foot">
        {!flipped ? (
          <button type="button" className="pill solid big wide" disabled={wait > 0} onClick={flip}>{wait > 0 ? `Ready in ${wait}` : 'Turn over'}</button>
        ) : (
          <div className="tp-fc-grades" role="group" aria-label="How well did you know it?">
            {GRADES.map(({ g, label: l, key, say }) => (
              <button key={g} type="button" className={`tp-fc-g g${g}`} onClick={() => rate(g)} aria-label={say ?? l}>
                <b>{l}</b>
                <kbd aria-hidden="true">{key}</kbd>
              </button>
            ))}
          </div>
        )}
        <div className="tp-fc-foot">
          <button type="button" className="pill text small" onClick={undo} disabled={!canUndo} aria-label="Take back the last answer">↶ Undo</button>
          <p className="small tp-fc-keys" aria-hidden="true">
            <span className="kb">Space turns over · 1–5 answer · U undoes</span>
            <span className="touch">{flipped ? 'Or drag it: ← ?  · Good →' : 'Tap the card to turn it over'}</span>
          </p>
        </div>
      </div>
    </Screen>
  );
}

