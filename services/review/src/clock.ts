/**
 * The current instant, as the service's legal clocks read it (clarification windows, due dates,
 * the year a reference number is issued in). A Nest token: the service uses `SystemClock`, tests
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

/** The calendar year in Nairobi of an instant. */
export function nairobiYear(instant: Date): number {
  return Number(nairobiDate(instant).slice(0, 4));
}
