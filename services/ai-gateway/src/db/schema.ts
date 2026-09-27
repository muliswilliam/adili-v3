import { eventsSchema } from '@adili/events/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { DATA_CLASSES, JOB_REASONS, JOB_STATUSES } from '../jobs/job-states.js';
import { TASK_NAMES } from '../tasks/task.js';

/**
 * One row per task job (spec 07c). Holds hashes, counts and the validated output, never the
 * provider request: the input lives here only while the job runs and is cleared when it ends,
 * and the output is purged after the retention window, since the calling service stores what
 * it shows.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    task: text({ enum: TASK_NAMES }).notNull(),
    promptVersion: integer().notNull(),
    dataClass: text({ enum: DATA_CLASSES }).notNull(),
    /** Owning record in the calling service, e.g. `review-case:<uuid>`. */
    subjectRef: text().notNull(),
    /** OAuth client of the calling service (`azp`, else `sub`); only it can read the job. */
    caller: text().notNull(),
    idempotencyKey: text().notNull(),
    /** SHA-256 of what the caller asked for, to tell a retry from a reused key. */
    requestHash: text().notNull(),
    /** SHA-256 of the canonical task input. */
    inputHash: text().notNull(),
    /** The task input while the job runs; null once it has ended. */
    input: jsonb(),
    status: text({ enum: JOB_STATUSES }).notNull(),
    reason: text({ enum: JOB_REASONS }),
    /** Decided by the routing table when the job is created. */
    provider: text().notNull(),
    model: text().notNull(),
    output: jsonb(),
    outputHash: text(),
    /** Set when the retention window cleared `output`; the job then no longer serves the cache. */
    outputPurgedAt: timestamp({ withTimezone: true }),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    costMicros: integer().notNull().default(0),
    latencyMs: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check(
      'jobs_reason_matches_status',
      sql`(${table.status} in ('failed', 'blocked')) = (${table.reason} is not null)`,
    ),
    // A retry with the same key finds the first job.
    uniqueIndex('jobs_caller_idempotency_key_idx').on(table.caller, table.idempotencyKey),
    // The result cache: at most one live or reusable job per request content, prompt version and
    // route. The spec keys it by (task, prompt version, provider, model, input hash); tenant,
    // caller, data class and subject are added so a cached job never crosses a tenant or caller
    // (it is readable by its caller only) and a job admitted for one data class is not served
    // for another. Failed and blocked jobs drop out, so a repeat call tries again.
    uniqueIndex('jobs_cache_idx')
      .on(
        table.tenant,
        table.caller,
        table.subjectRef,
        table.dataClass,
        table.task,
        table.promptVersion,
        table.provider,
        table.model,
        table.inputHash,
      )
      .where(
        sql`${table.status} in ('queued', 'running', 'succeeded') and ${table.outputPurgedAt} is null`,
      ),
    // The janitor's scans: jobs left queued, and outputs past retention.
    index('jobs_queued_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'queued'`),
    index('jobs_output_retention_idx')
      .on(table.finishedAt)
      .where(sql`${table.output} is not null`),
  ],
);

/** Drizzle schema of the ai-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  jobs,
};

export * from '@adili/events/schema';
