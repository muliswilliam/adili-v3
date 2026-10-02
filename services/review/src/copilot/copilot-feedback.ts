import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type FeedbackInput,
} from '../ai-gateway/ai-gateway-client.js';
import { caseTenant, notTheAssignee } from '../cases/access.js';
import { findCase, type ReviewTransaction, visibleId } from '../cases/case-lookup.js';
import type { ReviewSchema } from '../db/schema.js';
import { openOutput } from './copilot-requests.js';
import { reviewCopilotDrafts } from './draft-schema.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { aiGatewayUnavailable } from './problems.js';
import {
  COPILOT_RATINGS,
  type CopilotRating,
  type CopilotRow,
  reviewCopilotRatings,
  reviewCopilots,
} from './schema.js';

/** The blocks of a summary a reviewer rates one by one (review.yaml `CopilotBlock`). */
const SUMMARY_BLOCKS = {
  overview: 'overview',
  changes: 'changesSincePrevious',
  sections: 'sections',
  'worth-attention': 'worthAttention',
} as const;

const FLAG_BLOCK = /^flag:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** review.yaml `CopilotBlock`. */
const copilotBlock = z
  .string()
  .max(64)
  .refine((block) => block in SUMMARY_BLOCKS || FLAG_BLOCK.test(block), 'Not a copilot block');

/** Why a reviewer found an output unhelpful: the ai-gateway's `FeedbackInput.reason`, forwarded. */
const FEEDBACK_REASONS = [
  'inaccurate',
  'missed-something',
  'unclear',
  'too-long',
  'other',
] as const satisfies readonly NonNullable<FeedbackInput['reason']>[];

/** review.yaml `CopilotFeedbackInput`. */
export const copilotFeedbackInput = z.object({
  block: copilotBlock.nullish().transform((block) => block ?? null),
  rating: z.enum(COPILOT_RATINGS),
  reason: z.enum(FEEDBACK_REASONS).nullable(),
  note: z.string().max(1000).nullable(),
});
export type CopilotFeedbackInput = z.infer<typeof copilotFeedbackInput>;

/** An entry of review.yaml `CopilotView.feedback`. */
export interface CopilotRatingView {
  jobId: string;
  block: string | null;
  rating: CopilotRating;
}

/** Which output of a case a job's is: its summary, its explanations, or a clarification draft. */
type ShownOutput =
  | { caseId: string; kind: 'summary' | 'explanations'; record: CopilotRow }
  | { caseId: string; kind: 'draft' };

/**
 * The case whose copilot shows the output of job `jobId` (its summary or its explanations, or a
 * clarification draft `requestedBy` asked for, ready within its 24 hours), and which output it
 * is; null when no case of the transaction's tenant shows it to them.
 */
