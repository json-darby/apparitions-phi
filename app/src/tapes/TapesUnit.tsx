// One unit of the course: its notes, then every phrase with the speaker's clip,
// a say-it-yourself button and the "why" behind each tone.

import { useEffect, useState } from 'react';
import { Link, navigate, useRoute } from '../app/router';
import { Label, ListHead, Screen, Seg, Toggle, TopBar } from '../ui/kit';
import { LoadPack } from './Tapes';
import { JumpButton } from './UnitJump';
import { CardsIcon } from './TapesCards';
import { plainMeaning, thaiJoined, unitNumbers, unitTitle, type UnitItem } from './pack';
import { NoteText, Phrase, PlayButton, SayButton, ToneKey, WHO_LABEL, WhyList, stopTapes, useTapes } from './parts';
import './tapes.css';

type Who = 'all' | 'm' | 'f';

export default function TapesUnit({ params }: { params: Record<string, string> }) {
  const route = useRoute();
  const n = Number(params.n);
  const at = route.query.get('at');
  const { pack, state, update } = useTapes();
  const [open, setOpen] = useState<number | null>(at != null ? Number(at) : null);
  const [allNotes, setAllNotes] = useState(false);

  useEffect(() => {
    if (pack && state && state.lastUnit !== n) update({ lastUnit: n });
  }, [pack, n, state?.lastUnit]); // eslint-disable-line react-hooks/exhaustive-deps

  // another unit opens at its top (a search result scrolls to its phrase below)
  useEffect(() => {
    if (at == null) window.scrollTo(0, 0);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  // a search result: bring that phrase into view
  useEffect(() => {
    if (at == null || !pack) return;
    setOpen(Number(at));
    const t = setTimeout(() => document.getElementById(`tp-${n}-${at}`)?.scrollIntoView({ block: 'center' }), 60);
    return () => clearTimeout(t);
  }, [at, n, pack]);

  useEffect(() => () => stopTapes(), []);

  const bare = <TopBar mid={`Unit ${n}`} parent="/tapes" />;
  if (pack === undefined || !state) return <Screen top={bare} narrow><p className="small">Opening…</p></Screen>;
  if (pack === null) return <Screen top={bare} narrow className="tapes"><LoadPack /></Screen>;
  const top = <TopBar mid={`Unit ${n}`} parent="/tapes" right={<JumpButton nums={unitNumbers(pack)} heard={state.heard} current={n} />} />;

  const items = pack.units[String(n)];
  const nums = unitNumbers(pack);
  const k = nums.indexOf(n);
  const prev = k > 0 ? nums[k - 1] : null;
  const next = k >= 0 && k < nums.length - 1 ? nums[k + 1] : null;
  if (!items) return <Screen top={top} narrow><p className="body">There's no unit {n} in your study file.</p><Link to="/tapes">Back to The Tapes</Link></Screen>;

  const notes = pack.notes[String(n)] ?? [];
  const who: Who = state.who ?? 'all';
  const heard = state.heard.includes(n);
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => who === 'all' || it.who === '-' || it.who === who);

  return (
    <Screen top={top} narrow className="tapes">
      <div className="page-head" style={{ marginBottom: 18 }}>
        <Label>Unit {n} · {items.length} phrases</Label>
        <h1 className="h-page tp-unit-h">{unitTitle(pack, n)}</h1>
        <Link to={`/tapes/cards/${n}`} className="pill small tp-cards-link" style={{ textDecoration: 'none', alignSelf: 'flex-start', marginTop: 10 }}>
          <CardsIcon size={22} /> Flashcards for unit {n}
        </Link>
      </div>

      {notes.length > 0 && (
        <div className="card tp-notes">
          <div className="list-head" style={{ paddingBottom: 0 }}>
            <span className="label fg">How it works</span>
            <span className="small">{notes.length} notes</span>
          </div>
          <ul>
            {(allNotes ? notes : notes.slice(0, 3)).map((x, i) => (
              <li key={i} className="body"><NoteText html={x} /></li>
            ))}
          </ul>
          {notes.length > 3 && (
            <button type="button" className="tp-more" onClick={() => setAllNotes((a) => !a)}>
              {allNotes ? 'Show fewer' : `All ${notes.length} notes`}
            </button>
          )}
        </div>
      )}

      <div className="tp-bar">
        <ListHead title="Phrases" />
        <div className="hrow wrap" style={{ gap: 10 }}>
          <Seg label="Speaker" value={who} onChange={(v) => update({ who: v })} options={[{ v: 'all', label: 'Both' }, { v: 'm', label: 'Man' }, { v: 'f', label: 'Woman' }]} />
          <span className="hrow small" style={{ gap: 8 }}>
            <Toggle on={!state.hideRoman} onChange={(v) => update({ hideRoman: !v })} label="Show romanisation" />
            Sounds
          </span>
        </div>
      </div>
      <ToneKey />
      <p className="small" style={{ margin: '6px 0 0' }}>Tap a phrase for its words, note and why each tone is what it is.</p>

      <div className="rows-end" style={{ marginTop: 8 }}>
        {shown.map(({ it, i }) => (
          <PhraseRow key={i} id={`tp-${n}-${i}`} it={it} clip={it.clip ? `${n}.${i}` : null} open={open === i} onOpen={() => setOpen(open === i ? null : i)} hideRoman={state.hideRoman} />
        ))}
      </div>

      <div className="tp-foot">
        <button type="button" className={`pill big wide ${heard ? '' : 'solid'}`} onClick={() => update((s) => ({ heard: heard ? s.heard.filter((x) => x !== n) : [...s.heard, n] }))}>
          {heard ? `Unit ${n} heard ✓` : `Mark unit ${n} heard`}
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" className="pill" disabled={prev == null} onClick={() => prev != null && navigate(`/tapes/unit/${prev}`, true)}>← Unit {prev ?? ''}</button>
          <button type="button" className="pill" disabled={next == null} onClick={() => next != null && navigate(`/tapes/unit/${next}`, true)}>Unit {next ?? ''} →</button>
        </div>
      </div>
    </Screen>
  );
}

export function PhraseRow({ id, it, clip, open, onOpen, hideRoman }: { id?: string; it: UnitItem; clip: string | null; open: boolean; onOpen: () => void; hideRoman?: boolean }) {
  const v = it.variants[0];
  const meaning = plainMeaning(it.mean);
  return (
    <div className={`tp-item ${open ? 'open' : ''}`} id={id}>
      <div className="tp-item-top">
        <button type="button" className="tp-item-main" onClick={onOpen} aria-expanded={open}>
          {it.variants.map((x, k) => (
            <span key={k} className="tp-variant">
              {k > 0 && <span className="tp-or">or</span>}
              <Phrase v={x} hideRoman={hideRoman} />
            </span>
          ))}
          <span className="tp-mean">
            {meaning}
            {it.who !== '-' && <span className={`tp-who ${it.who}`}>{WHO_LABEL[it.who]}</span>}
          </span>
        </button>
        <div className="tp-acts">
          <PlayButton clip={clip} thai={thaiJoined(v)} />
          <SayButton v={v} en={meaning} clip={clip} pitch={it.pitch} melody={it.melody} />
        </div>
      </div>
      {open && (
        <div className="tp-detail">
          {it.words.length > 1 && (
            <div className="tp-words">
              {it.words.map(([th, ro, g], k) => (
                <div key={k} className="tp-wordrow">
                  <span className="thai" lang="th">{th}</span>
                  <span className="tp-wro">{ro}</span>
                  <span className="small">{g}</span>
                </div>
              ))}
            </div>
          )}
          {it.note && <p className="body" style={{ margin: 0 }}><NoteText html={it.note} /></p>}
          <details className="tp-whybox">
            <summary>Why these tones</summary>
            <WhyList variants={it.variants} />
          </details>
        </div>
      )}
    </div>
  );
}
