import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, lte, or, sql } from 'drizzle-orm';

import {
  type AgeCounts,
  type ApprovalPosition,
  ApprovalSource,
  type PendingApproval,
} from '../approvals/approval-source.js';
import { mergedReviewers, reviewersOfRecord } from '../approvals/separation-of-duties.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { officer } from '../cases/representation.js';
import { referrals } from './schema.js';

/** How much of the narrative the inbox card shows. */
const NARRATIVE_EXCERPT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Proposed referrals as the approvals inbox lists them (spec 08): the grounds, the declarant and
 * what the referral rests on, for a supervisor who neither proposed it nor held any of its cases.
 */
@Injectable()
export class ReferralApprovals extends ApprovalSource {
  readonly kind = 'referral' as const;

  async pending(
    tx: ReviewTransaction,
    tenant: string,
    after: ApprovalPosition | null,
    limit: number,
  ): Promise<PendingApproval[]> {
    const rows = await tx
      .select()
      .from(referrals)
      .where(
        and(
          eq(referrals.tenant, tenant),
          eq(referrals.status, 'proposed'),
          after === null
            ? undefined
            : or(
                gt(referrals.proposedAt, after.proposedAt),
                and(eq(referrals.proposedAt, after.proposedAt), gt(referrals.id, after.subjectId)),
              ),
        ),
      )
      .orderBy(asc(referrals.proposedAt), asc(referrals.id))
      .limit(limit);
    const reviewers = await reviewersOfRecord(
      tx,
      rows.flatMap((referral) => referral.sources.caseIds),
    );
    return rows.map((referral) => {
      const caseReviewers = new Map(
        referral.sources.caseIds.map((caseId) => [
          caseId,
          reviewers.get(caseId) ?? new Set<string>(),
        ]),
      );
      return {
        kind: this.kind,
        subjectId: referral.id,
        proposedAt: referral.proposedAt,
        proposerKind: referral.proposerKind,
        proposer: officer(referral.proposer, referral.proposerName),
        summary: {
          grounds: referral.grounds,
          caseId: referral.caseId,
          cycleYear: referral.cycleYear,
          declarantName: referral.declarantName,
          personnelFileNumber: referral.personnelFileNumber,
          narrativeExcerpt: referral.narrative.slice(0, NARRATIVE_EXCERPT),
          evidence: {
            flags: referral.sources.flagIds.length,
            clarifications: referral.sources.clarificationIds.length,
            obligations: referral.sources.obligationIds.length,
            actions: referral.sources.actionIds.length,
          },
        },
        parties: {
          proposer: referral.proposer,
          reviewersOfRecord: mergedReviewers(caseReviewers),
        },
      };
    });
  }

  async ageCounts(tx: ReviewTransaction, tenant: string, now: Date): Promise<AgeCounts> {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const [counts] = await tx
      .select({
        total: count(),
        from7To30Days:
          sql<number>`count(*) filter (where ${lte(referrals.proposedAt, weekAgo)} and ${gt(referrals.proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
        over30Days:
          sql<number>`count(*) filter (where ${lte(referrals.proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
      })
      .from(referrals)
      .where(and(eq(referrals.tenant, tenant), eq(referrals.status, 'proposed')));
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
      .select({ status: referrals.status })
      .from(referrals)
      .where(and(eq(referrals.id, subjectId), eq(referrals.tenant, tenant)))
      .for('update');
    return found ? { pending: found.status === 'proposed' } : null;
  }
}
