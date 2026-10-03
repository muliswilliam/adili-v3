import type { DeclarationSectionKey, PersonKey } from '@adili/forms';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, declarations } from '../declaration/schema.js';
import type { StoredEnvelope } from '../drafts/schema.js';

/**
 * Pre-fill suggestions (spec 05b): what KRA, NTSA, BRS and ArdhiSasa hold about a person of the
 * declaration, and what a document the declarant attached reads as, offered to the declarant item
 * by item. They live with the draft and go with
 * it: every row cascades from its declaration, and discarding or submitting the draft, or
 * discarding an amendment, deletes them (S7, `expiry.ts`).
 *
 * Personal data: a suggestion's proposed fields, the registry's identifiers and the match keys
 * are one envelope-encrypted blob per suggestion (ADR-006, the Commission's key), and the reason
 * a declarant gives for dismissing one is another. Clear columns hold identifiers, statuses and
 * keys the routes filter by, nothing a registry or the declarant said.
 *
 * Row-level security (migration 0021): the declarant's own, through their declaration, like the
 * draft's sections; nobody else reads them.
 */

export const SUGGESTION_SOURCES = ['kra', 'ntsa', 'brs', 'ardhisasa', 'document'] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export const SUGGESTION_SET_STATUSES = [
  'pending',
  'ready',
  'unavailable',
  'no-id',
  'not-enabled',
  'failed',
] as const;
export type SuggestionSetStatus = (typeof SUGGESTION_SET_STATUSES)[number];

