import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, CMP } from '@adili/numbering';
import { and, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { caseReviewersOfRecord, requireCanApprove } from '../approvals/separation-of-duties.js';
import { caseTenant } from '../cases/access.js';
import { type CaseRow, findCase, type ReviewTransaction, visibleId } from '../cases/case-lookup.js';
import { changeCaseStatus } from '../cases/case-status.js';
import { type CaseStatus, reviewTimeline, type TimelineKind } from '../cases/schema.js';
import { Clock, nairobiYear } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import type { DeterminationInput, ReasonInput } from './determination-input.js';
import { DeterminationWorkflows } from './determination-workflows.js';
import {
  DETERMINATION_APPROVED,
  DETERMINATION_PROPOSED,
  DETERMINATION_RETURNED,
  DETERMINATION_WITHDRAWN,
  type DeterminationEventData,
} from './events.js';
import { determinationView, type DeterminationView, OUTCOME_LABELS } from './representation.js';
import {
  type DeterminationOutcome,
  determinations,
  OPEN_PROPOSAL_STATUSES,
  type ProposalStatus,
} from './schema.js';

type DeterminationRow = typeof determinations.$inferSelect;

/**
 * Compliance determinations of review cases (spec 08): the case's assignee proposes an outcome
 * with reasons; a supervisor who neither proposed it nor ever held the case approves or returns
 * it; the proposer withdraws it while it waits. Approval allocates the `CMP` reference, moves the
 * case to `determined` (or `further-action`) and starts `DeterminationIssuanceWorkflow` (decision
 * letter, then the declarant told by person), all in one transaction with the timeline and events.
 */
@Injectable()
export class DeterminationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: DeterminationWorkflows,
    private readonly clock: Clock,
  ) {}

  async propose(
    principal: Principal,
    caseId: string,
    input: DeterminationInput,
  ): Promise<DeterminationView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const reviewCase = await findCase(tx, tenant, caseId, { lock: true });
      if (reviewCase.assignee !== principal.subject) {
        throw new ProblemException({
          type: 'not-the-assignee',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: "Only the case's assignee can propose its determination.",
        });
      }
      if (reviewCase.openClarifications > 0) {
        throw new ProblemException(
          {
            type: 'clarification-open',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail:
              'A clarification of the case is still open; resolve or withdraw it before proposing a determination.',
          },
          { code: 'clarification-open' },
        );
      }
      const [open] = await tx
        .select({ id: determinations.id, status: determinations.status })
        .from(determinations)
        .where(
          and(
            eq(determinations.caseId, reviewCase.id),
            inArray(determinations.status, OPEN_PROPOSAL_STATUSES),
          ),
        );
      if (open) {
        throw new ProblemException(
          {
            type: 'determination-open',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: `The case already has a determination ${open.status}.`,
          },
          { code: 'determination-open', determinationId: open.id },
        );
      }
      const [created] = await tx
        .insert(determinations)
        .values({
          id: uuidv7(),
          tenant,
          caseId: reviewCase.id,
          personId: reviewCase.personId,
          outcome: input.outcome,
          reasons: input.reasons,
          furtherActionNote: input.furtherActionNote ?? null,
          proposerKind: 'user',
          proposer: principal.subject,
          proposerName: principal.name,
          proposedAt: now,
          status: 'proposed',
        })
        .returning();
      const proposed = notFoundIfInvisible(created);
      await recordDetermination(tx, this.events, proposed, {
        kind: 'determination-proposed',
        type: DETERMINATION_PROPOSED,
        actor: principal.subject,
        summary: `Determination proposed: ${OUTCOME_LABELS[proposed.outcome]}`,
        at: now,
      });
      return determinationView(proposed);
    });
  }

  async get(principal: Principal, determinationId: string): Promise<DeterminationView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select()
        .from(determinations)
        .where(
          and(eq(determinations.id, visibleId(determinationId)), eq(determinations.tenant, tenant)),
        );
      return determinationView(notFoundIfInvisible(found));
    });
  }

  /**
   * A supervisor approves a proposal: the separation-of-duties rule first (403), then the status
   * (409). The `CMP` number is of the Commission and the year of approval; the directory is read
   * for the issuer code before anything changes, so an outage is a 503 and nothing is approved.
   */
  async approve(principal: Principal, determinationId: string): Promise<DeterminationView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { determination, reviewCase } = await this.lockForDecision(
        tx,
        tenant,
        principal,
        determinationId,
      );
      requireProposed(determination.status);
      const commission = await withUpstream(() => this.directory.getCommission(tenant));
      const reference = await allocateReference(tx, CMP, {
        issuer: commission.issuerCode,
        period: nairobiYear(now),
      });
      const [updated] = await tx
        .update(determinations)
        .set({
          status: 'approved',
          approver: principal.subject,
          approverName: principal.name,
          approvedAt: now,
          reference,
        })
        .where(eq(determinations.id, determination.id))
        .returning();
      const approved = notFoundIfInvisible(updated);
      await recordDetermination(tx, this.events, approved, {
        kind: 'determination-approved',
        type: DETERMINATION_APPROVED,
        actor: principal.subject,
        summary: `Determination ${reference} approved: ${OUTCOME_LABELS[approved.outcome]}`,
        at: now,
      });
      await changeCaseStatus(tx, this.events, {
        tenant,
        caseId: reviewCase.id,
        from: reviewCase.status,
        to: caseStatusAfter(approved.outcome),
        actor: principal.subject,
        at: now,
      });
      // Last, inside the transaction: if Temporal cannot be reached nothing is approved. The
      // workflow's first activity waits for this transaction to commit.
      await this.workflows.start({ tenant, determinationId: approved.id });
      return determinationView(approved);
    });
  }

  /** A supervisor the rule admits returns a proposal to its proposer with a reason. */
  async return(
    principal: Principal,
    determinationId: string,
    input: ReasonInput,
  ): Promise<DeterminationView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { determination } = await this.lockForDecision(tx, tenant, principal, determinationId);
      requireProposed(determination.status);
      const [updated] = await tx
        .update(determinations)
        .set({
          status: 'returned',
          returnedBy: principal.subject,
          returnedByName: principal.name,
          returnedAt: now,
          returnReason: input.reason,
        })
        .where(eq(determinations.id, determination.id))
        .returning();
      const returned = notFoundIfInvisible(updated);
      await recordDetermination(tx, this.events, returned, {
        kind: 'determination-returned',
        type: DETERMINATION_RETURNED,
        actor: principal.subject,
        summary: 'Determination returned to the proposer',
        at: now,
        approver: principal.subject,
      });
      return determinationView(returned);
    });
  }

  /** The proposer withdraws their proposal while it waits for approval. */
  async withdraw(principal: Principal, determinationId: string): Promise<DeterminationView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const determination = await lockDetermination(tx, tenant, determinationId);
      if (determination.proposer !== principal.subject) {
        throw new ProblemException({
          type: 'not-the-proposer',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: 'Only the officer who proposed a determination can withdraw it.',
        });
      }
      requireProposed(determination.status);
      const [updated] = await tx
        .update(determinations)
        .set({ status: 'withdrawn', withdrawnAt: now })
        .where(eq(determinations.id, determination.id))
        .returning();
      const withdrawn = notFoundIfInvisible(updated);
      await recordDetermination(tx, this.events, withdrawn, {
        kind: 'determination-withdrawn',
        type: DETERMINATION_WITHDRAWN,
        actor: principal.subject,
        summary: 'Determination withdrawn by the proposer',
        at: now,
      });
      return determinationView(withdrawn);
    });
  }

  /**
   * The determination and its case, locked, for a supervisor's decision; the separation-of-duties
   * rule applied to the caller (403).
   */
  private async lockForDecision(
    tx: ReviewTransaction,
    tenant: string,
    principal: Principal,
    determinationId: string,
  ): Promise<{ determination: DeterminationRow; reviewCase: CaseRow }> {
    const determination = await lockDetermination(tx, tenant, determinationId);
    const reviewCase = await findCase(tx, tenant, determination.caseId, { lock: true });
    requireCanApprove(principal, {
      proposer: determination.proposer,
      reviewersOfRecord: await caseReviewersOfRecord(tx, reviewCase.id),
    });
    return { determination, reviewCase };
  }
}

