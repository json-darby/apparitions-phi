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
  { to: '/settings', label: 'Settings', icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z' },
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
