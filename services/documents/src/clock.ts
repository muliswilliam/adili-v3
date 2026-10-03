/**
 * The current instant, as issuance reads it: the issue time printed and signed, and the end of a
 * download window. A Nest token: the service uses `SystemClock`, tests set the time.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
