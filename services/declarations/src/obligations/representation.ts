import type { CancelReason, ObligationStatus, ObligationType } from './engine.js';
import type { ReminderChannel, ReminderOutcome } from './schema.js';

/**
 * Response bodies of the obligations API, as in the contract (packages/schemas/internal/
 * declarations.yaml: `MyObligations`, `ObligationDetail`).
 */

export interface CommissionRef {
  slug: string;
  issuerCode: string;
  name: string;
}

export interface Obligation {
  id: string;
  commission: CommissionRef;
  type: ObligationType;
  cycleKey: string;
  statementDate: string;
  dueDate: string;
  status: ObligationStatus;
  cancelReason: CancelReason | null;
  remindersSent: number;
  policyVersion: number;
  createdAt: string;
}

export interface Reminder {
  offsetDays: number;
  scheduledAt: string;
  sentAt: string | null;
  channels: ReminderChannel[];
  outcome: ReminderOutcome;
}

export interface OfficerRef {
  rosterRecordId: string;
  personnelFileNumber: string;
  fullName: string;
  onboarded: boolean;
  ofr: string | null;
}

export interface ObligationDetail extends Obligation {
  reminders: Reminder[];
  /** The officer, for staff callers; null in the declarant's own view. */
  officer: OfficerRef | null;
}

export interface MyObligations {
  groups: { commission: CommissionRef; obligations: Obligation[] }[];
}

export interface ObligationListItem extends Obligation {
  officer: OfficerRef;
}

export interface ObligationPage {
  items: ObligationListItem[];
  nextCursor: string | null;
}

/** Obligations by status; cancelled ones are never counted. */
export interface StatusCounts {
  upcoming: number;
  due: number;
  overdue: number;
  filed: number;
}

/** A biennial cycle with its dates under the Commission's policy. */
export interface SummaryCycle {
  key: string;
  statementDate: string;
  dueDate: string;
}

export interface CommissionSummary {
  commission: CommissionRef;
  cycle: SummaryCycle;
  total: StatusCounts;
  byType: Record<ObligationType, StatusCounts>;
  /** Officers with a due or overdue obligation who have not onboarded, each counted once. */
  notOnboarded: { due: number; overdue: number };
}
