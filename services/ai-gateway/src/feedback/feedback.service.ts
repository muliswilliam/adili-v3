import { Injectable } from '@nestjs/common';
import { callerOf, type Principal } from '@adili/api-kit';
import { FieldCipher, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { asTenant, type GatewayDatabase } from '../db/context.js';
import { FEEDBACK_RATINGS, FEEDBACK_REASONS, feedback, jobs } from '../db/schema.js';
import { feedbackRecorded } from './events.js';

/**
 * A block of an output: a summary's `overview`, `changes`, `sections` or `worth-attention`, or
 * an explanation's `flag:<flagId>`.
 */
export const FEEDBACK_BLOCK =
  /^(overview|changes|sections|worth-attention|flag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** ai-gateway.yaml `FeedbackInput`. */
export const feedbackInputSchema = z.object({
  reviewerSubject: z.string().min(1).max(255).meta({
    description: 'The reviewer rating the output, as the calling service knows them (token `sub`)',
  }),
  block: z.string().max(64).regex(FEEDBACK_BLOCK).nullable().optional().meta({
    description:
      "The block rated: a summary's `overview`, `changes`, `sections` or `worth-attention`, or an explanation's `flag:<flagId>`. Null or left out: the output as a whole",
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
  block: z
    .string()
    .nullable()
    .meta({ description: 'The block rated; null for the output as a whole' }),
  at: z.iso.datetime(),
});
export type FeedbackView = z.infer<typeof feedbackViewSchema>;

/**
 * Reviewers' ratings of job outputs (spec 07c S13), recorded for the calling service that ran
 * the job: one per reviewer per block of the output, a repeat replacing the earlier rating. Each
 * rating is announced by `ai.feedback.recorded.v1` in the same transaction. The note is sealed
 * under the tenant's key before it is stored.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly events: EventPublisher,
    private readonly cipher: FieldCipher,
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
    const caller = callerOf(principal);
    const job = await this.ratedJob(jobId, tenant, caller);
    if (!job) return undefined;
    const block = input.block ?? null;
    // Sealed before the transaction (a call to OpenBao), bound to the rated block.
    const note =
      input.note === null
        ? { noteCiphertext: null, noteEnvelope: null }
        : await this.cipher
            .encrypt({
              tenant,
              recordId: feedbackNoteRecordId(job.id, input.reviewerSubject, block),
              plaintext: input.note,
            })
            .then(({ ciphertext, envelope }) => ({
              noteCiphertext: ciphertext,
              noteEnvelope: envelope,
            }));
    return asTenant(
      this.db,
      tenant,
      async (tx) => {
        const [row] = await tx
          .insert(feedback)
          .values({
            id: uuidv7(),
            jobId: job.id,
            tenant,
            reviewerSubject: input.reviewerSubject,
            block,
            rating: input.rating,
            reason: input.reason,
            ...note,
            at: new Date(),
          })
          .onConflictDoUpdate({
            target: [feedback.jobId, feedback.reviewerSubject, feedback.block],
            set: {
              rating: sql`excluded.rating`,
              reason: sql`excluded.reason`,
              noteCiphertext: sql`excluded.note_ciphertext`,
              noteEnvelope: sql`excluded.note_envelope`,
              at: sql`excluded.at`,
            },
          })
          .returning();
        if (!row) throw new Error(`Feedback on job ${job.id} was not recorded`);
        await this.events.record(tx, feedbackRecorded(job, row));
        return {
          jobId: row.jobId,
          reviewerSubject: row.reviewerSubject,
          block: row.block,
          rating: row.rating,
          reason: row.reason,
          note: input.note,
          at: row.at.toISOString(),
        };
      },
      caller,
    );
  }

  private async ratedJob(jobId: string, tenant: string, caller: string) {
    const [job] = await asTenant(
      this.db,
      tenant,
      (tx) =>
        tx
          .select({ id: jobs.id, task: jobs.task, tenant: jobs.tenant })
          .from(jobs)
          .where(
            and(
              eq(jobs.id, jobId),
              eq(jobs.tenant, tenant),
              eq(jobs.caller, caller),
              eq(jobs.status, 'succeeded'),
            ),
          ),
      caller,
    );
    return job;
  }
}

/**
 * The record id a feedback note is sealed under (AAD): the rated block of the job by the
 * reviewer, which a repeat rating replaces.
 */
export function feedbackNoteRecordId(
  jobId: string,
  reviewerSubject: string,
  block: string | null,
): string {
  return `ai-feedback-note:${JSON.stringify([jobId, reviewerSubject, block])}`;
}
