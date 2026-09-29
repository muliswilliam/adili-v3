import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, count, desc, eq, isNotNull, max, not, type SQL, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';

import { queueTenant, requireSupervisor } from '../cases/access.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { DECLARATION_TYPES, reviewAssignments, reviewCases } from '../cases/schema.js';
import { Clock } from '../clock.js';
import { config } from '../config.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { approveDetermination } from '../determinations/determinations.service.js';
import { determinations } from '../determinations/schema.js';
import { withUpstream } from '../internal-api/upstream.js';
import { ClosureWorkflows } from './closure-workflows.js';
import { bulkApprovals, closureSweeps } from './schema.js';

/** Query of `getBulkClosureSummary` and `approveBulkClosures` (review.yaml). */
export const closureFilter = z.object({
  cycleYear: z.coerce.number().int().min(2000).max(2100),
  type: z.enum(DECLARATION_TYPES).optional(),
  reportingEntityId: z.uuid().optional(),
});
export type ClosureFilter = z.infer<typeof closureFilter>;

/** review.yaml `ClosureSummary`. */
export interface ClosureSummaryView {
  cycleYear: number;
  eligibleProposed: number;
  sampled: number;
  approved: number;
  sampleRate: number;
  windowClosedAt: string | null;
  lastSweptAt: string | null;
}

/** review.yaml `BulkApprovalResult`. */
export interface BulkApprovalResultView {
  approved: number;
  skipped: number;
  firstReference: string | null;
  lastReference: string | null;
  chunks: number;
}

/** Closures approved per transaction: each allocates its `CMP` numbers in order. */
export const APPROVAL_CHUNK = 100;

/** Namespace of bulk approval ids: one per Commission, approver and idempotency key. */
const BULK_APPROVAL_NAMESPACE = '5d0c7b8e-3f21-4a9d-9c6e-8b1f2a7d4e30';

/**
 * Bulk closure for the Commission's supervisors (spec 08): the counts of the system's
 * `compliant-no-issues` proposals, sampled cases and approved closures for a cycle and filters,
 * and the approval of every waiting proposal that matches, in chunks of 100 per transaction. Each
 * chunk allocates its `CMP` numbers in sequence (gapless: a chunk that rolls back returns its
 * numbers), moves its cases to `determined` through the status transitions, records timeline and
 * events, and starts the notices of its declarants. No letter is rendered: it is issued the first
 * time someone asks for it. Reviewers get 403; anyone outside the Commission's review staff 404.
 */
