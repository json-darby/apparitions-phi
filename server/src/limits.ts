// Rate limits: a sliding window per key (origin + address), for /stt calls and
// live session starts. Daily caps live in the ledger.

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private perMinute: number;
  private now: () => number;

  constructor(perMinute: number, now: () => number = Date.now) {
    this.perMinute = perMinute;
    this.now = now;
  }

  /** True if allowed (and counts the hit). */
  take(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (list.length >= this.perMinute) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    return true;
  }
}
