import { Clock } from '../../src/clock.js';

/** The service's clock for tests: the real time until a test sets one. */
export class FakeClock extends Clock {
  private instant: Date | null = null;

  set(instant: string | Date): void {
    this.instant = new Date(instant);
  }

  reset(): void {
    this.instant = null;
  }

  now(): Date {
    return this.instant ? new Date(this.instant) : new Date();
  }
}
