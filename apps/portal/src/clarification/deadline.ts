import type { ClarificationStatus } from '../server/review/types';

/**
 * The 30-day response period of a clarification (Act s.35(3)), counted in calendar days in
 * Kenyan time. Pure: every function takes "now" so the server and the browser agree.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nairobi is UTC+3 all year. */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
/** The ClarificationWorkflow reminds the declarant on day 20 unless they have responded. */
export const REMINDER_DAY = 20;
/** From this many days left the countdown turns to a warning. */
const WARN_FROM_DAYS = 10;

function dayNumber(iso: string): number {
  return Math.floor((Date.parse(iso) + NAIROBI_OFFSET_MS) / DAY_MS);
}

/** Calendar days from `from` to `to` in Kenyan time; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

export interface Countdown {
  text: string;
  tone: 'neutral' | 'warning' | 'danger';
  overdue: boolean;
}

/** "Respond within 12 days", "Respond by today" or "Overdue by 3 days". */
export function countdown(dueAt: string, now: string): Countdown {
  const left = daysBetween(now, dueAt);
  if (left < 0) {
    return { text: `Overdue by ${plural(-left, 'day')}`, tone: 'danger', overdue: true };
  }
  if (left === 0) return { text: 'Respond by today', tone: 'danger', overdue: false };
  return {
    text: `Respond within ${plural(left, 'day')}`,
    tone: left <= WARN_FROM_DAYS ? 'warning' : 'neutral',
    overdue: false,
  };
}

/** Days a response came after the due date; a late response is at least one day late. */
export function lateDays(dueAt: string, respondedAt: string): number {
  return Math.max(1, daysBetween(dueAt, respondedAt));
}

/** When the day-20 reminder goes (or went). */
export function reminderAt(issuedAt: string): string {
  return new Date(Date.parse(issuedAt) + REMINDER_DAY * DAY_MS).toISOString();
}

/** Whether the day-20 reminder has gone (the workflow sends it unless already responded). */
export function reminderSent(issuedAt: string, now: string): boolean {
  return daysBetween(issuedAt, now) >= REMINDER_DAY;
}

/** Open for a response: issued and not yet answered, including after the due date. */
export function isOpen(status: ClarificationStatus): boolean {
  return status === 'issued' || status === 'overdue';
}
