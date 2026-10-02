/**
 * The current instant, as the service's legal clocks read it (receipt, decision deadlines,
 * representation windows, download windows). A Nest token: the service uses `SystemClock`, tests
 * set the time.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** The calendar date in Nairobi of an instant, `YYYY-MM-DD`. */
export function nairobiDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(instant);
}

/** The calendar year in Nairobi of an instant: the period of `ARQ` and `LEA` references. */
export function nairobiYear(instant: Date): number {
  return Number(nairobiDate(instant).slice(0, 4));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` whole days after `instant` (Nairobi has no daylight saving, so days are 24 hours). */
export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}
