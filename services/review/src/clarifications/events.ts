/**
 * Events the review service publishes about clarifications (spec 07a, outbox, CloudEvents).
 * Identifiers only: the letter's fields travel by pull, never in an event. The tenant extension is
 * the Commission's slug and the subject the clarification id (the case id for case events).
 */
export const CLARIFICATION_ISSUED = 'clarification.issued.v1';

/** `clarification.issued.v1` and the later `clarification.*` events of #174. */
export interface ClarificationEventData extends Record<string, unknown> {
  clarificationId: string;
  caseId: string;
}
