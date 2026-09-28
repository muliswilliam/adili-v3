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

/**
 * Whether the reminder went: its time, `reminderAt`, came before any response. Measured against the
 * same instant as `reminderAt`, so the date shown and this answer never disagree.
 */
export function reminderSent(issuedAt: string, respondedAt: string | null, now: string): boolean {
  return Date.parse(respondedAt ?? now) >= Date.parse(reminderAt(issuedAt));
}
