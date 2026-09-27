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
  /**
   * No live record existed; the caller now owns the key and must `complete` or `release` it
   * with `token`.
   */
  | { outcome: 'claimed'; token: string }
  /** A live record exists. `response` is null while the first request is still running. */
  | { outcome: 'existing'; requestHash: string; response: StoredResponse | null };

export interface IdempotencyStoreOptions {
  /** How long a key is remembered. Default 24 hours. */
  retentionMs?: number;
  /**
   * How long an unfinished claim blocks the key. After this the claim is treated as abandoned
   * (its process died mid-request) and a retry may run, so it must exceed the slowest request
   * of the service's idempotent routes. Default 60 seconds.
   */
  claimTimeoutMs?: number;
}

export const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CLAIM_TIMEOUT_MS = 60 * 1000;

/** Persistence for `@RequireIdempotencyKey()` routes. */
export abstract class IdempotencyStore {
  /** Atomically claims the key, or returns the live record that already holds it. */
  abstract claim(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyClaim>;

  /**
   * Stores the final response of a claimed key. Returns false, storing nothing, when the claim
   * `token` no longer holds the key (it was taken over as abandoned, or expired).
   */
  abstract complete(
    scope: IdempotencyScope,
    token: string,
    response: StoredResponse,
  ): Promise<boolean>;

  /**
   * Drops an unfinished claim so the request can be retried (used after 5xx outcomes). Does
   * nothing when `token` no longer holds the key.
   */
  abstract release(scope: IdempotencyScope, token: string): Promise<void>;

  /** Deletes records older than the retention period. Returns how many were removed. */
  abstract purgeExpired(): Promise<number>;
}
