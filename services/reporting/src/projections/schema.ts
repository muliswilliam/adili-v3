import type { AccessGround, AccessOutcome } from '@adili/events/contracts';
import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reporting service's projections (spec 09): per-Commission facts built from other services'
 * events (ADR-013), attributed to a financial year (1 July to 30 June, keyed by its start year).
 * Identifiers, dates and statuses only: no names, contacts or declaration content. Form M pulls
 * names by id at compile time and keeps them only inside its encrypted snapshot.
 *
 * Every consumer upserts its columns alone, so the facts come out the same whatever order the
 * events arrive in; a status moves only for an event at least as recent as the one that set it.
 * Row-level security: tenant data (`app.tenant`, or `platform`).
 */

/** Filing obligations (spec 04 `obligation.*`, spec 06 `declaration.submitted.v1`). */
export const obligationFacts = pgTable(
  'obligation_facts',
  {
    obligationId: uuid().primaryKey(),
    tenant: text().notNull(),
    /** The officer, by id only; null until an event that carries it arrives. */
    personId: uuid(),
    rosterRecordId: uuid(),
    /** `initial` | `biennial` | `final`; null until `obligation.created.v1` arrives. */
    type: text().$type<ObligationType>(),
    cycleKey: text(),
    /** Financial year by statement date: appointment (initial), cycle (biennial), exit (final). */
    fy: integer(),
    statementDate: date({ mode: 'string' }),
    dueDate: date({ mode: 'string' }),
    /** `upcoming` | `due` | `overdue` | `filed` | `cancelled`. */
    status: text(),
    /** Time of the event that set `status`. */
    statusAt: timestamp({ withTimezone: true }),
    /** When the first version was submitted (`declaration.submitted.v1`); null while unfiled. */
    filedAt: timestamp({ withTimezone: true }),
    late: boolean(),
  },
  (table) => [index('obligation_facts_tenant_fy_idx').on(table.tenant, table.fy)],
);

/** Clarifications (spec 07a `clarification.*`), attributed by the time they were issued. */
export const clarificationFacts = pgTable(
  'clarification_facts',
  {
    clarificationId: uuid().primaryKey(),
    tenant: text().notNull(),
    /** The declarant asked, by id only; null until an event that carries it arrives. */
    personId: uuid(),
    caseId: uuid().notNull(),
    fy: integer(),
    issuedAt: timestamp({ withTimezone: true }),
    /** `issued` | `responded` | `resolved` | `overdue` | `withdrawn`. */
    status: text().$type<ClarificationFactStatus>().notNull(),
    statusAt: timestamp({ withTimezone: true }).notNull(),
    respondedAt: timestamp({ withTimezone: true }),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('clarification_facts_tenant_fy_idx').on(table.tenant, table.fy)],
);

/** Administrative actions on the enforcement ladder (spec 08 `action.*`). */
export const actionFacts = pgTable(
  'action_facts',
  {
    actionId: uuid().primaryKey(),
    tenant: text().notNull(),
    /** The officer the ladder enforces, by id only; null until an event that carries it arrives. */
    personId: uuid(),
    /** `obligation` | `clarification`: what the ladder enforces. */
    subjectKind: text().notNull(),
    subjectId: uuid().notNull(),
    /** `notice-to-comply` | `warning` | `salary-stoppage` | `disciplinary-referral`. */
    step: text().$type<ActionStep>().notNull(),
    status: text().$type<ActionStatus>().notNull(),
    statusAt: timestamp({ withTimezone: true }).notNull(),
    issuedAt: timestamp({ withTimezone: true }),
    compliedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('action_facts_subject_idx').on(table.subjectKind, table.subjectId)],
);

/** Approved compliance determinations (spec 08 `determination.approved.v1`). */
export const determinationFacts = pgTable('determination_facts', {
  determinationId: uuid().primaryKey(),
  tenant: text().notNull(),
  caseId: uuid().notNull(),
  outcome: text().notNull(),
  fy: integer().notNull(),
  approvedAt: timestamp({ withTimezone: true }).notNull(),
});

/** Referrals sent to EACC (spec 08 `referral.sent.v1`). */
export const referralFacts = pgTable('referral_facts', {
  referralId: uuid().primaryKey(),
  tenant: text().notNull(),
  /** The person referred, by id only (null for a row projected before it was kept). */
  personId: uuid(),
  reference: text().notNull(),
  grounds: text().notNull(),
  fy: integer().notNull(),
  sentAt: timestamp({ withTimezone: true }).notNull(),
});

