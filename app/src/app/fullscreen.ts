// Full screen: hides the browser's address bar and tabs. Browsers only let a
// page enter it from a tap or key press, so the "Open full screen" setting
// re-enters on the first tap after the app loads. iPhone Safari has no full
// screen for pages; there, adding the app to the home screen opens it without the
// address bar (display: standalone in the web manifest).

import { useEffect, useState } from 'react';

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenSupported(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Opened from the home screen or as an installed app window: there is no address bar to hide. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    /* refused (no user gesture, or blocked by the browser): stay as we are */
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    /* already out */
  }
}

export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

/** True while the app is full screen; follows Esc and the browser's own controls too. */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  return on;
}

/** With the setting on, the first tap or key press after load goes full screen (once per load). */
export function useOpenFullscreen(wanted: boolean): void {
  useEffect(() => {
    if (!wanted || !fullscreenSupported() || isStandalone() || isFullscreen()) return;
    const go = () => {
      remove();
      void enterFullscreen();
    };
    const remove = () => {
      window.removeEventListener('pointerup', go, true);
      window.removeEventListener('keyup', go, true);
    };
    window.addEventListener('pointerup', go, true);
    window.addEventListener('keyup', go, true);
    return remove;
  }, [wanted]);
}
