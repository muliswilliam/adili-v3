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
}

/** Version 1 of every Commission's policy (spec 01). */
export const PLATFORM_DEFAULT_POLICY: TenantPolicy = {
  initialDueAfterAppointmentDays: 30,
  biennial: { statementDate: '11-01', dueDate: '12-31' },
  finalDueAfterExitDays: 30,
  reminderOffsetsDays: [30, 14, 7],
  clarification: { issueWindowMonths: 6, replyWindowDays: 30 },
  formMDue: '07-31',
};