/** What the declarant says a document is (`extractAttachment`), as the ai-gateway takes it. */
export const DOCUMENT_KINDS = [
  'title-deed',
  'logbook',
  'payslip',
  'bank-letter',
  'share-certificate',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Why a document's set is `failed`, for the declarant: the link to the file ran out or the store
 * did not answer (`document-unavailable`, try again), the file cannot be read (`document-unreadable`:
 * damaged, too long, or a type the reading does not take), nothing usable came back
 * (`not-read`: the reading did not fit the item, or the model declined), or the reading service
 * could not do it now (`unavailable`).
 */
export const EXTRACTION_FAILURES = [
  'document-unavailable',
  'document-unreadable',
  'not-read',
  'unavailable',
] as const;
export type ExtractionFailure = (typeof EXTRACTION_FAILURES)[number];

/** The item lists of a statement, as a document's reading targets them. */
export const STATEMENT_LISTS = ['assets', 'income', 'liabilities'] as const;
export type StatementList = (typeof STATEMENT_LISTS)[number];

export const SUGGESTION_STATUSES = ['new', 'accepted', 'dismissed', 'superseded'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/**
 * The declarant's request to check registries for a person (Data Protection Act s.30(1)(a)): who
 * asked, when, under which consent text, for which registries. One per lookup request; its sets
 * point at it. Identifiers only. The draft's working copy, deleted with its suggestions; the
 * record that lasts is `declaration.lookup-requested.v1` in the audit trail (`expiry.ts`).
 */
export const suggestionConsents = pgTable(
  'suggestion_consents',
  {
    id: uuid().primaryKey(),
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    personKey: text().$type<PersonKey>().notNull(),
    /** Token subject (`sub`) of the declarant who ticked "I request this check". */
    consentedBy: text().notNull(),
    consentedAt: timestamp({ withTimezone: true }).notNull(),
    /** The version of the consent text the declarant was shown. */
    textVersion: text().notNull(),
    systems: text().array().notNull(),
  },
  (table) => [index('suggestion_consents_declaration_id_idx').on(table.declarationId)],
);

/**
 * One registry's answer about one person, for one request: `pending` until the lookup workflow
 * records it. A later request for the same person and registry makes a new set; the earlier
 * set's `new` suggestions are superseded once it is answered.
 */
export const suggestionSets = pgTable(
  'suggestion_sets',
  {
    id: uuid().primaryKey(),
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    personKey: text().$type<PersonKey>().notNull(),
    source: text({ enum: SUGGESTION_SOURCES }).notNull(),
    status: text({ enum: SUGGESTION_SET_STATUSES }).notNull().default('pending'),
    /** The declarant's request it answers; null for a document's set (extraction, spec 05b). */
    consentId: uuid().references(() => suggestionConsents.id, { onDelete: 'cascade' }),
    /** The gateway's verification result, once the registry answered. */
    verificationResultId: uuid(),
    /** The ai-gateway's `extract-document` job, for a document's set. */
    aiJobId: uuid(),
    /**
     * A document's set: the attachment read (`declaration_attachments.id`, no foreign key: the
     * reading outlives an unlink), what the declarant said it is, and the declaration.v1
     * statement item it is read into: its list and type. Null for a registry's set.
     */
    attachmentId: uuid(),
    documentKind: text({ enum: DOCUMENT_KINDS }),
    targetSection: text({ enum: STATEMENT_LISTS }),
    targetItemType: text(),
    /** Why a document's set is `failed`; null otherwise. */
    reason: text({ enum: EXTRACTION_FAILURES }),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    /** When it became `ready`; null otherwise. */
    readyAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('suggestion_sets_declaration_id_idx').on(table.declarationId),
    index('suggestion_sets_ai_job_id_idx').on(table.aiJobId),
    // One reading of an attachment as a kind into an item type under way at a time (idempotent
    // per attachment, kind and item type, as the request finds it).
    uniqueIndex('suggestion_sets_pending_reading_key')
      .on(table.attachmentId, table.documentKind, table.targetSection, table.targetItemType)
      .where(sql`${table.status} = 'pending' and ${table.source} = 'document'`),
    check(
      'suggestion_sets_source_check',
      sql`${table.source} in ('kra', 'ntsa', 'brs', 'ardhisasa', 'document')`,
    ),
    check(
      'suggestion_sets_status_check',
      sql`${table.status} in ('pending', 'ready', 'unavailable', 'no-id', 'not-enabled', 'failed')`,
    ),
    check(
      'suggestion_sets_document_check',
      sql`(${table.source} = 'document') = (${table.attachmentId} is not null and ${table.documentKind} is not null and ${table.targetSection} is not null and ${table.targetItemType} is not null)`,
    ),
  ],
);

/**
 * One proposed item (or bio fields) from a set. `ciphertext` holds `SuggestionContents`; the clear
 * columns say where it lands, whether it matches an item already declared, and what the
 * declarant did with it (accept and dismiss, spec 05b S4-S5).
 */
export const suggestions = pgTable(
  'suggestions',
  {
    id: uuid().primaryKey(),
    setId: uuid()
      .notNull()
      .references(() => suggestionSets.id, { onDelete: 'cascade' }),
    /** Denormalised from the set for row-level security and the declaration's lists. */
    declarationId: uuid()
      .notNull()
      .references(() => declarations.id, { onDelete: 'cascade' }),
    personKey: text().$type<PersonKey>().notNull(),
    sectionKey: text().$type<DeclarationSectionKey>().notNull(),
    itemType: text().notNull(),
    ciphertext: bytea().notNull(),
    envelope: jsonb().$type<StoredEnvelope>().notNull(),
    /** Documents only (extraction): the reading's overall confidence. */
    confidence: real(),
    /** The item already in the section whose identifier coincides, when there is one. */
    matchItemId: uuid(),
    status: text({ enum: SUGGESTION_STATUSES }).notNull().default('new'),
    /**
     * Why the declarant dismissed it, when they said: their own words, sealed like the contents
     * (`SuggestionCipher.sealReason`); both null otherwise.
     */
    reasonCiphertext: bytea(),
    reasonEnvelope: jsonb().$type<StoredEnvelope>(),
    acceptedItemId: uuid(),
    /** Copied from the set: an accepted item's `source` names it even after a re-check. */
    verificationResultId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('suggestions_set_id_idx').on(table.setId),
    index('suggestions_declaration_id_idx').on(table.declarationId),
    check(
      'suggestions_status_check',
      sql`${table.status} in ('new', 'accepted', 'dismissed', 'superseded')`,
    ),
  ],
);

export const suggestionsSchema = { suggestionConsents, suggestionSets, suggestions };
