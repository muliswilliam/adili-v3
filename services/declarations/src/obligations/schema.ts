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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ObligationPolicy } from './engine.js';

/**
 * The obligations read and write model of the declarations service (spec 04). Only this service
 * reads or writes it (ADR-013); roster records and Commission names are pulled from the directory
 * into local read models, never joined across services.
 *
 * Row-level security (migration 0002): the roster snapshot, obligations and reminders are tenant
 * data for staff and system transactions (`app.tenant`, or `platform`), and a declarant reads their
 * own rows across Commissions through `app.person` (`withPerson`), read-only.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const ROSTER_RECORD_STATES = ['active', 'exited'] as const;

/**
 * The declarations service's snapshot of a directory roster record, as last pulled: what the
 * obligation engine reads, and the officer names and file numbers the Commission's obligations
 * list shows. Confidential (names); tenant-scoped.
 */
export const rosterSnapshots = pgTable(
  'roster_snapshots',
  {
    rosterRecordId: uuid().primaryKey(),
    tenant: text().notNull(),
    personnelFileNumber: text().notNull(),
    fullName: text().notNull(),
    state: text({ enum: ROSTER_RECORD_STATES }).notNull(),
    appointmentDate: date({ mode: 'string' }),
    exitDate: date({ mode: 'string' }),
    /** Null until the declarant onboards. */
    personId: uuid(),
    ofr: text(),
    onboardedAt: timestamp({ withTimezone: true }),
    /**
     * The record's `updatedAt` in the directory when pulled. A pull older than the stored one
     * (events handled out of order) does not overwrite it.
     */
    sourceUpdatedAt: timestamp({ withTimezone: true }).notNull(),
    /** The import or exit batch the last pull was for; null for a single-record pull. */
    syncedFrom: uuid(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('roster_snapshots_tenant_state_idx').on(table.tenant, table.state),
    index('roster_snapshots_person_id_idx').on(table.personId),
    check('roster_snapshots_state_check', sql`${table.state} in ('active', 'exited')`),
  ],
);

export const OBLIGATION_TYPE_VALUES = ['initial', 'biennial', 'final'] as const;
export const OBLIGATION_STATUS_VALUES = [
  'upcoming',
  'due',
  'overdue',
  'filed',
  'cancelled',
] as const;
export const CANCEL_REASON_VALUES = [
  'exited-before-statement-date',
  'exit-reversed',
  'superseded',
] as const;

/**
 * Filing obligations: one per roster record per duty (initial, biennial per cycle, final),
 * derived by the obligation engine, never created by hand. `cancelled` rows are history: at most
 * one live row per (roster record, cycle key), so an obligation cancelled and later owed again
 * (an exit reversed) is a new row with the same cycle key.
 */
export const filingObligations = pgTable(
  'filing_obligations',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    rosterRecordId: uuid()
      .notNull()
      .references(() => rosterSnapshots.rosterRecordId),
    /** Null until the declarant onboards (then set on every open obligation of the record). */
    personId: uuid(),
    ofr: text(),
    type: text({ enum: OBLIGATION_TYPE_VALUES }).notNull(),
    /** `initial:<appointment date>`, `biennial:<year>` or `final:<exit date>`. */
    cycleKey: text().notNull(),
    statementDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    status: text({ enum: OBLIGATION_STATUS_VALUES }).notNull(),
    cancelReason: text({ enum: CANCEL_REASON_VALUES }),
    /** The directory policy version whose periods and offsets the obligation was computed with. */
    policyVersionId: uuid().notNull(),
    policyVersion: integer().notNull(),
    /** When its `FilingObligationWorkflow` was started; null until then. */
    workflowStartedAt: timestamp({ withTimezone: true }),
    /** The declaration that filed it (slice 06); null before. */
    filedDeclarationId: uuid(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('filing_obligations_live_cycle_key')
      .on(table.rosterRecordId, table.cycleKey)
      .where(sql`${table.status} <> 'cancelled'`),
    index('filing_obligations_tenant_status_due_idx').on(table.tenant, table.status, table.dueDate),
    index('filing_obligations_person_id_idx').on(table.personId),
    index('filing_obligations_roster_record_id_idx').on(table.rosterRecordId),
    check('filing_obligations_type_check', sql`${table.type} in ('initial', 'biennial', 'final')`),
    check(
      'filing_obligations_status_check',
      sql`${table.status} in ('upcoming', 'due', 'overdue', 'filed', 'cancelled')`,
    ),
    check(
      'filing_obligations_cancel_reason_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
  ],
);

export const REMINDER_OUTCOME_VALUES = [
  'sent',
  'skipped-not-onboarded',
  'skipped-no-contact',
  'skipped-past-due-at-creation',
  'failed',
] as const;
export type ReminderOutcome = (typeof REMINDER_OUTCOME_VALUES)[number];

export const REMINDER_CHANNEL_VALUES = ['sms', 'email'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNEL_VALUES)[number];

/**
 * What became of each reminder of an obligation: sent, skipped (and why) or failed. One row per
 * offset, written when the reminder's time came (the workflow) or, for reminders already past
 * when the obligation was created, at creation.
 */
export const obligationReminders = pgTable(
  'obligation_reminders',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    obligationId: uuid()
      .notNull()
      .references(() => filingObligations.id),
    tenant: text().notNull(),
    /** Days before the due date. */
    offsetDays: integer().notNull(),
    scheduledAt: timestamp({ withTimezone: true }).notNull(),
    sentAt: timestamp({ withTimezone: true }),
    channels: jsonb().$type<ReminderChannel[]>().notNull().default([]),
    /** Notifications message ids, one per channel sent. */
    messageIds: jsonb().$type<string[]>().notNull().default([]),
    outcome: text({ enum: REMINDER_OUTCOME_VALUES }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('obligation_reminders_obligation_offset_key').on(table.obligationId, table.offsetDays),
    check(
      'obligation_reminders_outcome_check',
      sql`${table.outcome} in ('sent', 'skipped-not-onboarded', 'skipped-no-contact', 'skipped-past-due-at-creation', 'failed')`,
    ),
  ],
);

/**
 * The Commission policy version in force as last pulled from the directory (periods, reminder
 * offsets, obligations-start date). Platform data about each tenant; refreshed on every roster
 * event.
 */
export const tenantPolicyCache = pgTable('tenant_policy_cache', {
  tenant: text().primaryKey(),
  policyVersionId: uuid().notNull(),
  version: integer().notNull(),
  policy: jsonb().$type<ObligationPolicy>().notNull(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * How a Commission is named to declarants and staff (slug, issuer code, name), as last pulled
 * from the directory. Public facts, platform-level.
 */
export const commissionRefs = pgTable('commission_refs', {
  slug: text().primaryKey(),
  issuerCode: text().notNull(),
  name: text().notNull(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * The biennial cycles (platform data, not tenant policy): each cycle's obligations are created
 * `openingLeadDays` before its statement date. Seeded 2027, 2029, 2031.
 */
export const cycleCalendar = pgTable('cycle_calendar', {
  cycleYear: integer().primaryKey(),
  openingLeadDays: integer().notNull(),
});

export const obligationsSchema = {
  rosterSnapshots,
  filingObligations,
  obligationReminders,
  tenantPolicyCache,
  commissionRefs,
  cycleCalendar,
};