/** A change of a determination, as its timeline entry and event record it. */
export interface DeterminationChange {
  kind: TimelineKind;
  type: string;
  actor: string;
  summary: string;
  at: Date;
  approver?: string;
}

/** The case timeline entry and the `determination.*` event of a change. */
export async function recordDetermination(
  tx: ReviewTransaction,
  events: EventPublisher,
  row: DeterminationRow,
  change: DeterminationChange,
): Promise<void> {
  await tx.insert(reviewTimeline).values({
    id: uuidv7(),
    tenant: row.tenant,
    caseId: row.caseId,
    kind: change.kind,
    ref: row.id,
    actor: change.actor,
    summary: change.summary,
    at: change.at,
  });
  await events.record<DeterminationEventData>(tx, {
    type: change.type,
    subject: row.id,
    tenant: row.tenant,
    data: {
      determinationId: row.id,
      caseId: row.caseId,
      outcome: row.outcome,
      proposerKind: row.proposerKind,
      approver: change.approver ?? row.approver,
      ...(row.status === 'approved' && row.reference !== null ? { reference: row.reference } : {}),
    },
  });
}

/** The determination of the tenant, locked for update; 404 when invisible. */
async function lockDetermination(
  tx: ReviewTransaction,
  tenant: string,
  determinationId: string,
): Promise<DeterminationRow> {
  const [found] = await tx
    .select()
    .from(determinations)
    .where(
      and(eq(determinations.id, visibleId(determinationId)), eq(determinations.tenant, tenant)),
    )
    .for('update');
  return notFoundIfInvisible(found);
}

/** Approving, returning and withdrawing act on a proposal still waiting only. */
function requireProposed(status: ProposalStatus): void {
  if (status === 'proposed') return;
  throw new ProblemException(
    {
      type: 'not-proposed',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: `The determination is ${status}; it no longer waits for approval.`,
    },
    { code: 'not-proposed', determinationStatus: status },
  );
}

/** A further-action determination keeps the case open; any other closes it. */
function caseStatusAfter(outcome: DeterminationOutcome): CaseStatus {
  return outcome === 'further-action' ? 'further-action' : 'determined';
}
