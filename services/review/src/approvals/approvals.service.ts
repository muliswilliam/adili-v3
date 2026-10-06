import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { desc, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { caseTenant, queueTenant, requireSupervisor } from '../cases/access.js';
import { knownName } from '../cases/assignment.service.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { type Assignee, assigneeSchema } from '../cases/assignee.js';
import { Clock } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeterminationApprovals } from '../determinations/determination-approvals.js';
import { proposerKindSchema } from '../determinations/representation.js';
import { ActionApprovals } from '../enforcement/action-approvals.js';
import { decodeCursor, encodeCursor, type Position } from '../paging.js';
import { ReferralApprovals } from '../referrals/referral-approvals.js';
import type { ApprovalPosition, ApprovalSource, PendingApproval } from './approval-source.js';
import { notProposed } from './decisions.js';
import { APPROVAL_REASSIGNED, type ApprovalReassignedData } from './events.js';
import { APPROVAL_KINDS, type ApprovalKind, approvalReassignments } from './schema.js';
import { type CannotApproveReason, cannotApprove } from './separation-of-duties.js';

/** Query of `GET /v1/commissions/{slug}/approvals` (review.yaml `listApprovals`). */
export const approvalsQuery = z.object({
  kind: z.enum(APPROVAL_KINDS).optional(),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ApprovalsQuery = z.infer<typeof approvalsQuery>;

/** review.yaml `reassignApproval` body. */
export const reassignApprovalInput = z.object({
  toSupervisor: z.string().trim().min(1).max(200),
});
export type ReassignApprovalInput = z.infer<typeof reassignApprovalInput>;

/** review.yaml `ApprovalKind`. */
export const approvalKindSchema = z.enum(APPROVAL_KINDS);

/** review.yaml `ApprovalItem`. */
export const approvalItemSchema = z.object({
  kind: approvalKindSchema,
  subjectId: z.uuid(),
  proposedAt: z.iso.datetime(),
  proposerKind: proposerKindSchema,
  proposer: assigneeSchema.nullable(),
  summary: z.record(z.string(), z.unknown()).meta({
    description: 'Kind-specific summary (outcome and reasons excerpt; step and subject; grounds)',
  }),
  canApprove: z.boolean(),
  cannotApproveReason: z
    .enum(['proposer', 'reviewer-of-record', 'role'])
    .nullable() satisfies z.ZodType<CannotApproveReason | null>,
  reassignedTo: assigneeSchema.nullable(),
});
export type ApprovalItemView = z.infer<typeof approvalItemSchema>;

export interface ApprovalPage {
  items: ApprovalItemView[];
  nextCursor: string | null;
  /** Pending approvals by kind, by age band, and by kind and age band, whatever the page's filter. */
  counts: Record<string, number>;
}

/** review.yaml `ApprovalReassignment`: the `reassignApproval` response. */
export const approvalReassignmentSchema = z.object({
  kind: approvalKindSchema,
  subjectId: z.uuid(),
  reassignedTo: assigneeSchema,
});
export type ReassignedApproval = z.infer<typeof approvalReassignmentSchema>;

/** The age bands of the inbox's counts. */
const AGE_BANDS = ['under-7-days', '7-to-30-days', 'over-30-days'] as const;
type AgeBand = (typeof AGE_BANDS)[number];

/** The counts key of one kind's approvals in one age band, e.g. `determination:under-7-days`. */
const kindAgeKey = (kind: string, band: AgeBand) => `${kind}:${band}`;

/**
 * The supervisors' approvals inbox (spec 08): the union of every kind's pending approvals of the
 * Commission, oldest first, each with `canApprove` for the caller by the separation-of-duties
 * rule; and reassigning an approval to another supervisor, which is informational (the rule
 * still decides who may approve).
 */
@Injectable()
export class ApprovalsService {
  private readonly sources: readonly ApprovalSource[];

  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    determinations: DeterminationApprovals,
    actions: ActionApprovals,
    referralApprovals: ReferralApprovals,
  ) {
    this.sources = [determinations, actions, referralApprovals];
  }

  async list(principal: Principal, slug: string, query: ApprovalsQuery): Promise<ApprovalPage> {
    const tenant = queueTenant(principal, slug);
    requireSupervisor(principal);
    const after = query.cursor === undefined ? null : approvalPosition(decodeCursor(query.cursor));
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      // Each kind's next page in the same order; merged, the first `limit` are this page.
      const candidates: PendingApproval[] = [];
      for (const source of this.sources) {
        if (query.kind !== undefined && source.kind !== query.kind) continue;
        candidates.push(...(await source.pending(tx, tenant, after, query.limit + 1)));
      }
      candidates.sort(inboxOrder);
      const page = candidates.slice(0, query.limit);
      const last = page.at(-1);
      const reassigned = await latestReassignments(tx, page);
      return {
        items: page.map((approval): ApprovalItemView => {
          const reason = cannotApprove(principal, approval.parties);
          return {
            kind: approval.kind,
            subjectId: approval.subjectId,
            proposedAt: approval.proposedAt.toISOString(),
            proposerKind: approval.proposerKind,
            proposer: approval.proposer,
            summary: approval.summary,
            canApprove: reason === null,
            cannotApproveReason: reason,
            reassignedTo: reassigned.get(approval.subjectId) ?? null,
          };
        }),
        nextCursor:
          candidates.length > query.limit && last
            ? encodeCursor({ at: last.proposedAt, id: last.subjectId })
            : null,
        counts: await this.counts(tx, tenant, now),
      };
    });
  }

  /**
   * Points a pending approval at another supervisor of the Commission, with
   * `approval.reassigned.v1`. Supervisors only; one already decided is a 409.
   */
  async reassign(
    principal: Principal,
    kind: ApprovalKind,
    subjectId: string,
    input: ReassignApprovalInput,
  ): Promise<ReassignedApproval> {
    const tenant = caseTenant(principal);
    requireSupervisor(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const source = this.sources.find((candidate) => candidate.kind === kind);
      const found = notFoundIfInvisible(source ? await source.find(tx, tenant, subjectId) : null);
      if (!found.pending) throw notProposed();
      const name = await knownName(tx, tenant, input.toSupervisor);
      await tx.insert(approvalReassignments).values({
        id: uuidv7(),
        tenant,
        subjectKind: kind,
        subjectId,
        toSupervisor: input.toSupervisor,
        toSupervisorName: name,
        by: principal.subject,
        at: this.clock.now(),
      });
      await this.events.record<ApprovalReassignedData>(tx, {
        type: APPROVAL_REASSIGNED,
        subject: subjectId,
        tenant,
        data: { kind, subjectId, toSupervisor: input.toSupervisor, by: principal.subject },
      });
      return {
        kind,
        subjectId,
        reassignedTo: { subject: input.toSupervisor, name: name ?? input.toSupervisor },
      };
    });
  }

  /**
   * Pending approvals by kind (every kind, 0 when none), by age band across kinds
   * (`under-7-days`), and by age band within each kind (`determination:under-7-days`), so a tab
   * can say how long its own approvals have waited (#712).
   */
  private async counts(
    tx: ReviewTransaction,
    tenant: string,
    now: Date,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = Object.fromEntries(
      [
        ...APPROVAL_KINDS,
        ...AGE_BANDS,
        ...APPROVAL_KINDS.flatMap((kind) => AGE_BANDS.map((band) => kindAgeKey(kind, band))),
      ].map((key) => [key, 0]),
    );
    for (const source of this.sources) {
      const ages = await source.ageCounts(tx, tenant, now);
      const byBand: Record<AgeBand, number> = {
        'under-7-days': ages.under7Days,
        '7-to-30-days': ages.from7To30Days,
        'over-30-days': ages.over30Days,
      };
      counts[source.kind] = ages.under7Days + ages.from7To30Days + ages.over30Days;
      for (const band of AGE_BANDS) {
        counts[band] = (counts[band] ?? 0) + byBand[band];
        counts[kindAgeKey(source.kind, band)] = byBand[band];
      }
    }
    return counts;
  }
}