@Injectable()
export class BulkClosuresService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ClosureWorkflows,
    private readonly clock: Clock,
  ) {}

  async summary(
    principal: Principal,
    slug: string,
    filter: ClosureFilter,
  ): Promise<ClosureSummaryView> {
    const tenant = supervisorTenant(principal, slug);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const cases = casesMatching(tenant, filter);
      const [proposals] = await tx
        .select({
          eligibleProposed:
            sql<number>`count(*) filter (where ${determinations.status} = 'proposed')`.mapWith(
              Number,
            ),
          approved:
            sql<number>`count(*) filter (where ${determinations.status} = 'approved')`.mapWith(
              Number,
            ),
        })
        .from(determinations)
        .innerJoin(reviewCases, eq(reviewCases.id, determinations.caseId))
        .where(and(bulkClosure(tenant), cases));
      const [queue] = await tx
        .select({
          sampled: count(reviewCases.sampledAt),
          windowClosedAt: max(reviewCases.windowEndsAt),
        })
        .from(reviewCases)
        .where(and(cases, eq(reviewCases.band, 'low')));
      const [lastSweep] = await tx
        .select({ ranAt: closureSweeps.ranAt })
        .from(closureSweeps)
        .where(and(eq(closureSweeps.tenant, tenant), eq(closureSweeps.cycleYear, filter.cycleYear)))
        .orderBy(desc(closureSweeps.ranAt))
        .limit(1);
      return {
        cycleYear: filter.cycleYear,
        eligibleProposed: proposals?.eligibleProposed ?? 0,
        sampled: queue?.sampled ?? 0,
        approved: proposals?.approved ?? 0,
        sampleRate: config.CLOSURE_SAMPLE_RATE,
        windowClosedAt: queue?.windowClosedAt?.toISOString() ?? null,
        lastSweptAt: lastSweep?.ranAt.toISOString() ?? null,
      };
    });
  }

  /**
   * Approves every waiting system closure matching the filter, a chunk at a time, in the caller's
   * name. Closures of cases the caller once held are skipped (separation of duties) and counted.
   * The approval is one per caller and idempotency key: sent again after a failure part way, it
   * resumes, and its result counts every chunk approved under it. Two supervisors approving at once
   * share the work: a chunk skips proposals another holds.
   */
  async approve(
    principal: Principal,
    slug: string,
    filter: ClosureFilter,
    idempotencyKey: string,
  ): Promise<BulkApprovalResultView> {
    const tenant = supervisorTenant(principal, slug);
    // Before anything changes, so an outage is a 503 and nothing is approved.
    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    const bulkApprovalId = uuidv5(
      `${tenant}:${principal.subject}:${idempotencyKey}`,
      BULK_APPROVAL_NAMESPACE,
    );
    await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      tx
        .insert(bulkApprovals)
        .values({
          id: bulkApprovalId,
          tenant,
          approver: principal.subject,
          cycleYear: filter.cycleYear,
          type: filter.type ?? null,
          startedAt: this.clock.now(),
        })
        .onConflictDoNothing(),
    );
    let more = true;
    while (more) {
      more = await this.approveChunk(
        principal,
        tenant,
        filter,
        bulkApprovalId,
        commission.issuerCode,
      );
    }
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      await tx
        .update(bulkApprovals)
        .set({ completedAt: this.clock.now() })
        .where(eq(bulkApprovals.id, bulkApprovalId));
      return this.result(tx, principal, tenant, filter, bulkApprovalId);
    });
  }

  /** One chunk, in one transaction; false when nothing was left to approve. */
  private async approveChunk(
    principal: Principal,
    tenant: string,
    filter: ClosureFilter,
    bulkApprovalId: string,
    issuer: string,
  ): Promise<boolean> {
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const chunk = await tx
        .select({ determination: determinations, caseStatus: reviewCases.status })
        .from(determinations)
        .innerJoin(reviewCases, eq(reviewCases.id, determinations.caseId))
        .where(
          and(
            bulkClosure(tenant),
            eq(determinations.status, 'proposed'),
            casesMatching(tenant, filter),
            not(heldBy(principal.subject)),
          ),
        )
        .orderBy(asc(determinations.proposedAt), asc(determinations.id))
        .limit(APPROVAL_CHUNK)
        .for('update', { of: [determinations, reviewCases], skipLocked: true });
      if (chunk.length === 0) return false;
      for (const { determination, caseStatus } of chunk) {
        await approveDetermination(tx, this.events, {
          determination,
          caseStatus,
          approver: principal,
          issuer,
          at: now,
          bulkApprovalId,
        });
      }
      await tx
        .update(bulkApprovals)
        .set({ chunks: sql`${bulkApprovals.chunks} + 1` })
        .where(eq(bulkApprovals.id, bulkApprovalId));
      // Last, inside the transaction: if Temporal cannot be reached the chunk is not approved.
      await this.workflows.startNotices({
        tenant,
        determinationIds: chunk.map(({ determination }) => determination.id),
      });
      return true;
    });
  }

  /** What a bulk approval did over all its attempts, and what it left for another supervisor. */
  private async result(
    tx: ReviewTransaction,
    principal: Principal,
    tenant: string,
    filter: ClosureFilter,
    bulkApprovalId: string,
  ): Promise<BulkApprovalResultView> {
    const approvedBy = eq(determinations.bulkApprovalId, bulkApprovalId);
    const [totals] = await tx.select({ approved: count() }).from(determinations).where(approvedBy);
    const [first] = await tx
      .select({ reference: determinations.reference })
      .from(determinations)
      .where(and(approvedBy, isNotNull(determinations.reference)))
      .orderBy(asc(determinations.approvedAt), asc(determinations.reference))
      .limit(1);
    const [last] = await tx
      .select({ reference: determinations.reference })
      .from(determinations)
      .where(and(approvedBy, isNotNull(determinations.reference)))
      .orderBy(desc(determinations.approvedAt), desc(determinations.reference))
      .limit(1);
    const [skipped] = await tx
      .select({ count: count() })
      .from(determinations)
      .innerJoin(reviewCases, eq(reviewCases.id, determinations.caseId))
      .where(
        and(
          bulkClosure(tenant),
          eq(determinations.status, 'proposed'),
          casesMatching(tenant, filter),
          heldBy(principal.subject),
        ),
      );
    const [approval] = await tx
      .select({ chunks: bulkApprovals.chunks })
      .from(bulkApprovals)
      .where(eq(bulkApprovals.id, bulkApprovalId));
    return {
      approved: totals?.approved ?? 0,
      skipped: skipped?.count ?? 0,
      firstReference: first?.reference ?? null,
      lastReference: last?.reference ?? null,
      chunks: approval?.chunks ?? 0,
    };
  }
}

/**
 * The tenant of a supervisor's bulk closure request for Commission `slug`: 404 for anyone outside
 * its review staff, 403 `supervisor-required` for its reviewers.
 */
function supervisorTenant(principal: Principal, slug: string): string {
  const tenant = queueTenant(principal, slug);
  requireSupervisor(principal);
  return tenant;
}

/** The system's `compliant-no-issues` proposals of the Commission: bulk closures. */
function bulkClosure(tenant: string): SQL | undefined {
  return and(
    eq(determinations.tenant, tenant),
    eq(determinations.proposerKind, 'system'),
    eq(determinations.outcome, 'compliant-no-issues'),
  );
}

/** The Commission's cases of the filter's cycle, type and reporting entity. */
function casesMatching(tenant: string, filter: ClosureFilter): SQL | undefined {
  return and(
    eq(reviewCases.tenant, tenant),
    eq(reviewCases.cycleYear, filter.cycleYear),
    filter.type === undefined ? undefined : eq(reviewCases.type, filter.type),
    filter.reportingEntityId === undefined
      ? undefined
      : eq(reviewCases.reportingEntityId, filter.reportingEntityId),
  );
}

/** Cases `subject` holds or once held: the separation of duties keeps them from approving. */
function heldBy(subject: string): SQL {
  return sql`(${reviewCases.assignee} is not distinct from ${subject} or exists (select 1 from ${reviewAssignments} where ${reviewAssignments.caseId} = ${reviewCases.id} and ${reviewAssignments.subject} = ${subject}))`;
}
