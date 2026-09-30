import type { FieldEnvelope } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
  uuid,
} from 'drizzle-orm/pg-core';

import { declarations } from '../drafts/schema.js';

/**
 * Submitted declarations (spec 06): every submission is an immutable version, the assembled
 * `declaration.v1` document as one encrypted snapshot (the legal record), with its items
 * normalised beside it for analytics and material-change comparison (ADR-001). Both are
 * list-partitioned by cycle year (the statement date's year) and insert-only: a trigger refuses
 * every DELETE, every UPDATE of an item, and every UPDATE of a version except to the columns that
 * follow the legal act (supersession, set once; the acknowledgement; the verified count). See
 * migrations 0016 and 0018 for the partitions, triggers and row-level security.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

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

export const submissionSchema = { declarationVersions, declarationItems };
