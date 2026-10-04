// App-wide state: the store, content, memory engine, settings and the shared
// sound interface. Everything a screen needs comes from useApp().

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Content } from '../content/repo';
import type { Store } from '../db/store';
import { Engine } from '../engine/engine';
import { systemClock } from '../core/clock';
import { localDate } from '../core/dates';
import { defaultSettings, type Settings } from '../core/settings';
import type { SoundService } from '../audio/sound';
import { prefersReducedMotion } from './device';
import type { BlockId } from '../path/pathway';
import { setFaceTint } from '../anim/tint';

export interface AppState {
  store: Store;
  content: Content;
  engine: Engine;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  sound: SoundService;
  reducedMotion: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ store, content, sound, children }: { store: Store; content: Content; sound: SoundService; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const s = { ...defaultSettings(localDate(Date.now())), ...store.get<Partial<Settings>>('settings', {}) };
    setFaceTint(s.faceColour);
    return s;
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // the face colour is read by the draw code, outside React
  useLayoutEffect(() => setFaceTint(settings.faceColour), [settings.faceColour]);
  const engine = useMemo(() => new Engine(store, content, systemClock, () => settingsRef.current), [store, content]);
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      // written outside React's state updater: a store write wakes other views, which must not happen mid-render
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      store.set('settings', next);
      setSettings(next);
    },
    [store],
  );
  const [sysReduced, setSysReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSysReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const reducedMotion = settings.reducedMotion === 'on' || (settings.reducedMotion === 'auto' && sysReduced);
  const value = useMemo(
    () => ({ store, content, engine, settings, updateSettings, sound, reducedMotion }),
    [store, content, engine, settings, updateSettings, sound, reducedMotion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Re-render when the database changes. Returns the store version. */
export function useStoreVersion(): number {
  const { store } = useApp();
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.version,
  );
}

/** Adds time spent on a screen to today's minutes, under a daily block. */
export function useBlockTimer(block: BlockId | string) {
  const { store } = useApp();
  useEffect(() => {
    let last = Date.now();
    let visible = document.visibilityState === 'visible';
    const commit = () => {
      const now = Date.now();
      if (visible) store.addActivity(localDate(now), Math.min(now - last, 120_000), block);
      last = now;
    };
    const iv = setInterval(commit, 15_000);
    const vis = () => {
      commit();
      visible = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      commit();
      clearInterval(iv);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [store, block]);
}
