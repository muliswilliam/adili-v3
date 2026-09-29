import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  type ApprovalPosition,
  ApprovalSource,
  type PendingApproval,
  type ProposalTable,
} from '../approvals/approval-source.js';
import { reviewersOfRecord } from '../approvals/separation-of-duties.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { officer } from '../cases/representation.js';
import { type ActionRow, approverRoleOf } from './ladder-records.js';
import { ACTION_STEPS, administrativeActions, enforcementLadders } from './schema.js';

/** How much of a response the inbox card shows. */
const RESPONSE_EXCERPT = 200;

/**
 * Drafted ladder steps as the approvals inbox lists them (spec 08): the step, its subject and the
 * steps before it on the ladder with the declarant's responses, so the approver reads them first.
 */
@Injectable()
export class ActionApprovals extends ApprovalSource {
  readonly kind = 'action' as const;

  protected readonly proposals: ProposalTable = {
    table: administrativeActions,
    id: administrativeActions.id,
    tenant: administrativeActions.tenant,
    status: administrativeActions.status,
    proposedAt: administrativeActions.proposedAt,
  };

  async pending(
    tx: ReviewTransaction,
    tenant: string,
    after: ApprovalPosition | null,
    limit: number,
  ): Promise<PendingApproval[]> {
    const rows = await tx
      .select({ action: administrativeActions, ladder: enforcementLadders })
      .from(administrativeActions)
      .innerJoin(enforcementLadders, eq(enforcementLadders.id, administrativeActions.ladderId))
      .where(and(this.waiting(tenant), this.after(after)))
      .orderBy(asc(administrativeActions.proposedAt), asc(administrativeActions.id))
      .limit(limit);
    const caseIds = rows.flatMap(({ ladder }) => (ladder.caseId === null ? [] : [ladder.caseId]));
    const reviewers = await reviewersOfRecord(tx, caseIds);
    const earlier = await priorSteps(
      tx,
      rows.map(({ ladder }) => ladder.id),
    );
    return rows.map(({ action, ladder }) => ({
      kind: this.kind,
      subjectId: action.id,
      proposedAt: action.proposedAt,
      proposerKind: action.proposerKind,
      proposer: officer(action.proposer, action.proposerName),
      summary: {
        ladderId: ladder.id,
        step: action.step,
        subjectKind: ladder.subjectKind,
        subjectId: ladder.subjectId,
        subjectReference: ladder.subjectReference,
        declarantName: ladder.declarantName,
        personnelFileNumber: ladder.personnelFileNumber,
        priorSteps: (earlier.get(ladder.id) ?? [])
          .filter((prior) => prior.id !== action.id)
          .map(priorStepSummary),
      },
      parties: {
        proposer: action.proposer,
        reviewersOfRecord:
          ladder.caseId === null ? new Set<string>() : (reviewers.get(ladder.caseId) ?? new Set()),
        approverRole: approverRoleOf(action.step),
      },
    }));
  }
}

/** The steps of each ladder that were approved (they carry a reference), in ladder order. */
async function priorSteps(
  tx: ReviewTransaction,
  ladderIds: readonly string[],
): Promise<Map<string, ActionRow[]>> {
  const byLadder = new Map<string, ActionRow[]>();
  if (ladderIds.length === 0) return byLadder;
  const rows = await tx
    .select()
    .from(administrativeActions)
    .where(inArray(administrativeActions.ladderId, [...new Set(ladderIds)]))
    .orderBy(asc(administrativeActions.run), asc(administrativeActions.proposedAt));
  // Ladder order: by run, then step (drafts of one run may share an instant).
  rows.sort((a, b) => a.run - b.run || ACTION_STEPS.indexOf(a.step) - ACTION_STEPS.indexOf(b.step));
  for (const row of rows) {
    if (row.reference === null) continue;
    byLadder.set(row.ladderId, [...(byLadder.get(row.ladderId) ?? []), row]);
  }
  return byLadder;
}

function priorStepSummary(row: ActionRow) {
  return {
    actionId: row.id,
    step: row.step,
    status: row.status,
    reference: row.reference,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseExcerpt: row.response?.text.slice(0, RESPONSE_EXCERPT) ?? null,
    responseAttachments: row.response?.attachments.length ?? 0,
  };
}
