import type { FieldEnvelope } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

import type { AiLabel, FeedbackInput } from '../ai-gateway/ai-gateway-client.js';
import { bytea, declarations } from '../declaration/schema.js';
import { QUESTION_THEMES } from './themes.js';

/**
 * Ask Adili's conversations (spec 11): the declarant's own, one per draft or one without a draft
 * (the dashboard), deleted with the draft (in the transaction that discards or submits it) or,
 * without one, 30 days after its last message. What was said is encrypted with the Commission's
 * key (ADR-006); clear columns hold ids, the language, the corpus citations and flags only.
 *
 * Row-level security (migration 0023): the declarant reads and writes their own through
 * `app.person`; the platform context only deletes expired conversations. No staff route reads
 * them.
 */

export const ASSISTANT_LANGUAGE_VALUES = ['en', 'sw'] as const;
export type AssistantLanguage = (typeof ASSISTANT_LANGUAGE_VALUES)[number];

export const ASSISTANT_ROLE_VALUES = ['user', 'assistant'] as const;
export type AssistantRole = (typeof ASSISTANT_ROLE_VALUES)[number];

/** A declarant's rating of an answer: the ai-gateway's `FeedbackInput.rating`, forwarded. */
export const ASSISTANT_RATING_VALUES = [
  'helpful',
  'not-helpful',
] as const satisfies readonly FeedbackInput['rating'][];
export type AssistantRating = (typeof ASSISTANT_RATING_VALUES)[number];

export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: uuid().primaryKey(),
    personId: uuid().notNull(),
    /** The draft it is about; null for the declarant's conversation outside a draft. */
    declarationId: uuid().references(() => declarations.id, { onDelete: 'cascade' }),
    /** The Commission whose key encrypts it and whose reporting officer a decline names. */
    tenant: text().notNull(),
    language: text({ enum: ASSISTANT_LANGUAGE_VALUES }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    lastMessageAt: timestamp({ withTimezone: true }),
    /** Without a draft: 30 days after the last message (or the opening); null with a draft. */
    expiresAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('assistant_conversations_declaration_key')
      .on(table.declarationId)
      .where(sql`${table.declarationId} is not null`),
    uniqueIndex('assistant_conversations_person_without_draft_key')
      .on(table.personId)
      .where(sql`${table.declarationId} is null`),
    index('assistant_conversations_expires_at_idx').on(table.expiresAt),
    check('assistant_conversations_language_check', sql`${table.language} in ('en', 'sw')`),
    check(
      'assistant_conversations_expiry_check',
      sql`(${table.declarationId} is null) = (${table.expiresAt} is not null)`,
    ),
  ],
);

/** A corpus passage or help article an answer cites, as help search shows it (`HelpPassage`). */
export interface StoredCitation {
  id: string;
  source: 'act' | 'regs' | 'am' | 'help';
  citation: string;
  title: string;
  snippet: string;
  language: AssistantLanguage;
}

/** Where in the draft an answer is about. */
export interface StoredSectionLink {
  sectionKey: string;
  fieldPath: string | null;
}

/**
 * One turn of a conversation. The ciphertext holds the text as the declarant reads it and, for a
 * decline, the reporting officer's contact; never logged or put in an event.
 */
export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: uuid().primaryKey(),
    conversationId: uuid()
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    role: text({ enum: ASSISTANT_ROLE_VALUES }).notNull(),
    ciphertext: bytea().notNull(),
    envelope: jsonb().$type<FieldEnvelope>().notNull(),
    /** The section the declarant asked from; null for an answer and outside a draft. */
    sectionKey: text(),
    citations: jsonb().$type<StoredCitation[]>().notNull().default([]),
    sectionLink: jsonb().$type<StoredSectionLink>(),
    /** The ai-gateway job the answer came from; null for a question, or a decline made here. */
    jobId: uuid(),
    declined: boolean().notNull().default(false),
    /** The ai-gateway's AiLabel of an answer from the AI; null for a question or a decline made here. */
    label: jsonb().$type<AiLabel>(),
    /** The declarant's rating of an answer (#339); null until rated. */
    rating: text({ enum: ASSISTANT_RATING_VALUES }),
    /**
     * Why, and the declarant's note, encrypted like the text (`FeedbackPlaintext`, its own AAD
     * record id); null until rated.
     */
    feedbackCiphertext: bytea(),
    feedbackEnvelope: jsonb().$type<FieldEnvelope>(),
    /** A question's theme (`themes.ts`), as counted; null for an answer. */
    theme: text({ enum: QUESTION_THEMES }),
    at: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('assistant_messages_conversation_id_at_idx').on(table.conversationId, table.at),
    check('assistant_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
    check(
      'assistant_messages_rating_check',
      sql`${table.rating} is null or ${table.rating} in ('helpful', 'not-helpful')`,
    ),
    check(
      'assistant_messages_feedback_check',
      sql`(${table.feedbackCiphertext} is null) = (${table.feedbackEnvelope} is null)`,
    ),
  ],
);

/**
 * Summary hints already written (spec 11 S5), by what they were written for: the hash of the
 * hints request (the declaration type, the household as counts and the residuals, every person
 * key replaced by its place), the language and the prompt version. One hint per residual, in
 * order, and the label they came with. No personal data and no tenant's: rule ids and field
 * paths in, plain-language guidance out, so every Commission's declarants share them; no RLS
 * (migration 0025).
 */
export const assistantHintCache = pgTable(
  'assistant_hint_cache',
  {
    residualHash: text().notNull(),
    language: text({ enum: ASSISTANT_LANGUAGE_VALUES }).notNull(),
    promptVersion: integer().notNull(),
    hints: jsonb().$type<string[]>().notNull(),
    label: jsonb().$type<AiLabel>().notNull(),
    at: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.residualHash, table.language, table.promptVersion] })],
);

/**
 * Anonymised question counts per Commission, month (Nairobi, `YYYY-MM`) and theme (spec 11 S8),
 * counted as each answer is stored: how many questions, and how many of them the corpus could
 * not answer. No text, no person, no conversation: they outlive the conversations they count.
 * Row-level security (migration 0025): the Commission reads its own; a declarant counts only at
 * the Commissions they have filing obligations with.
 */
export const assistantThemeCounts = pgTable(
  'assistant_theme_counts',
  {
    tenant: text().notNull(),
    month: text().notNull(),
    theme: text({ enum: QUESTION_THEMES }).notNull(),
    count: integer().notNull().default(0),
    unanswered: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tenant, table.month, table.theme] }),
    check('assistant_theme_counts_month_check', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'assistant_theme_counts_unanswered_check',
      sql`${table.unanswered} >= 0 and ${table.unanswered} <= ${table.count}`,
    ),
  ],
);

export const assistantSchema = {
  assistantConversations,
  assistantMessages,
  assistantHintCache,
  assistantThemeCounts,
};
