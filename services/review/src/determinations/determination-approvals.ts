import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, lte, or, sql } from 'drizzle-orm';

import {
  type AgeCounts,
  type ApprovalPosition,
  ApprovalSource,
  type PendingApproval,
} from '../approvals/approval-source.js';
import { reviewersOfRecord } from '../approvals/separation-of-duties.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { reviewCases } from '../cases/schema.js';
import { officer } from './representation.js';
import { determinations } from './schema.js';

/** How much of the reasons the inbox card shows. */
const REASONS_EXCERPT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Proposed determinations as the approvals inbox lists them (spec 08). */
@Injectable()
export class DeterminationApprovals extends ApprovalSource {
  readonly kind = 'determination' as const;

  async pending(
    tx: ReviewTransaction,
    tenant: string,
    after: ApprovalPosition | null,
    limit: number,
  ): Promise<PendingApproval[]> {
    const rows = await tx
      .select({
        determination: determinations,
        caseReference: reviewCases.reference,
        declarantName: reviewCases.declarantName,
        personnelFileNumber: reviewCases.personnelFileNumber,
      })
      .from(determinations)
      .innerJoin(reviewCases, eq(reviewCases.id, determinations.caseId))
      .where(
        and(
          eq(determinations.tenant, tenant),
          eq(determinations.status, 'proposed'),
          after === null
            ? undefined
            : or(
                gt(determinations.proposedAt, after.proposedAt),
                and(
                  eq(determinations.proposedAt, after.proposedAt),
                  gt(determinations.id, after.subjectId),
                ),
              ),
        ),
      )
      .orderBy(asc(determinations.proposedAt), asc(determinations.id))
      .limit(limit);
    const reviewers = await reviewersOfRecord(
      tx,
      rows.map(({ determination }) => determination.caseId),
    );
    return rows.map(({ determination, caseReference, declarantName, personnelFileNumber }) => ({
      kind: this.kind,
      subjectId: determination.id,
      proposedAt: determination.proposedAt,
      proposerKind: determination.proposerKind,
      proposer: officer(determination.proposer, determination.proposerName),
      summary: {
        caseId: determination.caseId,
        caseReference,
        declarantName,
        personnelFileNumber,
        outcome: determination.outcome,
        reasonsExcerpt: determination.reasons.slice(0, REASONS_EXCERPT),
      },
      parties: {
        proposer: determination.proposer,
        reviewersOfRecord: reviewers.get(determination.caseId) ?? new Set(),
      },
    }));
  }

  async ageCounts(tx: ReviewTransaction, tenant: string, now: Date): Promise<AgeCounts> {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const [counts] = await tx
      .select({
        total: count(),
        from7To30Days:
          sql<number>`count(*) filter (where ${lte(determinations.proposedAt, weekAgo)} and ${gt(determinations.proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
        over30Days:
          sql<number>`count(*) filter (where ${lte(determinations.proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
      })
      .from(determinations)
      .where(and(eq(determinations.tenant, tenant), eq(determinations.status, 'proposed')));
    if (!counts) return { under7Days: 0, from7To30Days: 0, over30Days: 0 };
    return {
      under7Days: counts.total - counts.from7To30Days - counts.over30Days,
      from7To30Days: counts.from7To30Days,
      over30Days: counts.over30Days,
    };
  }

  async find(
    tx: ReviewTransaction,
    tenant: string,
    subjectId: string,
  ): Promise<{ pending: boolean } | null> {
    const [found] = await tx
      .select({ status: determinations.status })
      .from(determinations)
      .where(and(eq(determinations.id, subjectId), eq(determinations.tenant, tenant)))
      .for('update');
    return found ? { pending: found.status === 'proposed' } : null;
  }
}
