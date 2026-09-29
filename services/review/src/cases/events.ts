/**
 * Events the review service publishes about cases (spec 07a, outbox, CloudEvents). Identifiers and
 * states only: never declaration content, names or amounts. The tenant extension is the
 * Commission's slug and the subject the case id.
 */
export const REVIEW_CASE_CREATED = 'review.case.created.v1';
export const REVIEW_CASE_UPDATED = 'review.case.updated.v1';

/** `review.case.created.v1` and `review.case.updated.v1`. */
export interface CaseProcessedData extends Record<string, unknown> {
  caseId: string;
  declarationId: string;
  versionId: string;
  band: 'low' | 'medium' | 'high';
}

/** Events the review service consumes. */
export const DECLARATION_SUBMITTED = 'declaration.submitted.v1';
