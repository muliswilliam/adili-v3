import type { DeclarationSectionKey } from '@adili/forms';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, declarations } from '../declaration/schema.js';
import type { StatementKey } from './sections.js';

/**
 * Declaration drafts (spec 05). Drafts live in Postgres; Valkey only caches decrypted sections
 * (ADR-001 as amended by spec 05). Section contents are one envelope-encrypted blob per section
 * (ADR-006): no clear column holds a name, description, amount or address. What the platform
 * indexes (section key, completeness, counts, nil flags, dates) is copied to clear columns on
 * save, never taken from the client.
 *
 * The declaration itself, the aggregate the drafts edit, is in `declaration/schema.ts`.
 *
 * Row-level security (migration 0012): a declarant reads and writes their own declarations
 * through `app.person` (`withPerson`); sections and attachments follow their declaration. A
 * tenant policy exists for later staff reads, which no route of this slice uses.
 */

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
  /** Household: the children who get no statement, by person key, with the reason. */
  notIncluded?: { personKey: string; reason: string }[];
}

/** One capture section of a declaration: `bio`, `household`, `statement:<personKey>`, `other`. */
export const declarationSections = pgTable(
  'declaration_sections',
  {
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    sectionKey: text().$type<DeclarationSectionKey>().notNull(),
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
 * documents service; this row is for listing and integrity (hash and size). The file name can say
 * what the declarant owns, so it is kept only in the item's reference inside the encrypted
 * section (ADR-006), never here.
 */
export const declarationAttachments = pgTable(
  'declaration_attachments',
  {
    id: uuid().primaryKey(),
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    /** Always a statement's: only statement items take attachments. */
    sectionKey: text().$type<StatementKey>().notNull(),
    itemId: uuid().notNull(),
    uploadId: uuid().notNull(),
    sha256: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    linkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('declaration_attachments_upload_id_key').on(table.uploadId),
    index('declaration_attachments_declaration_id_idx').on(table.declarationId),
  ],
);

/**
 * The obligations that have a live draft (#300): identifiers only, one row per obligation, written
 * in the same transaction as the `declaration.draft-started.v1` and removed with
 * `declaration.draft-discarded.v1`. It is how the Commission counts drafts in progress without
 * reading drafts: the declarant writes their own rows (`app.person`), the tenant reads (migration
 * 0010), and `declarations` stays readable by nobody else while a draft.
 */
export const obligationDrafts = pgTable(
  'obligation_drafts',
  {
    obligationId: uuid().primaryKey(),
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    tenant: text().notNull(),
    personId: uuid().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('obligation_drafts_declaration_id_key').on(table.declarationId)],
);

export const draftsSchema = {
  declarationSections,
  declarationAttachments,
  obligationDrafts,
};
