// The engine reads time through a clock so the simulator can run 30 days in a second.

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class ManualClock implements Clock {
  constructor(private t: number) {}
  now() {
    return this.t;
  }
  set(t: number) {
    this.t = t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
