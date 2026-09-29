import { HttpStatus } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { and, inArray, isNotNull } from 'drizzle-orm';

import { isSupervisor } from '../cases/access.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { reviewAssignments, reviewCases } from '../cases/schema.js';

/** review.yaml `ApprovalItem.cannotApproveReason`: why a caller may not approve. */
export type CannotApproveReason = 'role' | 'proposer' | 'reviewer-of-record';

/** Who an approval must be kept away from: its proposer and the case's reviewers of record. */
export interface ApprovalParties {
  /** The proposing officer; null for a system proposal. */
  proposer: string | null;
  /** Everyone who held the case (reviewer-of-record history). */
  reviewersOfRecord: ReadonlySet<string>;
}

/**
 * The separation-of-duties rule (ADR-004, spec 08): the approver did not propose, never held the
 * case, and holds `supervisor`. Null when `principal` may approve; else why not. The proposer and
 * the reviewers of record are told so whatever their role (spec 08 S1).
 */
export function cannotApprove(
  principal: Principal,
  parties: ApprovalParties,
): CannotApproveReason | null {
  if (parties.proposer === principal.subject) return 'proposer';
  if (parties.reviewersOfRecord.has(principal.subject)) return 'reviewer-of-record';
  if (!isSupervisor(principal)) return 'role';
  return null;
}

/**
 * Refuses an approval, return or decline by a caller the rule excludes: 403 `separation-of-duties`
 * for the proposer or a reviewer of record, 403 `supervisor-required` for any other reviewer.
 */
export function requireCanApprove(principal: Principal, parties: ApprovalParties): void {
  const reason = cannotApprove(principal, parties);
  if (reason === null) return;
  if (reason === 'role') {
    throw new ProblemException(
      {
        type: 'supervisor-required',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: 'Only a supervisor can approve or return this.',
      },
      { code: 'supervisor-required', reason },
    );
  }
  throw new ProblemException(
    {
      type: 'separation-of-duties',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail:
        reason === 'proposer'
          ? 'You proposed this, so another supervisor must decide it.'
          : 'You reviewed this case, so another supervisor must decide it.',
    },
    { code: 'separation-of-duties', reason },
  );
}

/**
 * The case's reviewers of record: every officer its assignment history names and whoever holds it
 * now. Read in the caller's transaction, under the tenant's row-level security.
 */
export async function reviewersOfRecord(
  tx: ReviewTransaction,
  caseIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const byCase = new Map<string, Set<string>>(caseIds.map((id) => [id, new Set<string>()]));
  if (caseIds.length === 0) return byCase;
  const history = await tx
    .select({ caseId: reviewAssignments.caseId, subject: reviewAssignments.subject })
    .from(reviewAssignments)
    .where(
      and(inArray(reviewAssignments.caseId, [...caseIds]), isNotNull(reviewAssignments.subject)),
    );
  const holders = await tx
    .select({ caseId: reviewCases.id, subject: reviewCases.assignee })
    .from(reviewCases)
    .where(and(inArray(reviewCases.id, [...caseIds]), isNotNull(reviewCases.assignee)));
  for (const { caseId, subject } of [...history, ...holders]) {
    if (subject !== null) byCase.get(caseId)?.add(subject);
  }
  return byCase;
}

/** The reviewers of record of one case. */
export async function caseReviewersOfRecord(
  tx: ReviewTransaction,
  caseId: string,
): Promise<Set<string>> {
  const found = await reviewersOfRecord(tx, [caseId]);
  return found.get(caseId) ?? new Set();
}
