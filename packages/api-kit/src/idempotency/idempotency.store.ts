/** Identifies one idempotent request: the client's key within one caller's namespace. */
export interface IdempotencyScope {
  key: string;
  subject: string;
}

export interface StoredResponse {
  status: number;
  /** JSON-safe body as sent to the client; null when the handler returned nothing. */
  body: unknown;
}

export type IdempotencyClaim =
  /** No live record existed; the caller now owns the key and must `complete` or `release` it. */
  | { outcome: 'claimed' }
  /** A live record exists. `response` is null while the first request is still running. */
  | { outcome: 'existing'; requestHash: string; response: StoredResponse | null };

export interface IdempotencyStoreOptions {
  /** How long a key is remembered. Default 24 hours. */
  retentionMs?: number;
  /**
   * How long an unfinished claim blocks the key. After this the claim is treated as abandoned
   * (its process died mid-request) and a retry may run. Default 60 seconds.
   */
  claimTimeoutMs?: number;
}

export const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CLAIM_TIMEOUT_MS = 60 * 1000;

/** Persistence for `@RequireIdempotencyKey()` routes. */
export abstract class IdempotencyStore {
  /** Atomically claims the key, or returns the live record that already holds it. */
  abstract claim(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyClaim>;

  /** Stores the final response of a claimed key. */
  abstract complete(scope: IdempotencyScope, response: StoredResponse): Promise<void>;

  /** Drops an unfinished claim so the request can be retried (used after 5xx outcomes). */
  abstract release(scope: IdempotencyScope): Promise<void>;

  /** Deletes records older than the retention period. Returns how many were removed. */
  abstract purgeExpired(): Promise<number>;
}
