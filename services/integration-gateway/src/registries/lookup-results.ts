import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

import type { LookupResult } from '../adapter-kit/registry-adapter.js';
import type { System } from '../db/schema.js';
import type { ResultEnvelope } from './registry-records.js';

/**
 * A registry lookup as the internal API answers it: the envelope (`ResultEnvelope`) and the
 * normalised records, or `empty` (the same fields, no records) when nothing was found or the
 * registry gave no answer.
 *
 * A lookup the kit could not record (the verification-results row or its encryption failed,
 * `resultId` null) is refused with 503 `lookup-not-recorded` rather than answered: every lookup
 * for a case must be audited with its legal basis (ADR-008), and a result without its row could
 * not be read back for the Registry tab. Retrying is cheap, as the answer is cached.
 */
export function toLookupResult<T extends object, E extends object>(
  system: System,
  result: LookupResult<T>,
  empty: E,
): ResultEnvelope & (T | E) {
  if (result.resultId === null) {
    throw new ProblemException({
      type: 'lookup-not-recorded',
      title: 'Lookup not recorded',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      detail: 'The lookup could not be recorded, so no answer is given. Try again shortly.',
    });
  }
  const envelope: ResultEnvelope = {
    resultId: result.resultId,
    system,
    outcome: result.outcome,
    reason: result.outcome === 'unavailable' ? result.reason : null,
    cached: result.outcome !== 'unavailable' && result.cached,
    checkedAt: result.checkedAt.toISOString(),
  };
  return { ...envelope, ...(result.outcome === 'found' ? result.data : empty) };
}
