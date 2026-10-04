/** An in-memory service mock's clock: what "now" is to its handlers. */
export interface MockClock {
  /**
   * Runs the clock from `now` on: a mock's reset calls it with the instant it seeds its fixtures
   * as of, so a mock seeded as of a fixed time (in tests) answers as of that time, not the wall
   * clock. Seeded as of now, it is the wall clock.
   */
  startAt(now: number): void;
  /** The mock's time now, in epoch milliseconds. */
  now(): number;
  /** The mock's time now, as an ISO 8601 date-time (what timestamps in a response carry). */
  isoNow(): string;
}

/**
 * A clock for a mock's fixtures and handlers to share, so windows and deadlines seeded relative to
 * a fixed instant stay open or closed however far the wall clock has moved on (or a test's fake
 * clock moves it). It reads the wall clock, fake timers included, plus an offset.
 */
export function createMockClock(): MockClock {
  let offsetMs = 0;
  const now = () => Date.now() + offsetMs;
  return {
    startAt(seededAt) {
      offsetMs = seededAt - Date.now();
    },
    now,
    isoNow() {
      return new Date(now()).toISOString();
    },
  };
}
