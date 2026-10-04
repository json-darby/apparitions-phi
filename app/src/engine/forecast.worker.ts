// Runs the readiness forecast off the main thread.

import { runForecast, type Snapshot } from './forecast';

self.onmessage = (e: MessageEvent<{ id: number; snap: Snapshot; now: number }>) => {
  const { id, snap, now } = e.data;
  try {
    const f = runForecast(snap, { computedAt: now });
    (self as unknown as Worker).postMessage({ id, forecast: f });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