/** Oldest proposal first, then by subject id (as Postgres orders UUIDs). */
function inboxOrder(a: PendingApproval, b: PendingApproval): number {
  const byAge = a.proposedAt.getTime() - b.proposedAt.getTime();
  if (byAge !== 0) return byAge;
  return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
}

/** The supervisor each listed approval was last reassigned to. */
async function latestReassignments(
  tx: ReviewTransaction,
  approvals: readonly PendingApproval[],
): Promise<Map<string, Assignee>> {
  const latest = new Map<string, Assignee>();
  if (approvals.length === 0) return latest;
  const kinds = new Map(approvals.map((approval) => [approval.subjectId, approval.kind]));
  const rows = await tx
    .select()
    .from(approvalReassignments)
    .where(inArray(approvalReassignments.subjectId, [...kinds.keys()]))
    .orderBy(desc(approvalReassignments.at), desc(approvalReassignments.id));
  for (const row of rows) {
    if (kinds.get(row.subjectId) !== row.subjectKind || latest.has(row.subjectId)) continue;
    latest.set(row.subjectId, {
      subject: row.toSupervisor,
      name: row.toSupervisorName ?? row.toSupervisor,
    });
  }
  return latest;
}

/** The inbox's place a cursor names. */
function approvalPosition({ at, id }: Position): ApprovalPosition {
  return { proposedAt: at, subjectId: id };
}
