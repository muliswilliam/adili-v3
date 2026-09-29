import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';

import {
  type AgeCounts,
  type ApprovalPosition,
  ApprovalSource,
  type PendingApproval,
} from '../approvals/approval-source.js';
import { reviewersOfRecord } from '../approvals/separation-of-duties.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { officer } from '../cases/representation.js';
import { type ActionRow, approverRoleOf } from './ladder-records.js';
import { ACTION_STEPS, administrativeActions, enforcementLadders } from './schema.js';

/** How much of a response the inbox card shows. */
const RESPONSE_EXCERPT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Drafted ladder steps as the approvals inbox lists them (spec 08): the step, its subject and the
 * steps before it on the ladder with the declarant's responses, so the approver reads them first.
 */
@Injectable()
export class ActionApprovals extends ApprovalSource {
  readonly kind = 'action' as const;

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
      .where(
        and(
          eq(administrativeActions.tenant, tenant),
          eq(administrativeActions.status, 'proposed'),
          after === null
            ? undefined
            : or(
                gt(administrativeActions.proposedAt, after.proposedAt),
                and(
                  eq(administrativeActions.proposedAt, after.proposedAt),
                  gt(administrativeActions.id, after.subjectId),
                ),
              ),
        ),
      )
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

  async ageCounts(tx: ReviewTransaction, tenant: string, now: Date): Promise<AgeCounts> {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const [counts] = await tx
      .select({
        total: count(),
        from7To30Days:
          sql<number>`count(*) filter (where ${lte(administrativeActions.proposedAt, weekAgo)} and ${gt(administrativeActions.proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
        over30Days:
          sql<number>`count(*) filter (where ${lte(administrativeActions.proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
      })
      .from(administrativeActions)
      .where(
        and(eq(administrativeActions.tenant, tenant), eq(administrativeActions.status, 'proposed')),
      );
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
      .select({ status: administrativeActions.status })
      .from(administrativeActions)
      .where(and(eq(administrativeActions.id, subjectId), eq(administrativeActions.tenant, tenant)))
      .for('update');
    return found ? { pending: found.status === 'proposed' } : null;
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
