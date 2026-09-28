import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { commissions } from '../commissions/schema.js';
import type { ColumnMapping } from './header-mapping.js';
import type { ImportCounts, ImportFailureCode } from './import/representation.js';
import type { NormalisedRosterRow, RawRosterRow, RowError } from './row-validation.js';

/**
 * The roster of each Commission (spec #27): its records, reporting entities, imports with their
 * staged rows, and the summary row. Every table is tenant-scoped under RLS (FORCE ROW LEVEL
 * SECURITY, policies in migration 0009); `tenant` is the Commission's slug.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const ROSTER_RECORD_STATES = ['not_onboarded', 'onboarded', 'exited'] as const;
export type RosterRecordState = (typeof ROSTER_RECORD_STATES)[number];

export const IMPORT_CHANNELS = ['file', 'api'] as const;
export type ImportChannel = (typeof IMPORT_CHANNELS)[number];

export const IMPORT_STATES = ['pending', 'processing', 'completed', 'failed'] as const;
export type ImportState = (typeof IMPORT_STATES)[number];

export const IMPORT_FORMATS = ['csv', 'xlsx', 'json'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_ROW_STATUSES = ['accepted', 'rejected'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_ROW_OUTCOMES = ['created', 'updated', 'unchanged'] as const;
export type ImportRowOutcome = (typeof IMPORT_ROW_OUTCOMES)[number];

/**
 * A school, ministry, department or station named in roster rows; created on first sight during
 * an import and never deleted by one. Unique per tenant by normalised name.
 */
export const reportingEntities = pgTable(
  'reporting_entities',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenant: text()
      .notNull()
      .references(() => commissions.slug),
    /** As first written in a roster row. */
    name: text().notNull(),
    /** Lower-cased, whitespace collapsed: the identity of the entity within the tenant. */
    normalisedName: text().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('reporting_entities_tenant_normalised_name_key').on(
      table.tenant,
      table.normalisedName,
    ),
  ],
);

/**
 * One expected declarant of a Commission, keyed by personnel file number (unique per tenant,
 * case-insensitively). `onboarded` is set by slice 03; imports never change the identity fields
 * (national ID, full name) of an onboarded record.
 */
export const rosterRecords = pgTable(
  'roster_records',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenant: text()
      .notNull()
      .references(() => commissions.slug),
    personnelFileNumber: text().notNull(),
    fullName: text().notNull(),
    /** Digits only. The same national ID may be on another Commission's roster (transfers). */
    nationalId: text().notNull(),
    designation: text(),
    jobGroup: text(),
    reportingEntityId: uuid().references(() => reportingEntities.id),
    appointmentDate: date({ mode: 'string' }),
    email: text(),
    /** E.164. */
    phone: text(),
    state: text({ enum: ROSTER_RECORD_STATES }).notNull().default('not_onboarded'),
    exitDate: date({ mode: 'string' }),
    /** Not in the latest complete import; the reporting officer confirms the exit or keeps it. */
    absentFromLatestImport: boolean().notNull().default(false),
    flaggedByImportId: uuid().references((): AnyPgColumn => rosterImports.id),
    flaggedAt: timestamp({ withTimezone: true }),
    /**
     * Who last resolved the record, and when: kept it (flag cleared) or confirmed its exit. The
     * user's `sub`, or an HR system's client id. Reset when a later import flags it again.
     */
    flagClearedBy: text(),
    flagClearedAt: timestamp({ withTimezone: true }),
    /** Channel of the last change. */
    source: text({ enum: IMPORT_CHANNELS }).notNull(),
    firstSeenImportId: uuid()
      .notNull()
      .references((): AnyPgColumn => rosterImports.id),
    /** The latest import with a row for this record, whether or not it changed anything. */
    lastSeenImportId: uuid()
      .notNull()
      .references((): AnyPgColumn => rosterImports.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('roster_records_tenant_file_number_key').on(
      table.tenant,
      sql`lower(${table.personnelFileNumber})`,
    ),
    index('roster_records_tenant_national_id_idx').on(table.tenant, table.nationalId),
    /** The records list's order and keyset cursor. */
    index('roster_records_tenant_full_name_id_idx').on(table.tenant, table.fullName, table.id),
    index('roster_records_tenant_state_idx').on(table.tenant, table.state),
    index('roster_records_tenant_flagged_idx')
      .on(table.tenant)
      .where(sql`${table.absentFromLatestImport}`),
    index('roster_records_last_seen_import_id_idx').on(table.lastSeenImportId),
    check(
      'roster_records_state_check',
      sql`${table.state} in ('not_onboarded', 'onboarded', 'exited')`,
    ),
    check('roster_records_source_check', sql`${table.source} in ('file', 'api')`),
    check(
      'roster_records_exit_date_check',
      sql`${table.state} = 'exited' or ${table.exitDate} is null`,
    ),
  ],
);

/**
 * One import: the unit of work of `RosterImportWorkflow` and the report. At most one import per
 * tenant is `pending` or `processing`. Counts are written when it ends, from its rows.
 */
