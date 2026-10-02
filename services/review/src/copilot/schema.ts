import type { FieldEnvelope } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { reviewCases } from '../cases/schema.js';

/**
 * review.yaml `CopilotStatus`: `pending` while the first outputs are produced, `ready` when they
 * are, `stale` while newer ones are produced (the earlier ones still shown), `failed` when a job
 * failed, `not-enabled` when the gateway's classification gate blocked the Commission.
 */
export const COPILOT_STATUSES = ['not-enabled', 'pending', 'ready', 'failed', 'stale'] as const;
export type CopilotStatus = (typeof COPILOT_STATUSES)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * The copilot of a case (spec 07c): the AI-assisted summary and flag explanations the ai-gateway
 * produced for one of its versions, and the jobs producing the next ones. One row per case.
 *
 * The outputs hold declaration content, so they are stored only encrypted under the Commission's
 * key (ADR-006), each bound to the case and to what it is; they never appear in events or logs.
 *
 * Two sets of job ids: the jobs of the latest request (`summarizeJobId`, `explainJobId`) and the
 * jobs whose outputs are stored (`summaryJobId`, `explanationsJobId`). They agree once the
 * request's outputs have arrived; until then the stored ones are an earlier version's (`stale`).
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
    summarizeJobId: uuid(),
    /** Null when the version raised no flags: nothing to explain. */
    explainJobId: uuid(),
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
 * An officer's rating of a copilot output (spec 07c S13), one per officer per output (job). The
 * ai-gateway holds the rating of record, with the reason and note, and announces it for
 * reporting; the review service keeps the rating so the copilot view can show the officer their
 * own.
 */
export const reviewCopilotRatings = pgTable(
  'review_copilot_ratings',
  {
    jobId: uuid().notNull(),
    reviewerSubject: text().notNull(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    rating: text({ enum: COPILOT_RATINGS }).notNull(),
    ratedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.reviewerSubject] }),
    check(
      'review_copilot_ratings_rating_check',
      sql`${table.rating} in (${inList(COPILOT_RATINGS)})`,
    ),
  ],
);

export const copilotSchema = { reviewCopilots, reviewCopilotRatings };
