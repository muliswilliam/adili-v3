import { z } from 'zod';

import { addDays, nairobiDate } from './clock.js';
import { badRequest } from './problems.js';

/**
 * Written notice to a declarant who has no account (spec 10 decision 2, Regs r.22(2)): the access
 * officer serves the notice on paper and records the day it was served; the declarant's window
 * for representations (Form K) runs from that day.
 */

/** What the request keeps of a written notice: the day it was served, and who recorded it when. */
export interface WrittenNotice {
  /** `YYYY-MM-DD` (Nairobi): the day it was served. */
  notifiedOn: string;
  /** Token subject and name of the access officer who recorded it. */
  by: string;
  byName: string;
  /** ISO 8601: when it was recorded. */
  at: string;
}

/** Body of `recordWrittenNotice`. */
export const writtenNoticeBody = z.strictObject({
  notifiedOn: z.iso.date().meta({
    description:
      'The day the written notice was served on the declarant (`YYYY-MM-DD`, Nairobi): not in the future, and not before the officer was identified (Form K) or the grant (law enforcement)',
  }),
});

export type WrittenNoticeBody = z.infer<typeof writtenNoticeBody>;

/** access.yaml `DeclarantNotice` facts on a request: how and when the declarant was told. */
export const noticeSchema = z.object({
  channel: z.enum(['online', 'written']).meta({
    description:
      '`online`: the service told the declarant at their account; `written`: the access officer served a notice in writing and recorded the day',
  }),
  notifiedAt: z.iso.datetime({ offset: true }).meta({
    description: 'When told; for a written notice, the start of the day it was served (Nairobi)',
  }),
  notifiedOn: z.iso.date().nullable().meta({
    description: 'The day a written notice was served (`YYYY-MM-DD`); null when told online',
  }),
  recordedBy: z.string().nullable().meta({
    description: 'The access officer who recorded the written notice, by name; null online',
  }),
});

export type Notice = z.infer<typeof noticeSchema>;

/** How and when the declarant was told, from a request's columns; null before. */
export function noticeOf(notifiedAt: Date | null, written: WrittenNotice | null): Notice | null {
  if (notifiedAt === null) return null;
  return {
    channel: written === null ? 'online' : 'written',
    notifiedAt: notifiedAt.toISOString(),
    notifiedOn: written?.notifiedOn ?? null,
    recordedBy: written?.byName ?? null,
  };
}

/** The instant a Nairobi calendar day (`YYYY-MM-DD`) starts (Nairobi is UTC+3 all year). */
export function startOfNairobiDay(date: string): Date {
  return new Date(`${date}T00:00:00+03:00`);
}

/**
 * The window for representations a written notice served on `notifiedOn` opens: the declarant is
 * notified from the start of that day, and the window ends at the end of the `days`th day after
 * it (the day of service is not counted: Interpretation and General Provisions Act s.57(a)).
 */
export function writtenNoticeWindow(
  notifiedOn: string,
  days: number,
): { notifiedAt: Date; windowEndsAt: Date } {
  const notifiedAt = startOfNairobiDay(notifiedOn);
  return { notifiedAt, windowEndsAt: addDays(notifiedAt, days + 1) };
}

/**
 * 400 at `notifiedOn` unless it is a day from `earliest` (the officer identified, or the grant)
 * to today, in Nairobi.
 */
export function requireNoticeDay(
  notifiedOn: string,
  earliest: { at: Date; what: string },
  now: Date,
): void {
  if (notifiedOn > nairobiDate(now)) {
    throw badRequest('The notice cannot have been served in the future.', [
      { path: 'notifiedOn', message: 'is in the future' },
    ]);
  }
  if (notifiedOn < nairobiDate(earliest.at)) {
    throw badRequest(`The notice cannot have been served before ${earliest.what}.`, [
      { path: 'notifiedOn', message: `is before ${earliest.what}` },
    ]);
  }
}

/** The written notice the access officer records now. */
export function writtenNoticeOf(
  notifiedOn: string,
  officer: { subject: string; name: string },
  now: Date,
): WrittenNotice {
  return { notifiedOn, by: officer.subject, byName: officer.name, at: now.toISOString() };
}
