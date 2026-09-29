import type { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from './case-lookup.js';
import { type CaseStatusChangedData, REVIEW_CASE_STATUS_CHANGED } from './events.js';
import { type CaseStatus, reviewCases, reviewTimeline } from './schema.js';

/** A move of a case from one status to another, by `actor`. */
export interface StatusChange {
  tenant: string;
  caseId: string;
  from: CaseStatus;
  to: CaseStatus;
  actor: string;
  /** When the move happened; the database's time when absent. */
  at?: Date;
}

/**
 * The one way a case changes status: in the caller's transaction the case moves to `to`, with a
 * `status-changed` timeline entry and `review.case.status-changed.v1`. A move to the status the
 * case already has changes nothing.
 */
export async function changeCaseStatus(
  tx: ReviewTransaction,
  events: EventPublisher,
  { tenant, caseId, from, to, actor, at }: StatusChange,
): Promise<void> {
  if (from === to) return;
  await tx.update(reviewCases).set({ status: to }).where(eq(reviewCases.id, caseId));
  await tx.insert(reviewTimeline).values({
    id: uuidv7(),
    tenant,
    caseId,
    kind: 'status-changed',
    ref: null,
    actor,
    summary: `Status changed from ${from} to ${to}`,
    ...(at ? { at } : {}),
  });
  await events.record<CaseStatusChangedData>(tx, {
    type: REVIEW_CASE_STATUS_CHANGED,
    subject: caseId,
    tenant,
    data: { caseId, from, to },
  });
}

/**
 * The status after the case's assignee changes: `unassigned` and `assigned` follow the assignee;
 * a case further on (awaiting clarification, say) keeps its status.
 */
export function statusAfterAssignment(status: CaseStatus, assignee: string | null): CaseStatus {
  if (assignee !== null && status === 'unassigned') return 'assigned';
  if (assignee === null && status === 'assigned') return 'unassigned';
  return status;
}
