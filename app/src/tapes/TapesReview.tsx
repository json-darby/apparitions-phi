// A short review on a break: the English (and who is speaking), you say the
// Thai out loud, then check it against the speaker and grade yourself.

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../app/router';
import { Label, Meter, Screen, TopBar } from '../ui/kit';
import { LoadPack } from './Tapes';
import { plainMeaning, thaiJoined } from './pack';
import { NoteText, Phrase, PlayButton, SayButton, ToneKey, WHO_LABEL, playClip, speak, stopTapes, useTapes } from './parts';
import { dayNumber, dueCount, grade, gradeLabel, nextCard, type Grade } from './review';
import './tapes.css';

export default function TapesReview() {
  const { pack, state, update } = useTapes();
  const [lastId, setLastId] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => () => stopTapes(), []);

  const heard = state?.heard ?? [];
  const pick = useMemo(() => (pack && state ? nextCard(pack, state, heard, lastId) : null), [pack, state, lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = pack && state ? dueCount(pack, state, heard) : null;
  const left = counts ? counts.due + counts.fresh : 0;

  const top = <TopBar mid="Tapes review" parent="/tapes?tab=review" />;
  if (pack === undefined || !state) return <Screen top={top} narrow><p className="small">Opening…</p></Screen>;
  if (pack === null) return <Screen top={top} narrow className="tapes"><LoadPack /></Screen>;

  if (!pick) {
    return (
      <Screen top={top} narrow className="tapes">
        <div className="page-head">
          <Label>{done ? `${done} cards today` : 'Nothing due'}</Label>
          <h1 className="h-page">All done</h1>
          <p className="body" style={{ margin: 0 }}>
            {heard.length === 0 ? 'Mark the units you have heard and their phrases join the review.' : 'Come back after your next unit, or tomorrow for the cards that are due then.'}
          </p>
        </div>
        <Link to="/tapes" className="pill solid big wide" style={{ textDecoration: 'none' }}>Back to The Tapes</Link>
      </Screen>
    );
  }

  const { card, isNew } = pick;
  const it = card.item;
  const v = it.variants[0];
  const clip = it.clip ? `${card.n}.${card.i}` : null;
  const prev = state.cards[card.id];

  const show = () => {
    setShown(true);
    if (clip) void playClip(clip);
    else speak(thaiJoined(v));
  };
  const rate = (g: Grade) => {
    const today = dayNumber();
    update((s) => ({
      cards: { ...s.cards, [card.id]: grade(s.cards[card.id], g, today) },
      intro: s.cards[card.id] ? s.intro : { ...s.intro, [today]: (s.intro[String(today)] ?? 0) + 1 },
    }));
    stopTapes();
    setLastId(card.id);
    setShown(false);
    setDone((d) => d + 1);
  };

  return (
    <Screen top={top} narrow className="tapes tp-review">
      <div className="stack gap-2">
        <div className="list-head" style={{ paddingBottom: 0 }}>
          <span className="label">Unit {card.n}{isNew ? ' · new' : ''}</span>
          <span className="small num">{done} done · {left} left</span>
        </div>
        <Meter value={done / Math.max(1, done + left)} colour="var(--blue)" />
      </div>

      <div className="tp-card">
        {it.who !== '-' && <span className={`label tp-who-l ${it.who}`}>Say it as a {WHO_LABEL[it.who]}</span>}
        <div className="h-l tp-q">{plainMeaning(it.mean)}</div>
        {!shown && <p className="small" style={{ margin: 0 }}>Say it out loud first, then check.</p>}
        {shown && (
          <div className="tp-answer">
            <Phrase v={v} size="l" />
            {it.variants.length > 1 && <span className="small">or {it.variants.slice(1).map((x) => x.map((w) => w.map((s) => s.th).join('')).join(' ')).join(', ')}</span>}
            <div className="hrow" style={{ gap: 10, justifyContent: 'center' }}>
              <PlayButton clip={clip} thai={thaiJoined(v)} big />
              <SayButton v={v} en={plainMeaning(it.mean)} big />
            </div>
            {it.note && <p className="small" style={{ margin: 0 }}><NoteText html={it.note} /></p>}
            <ToneKey />
          </div>
        )}
      </div>

      <div className="tp-review-foot">
        {!shown ? (
          <button type="button" className="pill solid big wide" onClick={show}>Show answer</button>
        ) : (
          <div className="tp-grades" role="group" aria-label="How did it go?">
            <button type="button" className="pill big" onClick={() => rate(0)}><b>Again</b><span>{gradeLabel(prev, 0)}</span></button>
            <button type="button" className="pill big" onClick={() => rate(1)}><b>Good</b><span>{gradeLabel(prev, 1)}</span></button>
            <button type="button" className="pill big" onClick={() => rate(2)}><b>Easy</b><span>{gradeLabel(prev, 2)}</span></button>
          </div>
        )}
      </div>
    </Screen>
  );
}
