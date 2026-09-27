import { randomUUID } from 'node:crypto';

import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_RETENTION_MS,
  type IdempotencyClaim,
  type IdempotencyScope,
  IdempotencyStore,
  type IdempotencyStoreOptions,
  type StoredResponse,
} from './idempotency.store.js';

interface Entry {
  requestHash: string;
  token: string;
  response: StoredResponse | null;
  createdAt: number;
}

export interface InMemoryIdempotencyStoreOptions extends IdempotencyStoreOptions {
  /** Clock in epoch milliseconds; tests pass their own to exercise expiry. */
  now?: () => number;
}

/**
 * Process-local store for tests that run without a database.
 * Same semantics as `PostgresIdempotencyStore`.
 */
export class InMemoryIdempotencyStore extends IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly retentionMs: number;
  private readonly claimTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: InMemoryIdempotencyStoreOptions = {}) {
    super();
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.claimTimeoutMs = options.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  claim(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyClaim> {
    const id = entryId(scope);
    const existing = this.entries.get(id);
    if (existing && this.isLive(existing)) {
      return Promise.resolve({
        outcome: 'existing',
        requestHash: existing.requestHash,
        response: existing.response,
      });
    }
    const token = randomUUID();
    this.entries.set(id, { requestHash, token, response: null, createdAt: this.now() });
    return Promise.resolve({ outcome: 'claimed', token });
  }

  complete(scope: IdempotencyScope, token: string, response: StoredResponse): Promise<boolean> {
    const entry = this.heldBy(scope, token);
    if (entry) entry.response = response;
    return Promise.resolve(entry !== undefined);
  }

  release(scope: IdempotencyScope, token: string): Promise<void> {
    if (this.heldBy(scope, token)) this.entries.delete(entryId(scope));
    return Promise.resolve();
  }

  purgeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (this.now() - entry.createdAt > this.retentionMs) {
        this.entries.delete(id);
        removed++;
      }
    }
    return Promise.resolve(removed);
  }

  private heldBy(scope: IdempotencyScope, token: string): Entry | undefined {
    const entry = this.entries.get(entryId(scope));
    return entry?.token === token && entry.response === null ? entry : undefined;
  }

  private isLive(entry: Entry): boolean {
    const age = this.now() - entry.createdAt;
    return age <= this.retentionMs && (entry.response !== null || age <= this.claimTimeoutMs);
  }
}

function entryId(scope: IdempotencyScope): string {
  return JSON.stringify([scope.key, scope.subject]);
}
