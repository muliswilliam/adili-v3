import { eventsSchema } from '@adili/events/schema';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import {
  bigint,
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

import {
  CACHEABLE_STATUSES,
  JOB_REASONS,
  JOB_STATUSES,
  type JobStatus,
  LIVE_STATUSES,
} from '../jobs/job-states.js';
import { DATA_CLASSES } from '../jobs/task-request.js';
import { PROVIDER_CLASSES } from '../providers/port.js';
import { TASK_NAMES } from '../tasks/task.js';

/** `status in ('a', 'b')` for a partial index predicate; the values are constants, not input. */
export function statusIn(column: AnyColumn, statuses: readonly JobStatus[]): SQL {
  return sql`${column} in (${sql.raw(statuses.map((status) => `'${status}'`).join(', '))})`;
}

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
    /** The route's call parameters (`RouteParams`), fixed with provider and model at creation. */
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
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
        sql`${statusIn(table.status, CACHEABLE_STATUSES)} and ${table.outputPurgedAt} is null`,
      ),
    // The janitor's scans: live jobs past the grace period, and outputs past retention.
    index('jobs_live_idx').on(table.id).where(statusIn(table.status, LIVE_STATUSES)),
    index('jobs_output_retention_idx')
      .on(table.finishedAt)
      .where(sql`${table.output} is not null`),
    // Budgets and rate limits: a tenant's jobs this month, and in the last minute.
    index('jobs_tenant_created_at_idx').on(table.tenant, table.createdAt),
  ],
);

export type Job = typeof jobs.$inferSelect;

/**
 * The classification gate's per-tenant rules (spec 07c): whether a provider class may see a data
 * class. A pair without a row follows the default policy (see `defaultGateAdmits`). Every change
 * names who made it and the approval it rests on, and is audited.
 */
export const gatePolicies = pgTable(
  'gate_policies',
  {
    tenant: text().notNull(),
    dataClass: text({ enum: DATA_CLASSES }).notNull(),
    providerClass: text({ enum: PROVIDER_CLASSES }).notNull(),
    allowed: boolean().notNull(),
    /** The decision this rests on, e.g. a Commission resolution or an EACC approval number. */
    approvalRef: text().notNull(),
    /** `sub` of the platform admin who made the change. */
    changedBy: text().notNull(),
    /** Their display name at the time, for the policy page; null when the token had none. */
    changedByName: text(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenant, table.dataClass, table.providerClass] })],
);

export type GatePolicy = typeof gatePolicies.$inferSelect;

/**
 * The routing table (spec 07c): task to provider, model and call parameters, for one tenant or,
 * with a null tenant, for every tenant without its own row. A task without a row uses the
 * configured provider and model. Each environment has its own database, so its own table.
 */
export const routes = pgTable(
  'routing',
  {
    id: uuid().primaryKey(),
    tenant: text(),
    task: text({ enum: TASK_NAMES }).notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    changedBy: text().notNull(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('routing_tenant_task_idx')
      .on(table.tenant, table.task)
      .where(sql`${table.tenant} is not null`),
    uniqueIndex('routing_default_task_idx')
      .on(table.task)
      .where(sql`${table.tenant} is null`),
  ],
);

export type RouteRow = typeof routes.$inferSelect;

/** A tenant's token budget and rate limit; a tenant without a row has the configured defaults. */
export const budgets = pgTable('budgets', {
  tenant: text().primaryKey(),
  /** Tokens (in and out) the tenant's jobs may use per calendar month, Africa/Nairobi. */
  monthlyTokens: bigint({ mode: 'number' }).notNull(),
  /** Jobs the tenant may create per minute. */
  perMinute: integer().notNull(),
  changedBy: text().notNull(),
  changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const FEEDBACK_RATINGS = ['helpful', 'not-helpful'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
export const FEEDBACK_REASONS = [
  'inaccurate',
  'missed-something',
  'unclear',
  'too-long',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/**
 * Reviewers' ratings of job outputs (spec 07c): one per reviewer per job, a later rating by the
 * same reviewer replacing the earlier one. The note is the reviewer's own words and stays here;
 * events carry the rating and reason only.
 */
export const feedback = pgTable(
  'feedback',
  {
    /** Stable across updates: events name the rating by it, so counts can take the latest. */
    id: uuid().notNull().unique(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    /** The officer, as the calling service knows them (its token's `sub`). */
    reviewerSubject: text().notNull(),
    rating: text({ enum: FEEDBACK_RATINGS }).notNull(),
    reason: text({ enum: FEEDBACK_REASONS }),
    note: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.reviewerSubject] }),
    check('feedback_rating_check', sql`${table.rating} in ('helpful', 'not-helpful')`),
    check(
      'feedback_reason_check',
      sql`${table.reason} is null or ${table.reason} in ('inaccurate', 'missed-something', 'unclear', 'too-long', 'other')`,
    ),
    check('feedback_note_length', sql`char_length(${table.note}) <= 1000`),
  ],
);

export type FeedbackRow = typeof feedback.$inferSelect;

export const AUDIT_ACTIONS = [
  'ai.job.finished',
  'ai.gate-policy.changed',
  'ai.budget.changed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Append-only audit records (ADR-008, spec 07c): one per finished job, and one per policy or
 * budget change. Hashes, counts and decisions only: never the input, the output, a prompt or
 * the minimisation token map.
 */
export const auditRecords = pgTable(
  'audit_records',
  {
    id: uuid().primaryKey(),
    action: text({ enum: AUDIT_ACTIONS }).notNull(),
    tenant: text().notNull(),
    /** The calling service for a job; the administrator for a change. */
    actor: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // A finished job (`ai.job.finished`).
    jobId: uuid(),
    subjectRef: text(),
    task: text({ enum: TASK_NAMES }),
    promptVersion: integer(),
    dataClass: text({ enum: DATA_CLASSES }),
    provider: text(),
    model: text(),
    inputHash: text(),
    outputHash: text(),
    tokensIn: integer(),
    tokensOut: integer(),
    costMicros: integer(),
    latencyMs: integer(),
    outcome: text({ enum: JOB_STATUSES }),
    reason: text({ enum: JOB_REASONS }),
    // A change (`ai.gate-policy.changed`, `ai.budget.changed`).
    approvalRef: text(),
    /** What changed: the values before and after. */
    change: jsonb().$type<{ before: unknown; after: unknown }>(),
  },
  (table) => [
    uniqueIndex('audit_records_job_id_idx')
      .on(table.jobId)
      .where(sql`${table.jobId} is not null`),
    index('audit_records_tenant_occurred_at_idx').on(table.tenant, table.occurredAt),
  ],
);

export type AuditRecord = typeof auditRecords.$inferSelect;

/** Drizzle schema of the ai-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  jobs,
  gatePolicies,
  routes,
  budgets,
  auditRecords,
  feedback,
};

export * from '@adili/events/schema';
