import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ADM, allocateReference } from '@adili/numbering';
import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { lockForDecision, requireProposed } from '../approvals/decisions.js';
import { caseReviewersOfRecord } from '../approvals/separation-of-duties.js';
import { caseTenant, queueTenant, requireSupervisor } from '../cases/access.js';
import { type ReviewTransaction, visibleId } from '../cases/case-lookup.js';
import { Clock, nairobiYear } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import type { ReasonInput } from '../determinations/determination-input.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import { decodeCursor, encodeCursor } from '../paging.js';
import { LADDER_STEPS, type LadderStep } from './contract.js';
import { EnforcementWorkflows } from './enforcement-workflows.js';
import {
  ACTION_APPROVED,
  ACTION_DECLINED,
  LADDER_RESTARTED,
  type LadderRestartedData,
} from './events.js';
import {
  type ActionRow,
  approverRoleOf,
  type LadderRow,
  recordAction,
  recordHistory,
} from './ladder-records.js';
import { actionView, type ActionView, ladderView, type LadderView } from './representation.js';
import {
  ACTION_STATUSES,
  ACTION_STEPS,
  administrativeActions,
  enforcementLadders,
} from './schema.js';

/** Query of `GET /v1/commissions/{slug}/actions` (review.yaml `listEnforcementLadders`). */
export const laddersQuery = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  step: z.enum(ACTION_STEPS).optional(),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LaddersQuery = z.infer<typeof laddersQuery>;

export interface LadderPage {
  items: LadderView[];
  nextCursor: string | null;
}

/**
 * The enforcement ladder for the Commission's review staff (spec 08): the ladders and their
 * steps; approving or declining a drafted step (a notice or warning by a reviewer or supervisor
 * who is not a reviewer of record, later steps by a supervisor), and restarting a declined ladder
 * (supervisor). Approval allocates the `ADM` reference in the transaction of the legal act; the
 * workflow then issues the letter and tells the declarant.
 */
@Injectable()
export class EnforcementService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: EnforcementWorkflows,
    private readonly clock: Clock,
  ) {}

  async list(principal: Principal, slug: string, query: LaddersQuery): Promise<LadderPage> {
    const tenant = queueTenant(principal, slug);
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const conditions: (SQL | undefined)[] = [
        eq(enforcementLadders.tenant, tenant),
        query.status === undefined ? undefined : eq(administrativeActions.status, query.status),
        query.step === undefined ? undefined : eq(administrativeActions.step, query.step),
        after === null
          ? undefined
          : or(
              lt(enforcementLadders.startedAt, after.at),
              and(eq(enforcementLadders.startedAt, after.at), lt(enforcementLadders.id, after.id)),
            ),
      ];
      const rows = await tx
        .select({ ladder: enforcementLadders })
        .from(enforcementLadders)
        .leftJoin(
          administrativeActions,
          eq(administrativeActions.id, enforcementLadders.currentActionId),
        )
        .where(and(...conditions))
        .orderBy(desc(enforcementLadders.startedAt), desc(enforcementLadders.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit).map(({ ladder }) => ladder);
      const actions = await actionsOf(
        tx,
        page.map((ladder) => ladder.id),
      );
      const last = page.at(-1);
      return {
        items: page.map((ladder) =>
          ladderView(
            ladder,
            actions.filter((action) => action.ladderId === ladder.id),
          ),
        ),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ at: last.startedAt, id: last.id })
            : null,
      };
    });
  }

  async get(principal: Principal, ladderId: string): Promise<LadderView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const ladder = await findLadder(tx, tenant, ladderId);
      return ladderView(ladder, await actionsOf(tx, [ladder.id]));
    });
  }

  /**
   * An officer the separation-of-duties rule admits approves a drafted step: the rule first (403),
   * then the status (409). The `ADM` number is of the Commission and the year of approval; the
   * directory is read for the issuer code before anything changes, so an outage is a 503. The
   * workflow is told last, inside the transaction, so a decision it cannot hear is not made.
   */
  async approve(principal: Principal, actionId: string): Promise<ActionView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { action, ladder } = await lockStepForDecision(tx, tenant, principal, actionId);
      requireProposed('step', action.status);
      const commission = await withUpstream(() => this.directory.getCommission(tenant));
      const reference = await allocateReference(tx, ADM, {
        issuer: commission.issuerCode,
        period: nairobiYear(now),
      });
      const [updated] = await tx
        .update(administrativeActions)
        .set({
          status: 'approved',
          approver: principal.subject,
          approverName: principal.name,
          approvedAt: now,
          reference,
        })
        .where(eq(administrativeActions.id, action.id))
        .returning();
      const approved = notFoundIfInvisible(updated);
      await recordAction(tx, this.events, approved, {
        kind: 'action-approved',
        type: ACTION_APPROVED,
        actor: principal.subject,
        at: now,
      });
      await this.workflows.decided(ladder);
      return actionView(approved);
    });
  }

  /**
   * An officer the rule admits declines a drafted step with a note: the ladder ends, declined;
   * except a declined disciplinary referral, after which the ladder waits for compliance (a
   * stopped salary stays stopped until then).
   */
  async decline(principal: Principal, actionId: string, input: ReasonInput): Promise<ActionView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { action, ladder } = await lockStepForDecision(tx, tenant, principal, actionId);
      requireProposed('step', action.status);
      const [updated] = await tx
        .update(administrativeActions)
        .set({
          status: 'declined',
          declinedBy: principal.subject,
          declinedByName: principal.name,
          declinedAt: now,
          declineNote: input.reason,
        })
        .where(eq(administrativeActions.id, action.id))
        .returning();
      const declined = notFoundIfInvisible(updated);
      if (declined.step !== 'disciplinary-referral') {
        await tx
          .update(enforcementLadders)
          .set({ status: 'declined', endedAt: now })
          .where(eq(enforcementLadders.id, ladder.id));
      }
      await recordAction(tx, this.events, declined, {
        kind: 'action-declined',
        type: ACTION_DECLINED,
        actor: principal.subject,
        at: now,
      });
      await this.workflows.decided(ladder);
      return actionView(declined);
    });
  }

  /**
   * A supervisor restarts a declined ladder: a new run of the workflow drafts the declined step
   * again (the steps issued before it stand). Anything but a declined ladder is a 409.
   */
  async restart(principal: Principal, ladderId: string): Promise<LadderView> {
    const tenant = caseTenant(principal);
    requireSupervisor(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const ladder = await findLadder(tx, tenant, ladderId, { lock: true });
      if (ladder.status !== 'declined') {
        throw new ProblemException(
          {
            type: 'ladder-not-declined',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: `The ladder is ${ladder.status}; only a declined ladder can be restarted.`,
          },
          { code: 'ladder-not-declined', ladderStatus: ladder.status },
        );
      }
      const [declined] = await tx
        .select()
        .from(administrativeActions)
        .where(
          and(
            eq(administrativeActions.ladderId, ladder.id),
            eq(administrativeActions.status, 'declined'),
          ),
        )
        .orderBy(desc(administrativeActions.declinedAt))
        .limit(1);
      const step = restartStep(declined);
      const run = ladder.run + 1;
      const [updated] = await tx
        .update(enforcementLadders)
        .set({ status: 'active', run, endedAt: null, closingCause: null })
        .where(eq(enforcementLadders.id, ladder.id))
        .returning();
      await recordHistory(tx, tenant, ladder.id, 'ladder-restarted', principal.subject, now);
      await this.events.record<LadderRestartedData>(tx, {
        type: LADDER_RESTARTED,
        subject: ladder.id,
        tenant,
        data: {
          ladderId: ladder.id,
          subjectKind: ladder.subjectKind,
          subjectId: ladder.subjectId,
          step,
          run,
          by: principal.subject,
        },
      });
      // Last, inside the transaction: if Temporal cannot be reached nothing is restarted. The
      // ladder stays locked across the start (the exception in ADR-003 decision 7): the start
      // replaces the declined run if it is still open, and the lock guarantees that run is not
      // another restart's.
      await this.workflows.restart({
        tenant,
        subjectKind: ladder.subjectKind,
        subjectId: ladder.subjectId,
        restartAt: step,
      });
      return ladderView(notFoundIfInvisible(updated), await actionsOf(tx, [ladder.id]));
    });
  }
}

