import type { FieldEnvelope } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { LETTER_LANGUAGES, reviewCases } from '../cases/schema.js';
import { inList } from '../db/sql-list.js';

/** review.yaml `CopilotDraft.status`. */
export const COPILOT_DRAFT_STATUSES = ['pending', 'ready', 'failed'] as const;
export type CopilotDraftStatus = (typeof COPILOT_DRAFT_STATUSES)[number];

/** How long a draft can be polled; the purge deletes it after. */
export const COPILOT_DRAFT_TTL_HOURS = 24;

/**
 * A clarification draft the ai-gateway's `draft-clarification` task produces for a reviewer
 * (spec 07c S12): which job, for whom, how it ended and, once ready, the drafted text. The text is
 * kept for a day, then purged; the rest stays as the record of which job drafted what. It never becomes a clarification: the reviewer puts the items into the
 * composer and issues through the clarification endpoints.
 *
 * The drafted text holds declaration content, so it is stored only encrypted under the
 * Commission's key (ADR-006), bound to the draft and its job, and copied from the gateway's job
 * once it is ready: the draft is served from here for its whole day, whatever the gateway keeps.
 */
export const reviewCopilotDrafts = pgTable(
  'review_copilot_drafts',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    /** The assignee who asked; only they can poll it. */
    requestedBy: text().notNull(),
    /**
     * SHA-256 of the selection asked for: a retry with the draft's Idempotency-Key and another
     * selection is refused (`idempotency-key-reused`), as no answer is stored for replay.
     */
    selectionHash: text().notNull(),
    /**
     * The language the draft was asked in (review.yaml `LetterLanguage`): a clarification's items
     * and opening from its job record it, so a letter that changed language since can say so.
     */
    language: text({ enum: LETTER_LANGUAGES }).notNull().default('en'),
    /** Null when the gateway refused the request: no job was created. */
    jobId: uuid(),
    status: text({ enum: COPILOT_DRAFT_STATUSES }).notNull(),
    /** The gateway's job reason, or `rejected`. */
    failureReason: text(),
    /** Base64 AES-256-GCM ciphertext of the draft (`DraftContent`); set once ready, until purged. */
    ciphertext: text(),
    envelope: jsonb().$type<FieldEnvelope>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * When the purge removed the drafted text, past `expiresAt`. The row stays: which job drafted
     * text on the case, for whom, names the AI-drafted items of clarifications (ADR-007).
     */
    purgedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check(
      'review_copilot_drafts_status_check',
      sql`${table.status} in (${inList(COPILOT_DRAFT_STATUSES)})`,
    ),
    check(
      'review_copilot_drafts_language_check',
      sql`${table.language} in (${inList(LETTER_LANGUAGES)})`,
    ),
    check(
      'review_copilot_drafts_content_check',
      sql`(${table.status} = 'ready' and ${table.purgedAt} is null) = (${table.ciphertext} is not null and ${table.envelope} is not null)`,
    ),
    index('review_copilot_drafts_expires_at_idx').on(table.expiresAt),
  ],
);

export type CopilotDraftRow = typeof reviewCopilotDrafts.$inferSelect;

export const copilotDraftSchema = { reviewCopilotDrafts };
