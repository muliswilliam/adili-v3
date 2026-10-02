/**
 * What passes between the registry lookup workflow, its activities and the service that starts
 * it (spec 05b). Identifiers only: the national ID is resolved inside the activity and never
 * enters workflow history, nor do the registry's records.
 */
import type { PersonKey } from '@adili/forms';

import type { RegistrySystem } from '../registry-results.js';

export const REGISTRY_LOOKUPS_WORKFLOW = 'registryLookups';

/**
 * How often a registry that does not answer is asked, and the pauses between (07b's rule: retry
 * with backoff, then `unavailable`). Short, as the declarant is waiting: the gateway's breaker
 * and cache absorb an outage, and the declarant can check again.
 */
export const LOOKUP_ATTEMPTS = 3;
export const LOOKUP_RETRY_DELAYS_MS = [2_000, 4_000] as const;

/** The declaration and person a lookup request is for, as the activities need them. */
export interface LookupRef {
  tenant: string;
  declarationId: string;
  /** The declarant: activities read and write under their row-level security. */
  personId: string;
  subject: string;
  personKey: PersonKey;
}

/** One request's lookups: one set per registry, each answered on its own. */
export interface RegistryLookupsInput extends LookupRef {
  /** The consent the request recorded; also the workflow id's suffix. */
  consentId: string;
  sets: { setId: string; system: RegistrySystem }[];
}

/** One attempt at one registry. On the `final` one an unavailable registry is recorded as such. */
export interface LookupAttempt extends LookupRef {
  setId: string;
  system: RegistrySystem;
  final: boolean;
}

/** `recorded`: the set is settled (or gone); `retry`: the registry did not answer, ask again. */
export type LookupAttemptOutcome = 'recorded' | 'retry';

export function registryLookupsWorkflowId(consentId: string): string {
  return `registry-lookups-${consentId}`;
}
