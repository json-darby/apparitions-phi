// The guided day as a hook, so any screen can offer "Continue" to the next step
// (the way the best course apps flow: finish a step, go straight on to the next,
// and only see the menu when you want it). Today uses the same guide.

import { useMemo } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { localDate } from '../core/dates';
import { lessonFor } from '../content/lessons';
import { streetProgress } from '../street/state';
import { checkpointDays, dayBlocks } from './pathway';
import { dayGuide, marksOn, type Guide } from './guide';

export function useDayGuide(): Guide {
  const { engine, settings, store, content } = useApp();
  const v = useStoreVersion();
  return useMemo(() => {
    const day = engine.day();
    const plan = engine.planDay();
    const today = localDate(Date.now());
    const act = store.activity().find((a) => a.date === today);
    const blocks = dayBlocks(settings.minutes);
    const minutes = (id: string) => blocks.find((b) => b.id === id)?.minutes ?? 99;
    const spent = (id: string) => (act?.blocks[id] ?? 0) / 60_000;
    const block = (id: 'tonelab' | 'writing') => ({ done: spent(id) >= minutes(id) * 0.8, minutes: minutes(id), spent: spent(id) });
    const street = streetProgress(store, day, settings.adult);
    const culture = content.cultureForDay(day);
    const patternMet = !!store.one("SELECT 1 AS n FROM cards WHERE ref LIKE 'pattern:%' LIMIT 1");
    const checkpoints = store.get<Record<string, { score: number; date: string }>>('checkpoints', {});
    const isCheckpoint = checkpointDays(settings.courseDays).includes(day);
    return dayGuide({
      day,
      primerDone: settings.primerDone,
      lesson: lessonFor(Math.min(day, settings.courseDays))?.title ?? null,
      reviews: plan.reviews.length,
      fresh: plan.newRefs.length,
      patterns: patternMet || plan.newRefs.some((r) => r.startsWith('pattern:')),
      tone: block('tonelab'),
      writing: block('writing'),
      street: { left: street.total - street.done, today: street.today, next: street.next?.title ?? null },
      culture: culture?.day === day ? culture.title : null,
      checkpoint: isCheckpoint ? { done: Object.values(checkpoints).some((c) => c.date === today) } : null,
      marks: marksOn(store, today),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, settings]);
}