export const rosterImports = pgTable(
  'roster_imports',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenant: text()
      .notNull()
      .references(() => commissions.slug),
    channel: text({ enum: IMPORT_CHANNELS }).notNull(),
    declaredComplete: boolean().notNull(),
    /** The clean upload a file import reads (documents service); null for API batches. */
    uploadId: uuid(),
    fileName: text(),
    format: text({ enum: IMPORT_FORMATS }).notNull(),
    state: text({ enum: IMPORT_STATES }).notNull().default('pending'),
    /** Data rows staged; null until staging finishes. */
    totalRows: integer(),
    /** Rows whose outcome is decided: rejected when staged, or applied. */
    processedRows: integer().notNull().default(0),
    /** Chunks of accepted rows to apply; null until staging finishes. */
    chunkCount: integer(),
    /** Set when the import ends. Its `exitsRecorded` is as at the end; the column is current. */
    counts: jsonb().$type<ImportCounts>(),
    /**
     * Exits confirmed for records this import flagged absent, counted as they are confirmed,
     * mostly after the import ended.
     */
    exitsRecorded: integer().notNull().default(0),
    mapping: jsonb().$type<ColumnMapping>(),
    failureCode: text().$type<ImportFailureCode>(),
    failureDetail: text(),
    startedByKind: text({ enum: ['user', 'client'] }).notNull(),
    /** `sub` of the user, or the OAuth client id of an HR system. */
    startedBy: text().notNull(),
    /** Display name when it started (token `name`; client id for HR systems). */
    startedByName: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('roster_imports_tenant_started_at_idx').on(table.tenant, table.startedAt.desc()),
    uniqueIndex('roster_imports_one_in_progress_key')
      .on(table.tenant)
      .where(sql`${table.state} in ('pending', 'processing')`),
    check('roster_imports_channel_check', sql`${table.channel} in ('file', 'api')`),
    check('roster_imports_format_check', sql`${table.format} in ('csv', 'xlsx', 'json')`),
    check(
      'roster_imports_state_check',
      sql`${table.state} in ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      'roster_imports_started_by_kind_check',
      sql`${table.startedByKind} in ('user', 'client')`,
    ),
    check(
      'roster_imports_failure_check',
      sql`(${table.state} = 'failed') = (${table.failureCode} is not null)`,
    ),
    check(
      'roster_imports_completed_at_check',
      sql`(${table.state} in ('completed', 'failed')) = (${table.completedAt} is not null)`,
    ),
  ],
);

/**
 * The staged rows of an import: its report and the restart-safe work queue of the workflow.
 * Accepted rows are numbered into chunks of 1,000 when staged; applying a chunk marks its rows
 * applied in the same transaction, so a re-run skips them. Purged 30 days after the import ends
 * (`ImportRowsJanitor`).
 */
export const rosterImportRows = pgTable(
  'roster_import_rows',
  {
    importId: uuid()
      .notNull()
      .references(() => rosterImports.id, { onDelete: 'cascade' }),
    /** Spreadsheet row number (header is row 1), or the 1-based index in an API batch. */
    rowNumber: integer().notNull(),
    /** Denormalised from the import for RLS. */
    tenant: text().notNull(),
    raw: jsonb().$type<RawRosterRow>().notNull(),
    normalised: jsonb().$type<NormalisedRosterRow>(),
    status: text({ enum: IMPORT_ROW_STATUSES }).notNull(),
    errors: jsonb().$type<RowError[]>().notNull().default([]),
    /** Chunk an accepted row is applied in; null for rows rejected when staged. */
    chunkIndex: integer(),
    outcome: text({ enum: IMPORT_ROW_OUTCOMES }),
    appliedAt: timestamp({ withTimezone: true }),
    recordId: uuid().references(() => rosterRecords.id),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.rowNumber] }),
    // Pages of rows by status in row order (the report), without sorting all the import's rows.
    index('roster_import_rows_import_id_status_row_number_idx').on(
      table.importId,
      table.status,
      table.rowNumber,
    ),
    index('roster_import_rows_import_id_chunk_index_idx').on(table.importId, table.chunkIndex),
    /** A record's import history. */
    index('roster_import_rows_record_id_idx').on(table.recordId),
    check('roster_import_rows_status_check', sql`${table.status} in ('accepted', 'rejected')`),
    check(
      'roster_import_rows_outcome_check',
      sql`${table.outcome} is null or ${table.outcome} in ('created', 'updated', 'unchanged')`,
    ),
  ],
);

/**
 * The rows of an API batch (spec #27, channel `api`) as the HR system sent them, from the start
 * of the import until staging has copied them into `roster_import_rows` or the import ends,
 * either of which deletes them; the purge deletes any left 30 days after the import ended (or
 * started, if it never ended).
 */
export const rosterImportBatches = pgTable('roster_import_batches', {
  importId: uuid()
    .primaryKey()
    .references(() => rosterImports.id, { onDelete: 'cascade' }),
  /** Denormalised from the import for RLS (policy in migration 0014). */
  tenant: text().notNull(),
  rows: jsonb().$type<RawRosterRow[]>().notNull(),
});

/**
 * Counts per tenant, recomputed in the transaction of each change to the roster, so the
 * Commission list reads them without counting. Authoritative for the Commission read model.
 */
export const rosterSummaries = pgTable('roster_summaries', {
  tenant: text()
    .primaryKey()
    .references(() => commissions.slug),
  /** Records not `exited`. */
  expected: integer().notNull(),
  onboarded: integer().notNull(),
  /** Records not `exited` flagged absent from the latest complete import. */
  flagged: integer().notNull(),
  /** The latest completed import. */
  lastImportId: uuid().references(() => rosterImports.id),
  lastImportAt: timestamp({ withTimezone: true }),
  /** When the latest completed import declared complete finished. */
  lastCompleteImportAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const rosterSchema = {
  reportingEntities,
  rosterRecords,
  rosterImports,
  rosterImportRows,
  rosterImportBatches,
  rosterSummaries,
};
