import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
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

import { OBLIGATION_TYPE_VALUES } from '../obligations/schema.js';

/**
 * Declaration drafts (spec 05). Drafts live in Postgres; Valkey only caches decrypted sections
 * (ADR-001 as amended by spec 05). Section contents are one envelope-encrypted blob per section
 * (ADR-006): no clear column holds a name, description, amount or address. What the platform
 * indexes (section key, completeness, counts, nil flags, dates) is copied to clear columns on
 * save, never taken from the client.
 *
 * Row-level security (migration 0008): a declarant reads and writes their own declarations
 * through `app.person` (`withPerson`); sections and attachments follow their declaration. A
 * tenant policy exists for later staff reads, which no route of this slice uses.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** `amending` and `submitted` arrive with submission (slice 06). */
export const DECLARATION_STATUS_VALUES = ['draft', 'amending', 'submitted', 'discarded'] as const;
export type DeclarationStatus = (typeof DECLARATION_STATUS_VALUES)[number];

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
    type: text({ enum: OBLIGATION_TYPE_VALUES }).notNull(),
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
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
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

export const SECTION_COMPLETENESS_VALUES = [
  'not-started',
  'incomplete',
  'complete',
  'archived',
] as const;
export type SectionCompleteness = (typeof SECTION_COMPLETENESS_VALUES)[number];

/** The envelope stored beside a section's ciphertext (`FieldEnvelope` of `@adili/data-access`). */
export interface StoredEnvelope {
  v: 1;
  tenant: string;
  keyVersion: number;
  wrappedDek: string;
  iv: string;
  tag: string;
}

/**
 * Clear facts about a section, derived on save: item counts by category, nil flags, whether a
 * statement is archived (its person removed from the household), and the bio fields pre-filled
 * from the roster that the declarant cannot change (JSON pointers, no values).
 */
export interface SectionMetadata {
  counts?: Record<string, number>;
  nil?: Record<string, boolean>;
  archived?: boolean;
  lockedFields?: string[];
}

/** One capture section of a declaration: `bio`, `household`, `statement:<personKey>`, `other`. */
export const declarationSections = pgTable(
  'declaration_sections',
  {
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    sectionKey: text().notNull(),
    ciphertext: bytea().notNull(),
    envelope: jsonb().$type<StoredEnvelope>().notNull(),
    completeness: text({ enum: SECTION_COMPLETENESS_VALUES }).notNull().default('not-started'),
    metadata: jsonb().$type<SectionMetadata>().notNull().default({}),
    /** The declaration's `draft_version` this section was last saved at (the cache key). */
    savedVersion: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Null until the declarant first saves the section. */
    updatedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.declarationId, table.sectionKey] }),
    check(
      'declaration_sections_completeness_check',
      sql`${table.completeness} in ('not-started', 'incomplete', 'complete', 'archived')`,
    ),
  ],
);

/**
 * A clean upload of the documents service linked to an item of a section. The bytes stay in the
 * documents service; this row is for listing and integrity.
 */
export const declarationAttachments = pgTable(
  'declaration_attachments',
  {
    id: uuid().primaryKey(),
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    sectionKey: text().notNull(),
    itemId: uuid().notNull(),
    uploadId: uuid().notNull(),
    fileName: text().notNull(),
    sha256: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    linkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('declaration_attachments_upload_id_key').on(table.uploadId),
    index('declaration_attachments_declaration_id_idx').on(table.declarationId),
  ],
);

export const draftsSchema = { declarations, declarationSections, declarationAttachments };
