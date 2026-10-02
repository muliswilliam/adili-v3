/** A Commission's statutory periods, reminders and windows (stored as JSON per policy version). */
export interface TenantPolicy {
  /** Initial declaration due this many days after appointment (Act s.34(1)). */
  initialDueAfterAppointmentDays: number;
  /** Biennial declaration: statement date and due date as month-day (Act s.34(2)). */
  biennial: { statementDate: string; dueDate: string };
  /** Final declaration due this many days after leaving office (Act s.34(3)). */
  finalDueAfterExitDays: number;
  /** Reminders sent this many days before a due date; 30 is required (Admin Mechanism 24). */
  reminderOffsetsDays: number[];
  /** Clarification issue window and the declarant's reply window (Act s.35). */
  clarification: { issueWindowMonths: number; replyWindowDays: number };
  /** Form M compliance report due date, month-day (Regs r.25(2)). */
  formMDue: string;
  /** Periods of access to declarations (spec 10). */
  access: AccessPeriods;
}

/** The periods of access to declarations a Commission runs its requests on (spec 10). */
export interface AccessPeriods {
  /** Days to decide a Form K request from its receipt (Act s.36(1), Regs r.22). */
  decisionDays: number;
  /** Days to decide a law enforcement request from its receipt (Act s.36(2), Regs r.23). */
  leaDecisionDays: number;
  /** Days the declarant has for representations once notified (Administrative Mechanisms 28-34). */
  representationWindowDays: number;
  /** Days a granted package stays downloadable by its recipient (ADR-010 §6). */
  packageDownloadDays: number;
}

/**
 * A policy as stored: versions created before the access periods existed carry none, and read as
 * the platform defaults (`withPolicyDefaults`).
 */
export type StoredTenantPolicy = Omit<TenantPolicy, 'access'> & { access?: AccessPeriods };

/** Version 1 of every Commission's policy (spec 01). */
export const PLATFORM_DEFAULT_POLICY: TenantPolicy = {
  initialDueAfterAppointmentDays: 30,
  biennial: { statementDate: '11-01', dueDate: '12-31' },
  finalDueAfterExitDays: 30,
  reminderOffsetsDays: [30, 14, 7],
  clarification: { issueWindowMonths: 6, replyWindowDays: 30 },
  formMDue: '07-31',
  access: {
    decisionDays: 30,
    leaDecisionDays: 14,
    representationWindowDays: 7,
    packageDownloadDays: 14,
  },
};

/** `policy` with the platform default of every field it does not carry. */
export function withPolicyDefaults(policy: StoredTenantPolicy): TenantPolicy {
  return { ...policy, access: policy.access ?? PLATFORM_DEFAULT_POLICY.access };
}
