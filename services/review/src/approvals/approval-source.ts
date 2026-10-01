import { and, count, eq, gt, lte, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import type { Assignee } from '../cases/representation.js';
import type { ApprovalKind, ProposerKind } from './schema.js';
import type { ApprovalParties } from './separation-of-duties.js';

/** Something proposed that waits for approval, as the approvals inbox lists it. */
export interface PendingApproval {
  kind: ApprovalKind;
  subjectId: string;
  proposedAt: Date;
  proposerKind: ProposerKind;
  proposer: Assignee | null;
  /** Kind-specific: outcome and reasons excerpt; step and subject; grounds. */
  summary: Record<string, unknown>;
  /** Who the separation-of-duties rule keeps from approving it. */
  parties: ApprovalParties;
}

/** A place in the inbox's order: oldest proposal first, then by subject id. */
export interface ApprovalPosition {
  proposedAt: Date;
  subjectId: string;
}

/** How long the pending approvals of a kind have waited. */
export interface AgeCounts {
  under7Days: number;
  from7To30Days: number;
  over30Days: number;
}

/** A day, in milliseconds: the inbox's age bands are counted in days. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a kind keeps its proposals: the table and the columns every kind has. */
export interface ProposalTable {
  table: PgTable;
  id: PgColumn;
  tenant: PgColumn;
  status: PgColumn;
  proposedAt: PgColumn;
  /** Proposals of the kind the inbox leaves out (the bulk closures); none when absent. */
  excluded?: SQL;
}

/**
 * One kind of approval the inbox unions (spec 08): determinations, the ladder's actions and
 * referrals. A kind says where its proposals are and lists its pending ones; how long they have
 * waited and finding one to reassign are the same for every kind. Every method runs in the
 * caller's transaction, under the tenant's row-level security.
 */
export abstract class ApprovalSource {
  abstract readonly kind: ApprovalKind;

  protected abstract readonly proposals: ProposalTable;

  /** Pending approvals of the tenant after `after`, in the inbox's order, at most `limit`. */
  abstract pending(
    tx: ReviewTransaction,
    tenant: string,
    after: ApprovalPosition | null,
    limit: number,
  ): Promise<PendingApproval[]>;

  /** The tenant's pending approvals of this kind by age at `now`. */
  async ageCounts(tx: ReviewTransaction, tenant: string, now: Date): Promise<AgeCounts> {
    const { table, proposedAt } = this.proposals;
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const [counts] = await tx
      .select({
        total: count(),
        from7To30Days:
          sql<number>`count(*) filter (where ${lte(proposedAt, weekAgo)} and ${gt(proposedAt, monthAgo)})`.mapWith(
            Number,
          ),
        over30Days: sql<number>`count(*) filter (where ${lte(proposedAt, monthAgo)})`.mapWith(
          Number,
        ),
      })
      .from(table)
      .where(this.waiting(tenant));
    if (!counts) return { under7Days: 0, from7To30Days: 0, over30Days: 0 };
    return {
      under7Days: counts.total - counts.from7To30Days - counts.over30Days,
      from7To30Days: counts.from7To30Days,
      over30Days: counts.over30Days,
    };
  }

  /**
   * One approval of the tenant, locked for update, whether pending or decided; null when there is
   * none.
   */
  async find(
    tx: ReviewTransaction,
    tenant: string,
    subjectId: string,
  ): Promise<{ pending: boolean } | null> {
    const { table, id, tenant: tenantColumn, status } = this.proposals;
    const [found] = await tx
      .select({ status })
      .from(table)
      .where(and(eq(id, subjectId), eq(tenantColumn, tenant)))
      .for('update');
    return found ? { pending: found.status === 'proposed' } : null;
  }

  /** The tenant's proposals of this kind waiting for approval, as the inbox counts them. */
  protected waiting(tenant: string): SQL | undefined {
    const { tenant: tenantColumn, status, excluded } = this.proposals;
    return and(eq(tenantColumn, tenant), eq(status, 'proposed'), excluded);
  }

  /** The inbox's keyset: proposals after `after` in its order (oldest first, then by id). */
  protected after(after: ApprovalPosition | null): SQL | undefined {
    if (after === null) return undefined;
    const { id, proposedAt } = this.proposals;
    return or(
      gt(proposedAt, after.proposedAt),
      and(eq(proposedAt, after.proposedAt), gt(id, after.subjectId)),
    );
  }
}
