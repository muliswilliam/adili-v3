import type { FieldEnvelope } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { reviewCases } from '../cases/schema.js';
import { inList } from '../db/sql-list.js';

/**
 * review.yaml `CopilotStatus`: `pending` while the first outputs are produced, `ready` when they
 * are, `stale` while newer ones are produced (the earlier ones still shown), `failed` when a job
 * failed, `not-enabled` when the gateway's classification gate blocked the Commission.
 */
export const COPILOT_STATUSES = ['not-enabled', 'pending', 'ready', 'failed', 'stale'] as const;
export type CopilotStatus = (typeof COPILOT_STATUSES)[number];

/**
 * The copilot of a case (spec 07c): the AI-assisted summary and flag explanations the ai-gateway
 * produced for one of its versions, and the jobs producing the next ones. One row per case.
 *
 * The outputs hold declaration content, so they are stored only encrypted under the Commission's
 * key (ADR-006), each bound to the case and to what it is; they never appear in events or logs.
 *
 * Two sets of job ids: the jobs of the latest request (`requestedSummaryJobId`,
 * `requestedExplanationsJobId`, their outputs `staged*` as they arrive) and the jobs whose outputs
 * are shown (`summaryJobId`, `explanationsJobId`). They agree once every output of the request has
 * arrived; until then the shown ones are an earlier request's (`stale`).
 */
export const reviewCopilots = pgTable(
  'review_copilots',
  {
    caseId: uuid()
      .primaryKey()
      .references(() => reviewCases.id),
    tenant: text().notNull(),
    status: text({ enum: COPILOT_STATUSES }).notNull(),
    /** The version the latest request is for. */
    forVersionId: uuid().notNull(),
    /** When the registries were checked for the latest request (spec 07b); null until they are. */
    registryCheckedAt: timestamp({ withTimezone: true }),
    /** Requests so far: part of each request's idempotency keys, so a refresh asks anew. */
    attempt: integer().notNull(),
    requestedSummaryJobId: uuid(),
    /** Null when the version raised no flags: nothing to explain. */
    requestedExplanationsJobId: uuid(),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    /** Why the latest request produced nothing: the gateway's job reason, or the review service's. */
    failureReason: text(),
    /** The version the stored outputs are for, and when the last of them arrived. */
    generatedForVersionId: uuid(),
    generatedAt: timestamp({ withTimezone: true }),
    summaryJobId: uuid(),
    summaryPromptVersion: integer(),
    /** Base64 AES-256-GCM ciphertext of the `SummarizeDeclarationOutput`. */
    summaryCiphertext: text(),
    summaryEnvelope: jsonb().$type<FieldEnvelope>(),
    explanationsJobId: uuid(),
    explanationsPromptVersion: integer(),
    /** Base64 AES-256-GCM ciphertext of the `ExplainFlagsOutput`. */
    explanationsCiphertext: text(),
    explanationsEnvelope: jsonb().$type<FieldEnvelope>(),
    /**
     * The outputs of the latest request's jobs that have arrived, held until every job of the
     * request has its output: then they replace the stored ones together, so the panel never
     * mixes one version's summary with another's explanations. Cleared by the next request.
     */
    stagedSummaryPromptVersion: integer(),
    stagedSummaryCiphertext: text(),
    stagedSummaryEnvelope: jsonb().$type<FieldEnvelope>(),
    stagedExplanationsPromptVersion: integer(),
    stagedExplanationsCiphertext: text(),
    stagedExplanationsEnvelope: jsonb().$type<FieldEnvelope>(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('review_copilots_status_check', sql`${table.status} in (${inList(COPILOT_STATUSES)})`),
    // A rating names the output by its job.
    index('review_copilots_summary_job_id_idx').on(table.summaryJobId),
    index('review_copilots_explanations_job_id_idx').on(table.explanationsJobId),
  ],
);

export type CopilotRow = typeof reviewCopilots.$inferSelect;

/** review.yaml `CopilotFeedbackInput.rating`. */
export const COPILOT_RATINGS = ['helpful', 'not-helpful'] as const;
export type CopilotRating = (typeof COPILOT_RATINGS)[number];

/**
 * A reviewer's rating of a copilot output (spec 07c S13), one per reviewer per block of an output
 * (job): a summary's section, a flag's explanation, or (`block` null) the output as a whole. The
 * ai-gateway holds the rating of record, with the reason and note, and announces it for
 * reporting; the review service keeps the rating so the copilot view can show the reviewer their
 * own.
 */
export const reviewCopilotRatings = pgTable(
  'review_copilot_ratings',
  {
    /** A key of its own: `block` is null for the output as a whole, so it cannot be in one. */
    id: uuid().primaryKey(),
    jobId: uuid().notNull(),
    reviewerSubject: text().notNull(),
    /** review.yaml `CopilotBlock`; null for the output as a whole (a clarification draft). */
    block: text(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    rating: text({ enum: COPILOT_RATINGS }).notNull(),
    ratedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    unique('review_copilot_ratings_job_reviewer_block_key')
      .on(table.jobId, table.reviewerSubject, table.block)
      .nullsNotDistinct(),
    check(
      'review_copilot_ratings_rating_check',
      sql`${table.rating} in (${inList(COPILOT_RATINGS)})`,
    ),
  ],
);

export const copilotSchema = { reviewCopilots, reviewCopilotRatings };
