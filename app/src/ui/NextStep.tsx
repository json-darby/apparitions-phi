// "Continue" at the end of a step: straight on to the next step of the guided
// day (the way the best course apps flow), or back to Today when the day is
// done. Same size and place as the button it replaces, so nothing moves.

import { Link } from '../app/router';
import { useDayGuide } from '../path/useGuide';
import type { GuideStepId } from '../path/guide';

export function ContinueLink({ current }: { current: GuideStepId }) {
  const guide = useDayGuide();
  const next = guide.steps.find((s) => !s.done && s.id !== current) ?? null;
  return next ? (
    <Link to={next.to} className="pill solid" style={{ textDecoration: 'none' }} aria-label={`Continue: ${next.title}`} title={`Next: ${next.title}`}>
      Continue
    </Link>
  ) : (
    <Link to="/" className="pill solid" style={{ textDecoration: 'none' }} title="Today is done">
      Today
    </Link>
  );
}

/** The next step's name, for a small "Next: …" line above the buttons; null when the day is done. */
export function useNextTitle(current: GuideStepId): string | null {
  const guide = useDayGuide();
  return guide.steps.find((s) => !s.done && s.id !== current)?.title ?? null;
}