/**
 * The AI reviewer copilot of each case (spec 07c `review.copilot.updated.v1`): its latest status,
 * and when it first had outputs to show, which makes the case AI-assisted.
 */
export const copilotCaseFacts = pgTable(
  'copilot_case_facts',
  {
    caseId: uuid().primaryKey(),
    tenant: text().notNull(),
    /** `not-enabled` | `pending` | `ready` | `failed` | `stale`. */
    status: text().notNull(),
    statusAt: timestamp({ withTimezone: true }).notNull(),
    /** When the copilot was first `ready`; null while it never was. */
    firstReadyAt: timestamp({ withTimezone: true }),
    /** Financial year of `firstReadyAt`. */
    fy: integer(),
  },
  (table) => [index('copilot_case_facts_tenant_fy_idx').on(table.tenant, table.fy)],
);

/**
 * Reviewers' ratings of AI outputs (spec 07c `ai.feedback.recorded.v1`): one row per rating (of
 * an output or one of its blocks), the latest wins when a reviewer rates again. Rating and reason only; never who rated or the note.
 */
export const aiFeedbackFacts = pgTable(
  'ai_feedback_facts',
  {
    feedbackId: uuid().primaryKey(),
    tenant: text().notNull(),
    jobId: uuid().notNull(),
    /** The gateway task whose output was rated, e.g. `summarize-declaration`. */
    task: text().notNull(),
    /** `helpful` | `not-helpful`. */
    rating: text().notNull(),
    /** `inaccurate` | `missed-something` | `unclear` | `too-long` | `other`; null for none. */
    reason: text(),
    /** Financial year of the latest rating. */
    fy: integer().notNull(),
    recordedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index('ai_feedback_facts_tenant_fy_idx').on(table.tenant, table.fy)],
);

/**
 * Form K requests for access to declarations and clarifications (spec 10 `access.request.*`, Act
 * s.36(1)), for Form M section 5. One row per request, attributed to the financial year it was
 * received in, so its outcome counts in that year whenever it is decided. The outcome and the
 * Regulation 24 grounds only: never the applicant, the declarant or the reasons given. Law
 * enforcement requests (`lea.request.*`) are not projected.
 */
export const accessRequestFacts = pgTable(
  'access_request_facts',
  {
    requestId: uuid().primaryKey(),
    tenant: text().notNull(),
    /** Financial year of `receivedAt`; null until `access.request.received.v1` arrives. */
    fy: integer(),
    receivedAt: timestamp({ withTimezone: true }),
    /** The decision, or `cannot-identify` for a request closed unidentified; null while open. */
    outcome: text().$type<AccessRequestFactOutcome>(),
    /** The Regulation 24 grounds a denial or partial grant cites; empty otherwise. */
    grounds: text().array().$type<AccessGround[]>().notNull().default([]),
    /** When the outcome was recorded. */
    closedAt: timestamp({ withTimezone: true }),
    /** When the applicant withdrew it; null otherwise. */
    withdrawnAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('access_request_facts_tenant_fy_idx').on(table.tenant, table.fy)],
);

/** How a Form K request ended: decided, or closed because the officer could not be identified. */
export type AccessRequestFactOutcome = AccessOutcome | 'cannot-identify';

export const OBLIGATION_TYPES = ['initial', 'biennial', 'final'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

export const CLARIFICATION_FACT_STATUSES = [
  'issued',
  'responded',
  'resolved',
  'overdue',
  'withdrawn',
] as const;
export type ClarificationFactStatus = (typeof CLARIFICATION_FACT_STATUSES)[number];

/** The enforcement ladder's steps in order (spec 08). */
export const ACTION_STEPS = [
  'notice-to-comply',
  'warning',
  'salary-stoppage',
  'disciplinary-referral',
] as const;
export type ActionStep = (typeof ACTION_STEPS)[number];

/**
 * An action's status as its `action.*` events tell it (spec 08 #206): `cancelled` when its ladder
 * ended before it was issued.
 */
export const ACTION_STATUSES = [
  'proposed',
  'approved',
  'declined',
  'issued',
  'responded',
  'complied',
  'cancelled',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const projectionsSchema = {
  obligationFacts,
  clarificationFacts,
  actionFacts,
  determinationFacts,
  referralFacts,
  copilotCaseFacts,
  aiFeedbackFacts,
  accessRequestFacts,
};
