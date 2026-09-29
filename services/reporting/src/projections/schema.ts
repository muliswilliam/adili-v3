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
  reference: text().notNull(),
  grounds: text().notNull(),
  fy: integer().notNull(),
  sentAt: timestamp({ withTimezone: true }).notNull(),
});

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
};
