import { Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';

import {
  type ApprovalPosition,
  ApprovalSource,
  type PendingApproval,
  type ProposalTable,
} from '../approvals/approval-source.js';
import { reviewersOfRecord } from '../approvals/separation-of-duties.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { reviewCases } from '../cases/schema.js';
import { officer } from '../cases/representation.js';
import { determinations } from './schema.js';

/** How much of the reasons the inbox card shows. */
const REASONS_EXCERPT = 200;

/**
 * The system's `compliant-no-issues` proposals are bulk closures: a supervisor approves them by
 * filter on the bulk closure screen, so they stay out of the inbox, which would drown in them.
 */
const notBulkClosure: SQL = sql`not (${determinations.proposerKind} = 'system' and ${determinations.outcome} = 'compliant-no-issues')`;

/** Proposed determinations as the approvals inbox lists them (spec 08), bulk closures aside. */
@Injectable()
export class DeterminationApprovals extends ApprovalSource {
  readonly kind = 'determination' as const;

  protected readonly proposals: ProposalTable = {
    table: determinations,
    id: determinations.id,
    tenant: determinations.tenant,
    status: determinations.status,
    proposedAt: determinations.proposedAt,
    excluded: notBulkClosure,
  };

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
      .where(and(this.waiting(tenant), this.after(after)))
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
}