export async function caseShowingOutput(
  tx: ReviewTransaction,
  jobId: string,
  requestedBy: string,
): Promise<ShownOutput | null> {
  const [shown] = await tx
    .select()
    .from(reviewCopilots)
    .where(or(eq(reviewCopilots.summaryJobId, jobId), eq(reviewCopilots.explanationsJobId, jobId)));
  if (shown) {
    const kind = shown.summaryJobId === jobId ? 'summary' : 'explanations';
    return { caseId: shown.caseId, kind, record: shown };
  }
  const [drafted] = await tx
    .select({ caseId: reviewCopilotDrafts.caseId })
    .from(reviewCopilotDrafts)
    .where(
      and(
        eq(reviewCopilotDrafts.jobId, jobId),
        // A draft is its requester's alone, as its poll is.
        eq(reviewCopilotDrafts.requestedBy, requestedBy),
        eq(reviewCopilotDrafts.status, 'ready'),
        gt(reviewCopilotDrafts.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return drafted ? { caseId: drafted.caseId, kind: 'draft' } : null;
}

/** The reviewer's own ratings of the outputs `jobIds`, block by block. */
export async function ratingsOf(
  tx: ReviewTransaction,
  reviewerSubject: string,
  jobIds: (string | null)[],
): Promise<CopilotRatingView[]> {
  const ids = jobIds.filter((id): id is string => id !== null);
  if (ids.length === 0) return [];
  return tx
    .select({
      jobId: reviewCopilotRatings.jobId,
      block: reviewCopilotRatings.block,
      rating: reviewCopilotRatings.rating,
    })
    .from(reviewCopilotRatings)
    .where(
      and(
        eq(reviewCopilotRatings.reviewerSubject, reviewerSubject),
        inArray(reviewCopilotRatings.jobId, ids),
      ),
    )
    .orderBy(reviewCopilotRatings.jobId, reviewCopilotRatings.block);
}

/**
 * Reviewers' ratings of the copilot's outputs (spec 07c S13), one per block: each summary block
 * and each flag's explanation has its own control, a clarification draft one for the whole. The
 * case's assignee rates; the Commission's other reviewers and its supervisors read the copilot but
 * do not rate it (403), and anyone else gets 404. A block the output does not have is 400. The
 * rating goes to the ai-gateway first, which holds it with the reason and note and announces it
 * for reporting; the review service then keeps the rating to show it back. A repeat by the same
 * reviewer of the same block replaces their rating in both places.
 */
@Injectable()
export class CopilotFeedback {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly gateway: AiGatewayClient,
    private readonly cipher: FieldCipher,
  ) {}

  async rate(principal: Principal, jobId: string, input: CopilotFeedbackInput): Promise<void> {
    const tenant = caseTenant(principal);
    const context = { tenant, subject: principal.subject };
    const shown = await withTenant(this.db, context, async (tx) => {
      const output = notFoundIfInvisible(
        await caseShowingOutput(tx, visibleId(jobId), principal.subject),
      );
      const row = await findCase(tx, tenant, output.caseId);
      if (row.assignee !== principal.subject) {
        throw notTheAssignee("Only the case's assignee rates its copilot.");
      }
      return output;
    });
    if (!(await this.hasBlock(shown, input.block))) {
      throw new ProblemException(
        {
          type: 'block-not-in-output',
          title: 'Bad Request',
          status: HttpStatus.BAD_REQUEST,
          detail: `The output has no block ${String(input.block)}.`,
        },
        { code: 'block-not-in-output' },
      );
    }

    let recorded: boolean;
    try {
      recorded = await this.gateway.recordFeedback(tenant, jobId, {
        reviewerSubject: principal.subject,
        ...input,
      });
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) throw aiGatewayUnavailable();
      if (error instanceof InternalApiRejected) throw feedbackRejected();
      throw error;
    }
    // The gateway does not know the output's job (it never forgets one): as if it did not exist.
    if (!recorded) notFoundIfInvisible(null);

    await withTenant(this.db, context, (tx) =>
      tx
        .insert(reviewCopilotRatings)
        .values({
          jobId,
          reviewerSubject: principal.subject,
          block: input.block,
          tenant,
          caseId: shown.caseId,
          rating: input.rating,
          ratedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            reviewCopilotRatings.jobId,
            reviewCopilotRatings.reviewerSubject,
            reviewCopilotRatings.block,
          ],
          set: { rating: sql`excluded.rating`, ratedAt: sql`excluded.rated_at` },
        }),
    );
  }

  /** Whether the output shows `block`: null (the whole) always does. */
  private async hasBlock(shown: ShownOutput, block: string | null): Promise<boolean> {
    if (block === null) return true;
    if (shown.kind === 'draft') return false;
    const output = await openOutput(this.cipher, shown.record, shown.kind);
    if (!output) return false;
    if (shown.kind === 'summary') {
      if (!(block in SUMMARY_BLOCKS)) return false;
      return SUMMARY_BLOCKS[block as keyof typeof SUMMARY_BLOCKS] in output;
    }
    const flagId = FLAG_BLOCK.exec(block)?.[1];
    const explanations = output.explanations;
    return (
      flagId !== undefined &&
      Array.isArray(explanations) &&
      explanations.some(
        (explanation: unknown) =>
          typeof explanation === 'object' &&
          explanation !== null &&
          (explanation as { flagId?: unknown }).flagId === flagId,
      )
    );
  }
}

/** 400: the gateway refused the rating (its validation of the feedback); nothing was recorded. */
function feedbackRejected(): ProblemException {
  return new ProblemException(
    {
      type: 'feedback-rejected',
      title: 'Bad Request',
      status: HttpStatus.BAD_REQUEST,
      detail: 'The AI gateway refused the rating.',
    },
    { code: 'feedback-rejected' },
  );
}
