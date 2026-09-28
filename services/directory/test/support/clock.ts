import { Clock } from '../../src/clock.js';

/**
 * The directory's `Clock` for tests. It follows real time until a test sets or advances it, so
 * suites that never touch it behave as before; the harness also drives the rate limiter with it
 * (`RATE_LIMIT_CLOCK`), so budgets refill and reset as the clock moves.
 *
 * @example
 * api.clock.set('2026-10-01T09:00:00Z'); // frozen from here
 * api.clock.advance(31 * 60 * 1000);     // 31 minutes later
 */
export class TestClock extends Clock {
  private frozenAt: number | undefined;

  now(): Date {
    return new Date(this.frozenAt ?? Date.now());
  }

  /** Freezes the clock at `time`. */
  set(time: Date | string | number): void {
    this.frozenAt = new Date(time).getTime();
  }

  /** Moves the clock on by `ms` (freezing it at the current time first). */
  advance(ms: number): void {
    this.frozenAt = (this.frozenAt ?? Date.now()) + ms;
  }

  /** Back to real time. */
  reset(): void {
    this.frozenAt = undefined;
  }
}