/**
 * The action and its ladder, locked, for an officer's decision; the separation-of-duties rule
 * applied to the caller (403): the proposer (none for the system's drafts) and, for a
 * clarification's ladder, everyone who held its case may not decide it.
 */
function lockStepForDecision(
  tx: ReviewTransaction,
  tenant: string,
  principal: Principal,
  actionId: string,
): Promise<{ action: ActionRow; ladder: LadderRow }> {
  return lockForDecision(
    principal,
    async () => {
      const [action] = await tx
        .select()
        .from(administrativeActions)
        .where(
          and(
            eq(administrativeActions.id, visibleId(actionId)),
            eq(administrativeActions.tenant, tenant),
          ),
        )
        .for('update');
      if (!action) return undefined;
      return { action, ladder: await findLadder(tx, tenant, action.ladderId, { lock: true }) };
    },
    async ({ action, ladder }) => ({
      proposer: action.proposer,
      reviewersOfRecord:
        ladder.caseId === null ? new Set<string>() : await caseReviewersOfRecord(tx, ladder.caseId),
      approverRole: approverRoleOf(action.step),
    }),
  );
}

/** The ladder of the tenant, locked for update when `lock` is set; 404 when invisible. */
async function findLadder(
  tx: ReviewTransaction,
  tenant: string,
  ladderId: string,
  { lock = false } = {},
): Promise<LadderRow> {
  const query = tx
    .select()
    .from(enforcementLadders)
    .where(
      and(eq(enforcementLadders.id, visibleId(ladderId)), eq(enforcementLadders.tenant, tenant)),
    );
  const [found] = lock ? await query.for('update') : await query;
  return notFoundIfInvisible(found);
}

/** Every action of the ladders. */
export async function actionsOf(
  tx: ReviewTransaction,
  ladderIds: readonly string[],
): Promise<ActionRow[]> {
  if (ladderIds.length === 0) return [];
  return tx
    .select()
    .from(administrativeActions)
    .where(inArray(administrativeActions.ladderId, [...ladderIds]));
}

/** The step a restart drafts again: the declined one (the notice when none is found). */
function restartStep(declined: ActionRow | undefined): LadderStep {
  return declined?.step ?? LADDER_STEPS[0];
}
