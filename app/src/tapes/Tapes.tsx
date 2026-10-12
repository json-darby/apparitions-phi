// The Tapes: a companion for an audio course, for a quick look on a break.
// Units (notes and phrases with the speakers' clips), flashcards, the
// reading lessons, the letters, the tone rules and tips. The course material
// comes from the learner's own study file, loaded once per device.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, useRoute } from '../app/router';
import { Label, ListHead, Meter, Row, Screen, Seg, Sheet, TopBar } from '../ui/kit';
import { importPack, removePack, unlockPack } from './db';
import { NotSealed, WrongPassword } from './sealed';
import { PackError, plainMeaning, searchPack, unitNumbers, unitTitle, type Pack } from './pack';
import { Phrase, PlayButton, ToneKey, WHO_LABEL, tapesChanged, useTapes } from './parts';
import { LettersTab, TipsTab, TonesTab } from './Guide';
import { UnitGrid } from './UnitJump';
import { dayNumber } from './review';
import { CardsLink, cardsOf } from './TapesCards';
import './tapes.css';

type Tab = 'units' | 'review' | 'reading' | 'letters' | 'tones' | 'tips';
const TABS: { v: Tab; label: string }[] = [
  { v: 'units', label: 'Units' },
  { v: 'review', label: 'Cards' },
  { v: 'reading', label: 'Reading' },
  { v: 'letters', label: 'Letters' },
  { v: 'tones', label: 'Tones' },
  { v: 'tips', label: 'Tips' },
];
const NEEDS_PACK: Tab[] = ['units', 'review', 'reading'];

