import type { CopilotStatus } from './schema.js';

/**
 * `review.copilot.updated.v1`: a case's copilot changed status (requested, ready, failed, not
 * enabled). Identifiers and the status only, never the outputs. Subject: the case id.
 */
export const REVIEW_COPILOT_UPDATED = 'review.copilot.updated.v1';

export interface CopilotUpdatedData extends Record<string, unknown> {
  caseId: string;
  status: CopilotStatus;
  forVersionId: string;
}

/** Events of the ai-gateway the review service consumes: a job has ended (spec 07c). */
export const AI_JOB_COMPLETED = 'ai.job.completed.v1';
export const AI_JOB_FAILED = 'ai.job.failed.v1';
export const AI_JOB_BLOCKED = 'ai.job.blocked.v1';

const SUBJECT_PREFIX = 'review-case:';

/** The `subjectRef` of a case's jobs, which their events carry back. */
export function caseSubjectRef(caseId: string): string {
  return `${SUBJECT_PREFIX}${caseId}`;
}

/** The case a job's `subjectRef` names; null for a job about anything else. */
export function caseOfSubjectRef(subjectRef: string): string | null {
  return subjectRef.startsWith(SUBJECT_PREFIX) ? subjectRef.slice(SUBJECT_PREFIX.length) : null;
}
