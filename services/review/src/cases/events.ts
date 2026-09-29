import type { CaseStatus } from './schema.js';

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

export const REVIEW_CASE_ASSIGNED = 'review.case.assigned.v1';
export const REVIEW_CASE_STATUS_CHANGED = 'review.case.status-changed.v1';
export const REVIEW_CASE_VIEWED = 'review.case.viewed.v1';
export const REVIEW_FLAG_REVIEWED = 'review.flag.reviewed.v1';

/** `review.case.assigned.v1`: the assignee after the change (null: back in the queue). */
export interface CaseAssignedData extends Record<string, unknown> {
  caseId: string;
  assignee: string | null;
  by: string;
  kind: 'claimed' | 'released' | 'reassigned' | 'unassigned';
}

/** `review.case.status-changed.v1`. */
export interface CaseStatusChangedData extends Record<string, unknown> {
  caseId: string;
  from: CaseStatus;
  to: CaseStatus;
}

/** `review.case.viewed.v1`: who opened the case (its declaration was read for them). */
export interface CaseViewedData extends Record<string, unknown> {
  caseId: string;
  subject: string;
}

/** `review.flag.reviewed.v1`. */
export interface FlagReviewedData extends Record<string, unknown> {
  caseId: string;
  flagId: string;
  by: string;
}

/** Events the review service consumes. */
export const DECLARATION_SUBMITTED = 'declaration.submitted.v1';
