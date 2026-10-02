import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { PROPOSER_KINDS } from '../approvals/schema.js';
import { inList } from '../db/sql-list.js';

/**
 * The enforcement ladder (spec 08, refines ADR-003): one ladder per overdue filing obligation or
 * unanswered clarification, run by `EnforcementWorkflow`, and its administrative actions (notice to
 * comply, warning, salary stoppage, disciplinary referral). Tenant data under the same
 * row-level security as every review table; a declarant reads their own issued actions through
 * `app.person`.
 */

/** review.yaml `Ladder.subjectKind`: what the declarant failed to do. */
export const SUBJECT_KINDS = ['obligation', 'clarification'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** review.yaml `Ladder.status`. */
export const LADDER_STATUSES = ['active', 'complied', 'declined', 'ended'] as const;
export type LadderStatus = (typeof LADDER_STATUSES)[number];

/** review.yaml `ActionStep`, in ladder order. */
export const ACTION_STEPS = [
  'notice-to-comply',
  'warning',
  'salary-stoppage',
  'disciplinary-referral',
] as const;
export type ActionStep = (typeof ACTION_STEPS)[number];

/** review.yaml `ActionStatus`. */
export const ACTION_STATUSES = [
  'proposed',
  'approved',
  'approved-pending-payroll',
  'declined',
  'issued',
  'responded',
  'complied',
  'reinstated',
  'cancelled',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Actions whose letter has gone to the declarant: what the declarant sees and may answer. */
export const ISSUED_ACTION_STATUSES = ['issued', 'responded', 'complied', 'reinstated'] as const;

/**
 * What ended a ladder from outside: the declarant complied (`filed`, `clarification-responded`,
 * `clarification-resolved`), or the subject went away (`obligation-cancelled`,
 * `clarification-withdrawn`).
 */
export const CLOSING_CAUSES = [
  'filed',
  'clarification-responded',
  'clarification-resolved',
  'obligation-cancelled',
  'clarification-withdrawn',
] as const;
export type ClosingCause = (typeof CLOSING_CAUSES)[number];

/** A declarant's answer to a notice or warning; attachments are clean uploads of the Commission. */
export interface ActionResponse {
  text: string;
  attachments: { uploadId: string; fileName: string; sha256: string }[];
  /** ISO 8601. */
  submittedAt: string;
}

/** A payroll instruction's acknowledgement, as the integration-gateway answered it. */
export interface PayrollAcknowledgement {
  instructionReference: string;
  action: 'stop_salary' | 'resume_salary';
  status: string;
  payrollReference: string | null;
  receivedAt: string | null;
}

/** Kinds of ladder history entry. */
export const LADDER_HISTORY_KINDS = [
  'ladder-started',
  'ladder-restarted',
  'ladder-complied',
  'ladder-ended',
  'action-proposed',
  'action-approved',
  'action-declined',
  'action-issued',
  'action-responded',
  'action-complied',
  'action-cancelled',
  'action-reinstated',
  'payroll-instruction-sent',
  'payroll-instruction-acknowledged',
] as const;
export type LadderHistoryKind = (typeof LADDER_HISTORY_KINDS)[number];

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * One ladder per subject (an obligation or a clarification) of a Commission: the facts its views
 * and letters name, pulled once when it starts, and where it stands. A restart after a decline
 * keeps the ladder and counts a new `run`.
 */
export const enforcementLadders = pgTable(
  'enforcement_ladders',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    subjectKind: text({ enum: SUBJECT_KINDS }).notNull(),
    subjectId: uuid().notNull(),
    /** The declarant; null for an officer who never onboarded (no notification by person). */
    personId: uuid(),
    /** The roster record (payroll); null when the subject does not name one. */
    rosterRecordId: uuid(),
    /** The clarification's case; null for an obligation. */
    caseId: uuid(),
    /** The obligation's cycle key (`biennial:2027`) or the clarification's `CLR` reference. */
    subjectReference: text().notNull(),
    /** Read model for the Actions view: confidential, tenant-scoped. */
    declarantName: text().notNull(),
    personnelFileNumber: text().notNull(),
    status: text({ enum: LADDER_STATUSES }).notNull(),
    /** The step the ladder is on: its latest action. */
    currentActionId: uuid(),
    /** 1 for the first run; each restart after a decline adds one. */
    run: integer().notNull().default(1),
    closingCause: text({ enum: CLOSING_CAUSES }),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('enforcement_ladders_subject_key').on(
      table.tenant,
      table.subjectKind,
      table.subjectId,
    ),
    index('enforcement_ladders_tenant_started_idx').on(table.tenant, table.startedAt, table.id),
    check(
      'enforcement_ladders_subject_kind_check',
      sql`${table.subjectKind} in (${inList(SUBJECT_KINDS)})`,
    ),
    check('enforcement_ladders_status_check', sql`${table.status} in (${inList(LADDER_STATUSES)})`),
    check(
      'enforcement_ladders_closing_cause_check',
      sql`${table.closingCause} is null or ${table.closingCause} in (${inList(CLOSING_CAUSES)})`,
    ),
  ],
);

/**
 * An administrative action: one step of a ladder, drafted by the system, approved or declined by
 * an officer, then issued as a Restricted letter with an `ADM` reference. The declarant answers an
 * issued notice or warning once. A salary stoppage carries its payroll instructions (stop, and
 * resume on compliance) and their acknowledgements.
 */
export const administrativeActions = pgTable(
  'administrative_actions',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    ladderId: uuid()
      .notNull()
      .references(() => enforcementLadders.id),
    /** The ladder's run the action belongs to. */
    run: integer().notNull(),
    subjectKind: text({ enum: SUBJECT_KINDS }).notNull(),
    subjectId: uuid().notNull(),
    personId: uuid(),
    rosterRecordId: uuid(),
    step: text({ enum: ACTION_STEPS }).notNull(),
    status: text({ enum: ACTION_STATUSES }).notNull(),
    proposerKind: text({ enum: PROPOSER_KINDS }).notNull(),
    /** The proposing officer's subject; null for a system proposal. */
    proposer: text(),
    proposerName: text(),
    proposedAt: timestamp({ withTimezone: true }).notNull(),
    approver: text(),
    approverName: text(),
    approvedAt: timestamp({ withTimezone: true }),
    declinedBy: text(),
    declinedByName: text(),
    declinedAt: timestamp({ withTimezone: true }),
    declineNote: text(),
    /** When the letter was requested; the window runs from here. */
    issuedAt: timestamp({ withTimezone: true }),
    windowEndsAt: timestamp({ withTimezone: true }),
    /** `ADM-<ISSUER>-<YEAR>-<SEQ>-<CHECK>` (ADR-011), allocated at approval. */
    reference: text(),
    letterDocumentId: uuid(),
    letterVerificationId: text(),
    response: jsonb().$type<ActionResponse>(),
    respondedAt: timestamp({ withTimezone: true }),
    compliedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    payrollStopReference: text(),
    payrollStopAck: jsonb().$type<PayrollAcknowledgement>(),
    payrollResumeReference: text(),
    payrollResumeAck: jsonb().$type<PayrollAcknowledgement>(),
    /** The day payroll stops the salary from, fixed when the stop is first sent (`YYYY-MM-DD`). */
    salaryStopEffectiveDate: date({ mode: 'string' }),
    /** When payroll acknowledged the stop, and the resume. */
    salaryStoppedAt: timestamp({ withTimezone: true }),
    salaryReinstatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('administrative_actions_reference_key').on(table.reference),
    // One step waits for a decision at a time.
    uniqueIndex('administrative_actions_proposed_ladder_key')
      .on(table.ladderId)
      .where(sql`${table.status} = 'proposed'`),
    index('administrative_actions_ladder_idx').on(table.ladderId, table.proposedAt),
    index('administrative_actions_tenant_status_idx').on(
      table.tenant,
      table.status,
      table.proposedAt,
    ),
    index('administrative_actions_person_idx').on(table.personId, table.issuedAt),
    check(
      'administrative_actions_subject_kind_check',
      sql`${table.subjectKind} in (${inList(SUBJECT_KINDS)})`,
    ),
    check('administrative_actions_step_check', sql`${table.step} in (${inList(ACTION_STEPS)})`),
    check(
      'administrative_actions_status_check',
      sql`${table.status} in (${inList(ACTION_STATUSES)})`,
    ),
    check(
      'administrative_actions_proposer_kind_check',
      sql`${table.proposerKind} in (${inList(PROPOSER_KINDS)})`,
    ),
  ],
);

/** What happened on a ladder, in order: who did what to which step, and when. */
export const ladderHistory = pgTable(
  'ladder_history',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    ladderId: uuid()
      .notNull()
      .references(() => enforcementLadders.id),
    actionId: uuid(),
    kind: text({ enum: LADDER_HISTORY_KINDS }).notNull(),
    /** An officer's subject, `system:review`, or `person:<id>` for the declarant. */
    actor: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('ladder_history_ladder_idx').on(table.ladderId, table.at),
    check('ladder_history_kind_check', sql`${table.kind} in (${inList(LADDER_HISTORY_KINDS)})`),
  ],
);

export const enforcementSchema = { enforcementLadders, administrativeActions, ladderHistory };
