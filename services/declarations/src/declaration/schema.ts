import type { FieldEnvelope } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { OBLIGATION_TYPES } from '../obligations/engine.js';

/**
 * The declaration aggregate, shared by the drafts that edit it and the submission that files it:
 * the declaration itself (spec 05), and its submitted versions with their items (spec 06).
 * Drafts' sections and attachments are in `drafts/schema.ts`.
 */

/** Binary columns (ciphertexts). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * `draft` → `submitted` at the first submission; `submitted` → `amending` (reopened) → `submitted`
 * (a new version); `draft` or `amending` → `discarded` (discarding an amendment restores
 * `submitted`). `filed` is the obligation's status, not the declaration's.
 */
export const DECLARATION_STATUS_VALUES = ['draft', 'amending', 'submitted', 'discarded'] as const;
export type DeclarationStatus = (typeof DECLARATION_STATUS_VALUES)[number];

/** A draft, or a submitted declaration reopened for amendment: its sections can be edited. */
export const EDITABLE_STATUSES = ['draft', 'amending'] as const satisfies DeclarationStatus[];

export function isEditable(status: DeclarationStatus): boolean {
  return (EDITABLE_STATUSES as readonly DeclarationStatus[]).includes(status);
}

export const INCOME_PERIOD_SOURCE_VALUES = ['declared', 'assumed'] as const;

export const SCHEMA_VERSION = 'declaration.v1';

/**
 * One declaration: the aggregate. Type, statement date and income period are derived from the
 * obligation when the draft starts, never chosen. `draft_version` is the optimistic concurrency
 * token (the `ETag`), bumped by every section save in the save's transaction.
 */
export const declarations = pgTable(
  'declarations',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    personId: uuid().notNull(),
    obligationId: uuid().notNull(),
    rosterRecordId: uuid().notNull(),
    type: text({ enum: OBLIGATION_TYPES }).notNull(),
    statementDate: date({ mode: 'string' }).notNull(),
    /** Exclusive: the income period is (from, to]. */
    incomePeriodFrom: date({ mode: 'string' }).notNull(),
    incomePeriodTo: date({ mode: 'string' }).notNull(),
    /** `assumed` when no declaration on Adili gave the start, so reviewers can see it. */
    previousStatementDateSource: text({ enum: INCOME_PERIOD_SOURCE_VALUES }).notNull(),
    status: text({ enum: DECLARATION_STATUS_VALUES }).notNull().default('draft'),
    schemaVersion: text().notNull().default(SCHEMA_VERSION),
    draftVersion: integer().notNull().default(1),
    /** The section saved last, for "Continue"; null until the first save. */
    lastSection: text(),
    /** Allocated at the first submission and kept by every later version (ADR-011). */
    reference: text(),
    /** The version in force: the latest submitted; null until the first submission. */
    currentVersion: integer(),
    /** The version an amendment in progress started from; null unless `amending`. */
    amendingFromVersion: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // The database's clock on insert and on every update alike, so "newest first" holds even when
    // the service's clock and the database's disagree.
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    uniqueIndex('declarations_live_obligation_key')
      .on(table.obligationId)
      .where(sql`${table.status} <> 'discarded'`),
    index('declarations_person_id_idx').on(table.personId),
    check('declarations_type_check', sql`${table.type} in ('initial', 'biennial', 'final')`),
    check(
      'declarations_status_check',
      sql`${table.status} in ('draft', 'amending', 'submitted', 'discarded')`,
    ),
    check(
      'declarations_previous_statement_date_source_check',
      sql`${table.previousStatementDateSource} in ('declared', 'assumed')`,
    ),
  ],
);

/**
 * Submitted declarations (spec 06): every submission is an immutable version, the assembled
 * `declaration.v1` document as one encrypted snapshot (the legal record), with its items
 * normalised beside it for analytics and material-change comparison (ADR-001). Both are
 * list-partitioned by cycle year (the statement date's year) and insert-only: a trigger refuses
 * every DELETE, every UPDATE of an item, and every UPDATE of a version except to the columns that
 * follow the legal act (supersession, set once; the acknowledgement; the verified count). See
 * migrations 0016, 0018 and 0019 for the partitions, triggers and row-level security (the
 * declarant reads their own through `app.person`; only the Commission's context writes).
 */

export const ACKNOWLEDGEMENT_STATUS_VALUES = ['pending', 'issued', 'failed'] as const;
export type AcknowledgementStatus = (typeof ACKNOWLEDGEMENT_STATUS_VALUES)[number];

/** The columns of a version a trigger lets change after insert; everything else is fixed. */
export const MUTABLE_VERSION_COLUMNS = [
  'superseded_at',
  'ack_status',
  'ack_document_id',
  'ack_verification_id',
  'ack_verify_url',
  'ack_issued_at',
  'ack_requested_at',
  'verified_count',
] as const;

