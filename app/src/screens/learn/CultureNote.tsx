// Culture note: one short fact between blocks, with a dot animation above
// (phone) or to the left (tablet, desktop). ?day= opens another day's note.

import { useApp } from '../../app/context';
import { useDevice } from '../../app/device';
import { navigate, useRoute } from '../../app/router';
import { PlayIcon } from '../../audio/SoundLayer';
import { Apparition, ObjectTurn } from '../../anim';
import type { CultureNote as Note_, Item } from '../../content/types';
import { KeyHints, Label, Note, Screen, TopBar } from '../../ui/kit';
import { useKeys } from '../../input/keys';
import './learn.css';
import { ContinueLink } from '../../ui/NextStep';

/** What turns in the dots for each note; a person for notes about people. */
const ART: Record<string, { object?: string; who?: string; colour: string }> = {
  'c-wai': { who: 'pim', colour: '#E8E8E8' },
  'c-street-food': { object: 'A plate of fried rice', colour: '#FFB03A' },
  'c-baht': { object: 'A 100 baht note', colour: '#FFB03A' },
  'c-ice': { object: 'A glass of tube ice', colour: '#2EE6E6' },
  'c-haggling': { object: 'A market stall', colour: '#FFB03A' },
};

export default function CultureNote() {
  const { engine, content, sound, reducedMotion } = useApp();
  const { device } = useDevice();
  const { query } = useRoute();
  const today = engine.day();
  // ?id= opens any unlocked note; ?day= the note for an earlier day
  const id = query.get('id');
  const asked = Number(query.get('day'));
  const day = Number.isFinite(asked) && asked > 0 ? Math.min(asked, today) : today;
  const byId = id ? content.culture.find((c) => c.id === id) : undefined;
  const locked = !!byId && byId.day > today;
  const note = id ? (locked ? undefined : byId) : content.cultureForDay(day);
  const sorted = [...content.culture].filter((c) => c.day <= today).sort((a, b) => a.day - b.day);
  const idx = note ? sorted.findIndex((c) => c.id === note.id) : -1;
  const prev: Note_ | undefined = idx > 0 ? sorted[idx - 1] : undefined;
  const next: Note_ | undefined = idx >= 0 ? sorted[idx + 1] : undefined;
  const open = (c: Note_ | undefined) => c && navigate(`/culture?id=${encodeURIComponent(c.id)}`, true);

  useKeys((a) => {
    if (a.type === 'move' && a.down && a.dx) {
      open(a.dx < 0 ? prev : next);
      return true;
    }
  });

  if (!note) {
    return (
      <Screen top={<TopBar mid="Culture note" parent="/" />} narrow>
        <h1 className="h-l">{locked ? `Opens on day ${byId!.day}.` : id ? 'Not found.' : 'No note today.'}</h1>
      </Screen>
    );
  }

  const art = ART[note.id] ?? { who: 'pim', colour: '#E8E8E8' };
  const items = note.items.map((id) => content.item(id)).filter((x): x is Item => !!x);

  return (
    <Screen top={<TopBar mid="Culture note" parent="/" />}>
      <div className="culture-grid">
        <div className="culture-art">
          {art.object ? (
            <ObjectTurn object={art.object} colour={art.colour} style={{ width: '100%', height: '100%', minHeight: device === 'phone' ? 220 : 420 }} />
          ) : (
            <Apparition who={art.who ?? 'pim'} mode={reducedMotion ? 'still' : 'idle'} colour={art.colour} style={{ width: '100%', height: device === 'phone' ? 220 : 420 }} />
          )}
        </div>
        <div className="stack gap-4">
          <Label>Day {note.day} · culture note</Label>
          <h1 className="h-l">{note.title}</h1>
          <p className="body" style={{ fontSize: 17, lineHeight: 1.55, margin: 0, maxWidth: '54ch' }}>{note.body}</p>
          {items.length > 0 && (
            <div className="stack gap-1">
              <Label>Words in this note</Label>
              {items.map((it) => (
                <div key={it.id} className="row" style={{ cursor: 'default' }}>
                  <span className="hrow" style={{ gap: 12 }}>
                    <button
                      type="button"
                      className="iconbtn ghost"
                      style={{ width: 36, height: 36 }}
                      aria-label={`Hear ${it.en}`}
                      onClick={() => sound.play({ ref: `item:${it.id}`, thai: it.thai, roman: it.roman, en: it.en, tones: it.tones })}
                    >
                      <PlayIcon size={14} />
                    </button>
                    <span>
                      <span className="thai-m" lang="th">{it.thai}</span>
                      <span className="small" style={{ display: 'block' }}>{it.roman}</span>
                    </span>
                  </span>
                  <span className="row-right">{it.en}</span>
                </div>
              ))}
            </div>
          )}
          {note.status === 'placeholder' && <Note>Placeholder note. The checked set of 30 arrives with the full content in Phase 4.</Note>}
          <div className="learn-foot" style={{ marginTop: 'var(--s6)' }}>
            <div className="btn-row three">
              <button className="pill" type="button" onClick={() => open(prev)} disabled={!prev}>Previous</button>
              <button className="pill" type="button" onClick={() => open(next)} disabled={!next}>Next note</button>
              <ContinueLink current="culture" />
            </div>
            {device === 'desktop' && <KeyHints hints={[['←', 'Previous note'], ['→', 'Next note']]} />}
          </div>
        </div>
      </div>
    </Screen>
  );
}
