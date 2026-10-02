import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { AiGatewayClient, AiGatewayUnavailable } from '../ai-gateway/ai-gateway-client.js';
import { caseTenant } from '../cases/access.js';
import { findCase, type ReviewTransaction, visibleId } from '../cases/case-lookup.js';
import type { ReviewSchema } from '../db/schema.js';
import { upstreamUnavailable } from '../internal-api/upstream.js';
import { reviewCopilotDrafts } from './draft-schema.js';
import {
  COPILOT_RATINGS,
  type CopilotRating,
  reviewCopilotRatings,
  reviewCopilots,
} from './schema.js';

/** review.yaml `CopilotFeedbackInput`. */
export const copilotFeedbackInput = z.object({
  rating: z.enum(COPILOT_RATINGS),
  reason: z.enum(['inaccurate', 'missed-something', 'unclear', 'too-long', 'other']).nullable(),
  note: z.string().max(1000).nullable(),
});
export type CopilotFeedbackInput = z.infer<typeof copilotFeedbackInput>;

/** An entry of review.yaml `CopilotView.feedback`. */
export interface CopilotRatingView {
  jobId: string;
  rating: CopilotRating;
}

/**
 * The case whose copilot shows the output of job `jobId` (its summary or its explanations, or a
 * clarification draft ready within its 24 hours); null when no case of the transaction's tenant
 * shows it.
 */
export async function caseShowingOutput(
  tx: ReviewTransaction,
  jobId: string,
): Promise<string | null> {
  const [shown] = await tx
    .select({ caseId: reviewCopilots.caseId })
    .from(reviewCopilots)
    .where(or(eq(reviewCopilots.summaryJobId, jobId), eq(reviewCopilots.explanationsJobId, jobId)));
  if (shown) return shown.caseId;
  const [drafted] = await tx
    .select({ caseId: reviewCopilotDrafts.caseId })
    .from(reviewCopilotDrafts)
    .where(
      and(
        eq(reviewCopilotDrafts.jobId, jobId),
        eq(reviewCopilotDrafts.status, 'ready'),
        gt(reviewCopilotDrafts.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return drafted?.caseId ?? null;
}

/** The officer's own ratings of the outputs `jobIds`. */
export async function ratingsOf(
  tx: ReviewTransaction,
  reviewerSubject: string,
  jobIds: (string | null)[],
): Promise<CopilotRatingView[]> {
  const ids = jobIds.filter((id): id is string => id !== null);
  if (ids.length === 0) return [];
  return tx
    .select({ jobId: reviewCopilotRatings.jobId, rating: reviewCopilotRatings.rating })
    .from(reviewCopilotRatings)
    .where(
      and(
        eq(reviewCopilotRatings.reviewerSubject, reviewerSubject),
        inArray(reviewCopilotRatings.jobId, ids),
      ),
    )
    .orderBy(reviewCopilotRatings.jobId);
}

/**
 * Officers' ratings of the copilot's outputs (spec 07c S13). The case's assignee rates; the
 * Commission's other reviewers and its supervisors read the copilot but do not rate it (403),
 * and anyone else gets 404. The rating goes to the ai-gateway first, which holds it with the
 * reason and note and announces it for reporting; the review service then keeps the rating to
 * show it back. A repeat by the same officer replaces their rating in both places.
 */
@Injectable()
export class CopilotFeedback {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly gateway: AiGatewayClient,
  ) {}

  async rate(principal: Principal, jobId: string, input: CopilotFeedbackInput): Promise<void> {
    const tenant = caseTenant(principal);
    const context = { tenant, subject: principal.subject };
    const caseId = await withTenant(this.db, context, async (tx) => {
      const shownOn = notFoundIfInvisible(await caseShowingOutput(tx, visibleId(jobId)));
      const row = await findCase(tx, tenant, shownOn);
      if (row.assignee !== principal.subject) {
        throw new ProblemException(
          {
            type: 'not-the-assignee',
            title: 'Forbidden',
            status: HttpStatus.FORBIDDEN,
            detail: "Only the case's assignee rates its copilot.",
          },
          { code: 'not-the-assignee' },
        );
      }
      return row.id;
    });

    let recorded: boolean;
    try {
      recorded = await this.gateway.recordFeedback(jobId, {
        reviewerSubject: principal.subject,
        ...input,
      });
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) {
        throw upstreamUnavailable(
          'ai-gateway',
          'The AI gateway cannot be reached. Try again shortly.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
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
          tenant,
          caseId,
          rating: input.rating,
          ratedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [reviewCopilotRatings.jobId, reviewCopilotRatings.reviewerSubject],
          set: { rating: sql`excluded.rating`, ratedAt: sql`excluded.rated_at` },
        }),
    );
  }
}
