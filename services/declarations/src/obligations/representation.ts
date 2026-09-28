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
