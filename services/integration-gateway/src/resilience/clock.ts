/** Time as the gateway sees it; tests move it by hand to step through breaker cool-downs. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => Date.now() };
