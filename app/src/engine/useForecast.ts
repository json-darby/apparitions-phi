// The forecast for screens: cached in the store, recomputed in a worker when
// the day changes, the settings change, or enough new answers have come in.

import { useEffect, useState } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { runForecast, type Forecast } from './forecast';
import { buildSnapshot } from './profile';

/** Recompute after this many new log rows. */
const EVERY = 40;

interface Cached {
  key: string;
  forecast: Forecast;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (f: Forecast | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./forecast.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; forecast?: Forecast; error?: string }>) => {
      pending.get(e.data.id)?.(e.data.forecast ?? null);
      pending.delete(e.data.id);
      if (e.data.error) console.warn('forecast failed', e.data.error);
    };
    return worker;
  } catch {
    return null;
  }
}

export function useForecast(): { forecast: Forecast | null; busy: boolean; refresh: () => void } {
  const { engine, store, settings } = useApp();
  useStoreVersion();
  const logs = store.logCount();
  const key = [
    engine.today(), Math.floor(logs / EVERY), settings.tripDate, settings.minutes, settings.courseDays,
    settings.adult, settings.startDate,
  ].join('|');
  const cached = store.get<Cached | null>('forecast', null);
  const [busy, setBusy] = useState(false);
  const fresh = cached?.key === key;

  useEffect(() => {
    if (fresh || !settings.onboarded) return;
    let alive = true;
    setBusy(true);
    const snap = buildSnapshot(engine);
    const done = (f: Forecast | null) => {
      if (!alive) return;
      setBusy(false);
      if (f) store.set<Cached>('forecast', { key, forecast: f });
    };
    const w = getWorker();
    if (w) {
      const id = ++seq;
      pending.set(id, done);
      w.postMessage({ id, snap, now: Date.now() });
    } else {
      setTimeout(() => done(runForecast(snap, { computedAt: Date.now(), runs: 20, leverRuns: 8 })), 50);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fresh]);

  return {
    forecast: cached?.forecast ?? null,
    busy: busy || !fresh,
    refresh: () => {
      if (cached) store.set<Cached>('forecast', { ...cached, key: '' });
    },
  };
}
