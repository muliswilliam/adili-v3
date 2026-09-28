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

import {
  CACHEABLE_STATUSES,
  JOB_REASONS,
  JOB_STATUSES,
  LIVE_STATUSES,
} from '../jobs/job-states.js';
import { DATA_CLASSES } from '../jobs/task-request.js';
import { TASK_NAMES } from '../tasks/task.js';

/**
 * The result cache key, in index order. The spec keys the cache by (task, prompt version,
 * provider, model, input hash); tenant, caller, data class and subject are added so a cached
 * job never crosses a tenant or caller (it is readable by its caller only), a job admitted for
 * one data class is not served for another, and its events name the caller's own subject.
 */
export const CACHE_KEY = [
  'tenant',
  'caller',
  'subjectRef',
  'dataClass',
  'task',
  'promptVersion',
  'provider',
  'model',
  'inputHash',
] as const;

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
    // The result cache: at most one live or succeeded job per key. Failed and blocked jobs drop
    // out, so a repeat call tries again.
    uniqueIndex('jobs_cache_idx')
      .on(table[CACHE_KEY[0]], ...CACHE_KEY.slice(1).map((column) => table[column]))
      .where(
        sql`${table.status} in (${sql.raw(CACHEABLE_STATUSES.map((status) => `'${status}'`).join(', '))}) and ${table.outputPurgedAt} is null`,
      ),
    // The janitor's scans: live jobs past the grace period, and outputs past retention.
    index('jobs_live_idx')
      .on(table.id)
      .where(
        sql`${table.status} in (${sql.raw(LIVE_STATUSES.map((status) => `'${status}'`).join(', '))})`,
      ),
    index('jobs_output_retention_idx')
      .on(table.finishedAt)
      .where(sql`${table.output} is not null`),
  ],
);

export type Job = typeof jobs.$inferSelect;

/** Drizzle schema of the ai-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  jobs,
};

export * from '@adili/events/schema';