/** One submitted version of a declaration. */
export const declarationVersions = pgTable(
  'declaration_versions',
  {
    id: uuid().notNull(),
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id),
    /** 1 at the first submission, one more per amendment. */
    version: integer().notNull(),
    /** The statement date's year: the partition key. */
    cycleYear: integer().notNull(),
    tenant: text().notNull(),
    personId: uuid().notNull(),
    /** Allocated at version 1 and copied to later versions (ADR-011). */
    reference: text().notNull(),
    /** The `declaration.v1` document, encrypted with the Commission's key (ADR-006). */
    snapshotCiphertext: bytea().notNull(),
    envelope: jsonb().$type<FieldEnvelope>().notNull(),
    /** Hex SHA-256 of the document's RFC 8785 canonical JSON, before encryption. */
    canonicalSha256: text().notNull(),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    /** Submitted after the obligation's due date (Africa/Nairobi). */
    late: boolean().notNull(),
    /** Step-up evidence from the token the submission was made with. */
    stepUpAcr: text().notNull(),
    stepUpAuthTime: timestamp({ withTimezone: true }).notNull(),
    /** Hex SHA-256 of the `Idempotency-Key` it was submitted with. */
    idempotencyKeyHash: text().notNull(),
    /** When a later version replaced it; set once. */
    supersededAt: timestamp({ withTimezone: true }),
    ackStatus: text({ enum: ACKNOWLEDGEMENT_STATUS_VALUES }).notNull().default('pending'),
    ackDocumentId: uuid(),
    ackVerificationId: text(),
    /** Where the verify page answers for the slip: its QR code's payload. */
    ackVerifyUrl: text(),
    ackIssuedAt: timestamp({ withTimezone: true }),
    /** When the declarant last asked for the slip again (reissue); null until they do. */
    ackRequestedAt: timestamp({ withTimezone: true }),
    /** Lookups of its acknowledgement slip on the verify app. */
    verifiedCount: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A partitioned table's keys include the partition key; a declaration's versions share its
    // cycle year, so the key still makes (declaration, version) unique.
    primaryKey({ columns: [table.id, table.cycleYear] }),
    unique('declaration_versions_declaration_version_key').on(
      table.declarationId,
      table.cycleYear,
      table.version,
    ),
    // The verified count follows lookups of a slip by its verification code.
    index('declaration_versions_ack_verification_id_idx').on(table.ackVerificationId),
    check('declaration_versions_version_check', sql`${table.version} >= 1`),
    check(
      'declaration_versions_ack_status_check',
      sql`${table.ackStatus} in ('pending', 'issued', 'failed')`,
    ),
  ],
);

export const ITEM_CATEGORY_VALUES = ['income', 'asset', 'liability'] as const;
export type ItemCategory = (typeof ITEM_CATEGORY_VALUES)[number];

/** The envelopes of an item's two encrypted fields. */
export interface ItemEnvelopes {
  description: FieldEnvelope;
  value: FieldEnvelope;
}

/**
 * One income, asset or liability of a version's statements. Clear columns are what analytics
 * and material-change comparison select rows by; the description and the value (a `Money`) are
 * encrypted with the Commission's key and read in-process per declaration.
 */
export const declarationItems = pgTable(
  'declaration_items',
  {
    id: uuid().notNull(),
    versionId: uuid().notNull(),
    cycleYear: integer().notNull(),
    tenant: text().notNull(),
    /** Whose statement: `officer`, `spouse:<id>` or `child:<id>`. */
    personKey: text().notNull(),
    category: text({ enum: ITEM_CATEGORY_VALUES }).notNull(),
    type: text().notNull(),
    inKenya: boolean().notNull(),
    /** Kenyan county code, when in Kenya. */
    county: text(),
    /** ISO 3166-1 alpha-2, when outside Kenya. */
    country: text(),
    /** Assets only; false for income and liabilities. */
    isJoint: boolean().notNull(),
    sharePercent: numeric({ precision: 5, scale: 2, mode: 'number' }),
    /** Why it changed since the previous declaration; null when unchanged. */
    changeKind: text(),
    /** The item's id in the document. */
    itemId: uuid().notNull(),
    descriptionCiphertext: bytea().notNull(),
    valueCiphertext: bytea().notNull(),
    envelope: jsonb().$type<ItemEnvelopes>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.cycleYear] }),
    foreignKey({
      name: 'declaration_items_version_fk',
      columns: [table.versionId, table.cycleYear],
      foreignColumns: [declarationVersions.id, declarationVersions.cycleYear],
    }),
    index('declaration_items_version_id_idx').on(table.versionId),
    index('declaration_items_tenant_category_type_idx').on(
      table.tenant,
      table.category,
      table.type,
    ),
    check(
      'declaration_items_category_check',
      sql`${table.category} in ('income', 'asset', 'liability')`,
    ),
  ],
);

export const declarationSchema = { declarations, declarationVersions, declarationItems };
