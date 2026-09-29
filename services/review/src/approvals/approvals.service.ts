import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { desc, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { caseTenant, isSupervisor, queueTenant } from '../cases/access.js';
import { knownName } from '../cases/assignment.service.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import type { Assignee } from '../cases/representation.js';
import { Clock } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeterminationApprovals } from '../determinations/determination-approvals.js';
import { ActionApprovals } from '../enforcement/action-approvals.js';
import type { ApprovalPosition, ApprovalSource, PendingApproval } from './approval-source.js';
import { APPROVAL_REASSIGNED, type ApprovalReassignedData } from './events.js';
import {
  APPROVAL_KINDS,
  type ApprovalKind,
  approvalReassignments,
  type ProposerKind,
} from './schema.js';
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

/** review.yaml `ApprovalItem`. */
export interface ApprovalItemView {
  kind: ApprovalKind;
  subjectId: string;
  proposedAt: string;
  proposerKind: ProposerKind;
  proposer: Assignee | null;
  summary: Record<string, unknown>;
  canApprove: boolean;
  cannotApproveReason: CannotApproveReason | null;
  reassignedTo: Assignee | null;
}

export interface ApprovalPage {
  items: ApprovalItemView[];
  nextCursor: string | null;
  /** Pending approvals by kind and by age band, whatever the page's filter. */
  counts: Record<string, number>;
}

/** review.yaml `reassignApproval` response. */
export interface ReassignedApproval {
  kind: ApprovalKind;
  subjectId: string;
  reassignedTo: Assignee;
}

/** The age bands of the inbox's counts. */
const AGE_BANDS = ['under-7-days', '7-to-30-days', 'over-30-days'] as const;

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
  ) {
    // Referrals add their source here.
    this.sources = [determinations, actions];
  }

  async list(principal: Principal, slug: string, query: ApprovalsQuery): Promise<ApprovalPage> {
    const tenant = queueTenant(principal, slug);
    requireSupervisor(principal);
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
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
            ? encodeCursor({ proposedAt: last.proposedAt, subjectId: last.subjectId })
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
      if (!found.pending) {
        throw new ProblemException(
          {
            type: 'not-proposed',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: 'This has been decided; it no longer waits for approval.',
          },
          { code: 'not-proposed' },
        );
      }
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

  /** Pending approvals by kind (every kind, 0 when none) and by age band. */
  private async counts(
    tx: ReviewTransaction,
    tenant: string,
    now: Date,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = Object.fromEntries(
      [...APPROVAL_KINDS, ...AGE_BANDS].map((key) => [key, 0]),
    );
    for (const source of this.sources) {
      const ages = await source.ageCounts(tx, tenant, now);
      counts[source.kind] = ages.under7Days + ages.from7To30Days + ages.over30Days;
      counts['under-7-days'] = (counts['under-7-days'] ?? 0) + ages.under7Days;
      counts['7-to-30-days'] = (counts['7-to-30-days'] ?? 0) + ages.from7To30Days;
      counts['over-30-days'] = (counts['over-30-days'] ?? 0) + ages.over30Days;
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

/**
 * Approvals (the inbox, bulk closures) are the supervisors': a reviewer gets 403
 * `supervisor-required`.
 */
export function requireSupervisor(principal: Principal): void {
  if (isSupervisor(principal)) return;
  throw new ProblemException(
    {
      type: 'supervisor-required',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: 'Approvals are for supervisors.',
    },
    { code: 'supervisor-required' },
  );
}

const cursorPayload = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** Opaque to clients: base64url of `[proposedAt, subjectId]`. */
function encodeCursor(position: ApprovalPosition): string {
  return Buffer.from(
    JSON.stringify([position.proposedAt.toISOString(), position.subjectId]),
  ).toString('base64url');
}

/** The position a cursor names; 400 for one this inbox did not issue. */
function decodeCursor(value: string): ApprovalPosition {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (parsed.success) {
      return { proposedAt: new Date(parsed.data[0]), subjectId: parsed.data[1] };
    }
  } catch {
    // Not JSON: not a cursor this inbox issued.
  }
  throw new ProblemException({
    type: 'about:blank',
    title: 'Bad Request',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The cursor is not one this inbox issued.',
  });
}
