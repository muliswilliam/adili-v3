import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, isNotNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewSchema } from '../db/schema.js';
import { caseTenant, isSupervisor } from './access.js';
import { caseItem, type CaseRow, findCase, type ReviewTransaction } from './case-lookup.js';
import { changeCaseStatus, statusAfterAssignment } from './case-status.js';
import { type CaseAssignedData, REVIEW_CASE_ASSIGNED } from './events.js';
import type { CaseListItem } from './representation.js';
import { type AssignmentKind, reviewAssignments, reviewCases, reviewTimeline } from './schema.js';

interface AssignmentChange {
  assignee: string | null;
  assigneeName: string | null;
  kind: AssignmentKind;
  by: string;
}

/**
 * Who works a case (spec 07a): a reviewer or supervisor of the Commission claims an unassigned
 * case and releases their own; a supervisor reassigns or unassigns any. Every change appends to
 * the reviewer-of-record history (separation of duties, spec 08), adds a timeline entry and
 * records `review.case.assigned.v1` (and `review.case.status-changed.v1` when the status moves)
 * in the same transaction.
 */
@Injectable()
export class AssignmentService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
  ) {}

  claim(principal: Principal, caseId: string): Promise<CaseListItem> {
    return this.change(principal, caseId, (row) => {
      if (row.assignee !== null) {
        throw new ProblemException({
          type: 'case-already-assigned',
          title: 'Case already assigned',
          status: HttpStatus.CONFLICT,
          detail: 'Another officer holds this case. Ask a supervisor to reassign it.',
        });
      }
      return {
        assignee: principal.subject,
        assigneeName: principal.name,
        kind: 'claimed',
        by: principal.subject,
      };
    });
  }

  release(principal: Principal, caseId: string): Promise<CaseListItem> {
    return this.change(principal, caseId, (row) => {
      if (row.assignee !== principal.subject) {
        throw forbidden('Only the officer who holds a case can release it.');
      }
      return { assignee: null, assigneeName: null, kind: 'released', by: principal.subject };
    });
  }

  reassign(principal: Principal, caseId: string, assignee: string | null): Promise<CaseListItem> {
    return this.change(principal, caseId, async (row, tx) => {
      if (!isSupervisor(principal)) {
        throw forbidden('Only a supervisor can reassign or unassign a case.');
      }
      if (assignee === row.assignee) return null;
      return assignee === null
        ? { assignee: null, assigneeName: null, kind: 'unassigned', by: principal.subject }
        : {
            assignee,
            assigneeName: await knownName(tx, row.tenant, assignee),
            kind: 'reassigned',
            by: principal.subject,
          };
    });
  }

  /**
   * Applies the change `decide` makes of the locked case (null: nothing to change). The status
   * moves between `unassigned` and `assigned` only; a case further on (awaiting clarification,
   * say) keeps its status while its assignee changes.
   */
  private change(
    principal: Principal,
    caseId: string,
    decide: (
      row: CaseRow,
      tx: ReviewTransaction,
    ) => AssignmentChange | null | Promise<AssignmentChange | null>,
  ): Promise<CaseListItem> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const row = await findCase(tx, tenant, caseId, { lock: true });
      const change = await decide(row, tx);
      if (change === null) return caseItem(tx, row);

      const status = statusAfterAssignment(row.status, change.assignee);
      const now = new Date();
      const [updated] = await tx
        .update(reviewCases)
        .set({
          assignee: change.assignee,
          assigneeName: change.assigneeName,
          claimedAt: change.assignee === null ? null : now,
        })
        .where(eq(reviewCases.id, row.id))
        .returning();
      if (!updated) throw new Error(`The case ${row.id} disappeared under its lock`);

      await tx.insert(reviewAssignments).values({
        id: uuidv7(),
        tenant,
        caseId: row.id,
        subject: change.assignee,
        subjectName: change.assigneeName,
        kind: change.kind,
        by: change.by,
        at: now,
      });
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: row.id,
        kind: 'assigned',
        ref: change.assignee,
        actor: change.by,
        summary: summaryOf(change),
        at: now,
      });
      await this.events.record<CaseAssignedData>(tx, {
        type: REVIEW_CASE_ASSIGNED,
        subject: row.id,
        tenant,
        data: { caseId: row.id, assignee: change.assignee, by: change.by, kind: change.kind },
      });
      await changeCaseStatus(tx, this.events, {
        tenant,
        caseId: row.id,
        from: row.status,
        to: status,
        actor: change.by,
        at: now,
      });
      return caseItem(tx, { ...updated, status });
    });
  }
}

function summaryOf(change: AssignmentChange): string {
  switch (change.kind) {
    case 'claimed':
      return 'Claimed';
    case 'released':
      return 'Released to the queue';
    case 'reassigned':
      return `Reassigned to ${change.assigneeName ?? 'another officer'}`;
    case 'unassigned':
      return 'Unassigned by a supervisor';
  }
}

/** The display name an officer had when they last held a case of the Commission, if ever. */
async function knownName(
  tx: ReviewTransaction,
  tenant: string,
  subject: string,
): Promise<string | null> {
  const [known] = await tx
    .select({ name: reviewAssignments.subjectName })
    .from(reviewAssignments)
    .where(
      and(
        eq(reviewAssignments.tenant, tenant),
        eq(reviewAssignments.subject, subject),
        isNotNull(reviewAssignments.subjectName),
      ),
    )
    .limit(1);
  return known?.name ?? null;
}

function forbidden(detail: string): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
    detail,
  });
}
