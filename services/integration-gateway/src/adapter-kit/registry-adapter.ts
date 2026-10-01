import type { Principal } from '@adili/api-kit';
import type { z } from 'zod';

import type { LegalBasis, System, UnavailableReason } from '../db/schema.js';

/**
 * One way of asking one registry, e.g. IPRS's person by national ID. The adapter only talks to
 * the registry; the kit (`RegistryLookups`) adds the cache, pause flag, rate limit, timeout,
 * circuit breaker and the verification-results row around it.
 */
export interface RegistryAdapter<T> {
  readonly system: System;
  /** Names the kind of answer in cache keys (`<system>:<operation>:<subject hash>`). */
  readonly operation: string;
  /** The normalised answer. A cache entry that does not parse (an older shape) is a miss. */
  readonly schema: z.ZodType<T>;
  /**
   * Asks the registry about `subject` (e.g. a national ID). Resolves to the normalised answer,
   * or null when the registry has no record; anything else (network, 5xx, a body that breaks
   * the contract) rejects with an `UpstreamError`. Stops when `signal` aborts: the kit's timeout.
   */
  fetch(subject: string, signal: AbortSignal): Promise<T | null>;
}

/** Why a lookup is made and for what, as the calling service declares it. */
export interface LookupPurpose {
  legalBasis: LegalBasis;
  /** The review case (or other record) the lookup is for; null when there is none. */
  caseRef: string | null;
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
