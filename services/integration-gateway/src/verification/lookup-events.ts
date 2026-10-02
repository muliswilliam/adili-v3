import { PLATFORM_TENANT } from '@adili/api-kit';
import type { NewEvent } from '@adili/events';

import type { LegalBasis, LookupOutcome, System, UnavailableReason } from '../db/schema.js';

/**
 * A registry was consulted, or a cached answer reused (ADR-008: integration calls are audited
 * with their legal basis). Identifiers and statuses only: the subject is the keyed hash, never
 * the national ID, and nothing of the answer. Subject: the verification-results row; tenant: the
 * one the lookup acted for, else `platform`. Documented here until the AsyncAPI file lands.
 */
export const REGISTRY_LOOKUP_PERFORMED = 'registry.lookup.performed.v1';

export interface RegistryLookupPerformedData extends Record<string, unknown> {
  resultId: string;
  system: System;
  outcome: LookupOutcome;
  /** Why the lookup was unavailable; null otherwise. */
  reason: UnavailableReason | null;
  cached: boolean;
  legalBasis: LegalBasis;
  caseRef: string | null;
  subjectHash: string;
  /** OAuth client of the calling service. */
  requestedBy: string;
}

export function lookupPerformed(
  data: RegistryLookupPerformedData,
  tenant: string | null,
): NewEvent<RegistryLookupPerformedData> {
  return {
    type: REGISTRY_LOOKUP_PERFORMED,
    subject: data.resultId,
    tenant: tenant ?? PLATFORM_TENANT,
    data,
  };
}
