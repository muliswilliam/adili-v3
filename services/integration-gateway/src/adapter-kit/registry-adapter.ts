import type { Principal } from '@adili/api-kit';
import type { z } from 'zod';

import type { LegalBasis, System, UnavailableReason } from '../db/schema.js';

/**
 * One way of asking one registry, e.g. IPRS's person by national ID. The adapter only talks to
 * the registry; the kit (`RegistryLookups`) adds the cache, pause flag, rate limit, timeout,
 * circuit breaker and the verification-results row around it.
 */
export interface RegistryAdapter<T, S = string> {
  readonly system: System;
  /** Names the kind of answer in cache keys (`<system>:<operation>:<subject hash>`). */
  readonly operation: string;
  /** The normalised answer. A cache entry that does not parse (an older shape) is a miss. */
  readonly schema: z.ZodType<T>;
  /**
   * Asks the registry about `subject` (e.g. a national ID). Resolves to the normalised answer,
   * or null when the registry has no record; anything else (network, 5xx, a body that breaks
   * the contract) rejects with an `UpstreamError`. Stops when `signal` aborts: the kit's timeout.
   * The kit took the rate-limit slot of one call; an adapter that calls the registry more than
   * once takes one for each further call from `calls` first.
   */
  fetch(subject: S, signal: AbortSignal, calls: UpstreamCalls): Promise<T | null>;
}

/** The rate limit of an adapter's further calls to its registry, within one lookup. */
export interface UpstreamCalls {
  /**
   * Waits for the system's rate-limit slot for one more call. Rejects with
   * `RateLimitExhausted` when none frees up within the max wait (the lookup is `rate-limited`).
   */
  another(): Promise<void>;
}

/**
 * An adapter whose subject is more than one identifier (the supplier check's employer and
 * company): it says how the subject reads as one string, which the kit hashes for the cache key
 * and the verification-results row.
 */
export interface KeyedRegistryAdapter<T, S> extends RegistryAdapter<T, S> {
  subjectKey(subject: S): string;
}

/** What the answer cache needs of an adapter. */
export type CachedAdapter<T> = Pick<RegistryAdapter<T, unknown>, 'system' | 'operation' | 'schema'>;

/** Why a lookup is made and for what, as the calling service declares it. */
export interface LookupPurpose {
  legalBasis: LegalBasis;
  /** The review case (or other record) the lookup is for; null when there is none. */
  caseRef: string | null;
  /**
   * The platform person the lookup is about (the declarant of the case), so a later read of the
   * stored result is audited as a read of their data (ADR-008); null when there is none yet.
   */
  subjectPersonId: string | null;
}

export interface LookupContext {
  caller: Principal;
  purpose: LookupPurpose;
  /**
   * Tenant the lookup acts for, whose key encrypts the answer kept on the verification-results
   * row. Null for lookups for no tenant (IPRS at onboarding): nothing of the answer is kept.
   */
  tenant: string | null;
}

/**
 * The uniform outcome of every lookup: the registry's answer (fresh or cached), that it has no
 * record, or why there is no answer. `resultId` names the verification-results row, or is null
 * when the row could not be written (the lookup still answers).
 */
export type LookupResult<T> = { resultId: string | null; checkedAt: Date } & (
  | { outcome: 'found'; data: T; cached: boolean }
  | { outcome: 'not-found'; cached: boolean }
  | { outcome: 'unavailable'; reason: UnavailableReason }
);
