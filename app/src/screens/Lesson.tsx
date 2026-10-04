// Today's lesson: a short page on how Thai works for one course day, the
// foundation under that day's words (content/lessons.ts). ?day=N opens another
// day (default: today); ?from=library makes Back return to the library list.
// Every example plays its real clip, in the learner's own voice and form where
// the item has forms or a polite ending. Nothing here reaches the memory engine.

import { useEffect, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { Link, back, navigate, useRoute } from '../app/router';
import { PlayIcon } from '../audio/SoundLayer';
import { lessonDay, lessonFor, ownFirst, type LessonSection } from '../content/lessons';
import type { Item, VoiceId } from '../content/types';
import { myVoiceFor, type Settings } from '../core/settings';
import { useKeys } from '../input/keys';
import { KeyHints, Label, Screen, TopBar } from '../ui/kit';
import { FitText } from '../ui/FitText';
import { isFemale, listenForm } from './learn/parts/common';
import './lesson.css';

/** Where Back goes: the library list, a path the caller passed, or home. */
function backTo(from: string | null): string {
  if (from === 'library') return '/library?tab=lessons';
  if (from && from.startsWith('/') && !from.startsWith('//')) return from;
  return '/';
}

/** The learner's own voice, kept to their speaking identity so forms and endings are theirs. */
function ownVoice(s: Settings): VoiceId {
  const v = myVoiceFor(s);
  if (isFemale(v) === (s.identity === 'f')) return v;
  return s.identity === 'f' ? 'f1' : 'm1';
}

/** A paragraph with any Thai word set in the Thai face. */
function Para({ text }: { text: string }) {
  const parts = text.split(/([฀-๿]+)/);
  return (
    <p className="lesson-p">
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="thai" lang="th">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </p>
  );
}

function Example({ item, voice, onPlay }: { item: Item; voice: VoiceId; onPlay: (it: Item) => void }) {
  const said = listenForm(item, voice);
  return (
    <li>
      <button type="button" className="lesson-ex" onClick={() => onPlay(item)} aria-label={`Hear ${said.roman}, ${item.en}`}>
        {/* every row one height: a long phrase or meaning gets smaller type, not a taller row */}
        <span className="lesson-ex-text">
          <FitText as="span" className="lesson-ex-thai" lang="th" min={16}>{said.thai}</FitText>
          <FitText as="span" className="lesson-ex-sub" lines={2} min={10.5} valign="top">
            <span className="roman">{said.roman}</span> <span className="mut">· {item.en}</span>
          </FitText>
        </span>
        <span className="lesson-ex-play" aria-hidden="true">
          <PlayIcon size={14} />
        </span>
      </button>
    </li>
  );
}

function Section({ s, n, items, voice, onPlay }: { s: LessonSection; n: number; items: Item[]; voice: VoiceId; onPlay: (it: Item) => void }) {
  return (
    <section className="lesson-sec" aria-labelledby={`lesson-sec-${n}`}>
      <h2 id={`lesson-sec-${n}`} className="h-s">
        {s.heading}
      </h2>
      {s.body.map((p, i) => (
        <Para key={i} text={p} />
      ))}
      {items.length > 0 && (
        <ul className="lesson-exs" aria-label="Examples">
          {items.map((it) => (
            <Example key={it.id} item={it} voice={voice} onPlay={onPlay} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Lesson() {
  const { engine, content, settings, sound } = useApp();
  const { device } = useDevice();
  const { query } = useRoute();
  const today = engine.day();
  const day = lessonDay(query.get('day'), today, settings.courseDays);
  const lesson = lessonFor(day);
  const isToday = day === today;
  const from = query.get('from');
  const parent = backTo(from);
  const voice = ownVoice(settings);

  // earlier and later lessons, up to the learner's current day
  const reach = Math.max(1, Math.min(today, settings.courseDays));
  const prev = day > 1 ? day - 1 : null;
  const next = day < reach && lessonFor(day + 1) ? day + 1 : null;
  const go = (n: number | null) => n && navigate(`/lesson?day=${n}${from ? `&from=${encodeURIComponent(from)}` : ''}`, true);

  const play = (it: Item) => void sound.play(listenForm(it, voice));

  // a new day starts at the top; leaving stops its sound
  useEffect(() => {
    window.scrollTo({ top: 0 });
    return () => sound.stop();
  }, [day, sound]);

  useKeys((a, e) => {
    if (a.type === 'move' && a.down && a.dx) {
      go(a.dx < 0 ? prev : next);
      return true;
    }
    if (a.type === 'confirm') {
      // Enter on a focused button or link is that control's own
      if ((e.target as HTMLElement | null)?.closest?.('button, a')) return;
      if (isToday) navigate('/new');
      else back(parent);
      return true;
    }
    if (a.type === 'back') {
      back(parent);
      return true;
    }
  });

  const items = (ids: string[] = []) =>
    ownFirst(
      ids.map((id) => content.item(id)).filter((it): it is Item => !!it && (settings.adult || !it.adult)),
      settings.identity,
    );

  const label = `Day ${day} · ${isToday ? 'Today’s lesson' : 'Lesson'}`;
  let body: ReactNode;
  if (!lesson) {
    body = (
      <div className="stack gap-4">
        <Label>{label}</Label>
        <h1 className="h-l">No lesson for this day.</h1>
      </div>
    );
  } else {
    body = (
      <article className="lesson fade-in" aria-labelledby="lesson-title">
        <Label>{label}</Label>
        <h1 id="lesson-title" className="h-l">
          {lesson.title}
        </h1>
        <p className="lesson-goal">{lesson.goal}</p>
        {lesson.sections.map((s, i) => (
          <Section key={i} s={s} n={i} items={items(s.examples)} voice={voice} onPlay={play} />
        ))}
      </article>
    );
  }

  return (
    <Screen top={<TopBar mid={isToday ? 'Today’s lesson' : 'Lesson'} parent={parent} />} narrow>
      {body}
      <div className="lesson-foot">
        {isToday ? (
          <Link to="/new" className="pill solid big wide">
            Start today’s words
          </Link>
        ) : (
          <button type="button" className="pill big wide" onClick={() => back(parent)}>
            Back
          </button>
        )}
        {(prev || next) && (
          <nav className="lesson-nav" aria-label="Other lessons">
            <button type="button" className="pill small" onClick={() => go(prev)} disabled={!prev}>
              {prev ? `Day ${prev}` : 'Previous'}
            </button>
            <button type="button" className="pill small" onClick={() => go(next)} disabled={!next}>
              {next ? `Day ${next}` : 'Next'}
            </button>
          </nav>
        )}
        {device === 'desktop' && (
          <KeyHints
            hints={[
              ['←', 'Previous lesson'],
              ['→', 'Next lesson'],
              ['Enter', isToday ? 'Start today’s words' : 'Back'],
            ]}
          />
        )}
      </div>
    </Screen>
  );
}
