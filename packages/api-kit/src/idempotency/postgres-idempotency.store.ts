import { randomUUID } from 'node:crypto';

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
      const token = randomUUID();
      // Inserts a fresh claim, or takes over a row that expired or was abandoned mid-request.
      const claimed = await this.db
        .insert(table)
        .values({ key: scope.key, principalSubject: scope.subject, requestHash, claimToken: token })
        .onConflictDoUpdate({
          target: [table.key, table.principalSubject],
          set: {
            requestHash,
            responseStatus: null,
            responseBody: null,
            claimToken: token,
            createdAt: sql`now()`,
          },
          setWhere: sql`${table.createdAt} < ${olderThan(this.retentionMs)} or (${table.responseStatus} is null and ${table.createdAt} < ${olderThan(this.claimTimeoutMs)})`,
        })
        .returning({ key: table.key });
      if (claimed.length > 0) {
        return { outcome: 'claimed', token };
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

  async complete(
    scope: IdempotencyScope,
    token: string,
    response: StoredResponse,
  ): Promise<boolean> {
    const completed = await this.db
      .update(table)
      .set({ responseStatus: response.status, responseBody: response.body })
      .where(heldBy(scope, token))
      .returning({ key: table.key });
    return completed.length > 0;
  }

  async release(scope: IdempotencyScope, token: string): Promise<void> {
    await this.db.delete(table).where(heldBy(scope, token));
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

/** The unfinished claim of `scope` made with `token`. */
function heldBy(scope: IdempotencyScope, token: string) {
  return and(matches(scope), eq(table.claimToken, token), isNull(table.responseStatus));
}

/** Cutoff on the database clock, so replicas with skewed clocks agree on expiry. */
function olderThan(ms: number) {
  return sql`now() - make_interval(secs => ${ms / 1000})`;
}
