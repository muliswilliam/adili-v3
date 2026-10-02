import { Injectable } from '@nestjs/common';
import { callerOf, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { FEEDBACK_RATINGS, FEEDBACK_REASONS, feedback, jobs, type schema } from '../db/schema.js';
import { feedbackRecorded } from './events.js';

/** ai-gateway.yaml `FeedbackInput`. */
export const feedbackInputSchema = z.object({
  reviewerSubject: z.string().min(1).max(255).meta({
    description: 'The officer rating the output, as the calling service knows them (token `sub`)',
  }),
  rating: z.enum(FEEDBACK_RATINGS),
  reason: z.enum(FEEDBACK_REASONS).nullable(),
  note: z.string().max(1000).nullable(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

/** ai-gateway.yaml `Feedback`. */
export const feedbackViewSchema = z.object({
  jobId: z.uuid(),
  ...feedbackInputSchema.shape,
  at: z.iso.datetime(),
});
export type FeedbackView = z.infer<typeof feedbackViewSchema>;

/**
 * Reviewers' ratings of job outputs (spec 07c S13), recorded for the calling service that ran
 * the job: one per reviewer per job, a repeat replacing the earlier rating. Each rating is
 * announced by `ai.feedback.recorded.v1` in the same transaction.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly events: EventPublisher,
  ) {}

  /**
   * Records `input` for job `jobId`; undefined when the caller has no succeeded job with that id
   * for `tenant` (another caller's or another tenant's job is indistinguishable from a missing
   * one, and only a succeeded job has an output to rate).
   */
  async record(
    jobId: string,
    input: FeedbackInput,
    tenant: string,
    principal: Principal,
  ): Promise<FeedbackView | undefined> {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({ id: jobs.id, task: jobs.task, tenant: jobs.tenant })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.tenant, tenant),
            eq(jobs.caller, callerOf(principal)),
            eq(jobs.status, 'succeeded'),
          ),
        );
      if (!job) return undefined;
      const [row] = await tx
        .insert(feedback)
        .values({ id: uuidv7(), jobId: job.id, ...input, at: new Date() })
        .onConflictDoUpdate({
          target: [feedback.jobId, feedback.reviewerSubject],
          set: {
            rating: sql`excluded.rating`,
            reason: sql`excluded.reason`,
            note: sql`excluded.note`,
            at: sql`excluded.at`,
          },
        })
        .returning();
      if (!row) throw new Error(`Feedback on job ${job.id} was not recorded`);
      await this.events.record(tx, feedbackRecorded(job, row));
      return {
        jobId: row.jobId,
        reviewerSubject: row.reviewerSubject,
        rating: row.rating,
        reason: row.reason,
        note: row.note,
        at: row.at.toISOString(),
      };
    });
  }
}
