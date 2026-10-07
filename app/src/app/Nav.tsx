// Phone and tablet navigation: a tab bar along the bottom of the main screens
// (desktop has the side rail). Today, Library, Progress and Settings are always
// one tap away; inside a lesson, review, drill or conversation it stays out of
// the way.

import { Link } from './router';
import './nav.css';

const TABS = [
  { to: '/', label: 'Today', icon: 'M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z' },
  { to: '/library', label: 'Library', icon: 'M5 4h4v16H5zM10 4h4v16h-4zM15.5 5.2l3.7-1 3.6 15.4-3.7 1z' },
  { to: '/progress', label: 'Progress', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { to: '/settings', label: 'Settings', icon: 'M15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' },
] as const;

/** The screens that show the tab bar on phone and tablet. */
export const TAB_ROUTES = ['/', '/library', '/progress', '/readiness', '/settings', '/cast'];

export function TabBar({ path }: { path: string }) {
  const on = (to: string) => (to === '/' ? path === '/' || path === '/readiness' : path === to || (to === '/library' && path === '/cast'));
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.to} to={t.to} className="tab" aria-current={on(t.to) ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.icon} />
          </svg>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
