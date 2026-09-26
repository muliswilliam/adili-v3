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
    this.entries.set(id, { requestHash, response: null, createdAt: this.now() });
    return Promise.resolve({ outcome: 'claimed' });
  }

  complete(scope: IdempotencyScope, response: StoredResponse): Promise<void> {
    const entry = this.entries.get(entryId(scope));
    if (entry) entry.response = response;
    return Promise.resolve();
  }

  release(scope: IdempotencyScope): Promise<void> {
    const id = entryId(scope);
    if (this.entries.get(id)?.response === null) this.entries.delete(id);
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

  private isLive(entry: Entry): boolean {
    const age = this.now() - entry.createdAt;
    return age <= this.retentionMs && (entry.response !== null || age <= this.claimTimeoutMs);
  }
}

function entryId(scope: IdempotencyScope): string {
  return JSON.stringify([scope.key, scope.subject]);
}
