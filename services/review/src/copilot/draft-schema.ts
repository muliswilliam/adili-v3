import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { reviewCases } from '../cases/schema.js';

/** review.yaml `CopilotDraft.status`. */
export const COPILOT_DRAFT_STATUSES = ['pending', 'ready', 'failed'] as const;
export type CopilotDraftStatus = (typeof COPILOT_DRAFT_STATUSES)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** How long a draft can be polled; the purge deletes it after. */
export const COPILOT_DRAFT_TTL_HOURS = 24;

/**
 * A clarification draft the ai-gateway's `draft-clarification` task produces for a reviewer
 * (spec 07c S12): which job, for whom, and how it ended. Kept for a day so a slow draft can be
 * polled, then purged. It never becomes a clarification: the reviewer puts the items into the
 * composer and issues through the clarification endpoints.
 *
 * No content: the selection and the drafted text stay with the gateway's job, read when the
 * draft is polled.
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
    /** Null when the gateway refused the request: no job was created. */
    jobId: uuid(),
    status: text({ enum: COPILOT_DRAFT_STATUSES }).notNull(),
    /** The gateway's job reason, or `rejected`. */
    failureReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'review_copilot_drafts_status_check',
      sql`${table.status} in (${inList(COPILOT_DRAFT_STATUSES)})`,
    ),
    index('review_copilot_drafts_expires_at_idx').on(table.expiresAt),
  ],
);

export type CopilotDraftRow = typeof reviewCopilotDrafts.$inferSelect;

export const copilotDraftSchema = { reviewCopilotDrafts };
