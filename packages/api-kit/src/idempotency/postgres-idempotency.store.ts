import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_RETENTION_MS,
  type IdempotencyClaim,
  type IdempotencyScope,
  IdempotencyStore,
  type IdempotencyStoreOptions,
  type StoredResponse,
} from './idempotency.store.js';
import { idempotencyKeys as table } from './schema.js';

/** Any Drizzle Postgres database whose schema includes `idempotencySchema`. */
export type IdempotencyDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'insert' | 'select' | 'update' | 'delete'
>;

/** A claim can lose a race with a concurrent release; retry a few times before giving up. */
const MAX_CLAIM_ATTEMPTS = 3;

/** Stores idempotency records in the service's own database (`idempotency_keys`). */
export class PostgresIdempotencyStore extends IdempotencyStore {
  private readonly retentionMs: number;
  private readonly claimTimeoutMs: number;

  constructor(
    private readonly db: IdempotencyDatabase,
    options: IdempotencyStoreOptions = {},
  ) {
    super();
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.claimTimeoutMs = options.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS;
  }

  async claim(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyClaim> {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
      // Inserts a fresh claim, or takes over a row that expired or was abandoned mid-request.
      const claimed = await this.db
        .insert(table)
        .values({ key: scope.key, principalSubject: scope.subject, requestHash })
        .onConflictDoUpdate({
          target: [table.key, table.principalSubject],
          set: {
            requestHash,
            responseStatus: null,
            responseBody: null,
            createdAt: sql`now()`,
          },
          setWhere: sql`${table.createdAt} < ${olderThan(this.retentionMs)} or (${table.responseStatus} is null and ${table.createdAt} < ${olderThan(this.claimTimeoutMs)})`,
        })
        .returning({ key: table.key });
      if (claimed.length > 0) {
        return { outcome: 'claimed' };
      }

      const [existing] = await this.db
        .select({
          requestHash: table.requestHash,
          responseStatus: table.responseStatus,
          responseBody: table.responseBody,
        })
        .from(table)
        .where(matches(scope));
      if (existing) {
        return {
          outcome: 'existing',
          requestHash: existing.requestHash,
          response:
            existing.responseStatus === null
              ? null
              : { status: existing.responseStatus, body: existing.responseBody },
        };
      }
      // Released between the insert and the select: claim again.
    }
    throw new Error('Could not claim idempotency key under contention');
  }

  async complete(scope: IdempotencyScope, response: StoredResponse): Promise<void> {
    await this.db
      .update(table)
      .set({ responseStatus: response.status, responseBody: response.body })
      .where(matches(scope));
  }

  async release(scope: IdempotencyScope): Promise<void> {
    await this.db.delete(table).where(and(matches(scope), isNull(table.responseStatus)));
  }

  async purgeExpired(): Promise<number> {
    const removed = await this.db
      .delete(table)
      .where(lt(table.createdAt, olderThan(this.retentionMs)))
      .returning({ key: table.key });
    return removed.length;
  }
}

function matches(scope: IdempotencyScope) {
  return and(eq(table.key, scope.key), eq(table.principalSubject, scope.subject));
}

/** Cutoff on the database clock, so replicas with skewed clocks agree on expiry. */
function olderThan(ms: number) {
  return sql`now() - make_interval(secs => ${ms / 1000})`;
}
