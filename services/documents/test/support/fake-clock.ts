import { Clock } from '../../src/clock.js';

/** The system time, moved forward by what a test advanced it. */
export class FakeClock extends Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
