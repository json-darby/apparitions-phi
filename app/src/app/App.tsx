// The app shell: boots the local database, then routes. Desktop gets a
// navigation rail; phone and tablet use each screen's top bar.

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { openBrowserStore } from '../db/browser';
import { applyCourse, fetchCourse, loadContent, type Content } from '../content/repo';
import { setCourseTasks } from '../content/street-seed';
import type { Store } from '../db/store';
import { AudioSound, dropOldAudioCaches } from '../audio/AudioSound';
import { defaultSettings, type Settings } from '../core/settings';
import { localDate } from '../core/dates';
import { SoundLayer } from '../audio/SoundLayer';
import { AppProvider, useApp, useBlockTimer, useStoreVersion } from './context';
import { useDevice } from './device';
import { Link, match, navigate, useRoute } from './router';
import { ROUTES } from './routes';
import { DRILLS } from '../path/pathway';
import { addMark, markForRoute } from '../path/guide';
import { RowTearWipe } from '../anim';
import { useOpenFullscreen } from './fullscreen';
import { useAutoUpdate } from './update';
import { FullscreenButton } from '../ui/kit';
import { TAB_ROUTES, TabBar } from './Nav';
import { SCHOOL } from '../school/names';

export function App() {
  const [boot, setBoot] = useState<{ store: Store; content: Content } | { error: string } | null>(null);
  // Real audio when the course has clips; behaves exactly like CaptionSound otherwise.
  const sound = useMemo(() => new AudioSound(), []);
  // dev only: reach the sound service from the console (window.__phiSound)
  if (import.meta.env.DEV) (window as unknown as { __phiSound?: AudioSound }).__phiSound = sound;
  useEffect(() => {
    openBrowserStore()
      .then(async (store) => {
        // the generated course, if one is bundled; reseeds only when its version changed
        applyCourse(store, await fetchCourse());
        // clips re-made in place are fetched afresh, not served from an older cache
        void dropOldAudioCaches().catch(() => {});
        const content = loadContent(store);
        // a generated course's street and chapter scripts replace the seed ones: only its own are offered
        setCourseTasks(content.tasks, store.getMeta('content_source') === 'course' ? content.items : null);
        const settings: Settings = { ...defaultSettings(localDate(Date.now())), ...store.get<Partial<Settings>>('settings', {}) };
        sound.configure({ content, settings, store });
        setBoot({ store, content });
      })
      .catch((e: unknown) => setBoot({ error: e instanceof Error ? e.message : String(e) }));
  }, [sound]);
  if (!boot) return <div className="boot label">APPARITIONS: PHI</div>;
  if ('error' in boot)
    return (
      <div className="boot">
        <div className="stack gap-3" style={{ maxWidth: 420, padding: 20 }}>
          <div className="label">Could not open local storage</div>
          <p className="body">{boot.error}</p>
        </div>
      </div>
    );
  return (
    <AppProvider store={boot.store} content={boot.content} sound={sound}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { settings, store, reducedMotion } = useApp();
  const route = useRoute();
  const { device, touch } = useDevice();

  useEffect(() => {
    if (!settings.onboarded && route.path !== '/welcome') navigate('/welcome', true);
  }, [settings.onboarded, route.path]);

  // the day guide: opening the sentence builder or today's culture note counts as that step
  const query = route.query.toString();
  useEffect(() => {
    const mark = markForRoute(route.path, new URLSearchParams(query));
    if (mark) addMark(store, localDate(Date.now()), mark);
  }, [store, route.path, query]);

  let found: { screen: (typeof ROUTES)[number]; params: Record<string, string> } | null = null;
  for (const r of ROUTES) {
    const p = match(r.path, route.path);
    if (p) {
      found = { screen: r, params: p };
      break;
    }
  }
  const Screen = found?.screen.screen;
  const rail = device === 'desktop' && route.path !== '/welcome' && route.path !== '/primer';
  // phone and tablet: the tab bar on the main screens, so Settings and the rest are always reachable
  const tabs = device !== 'desktop' && settings.onboarded && TAB_ROUTES.includes(route.path);
  useOpenFullscreen(settings.fullscreen);
  useAutoUpdate(route.path);

  return (
    <div className={`app grain device-${device} ${touch ? 'touch' : 'mouse'} ${reducedMotion ? 'reduced' : ''} ${tabs ? 'has-tabs' : ''}`}>
      {rail && <Rail path={route.path} />}
      <main className="main">
        <RowTearWipe routeKey={route.path}>
          <Suspense fallback={<div className="boot label">Loading</div>}>
            {Screen ? (
              <Timed block={found!.screen.block} key={`${route.path}?${route.query.toString()}`}>
                <Screen params={found!.params} />
              </Timed>
            ) : (
              <NotFound />
            )}
          </Suspense>
        </RowTearWipe>
      </main>
      {tabs && <TabBar path={route.path} />}
      <SoundLayer />
    </div>
  );
}

function Timed({ block, children }: { block?: string; children: ReactNode }) {
  useBlockTimer(block ?? 'other');
  return <>{children}</>;
}

const STATUS: Record<string, { word: string; tone: string }> = {
  ahead: { word: 'Ahead', tone: 'var(--good)' },
  'on-track': { word: 'On track', tone: 'var(--good)' },
  'at-risk': { word: 'At risk', tone: 'var(--amber)' },
  behind: { word: 'Behind', tone: 'var(--bad)' },
};

function Rail({ path }: { path: string }) {
  const { engine, settings, store } = useApp();
  useStoreVersion();
  const day = engine.day();
  const cur = (p: string) => (path === p ? 'page' : undefined);
  // the last forecast worked out (Today and Readiness keep it fresh); the rail never starts one
  const status = STATUS[store.get<{ forecast?: { status?: string } } | null>('forecast', null)?.forecast?.status ?? ''];
  return (
    <nav className="rail" aria-label="Main">
      <Link to="/" className="logo" aria-label="APPARITIONS: PHI, home">
        APPARITIONS: PHI
      </Link>
      <Link to="/" aria-current={cur('/')}>
        Today <span className="meta">Day {Math.min(day, settings.courseDays)}</span>
      </Link>
      <Link to="/library" aria-current={cur('/library')}>Library</Link>
      <Link to="/progress" aria-current={cur('/progress')}>Progress</Link>
      <Link to="/readiness" aria-current={cur('/readiness')}>
        Readiness {status && <span className="meta" style={{ color: status.tone }}>{status.word}</span>}
      </Link>
      {settings.desktopDrills && (
        <>
          <div className="rail-section label">Drills</div>
          {DRILLS.map((d) => (
            <Link key={d.id} to={`/drill/${d.id}`} aria-current={cur(`/drill/${d.id}`)}>
              {d.title}
            </Link>
          ))}
        </>
      )}
      <div className="rail-section label">The Street</div>
      <Link to="/street" aria-current={cur('/street')}>Walk</Link>
      <Link to="/cast" aria-current={cur('/cast')}>Cast</Link>
      <Link to="/school" aria-current={path.startsWith('/school') ? 'page' : undefined}>
        <span>
          {SCHOOL.name}
          <span className="small thai" lang="th" style={{ display: 'block' }}>{SCHOOL.thai}</span>
        </span>
      </Link>
      <div className="rail-foot stack gap-1">
        <Link to="/settings" aria-current={cur('/settings')}>Settings</Link>
        <FullscreenButton wide />
      </div>
    </nav>
  );
}

function NotFound() {
  return (
    <div className="boot">
      <div className="stack gap-3 center">
        <div className="label">Not here</div>
        <Link to="/" className="pill">Today</Link>
      </div>
    </div>
  );
}
