// "Install app" on Android and desktop Chrome or Edge: the browser offers the
// install prompt once the app qualifies; we keep it and show our own button
// (Settings). iPhone and iPad have no prompt: Share, then Add to Home Screen.

import { useSyncExternalStore } from 'react';
import { isStandalone } from './fullscreen';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const ping = () => subs.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    ping();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    ping();
  });
}

export type InstallState = 'installed' | 'ready' | 'ios' | 'menu';

function state(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'ready';
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'menu';
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    state,
  );
}

/** Shows the browser's install prompt. True when the learner installed. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  ping();
  return outcome === 'accepted';
}
