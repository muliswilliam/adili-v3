/**
 * Events the review service publishes about clarifications (spec 07a, outbox, CloudEvents).
 * Identifiers only: the letter's fields travel by pull, never in an event. The tenant extension is
 * the Commission's slug and the subject the clarification id (the case id for case events).
 */
export const CLARIFICATION_ISSUED = 'clarification.issued.v1';
export const CLARIFICATION_REMINDER_SENT = 'clarification.reminder-sent.v1';
export const CLARIFICATION_RESPONDED = 'clarification.responded.v1';
export const CLARIFICATION_OVERDUE = 'clarification.overdue.v1';
export const CLARIFICATION_RESOLVED = 'clarification.resolved.v1';
export const CLARIFICATION_WITHDRAWN = 'clarification.withdrawn.v1';

/** Every `clarification.*` event carries the clarification and its case. */
export interface ClarificationEventData extends Record<string, unknown> {
  clarificationId: string;
  caseId: string;
}

/** `clarification.responded.v1`: whether the response came after the due date. */
export interface ClarificationRespondedData extends ClarificationEventData {
  late: boolean;
}
