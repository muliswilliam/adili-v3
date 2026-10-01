import {
  REMINDER_CHANNELS,
  REMINDER_OUTCOMES,
  type ReminderChannel,
  type ReminderOutcome,
} from '@adili/events/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ReminderParams } from '../notifications/notifications-client.js';
import {
  CANCEL_REASONS,
  OBLIGATION_STATUSES,
  OBLIGATION_TYPES,
  type ObligationPolicy,
} from './engine.js';

/**
 * The obligations read and write model of the declarations service (spec 04). Only this service
 * reads or writes it (ADR-013); roster records and Commission names are pulled from the directory
 * into local read models, never joined across services.
 *
 * Row-level security (migrations 0002 and 0010): the roster snapshot, obligations and reminders
 * are tenant data for staff and system transactions (`app.tenant`, or `platform`), and a declarant
 * reads their own rows across Commissions through `app.person` (`withPerson`), read-only (ADR-018).
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** As in the directory: `not_onboarded` until the declarant onboards, `exited` once an exit is recorded. */
export const ROSTER_RECORD_STATES = ['not_onboarded', 'onboarded', 'exited'] as const;

/**
 * The declarations service's snapshot of a directory roster record, as last pulled: what the
 * obligation engine reads, and the declarant names and file numbers the Commission's obligations
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
     * The declarant's reporting entity as the roster names it (categorisation only: it never
     * reads declarations); null when the roster gives none.
     */
    reportingEntityId: uuid(),
    reportingEntityName: text(),
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
    // The cycle opening pages through a tenant's snapshots by id.
    index('roster_snapshots_tenant_id_idx').on(table.tenant, table.rosterRecordId),
    check(
      'roster_snapshots_state_check',
      sql`${table.state} in ('not_onboarded', 'onboarded', 'exited')`,
    ),
  ],
);

/** `'a', 'b'` for a check constraint over a list of values. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

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
    type: text({ enum: OBLIGATION_TYPES }).notNull(),
    /** `initial:<appointment date>`, `biennial:<year>` or `final:<exit date>`. */
    cycleKey: text().notNull(),
    statementDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    status: text({ enum: OBLIGATION_STATUSES }).notNull(),
    cancelReason: text({ enum: CANCEL_REASONS }),
    /** The directory policy version whose periods and offsets the obligation was computed with. */
    policyVersionId: uuid().notNull(),
    policyVersion: integer().notNull(),
    /**
     * That policy version's reminder offsets (days before the due date, largest first), which its
     * workflow plans reminders with (ADR-003 §4: a later version never re-plans a running case).
     */
    reminderOffsetsDays: integer().array().notNull(),
    /**
     * When its `FilingObligationWorkflow` was last started (or found running or completed); null
     * until then. A run that stopped before this was restarted.
     */
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
    check('filing_obligations_type_check', sql`${table.type} in (${sqlList(OBLIGATION_TYPES)})`),
    check(
      'filing_obligations_status_check',
      sql`${table.status} in (${sqlList(OBLIGATION_STATUSES)})`,
    ),
    check(
      'filing_obligations_cancel_reason_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
  ],
);

/** The event contract's values (`obligation.reminder.recorded.v1`), stored as they are published. */
export const REMINDER_OUTCOME_VALUES = REMINDER_OUTCOMES;
export type { ReminderOutcome };

export const REMINDER_CHANNEL_VALUES = REMINDER_CHANNELS;
export type { ReminderChannel };

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
      sql`${table.outcome} in (${sqlList(REMINDER_OUTCOME_VALUES)})`,
    ),
  ],
);

/**
 * The message each reminder sends, as its first attempt rendered it (template parameters). Every
 * later attempt sends this body again, so notifications sees the same request under the reminder
 * channel's `Idempotency-Key` even when the Commission's name or the obligation changed in
 * between, and never refuses it as a key reused for another body. Tenant data (migration 0007).
 */
export const reminderMessages = pgTable(
  'reminder_messages',
  {
    obligationId: uuid()
      .notNull()
      .references(() => filingObligations.id),
    offsetDays: integer().notNull(),
    tenant: text().notNull(),
    params: jsonb().$type<ReminderParams>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.obligationId, table.offsetDays] })],
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
 * from the directory, and when its latest roster import completed (the national summary). Public
 * facts, platform-level: no row-level security (migration 0009).
 */
export const commissionRefs = pgTable('commission_refs', {
  slug: text().primaryKey(),
  issuerCode: text().notNull(),
  name: text().notNull(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** The time of the latest `roster.import.completed.v1` handled; null before any. */
  lastRosterImportAt: timestamp({ withTimezone: true }),
});

/**
 * The biennial cycles (platform data, not tenant policy): each cycle's obligations are created
 * `openingLeadDays` before its statement date. Seeded 2027, 2029, 2031. No row-level security
 * (migration 0009).
 */
export const cycleCalendar = pgTable('cycle_calendar', {
  cycleYear: integer().primaryKey(),
  openingLeadDays: integer().notNull(),
});

/**
 * The cycles opened for each Commission: written when its `CycleOpeningWorkflow` has created the
 * cycle's biennial obligations for every active declarant, with how many it has. A cycle recorded
 * here is not opened again (a second firing of the schedule creates nothing). Platform-level.
 */
export const cycleOpenings = pgTable(
  'cycle_openings',
  {
    tenant: text().notNull(),
    cycleYear: integer().notNull(),
    /**
     * The Commission's live biennial obligations of the cycle when the opening was recorded (the
     * opening created most; declarants ingested after the opening date got theirs on ingest).
     */
    obligationsCreated: integer().notNull(),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenant, table.cycleYear] })],
);

export const obligationsSchema = {
  rosterSnapshots,
  filingObligations,
  obligationReminders,
  reminderMessages,
  tenantPolicyCache,
  commissionRefs,
  cycleCalendar,
  cycleOpenings,
};
