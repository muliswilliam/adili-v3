import { Injectable } from '@nestjs/common';

/**
 * The time rules are computed with (onboarding expiry, cooldowns, attempt windows). A Nest
 * token: tests override it (`TestClock` in test/support/clock.ts) to move time without waiting.
 * Timestamps the rules depend on are written from it, not from the database's `now()`.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
