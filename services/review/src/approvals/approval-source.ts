import type { Assignee } from '../cases/representation.js';
import type { ReviewTransaction } from '../cases/case-lookup.js';
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

/**
 * One kind of approval the inbox unions (spec 08): determinations, the ladder's actions and
 * referrals. Every method runs in the caller's transaction, under the tenant's row-level security.
 */
export abstract class ApprovalSource {
  abstract readonly kind: ApprovalKind;

  /** Pending approvals of the tenant after `after`, in the inbox's order, at most `limit`. */
  abstract pending(
    tx: ReviewTransaction,
    tenant: string,
    after: ApprovalPosition | null,
    limit: number,
  ): Promise<PendingApproval[]>;

  /** The tenant's pending approvals of this kind by age at `now`. */
  abstract ageCounts(tx: ReviewTransaction, tenant: string, now: Date): Promise<AgeCounts>;

  /**
   * One approval of the tenant, locked for update, whether pending or decided; null when there is
   * none.
   */
  abstract find(
    tx: ReviewTransaction,
    tenant: string,
    subjectId: string,
  ): Promise<{ pending: boolean } | null>;
}
