import type { NewEvent } from '@adili/events';

import type { FeedbackRating, FeedbackReason, FeedbackRow, Job } from '../db/schema.js';

/**
 * Announces a reviewer's rating of a job's output (spec 07c), so reporting can count ratings per
 * Commission and task. The rating and reason only: never the note, never who rated. A rating
 * changed later is announced again under the same `feedbackId`; the latest `recordedAt` holds.
 * Documented here until the AsyncAPI file lands.
 */
export const AI_FEEDBACK_RECORDED = 'ai.feedback.recorded.v1';

export interface AiFeedbackRecordedData extends Record<string, unknown> {
  feedbackId: string;
  jobId: string;
  task: string;
  tenant: string;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  recordedAt: string;
}

/** `ai.feedback.recorded.v1` for a rating just recorded. */
export function feedbackRecorded(
  job: Pick<Job, 'id' | 'task' | 'tenant'>,
  row: FeedbackRow,
): NewEvent<AiFeedbackRecordedData> {
  return {
    type: AI_FEEDBACK_RECORDED,
    subject: row.id,
    tenant: job.tenant,
    data: {
      feedbackId: row.id,
      jobId: job.id,
      task: job.task,
      tenant: job.tenant,
      rating: row.rating,
      reason: row.reason,
      recordedAt: row.at.toISOString(),
    },
  };
}