export default function Tapes() {
  const route = useRoute();
  const { pack, state, update } = useTapes();
  const tab = (route.query.get('tab') as Tab) || 'units';
  const setTab = (t: Tab) => navigate(`/tapes?tab=${t}`, true);
  const [q, setQ] = useState('');
  const [manage, setManage] = useState(false);

  const nums = useMemo(() => (pack ? unitNumbers(pack) : []), [pack]);
  const heard = new Set(state?.heard ?? []);
  const next = nums.find((n) => !heard.has(n)) ?? nums[nums.length - 1];
  const resume = state?.lastUnit ?? next;
  const found = useMemo(() => (pack && q.trim().length > 1 ? searchPack(pack, q) : []), [pack, q]);

  return (
    <Screen top={<TopBar mid="The Tapes" parent="/extras" right={pack ? <CardsLink /> : undefined} />} narrow className="tapes">
      <div className="page-head" style={{ marginBottom: 16 }}>
        <Label>Extras · P******* companion{pack ? ` · ${nums.length} units` : ''}</Label>
        <h1 className="h-page">The Tapes</h1>
        <p className="body" style={{ margin: 0 }}>What you just heard on the course, written down: notes, phrases and the speakers' own clips.</p>
      </div>

      <div className="lib-tabs">
        <Seg label="Tapes section" value={tab} onChange={setTab} options={TABS} />
      </div>

      {pack === undefined && <p className="small" style={{ marginTop: 20 }}>Opening…</p>}

      {pack === null && NEEDS_PACK.includes(tab) && <LoadPack />}

      {pack && tab === 'units' && (
        <section style={{ marginTop: 18 }}>
          <div className="tp-jump-wrap">
            <ListHead title="Go to a unit" note={`${heard.size} of ${nums.length} heard`} />
            <UnitGrid nums={nums} heard={[...heard]} current={state?.lastUnit} onPick={(n) => navigate(`/tapes/unit/${n}`)} />
          </div>
          {resume != null && (
            <div className="card tp-resume">
              <div className="list-head" style={{ paddingBottom: 0 }}>
                <span className="label">{state?.lastUnit ? 'Pick up where you left off' : 'Start here'}</span>
                <span className="small num">{pack.units[String(resume)]?.length ?? 0} phrases</span>
              </div>
              <div className="tp-resume-title">
                <span className="h-m">Unit {resume}</span>
                <span className="body">{unitTitle(pack, resume)}</span>
              </div>
              <Meter value={nums.length ? heard.size / nums.length : 0} colour="var(--blue)" />
              <div className="hrow wrap" style={{ gap: 8 }}>
                <Link to={`/tapes/unit/${resume}`} className="pill solid" style={{ textDecoration: 'none' }}>Open unit {resume}</Link>
                <Link to={`/tapes/cards/${resume}`} className="pill" style={{ textDecoration: 'none' }}>Unit {resume} cards</Link>
              </div>
            </div>
          )}

          <label className="search" style={{ marginTop: 18 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
            <input type="search" placeholder="Find a phrase you heard" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search every unit" />
          </label>

          {q.trim().length > 1 ? (
            <div style={{ marginTop: 14 }}>
              <ListHead title="Found" note={found.length >= 40 ? 'first 40' : `${found.length}`} />
              {found.length === 0 && <p className="small">Nothing yet. Try the English, the Thai, or the sound without tone marks (kao jai).</p>}
              <div className="rows-end">
                {found.map(({ n, i, item }) => (
                  <div key={`${n}.${i}`} className="tp-item tp-item-top">
                    <Link to={`/tapes/unit/${n}?at=${i}`} className="tp-item-main" style={{ textDecoration: 'none' }}>
                      <Phrase v={item.variants[0]} hideRoman={state?.hideRoman} lines={false} />
                      <span className="small">{plainMeaning(item.mean)}{item.who !== '-' && <span className={`tp-who ${item.who}`}>{WHO_LABEL[item.who]}</span>} · unit {n}</span>
                    </Link>
                    <PlayButton clip={item.clip ? `${n}.${i}` : null} thai={item.variants[0].map((w) => w.map((s) => s.th).join('')).join('')} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 22 }}>
              <ListHead title="Units" note="Tap the circle once you've heard it" />
              <div className="rows-end">
                {nums.map((n) => {
                  const done = heard.has(n);
                  return (
                    <div key={n} className={`tp-unit ${done ? 'is-done' : ''}`}>
                      <Link to={`/tapes/unit/${n}`} className="tp-unit-main" style={{ textDecoration: 'none' }}>
                        <span className="tp-unit-n num">{n}</span>
                        <span className="tp-unit-t">{unitTitle(pack, n)}</span>
                        <span className="small num tp-unit-c">{pack.units[String(n)].length}</span>
                      </Link>
                      <button
                        type="button"
                        className={`tp-check ${done ? 'on' : ''}`}
                        aria-pressed={done}
                        aria-label={`Unit ${n} heard`}
                        onClick={() => update((s) => ({ heard: done ? s.heard.filter((x) => x !== n) : [...s.heard, n] }))}
                      >
                        {done && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="pill text small" style={{ marginTop: 16 }} onClick={() => setManage(true)}>Your study file</button>
            </div>
          )}
        </section>
      )}

      {pack && tab === 'review' && state && <CardsTab pack={pack} />}

      {pack && tab === 'reading' && (
        <section style={{ marginTop: 18 }}>
          <p className="body" style={{ marginTop: 0 }}>The booklet's reading lessons. Read each line yourself first, then play it and open "why" to check the tones.</p>
          <div className="rows-end">
            {pack.reading.map((L) => (
              <Row key={L.n} to={`/tapes/reading/${L.n}`} right={`${L.items.length} lines`}>Reading lesson {L.n}</Row>
            ))}
          </div>
          <div className="hrow wrap" style={{ gap: 8, marginTop: 16 }}>
            <Link to="/tapes/tone-drill" className="pill" style={{ textDecoration: 'none' }}>Tone drill</Link>
          </div>
        </section>
      )}

      {tab === 'letters' && <LettersTab />}
      {tab === 'tones' && <TonesTab />}
      {tab === 'tips' && <TipsTab />}

      {manage && pack && <ManageSheet pack={pack} onClose={() => setManage(false)} />}
    </Screen>
  );
}

function CardsTab({ pack }: { pack: Pack }) {
  const { state } = useTapes();
  if (!state) return null;
  const today = dayNumber();
  const all = cardsOf(pack, unitNumbers(pack), state);
  const started = all.filter((c) => state.cards[c.id]).length;
  const due = all.filter((c) => state.cards[c.id] && state.cards[c.id].due <= today).length;
  return (
    <section style={{ marginTop: 18 }}>
      <p className="body" style={{ marginTop: 0 }}>
        Flashcards for each unit: the English on the front, say the Thai out loud, turn it over to check against the speaker. Hard ones come back more often in the same sitting; each card then returns on a later day, when it's due.
      </p>
      <div className="bigstats" style={{ margin: '14px 0' }}>
        <div className="bigstat"><span className="label">Due today</span><span className="h-m num">{due}</span></div>
        <div className="bigstat"><span className="label">Cards met</span><span className="h-m num">{started}</span></div>
        <div className="bigstat"><span className="label">In all</span><span className="h-m num">{all.length}</span></div>
      </div>
      <div className="stack gap-2">
        {due > 0 && <Link to="/tapes/cards/due" className="pill solid big wide" style={{ textDecoration: 'none' }}>Due today · {due}</Link>}
        <Link to="/tapes/cards" className={`pill big wide ${due > 0 ? '' : 'solid'}`} style={{ textDecoration: 'none' }}>Choose a unit</Link>
      </div>
    </section>
  );
}

/** Nothing on this device yet: unlock the pack with the password (or, failing that, choose the study file). */
export function LoadPack() {
  const input = useRef<HTMLInputElement>(null);
  const pwBox = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fileWay, setFileWay] = useState(false);
  // after a wrong try the box comes back focused with its text selected, ready to retype
  useEffect(() => {
    if (err && busy == null) pwBox.current?.select();
  }, [err, busy]);
  const unlock = async () => {
    if (!pw.trim() || busy != null) return;
    setErr(null);
    setBusy(0);
    try {
      await unlockPack(pw, setBusy);
      tapesChanged();
    } catch (e) {
      setErr(e instanceof WrongPassword
        ? "That password isn't right."
        : e instanceof NotSealed || (e as Error)?.message?.startsWith('download')
          ? "Couldn't download the Tapes just now. Check the connection and try again."
          : `Couldn't keep them on this device (${(e as Error)?.message ?? 'storage refused'}). Free some space and try again.`);
    } finally {
      setBusy(null);
    }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setBusy(0);
    try {
      await importPack(f, setBusy);
      tapesChanged();
    } catch (e) {
      setErr(e instanceof PackError
        ? "That file doesn't look like the Thai study page. Choose the index.html that holds your units (about 60 MB)."
        : `Couldn't keep it on this device (${(e as Error)?.message ?? 'storage refused'}). Free some space and try again.`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card tp-load" style={{ marginTop: 18 }}>
      <Label fg>Unlock The Tapes</Label>
      <p className="body" style={{ margin: 0 }}>
        Type the password once on this device. The units and the speakers' clips download (about 50 MB) and stay here, offline.
      </p>
      {busy != null ? (
        <div className="stack gap-2">
          <Meter value={busy} colour="var(--blue)" />
          <span className="small num">{busy < 0.76 ? 'Downloading' : 'Keeping it on this device'}… {Math.round(busy * 100)}%</span>
        </div>
      ) : (
        <form className="stack gap-3" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <label className="tp-pw">
            <span className="sr-only">Password</span>
            <input
              ref={pwBox}
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
          </label>
          <button type="submit" className="pill solid big wide" disabled={!pw.trim()}>Unlock</button>
        </form>
      )}
      {err && <p className="small" style={{ color: 'var(--bad)', margin: 0 }} role="alert">{err}</p>}
      {busy == null && (fileWay ? (
        <div className="stack gap-2">
          <p className="small" style={{ margin: 0 }}>Or load the study page (index.html) straight from this device.</p>
          <input ref={input} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" className="pill wide" onClick={() => input.current?.click()}>Choose the study file</button>
        </div>
      ) : (
        <button type="button" className="tp-more" onClick={() => setFileWay(true)}>Have the study file instead?</button>
      ))}
      <p className="small" style={{ margin: 0 }}>Letters, Tones and Tips work without it.</p>
    </section>
  );
}

function ManageSheet({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const n = unitNumbers(pack).length;
  const phrases = Object.values(pack.units).reduce((a, u) => a + u.length, 0);
  return (
    <Sheet onClose={onClose} label="Your study file">
      <div className="stack gap-4">
        <h2 className="h-m">Your study file</h2>
        <p className="body" style={{ margin: 0 }}>
          {n} units, {phrases.toLocaleString()} phrases and {pack.reading.length} reading lessons, loaded {new Date(pack.loadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. Kept on this device only.
        </p>
        <input ref={input} type="file" accept=".html,.htm,text/html" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(0);
          try {
            await importPack(f, setBusy);
            tapesChanged();
            onClose();
          } catch {
            setBusy(null);
          }
        }} />
        {busy != null ? <Meter value={busy} colour="var(--blue)" /> : (
          <div className="btn-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <button type="button" className="pill" onClick={() => input.current?.click()}>Load a newer one</button>
            <button type="button" className="pill" onClick={async () => { await removePack(); tapesChanged(); onClose(); }}>Remove it</button>
          </div>
        )}
        <p className="small" style={{ margin: 0 }}>Removing it keeps your ticks and review cards, so loading it again picks up where you were.</p>
        <button type="button" className="pill text" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}

export { ToneKey };
