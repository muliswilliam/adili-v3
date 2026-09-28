import { Injectable } from '@nestjs/common';

/**
 * The time obligations are computed against (today in Nairobi, creation statuses, reminders
 * already past). A Nest token: tests override it to pin "today".
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
