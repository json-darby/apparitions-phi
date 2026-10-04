// Personal calibration. FSRS predicts recall R for a card at review time. This
// learner's real chance of recall is modelled as R^k: k = 1 means FSRS is right
// about them, k > 1 means they forget faster than it thinks, k < 1 slower.
// k is fitted by maximum likelihood over their own reviews, with a prior that
// keeps it near 1 until there is enough evidence.

export interface Observation {
  /** FSRS predicted recall just before the review, 0..1 */
  pred: number;
  /** did they recall it */
  recalled: boolean;
}

export interface Calibration {
  k: number;
  /** observations used */
  n: number;
  /** k's 80% interval, from the curvature of the likelihood */
  lo: number;
  hi: number;
  /** recall the model predicted vs what happened, over the observations */
  predicted: number;
  actual: number;
}

const PRIOR_SD = 0.35; // on ln k
const MIN_K = 0.4;
const MAX_K = 3;

function logPost(lnk: number, obs: Observation[]): number {
  const k = Math.exp(lnk);
  let s = -(lnk * lnk) / (2 * PRIOR_SD * PRIOR_SD);
  for (const o of obs) {
    const p = Math.min(0.9999, Math.max(1e-4, Math.pow(o.pred, k)));
    s += o.recalled ? Math.log(p) : Math.log(1 - p);
  }
  return s;
}

export function calibrate(all: Observation[]): Calibration {
  // only informative reviews: predictions that are neither certain nor hopeless
  const obs = all.filter((o) => o.pred > 0.02 && o.pred < 0.995);
  const predicted = obs.length ? obs.reduce((s, o) => s + o.pred, 0) / obs.length : 0;
  const actual = obs.length ? obs.filter((o) => o.recalled).length / obs.length : 0;
  if (!obs.length) return { k: 1, n: 0, lo: Math.exp(-PRIOR_SD * 1.28), hi: Math.exp(PRIOR_SD * 1.28), predicted, actual };

  // golden-section search for the maximum on ln k
  let a = Math.log(MIN_K);
  let b = Math.log(MAX_K);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = logPost(c, obs);
  let fd = logPost(d, obs);
  for (let i = 0; i < 60; i++) {
    if (fc > fd) {
      b = d; d = c; fd = fc; c = b - g * (b - a); fc = logPost(c, obs);
    } else {
      a = c; c = d; fc = fd; d = a + g * (b - a); fd = logPost(d, obs);
    }
  }
  const lnk = (a + b) / 2;
  // curvature for the interval
  const h = 1e-3;
  const f0 = logPost(lnk, obs);
  const curv = -(logPost(lnk + h, obs) - 2 * f0 + logPost(lnk - h, obs)) / (h * h);
  const sd = curv > 0 ? 1 / Math.sqrt(curv) : PRIOR_SD;
  return { k: Math.exp(lnk), n: obs.length, lo: Math.exp(lnk - 1.28 * sd), hi: Math.exp(lnk + 1.28 * sd), predicted, actual };
}

/**
 * The FSRS retention to request so that this learner's true recall at review
 * time meets the target: R^k = target, so R = target^(1/k). Bounded so a noisy
 * k can never make schedules absurd.
 */
export function personalRetention(target: number, k: number): number {
  return Math.min(0.97, Math.max(0.8, Math.pow(target, 1 / k)));
}
