// Cast: the eight people of the street, each clearer as you know them. Today's
// constellation (everyone you spoke to today) sits on top when there is one.

import { useMemo } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { Apparition, Constellation } from '../anim';
import { startOfDay } from '../core/dates';
import { PLACES } from '../content/seed';
import { personForSource, tasksFor } from '../content/street-seed';
import { Label, Screen, TopBar } from '../ui/kit';
import { placeColour, useStreet } from './parts/common';
import { clarityFor, repOf } from './state';
import { RepStars } from './parts/RepStars';
import './street.css';

export default function Cast() {
  const { content, store, settings, reducedMotion } = useApp();
  const v = useStoreVersion();
  const [street] = useStreet();
  const tasks = useMemo(() => tasksFor(settings.identity).filter((t) => !t.adult || settings.adult), [settings.identity, settings.adult]);

  const today = useMemo(() => {
    const rows = store.all<{ source: string }>("SELECT DISTINCT source FROM log WHERE (source LIKE 'street:%' OR source LIKE 'live:%') AND at >= ?", [startOfDay(Date.now())]);
    const people = new Set<string>();
    for (const r of rows) {
      const p = personForSource(r.source);
      if (p) people.add(p);
    }
    return [...people];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, v]);

  return (
    <Screen top={<TopBar mid="Cast" parent="/" />}>
      <Label>The Street</Label>
      <h1 className="h-xl" style={{ margin: '10px 0 12px' }}>Cast</h1>
      <p className="body" style={{ marginTop: 0, maxWidth: '54ch' }}>
        Eight people. They come into focus as you get to know them.
      </p>
      {today.length > 0 && (
        <section style={{ margin: '12px 0 28px' }}>
          <Label>Spoken to today</Label>
          <Constellation people={today} style={{ minHeight: 160 }} />
          <p className="small" style={{ margin: 0 }}>{today.map((id) => content.person(id)?.name ?? id).join(', ')}.</p>
        </section>
      )}
      <div className="cast-grid">
        {content.cast.map((c) => {
          const rep = repOf(street, c.id);
          const theirs = tasks.filter((t) => t.person === c.id && !t.chapter);
          const done = theirs.filter((t) => street.done.includes(t.id)).length;
          const place = PLACES.find((p) => p.id === c.place);
          const colour = c.place ? placeColour(c.place) : '#E8E8E8';
          const met = street.met?.includes(c.id);
          return (
            <article key={c.id} className="cast-card">
              <div className="art" style={{ position: 'relative' }}>
                {c.place && <RepStars rep={rep} name={c.name} colour={colour} style={{ top: '10%', right: '16%' }} />}
                <Apparition who={c.id} mode={reducedMotion ? 'still' : 'idle'} colour={colour} clarity={c.id === 'pim' ? 0.92 : clarityFor(rep)} label={`${c.name}, ${met ? 'drawn in light' : 'not yet met'}`} />
              </div>
              <div className="hrow between" style={{ alignItems: 'baseline' }}>
                <b style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{c.name}</b>
                {place && <span className="small" lang="th" style={{ color: colour }}>{place.thaiSign}</span>}
              </div>
              <div className="small">{c.role} · {c.age}</div>
              {c.place ? (
                <>
                  <div className="hrow between small">
                    <span>Reputation</span>
                    <span className="num">{Math.max(0, rep) / 2} of 5 stars</span>
                  </div>
                  <div className="small">{theirs.length ? `${done} of ${theirs.length} tasks done` : 'No tasks yet'}{met ? '' : ' · not met'}</div>
                </>
              ) : (
                <div className="small">Your guide. Narrates; never on the street.</div>
              )}
            </article>
          );
        })}
      </div>
      <p className="small" style={{ marginTop: 32 }}>
        Every person in the app is AI-generated and credited as such. None is based on a real person.
      </p>
    </Screen>
  );
}
