import type { ObligationStatus } from '../obligations/engine.js';
import type { DeclarationStatus } from '../drafts/schema.js';

/**
 * When a declaration can be submitted (spec 06), pure: the rules the submit transaction enforces
 * and the summary's `canSubmit` reports, in one place. Dates are civil dates in Africa/Nairobi
 * (`YYYY-MM-DD`), compared as strings.
 */

/** Only a draft or an amendment in progress is submitted; anything else is `not-a-draft`. */
export function isSubmittable(status: DeclarationStatus): boolean {
  return status === 'draft' || status === 'amending';
}

export interface ObligationWindow {
  status: ObligationStatus;
  statementDate: string;
  dueDate: string;
}

export type ObligationRefusal =
  'obligation-cancelled' | 'before-statement-date' | 'amendment-window-closed' | 'not-a-draft';

/**
 * Why the obligation does not take this submission today, or null when it does. A declaration is
 * made as at its statement date, so nothing is submitted before it, whatever the obligation's
 * status says (an `upcoming` obligation whose date has come is only waiting for its workflow).
 * After the due date a first submission is still taken (filed late); an amendment of a filed
 * obligation is not, and goes through the Commission's clarifications instead.
 */
export function obligationRefusal(
  status: DeclarationStatus,
  obligation: ObligationWindow,
  today: string,
): ObligationRefusal | null {
  if (obligation.status === 'cancelled') return 'obligation-cancelled';
  if (today < obligation.statementDate) return 'before-statement-date';
  if (obligation.status === 'filed') {
    // A filed obligation is only submitted to again by amending what filed it.
    if (status !== 'amending') return 'not-a-draft';
    if (today > obligation.dueDate) return 'amendment-window-closed';
  }
  return null;
}

/**
 * Why submitting the declaration now would be refused before its contents are looked at, or null:
 * `not-a-draft` for a declaration already submitted (or discarded), then the obligation's
 * refusal.
 */
export function submitRefusal(
  status: DeclarationStatus,
  obligation: ObligationWindow,
  today: string,
): ObligationRefusal | null {
  return isSubmittable(status) ? obligationRefusal(status, obligation, today) : 'not-a-draft';
}

/** Submitted after the due date: the version and the obligation record it as late. */
export function isLate(dueDate: string, today: string): boolean {
  return today > dueDate;
}
