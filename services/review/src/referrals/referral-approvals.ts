import { Injectable } from '@nestjs/common';
import { and, asc } from 'drizzle-orm';

import {
  type ApprovalPosition,
  ApprovalSource,
  type PendingApproval,
  type ProposalTable,
} from '../approvals/approval-source.js';
import { mergedReviewers, reviewersOfRecord } from '../approvals/separation-of-duties.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { officer } from '../cases/representation.js';
import { referrals } from './schema.js';

/** How much of the narrative the inbox card shows. */
const NARRATIVE_EXCERPT = 200;

/**
 * Proposed referrals as the approvals inbox lists them (spec 08): the grounds, the declarant and
 * what the referral rests on, for a supervisor who neither proposed it nor held any of its cases.
 */
@Injectable()
export class ReferralApprovals extends ApprovalSource {
  readonly kind = 'referral' as const;

  protected readonly proposals: ProposalTable = {
    table: referrals,
    id: referrals.id,
    tenant: referrals.tenant,
    status: referrals.status,
    proposedAt: referrals.proposedAt,
  };

  async pending(
    tx: ReviewTransaction,
    tenant: string,
    after: ApprovalPosition | null,
    limit: number,
  ): Promise<PendingApproval[]> {
    const rows = await tx
      .select()
      .from(referrals)
      .where(and(this.waiting(tenant), this.after(after)))
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
}
