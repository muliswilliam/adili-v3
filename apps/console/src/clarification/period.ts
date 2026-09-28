import { addDays, daysBetween } from '@adili/ui';

/**
 * The declarant's 30-day response period as the ClarificationWorkflow runs it (spec 07a): a
 * reminder on day 20 unless they have responded. The contract carries no reminder date, so it is
 * derived from the issue date.
 */

const REMINDER_DAY = 20;

/** When the day-20 reminder goes (or went). */
export function reminderAt(issuedAt: string): string {
  return addDays(issuedAt, REMINDER_DAY);
}

/** Days a response came after the due date; a late response is at least one day late. */
export function lateDays(dueAt: string, respondedAt: string): number {
  return Math.max(1, daysBetween(dueAt, respondedAt));
}

/** Whether the reminder went: day 20 reached, and no response before it. */
export function reminderSent(issuedAt: string, respondedAt: string | null, now: string): boolean {
  if (respondedAt && Date.parse(respondedAt) <= Date.parse(reminderAt(issuedAt))) return false;
  return daysBetween(issuedAt, respondedAt ?? now) >= REMINDER_DAY;
}
