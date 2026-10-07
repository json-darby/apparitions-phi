// Custom lessons: describe a situation, the server writes a section in the
// same format as the built-in ones and checks it, you review it (delete or
// reword any line), then save it to this device. It appears on the map under
// "Mine". Generated Thai is marked "unchecked" (subtly): the server's rule
// checks and a second model have read it, but no course recipe built it.
// The section under review is kept on the device until it is saved or thrown
// away, so leaving the screen loses nothing.

import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { Link, navigate } from '../app/router';
import { useLiveHealth } from '../live/LivePanel';
import { Label, Screen, SectionHead, TopBar } from '../ui/kit';
import { courseLexicon, draftToRecord, dropLine, knownWords, recordNewWords, replaceLine, saveCustom, type CustomRecord } from './custom';
import { customUsable, requestCustom } from './customApi';
import { SCHOOL } from './names';
import { KEYS, loadPrefs } from './prefs';
import './school.css';

const EXAMPLES = ['Renting a scooter for three days', 'Dropping off laundry', 'Booking a boat trip to an island', 'At the barber', 'Buying a SIM card'];

interface Draft {
  record: CustomRecord;
  dropped: number;
  mock: boolean;
}

export default function SchoolCustom() {
  const { store, content, engine, settings } = useApp();
  const health = useLiveHealth();
  const online = customUsable(health);
  const lex = useMemo(() => courseLexicon(content.items), [content]);
  const [scenario, setScenario] = useState('');
  const [mine, setMine] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(() => store.get<Draft | null>(KEYS.customDraft, null));
  const [reword, setReword] = useState<{ id: string; en: string } | null>(null);

  const setDraft = (d: Draft | null) => {
    setDraftState(d);
    store.set(KEYS.customDraft, d);
  };

  const known = () => {
    const met = engine.introducedRefs();
    return knownWords(content.items, (id) => met.has(`item:${id}`), settings.adult);
  };

  const write = async () => {
    const text = scenario.trim();
    if (text.length < 4 || busy) return;
    setError(null);
    setBusy('Writing the lines, then checking them…');
    const r = await requestCustom({ scenario: text, mine: mine.trim() || undefined, identity: settings.identity, adult: settings.adult, known: known() });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    if (!('draft' in r)) return setError('The server sent something unexpected.');
    setDraft({ record: draftToRecord(r.draft, lex), dropped: r.draft.dropped, mock: r.draft.mock });
  };

  const rewordLine = async () => {
    if (!draft || !reword || busy) return;
    const en = reword.en.trim();
    if (!en) return;
    setError(null);
    setBusy('Rewording that line…');
    const r = await requestCustom({ scenario: draft.record.scenario, identity: settings.identity, adult: settings.adult, known: known(), reword: { en, context: draft.record.scenario } });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    if (!('line' in r)) return setError('The server sent something unexpected.');
    setDraft({ ...draft, record: replaceLine(draft.record, reword.id, r.line, lex) });
    setReword(null);
  };

  const save = () => {
    if (!draft || !draft.record.section.lines.length) return;
    const record = { ...draft.record, newWords: recordNewWords(draft.record, lex) };
    saveCustom(store, record);
    setDraft(null);
    navigate(`/school/section/${record.id}`, true);
  };

  const top = <TopBar mid={SCHOOL.name} parent="/school" />;

  // ---------- review ----------
  if (draft) {
    const r = draft.record;
    const me = settings.identity;
    const they = loadPrefs(store).they === 'm' ? 'm' : 'f';
    const fresh = recordNewWords(r, lex);
    const lines = r.section.lines;
    const answerOf = new Map(lines.map((l) => [l.id, l.en]));
    return (
      <Screen top={top} narrow>
        <Label>Mine · review before saving</Label>
        <input
          className="sn-title-input h-l"
          value={r.title}
          maxLength={60}
          aria-label="Lesson name"
          onChange={(e) => setDraft({ ...draft, record: { ...r, title: e.target.value, section: { ...r.section, title: e.target.value } } })}
        />
        <p className="body sn-scenario">{r.scenario}</p>
        <div className="sn-facts">
          <span>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          <span>{fresh.length} new word{fresh.length === 1 ? '' : 's'}</span>
          {draft.dropped > 0 && <span>{draft.dropped} dropped by the checks</span>}
          {r.adult && <span>18+</span>}
        </div>
        <p className="small sn-unchecked-note">
          <span className="sn-unchecked" aria-hidden /> Written and checked by machine: the Thai passed the rule checks and a second model’s reading, but not the course’s own recipes. Delete or reword anything that is not what you would say.
        </p>
        {draft.mock && <p className="small" style={{ color: 'var(--amber)', margin: 0 }}>Practice server: a sample lesson, no cost.</p>}
        {error && <p className="small" role="status" style={{ color: 'var(--amber)' }}>{error}</p>}

        <SectionHead title="Lines" note="What you say" />
        <ol className="sn-review">
          {lines.map((l) => {
            const f = l[me];
            const editing = reword?.id === l.id;
            const back = r.back[l.id];
            return (
              <li key={l.id} className="sn-review-line">
                <div className="sn-review-main">
                  <div className="thai-m" lang="th">{f.thai}</div>
                  <span className="roman">{f.roman}</span>
                  <div className="sn-review-en">{l.en}{l.id === r.section.door ? <span className="sn-tag-inline">Door phrase</span> : null}</div>
                  {back && back.toLowerCase() !== l.en.toLowerCase() && <div className="small sn-back">Reads back as: “{back}”</div>}
                  {l.replies.length > 0 && (
                    <ul className="sn-replies">
                      {l.replies.map((x) => (
                        <li key={x.id}>
                          They say <span className="thai" lang="th">{x[they].thai}</span> ({x.en}) → you: {answerOf.get(x.answer) ?? ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {editing && (
                    <form
                      className="sn-reword"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rewordLine();
                      }}
                    >
                      <label className="label" htmlFor={`rw-${l.id}`}>Say it as</label>
                      <input id={`rw-${l.id}`} type="text" value={reword.en} maxLength={160} onChange={(e) => setReword({ id: l.id, en: e.target.value })} autoFocus />
                      <div className="hrow wrap" style={{ gap: 8 }}>
                        <button type="submit" className="pill small solid sn-solid" disabled={!!busy || !online}>Rewrite</button>
                        <button type="button" className="pill small" onClick={() => setReword(null)}>Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
                {!editing && (
                  <div className="sn-review-actions">
                    <button type="button" className="pill small" disabled={!!busy || !online} onClick={() => setReword({ id: l.id, en: l.en })}>Reword</button>
                    <button type="button" className="pill small" disabled={!!busy} onClick={() => setDraft({ ...draft, record: dropLine(r, l.id) })} aria-label={`Delete: ${l.en}`}>Delete</button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {r.section.frames.length > 0 && (
          <>
            <SectionHead title="Frames" note="The frame stays, the word changes" />
            {r.section.frames.map((sf) => {
              const fr = r.frames.find((x) => x.id === sf.frame);
              if (!fr) return null;
              return (
                <div key={sf.frame} className="sn-frame">
                  <div className="hrow between wrap">
                    <span className="thai-m" lang="th">{fr[me].thai}</span>
                    <span className="label">{fr.en}</span>
                  </div>
                  <span className="roman">{fr[me].roman}</span>
                  <div className="sn-words">
                    {sf.words.map((w) => (
                      <span key={w.id}><span className="thai" lang="th">{w.word.thai}</span>{w.en}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {busy && <p className="small" role="status">{busy}</p>}
        <div className="sn-actions">
          <button type="button" className="pill solid sn-solid" disabled={!lines.length || !!busy} onClick={save}>Save to Mine</button>
          <button type="button" className="pill" disabled={!!busy} onClick={() => { setDraft(null); setReword(null); }}>Throw it away</button>
        </div>
      </Screen>
    );
  }

  // ---------- describe ----------
  const left = health?.custom?.requestsLeftToday;
  return (
    <Screen top={top} narrow>
      <Label>Mine · a lesson for your situation</Label>
      <h1 className="h-l" style={{ marginTop: 10 }}>Build a lesson</h1>
      <p className="body" style={{ maxWidth: '56ch', margin: '14px 0 0' }}>
        Describe a situation and the server writes 8 to 12 lines in your register, the replies you are likely to hear, and a frame or two. It prefers words you already know. You check every line before anything is saved.
      </p>

      <form
        className="sn-describe"
        onSubmit={(e) => {
          e.preventDefault();
          void write();
        }}
      >
        <label className="label" htmlFor="sn-scenario">The situation</label>
        <textarea id="sn-scenario" rows={3} maxLength={400} value={scenario} placeholder="Renting a scooter for three days" onChange={(e) => setScenario(e.target.value)} />
        <div className="sn-chips" aria-label="Examples">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="sn-chip" onClick={() => setScenario(x)}>{x}</button>
          ))}
        </div>
        <label className="label" htmlFor="sn-mine">Lines you want to say <span className="mut">· optional, in your own words</span></label>
        <textarea id="sn-mine" rows={3} maxLength={800} value={mine} placeholder={'Is a helmet included?\nCan I bring it back late?'} onChange={(e) => setMine(e.target.value)} />
        {!settings.adult && <p className="small" style={{ margin: 0 }}>18+ is off, so nightlife and dating situations are left out.</p>}
        {error && <p className="small" role="status" style={{ color: 'var(--amber)', margin: 0 }}>{error}</p>}
        {busy && <p className="small" role="status" style={{ margin: 0 }}>{busy} This can take up to a minute.</p>}
        <div className="sn-actions">
          <button type="submit" className="pill solid sn-solid" disabled={!online || scenario.trim().length < 4 || !!busy}>
            {busy ? 'Writing…' : 'Write the lesson'}
          </button>
          <Link to="/school" className="pill" style={{ textDecoration: 'none' }}>Map</Link>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {!online
            ? health === undefined ? 'Checking the server…' : 'Custom lessons are written on the server, so they need a connection (Settings → Talk live). Saved ones work offline.'
            : left != null ? `${left} left today${health?.mock ? ' · practice server, no cost' : ''}.` : ''}
        </p>
      </form>
    </Screen>
  );
}
