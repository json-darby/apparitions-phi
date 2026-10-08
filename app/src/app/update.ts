// Updates. The app keeps a copy of itself for offline use, so opening it shows
// that copy at once while a newer version, if there is one, downloads in the
// background; the service worker then takes over straight away (skipWaiting +
// clientsClaim in the generated worker). The screen in front is still the old
// version until it reloads. Rather than wait for a manual refresh, reload as
// soon as an update has arrived and the screen in front holds nothing in
// progress: Today, the browse tabs, or the opening screen before set-up starts.
// Mid-lesson, mid-drill or mid-set-up it waits until you are back on one of
// those. Progress is saved as you go, so a reload never loses any.

import { useEffect } from 'react';

/** Screens with nothing in progress, where a reload goes unnoticed. */
const CALM = ['/', '/library', '/progress', '/readiness', '/cast'];
/** How often an open app asks the server for a newer version. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

let here = '/';
let ready = false;

function calm(path: string): boolean {
  if (CALM.includes(path)) return true;
  // the opening screen, before the first question (the questions are a different layout)
  return path === '/welcome' && !!document.querySelector('.welcome');
}

function reloadIfCalm() {
  if (ready && calm(here)) location.reload();
}

function check() {
  void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
}

/** Call once, in the app shell, with the current route. */
export function useAutoUpdate(path: string): void {
  useEffect(() => {
    here = path;
    reloadIfCalm();
  }, [path]);

  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw || import.meta.env.DEV) return;
    // on a first visit the worker takes control of a page that is already the newest:
    // only a change from one worker to another is an update
    const hadWorker = !!sw.controller;
    let waiting = 0;
    const onChange = () => {
      if (!hadWorker) return;
      ready = true;
      reloadIfCalm();
      // a screen can become calm without the route changing (Back to the opening screen): look again every few seconds
      if (!waiting) waiting = window.setInterval(reloadIfCalm, 4000);
    };
    // coming back to the app (another app, another tab) is when an update is most likely waiting
    const onShow = () => {
      if (document.visibilityState === 'visible') check();
    };
    sw.addEventListener('controllerchange', onChange);
    document.addEventListener('visibilitychange', onShow);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      sw.removeEventListener('controllerchange', onChange);
      document.removeEventListener('visibilitychange', onShow);
      window.clearInterval(timer);
      window.clearInterval(waiting);
    };
  }, []);
}
