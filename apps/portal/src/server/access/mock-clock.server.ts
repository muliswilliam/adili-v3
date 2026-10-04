/**
 * The access mocks' one clock (`mock.server.ts`, `mock-notices.server.ts`,
 * `mock-history.server.ts`). It runs from the instant the mocks were last seeded as of, so a
 * store seeded as of a fixed time (in tests) answers as of that time, not the wall clock; it is
 * the wall clock when seeded as of now.
 */
let offsetMs = 0;

/** Starts the clock at `now`; only `resetAccessMocks` calls it, as it seeds all three. */
export function setMockClock(now: number) {
  offsetMs = now - Date.now();
}

/** The mocks' time now, in epoch milliseconds. */
export function mockNow(): number {
  return Date.now() + offsetMs;
}
