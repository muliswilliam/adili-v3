import { randomUUID } from 'node:crypto';

import type { StoredVersion } from './fake-declarations.js';
import { givenAssignedCase } from './cases.js';
import type { Caller, ReviewApi } from './review-api.js';

/**
 * The case of a version, worked in turn by `holders` through the claim and release routes (so the
 * reviewer-of-record history names each), and left with the last of them.
 */
export async function givenWorkedCase(
  api: ReviewApi,
  version: StoredVersion,
  holders: readonly Caller[],
): Promise<string> {
  const caseId = await givenAssignedCase(api, version, null);
  for (const [index, holder] of holders.entries()) {
    const claimed = await api.send('POST', `/v1/review/cases/${caseId}/claim`, holder);
    if (claimed.statusCode !== 200) throw new Error(`claim failed: ${claimed.body}`);
    if (index < holders.length - 1) {
      const released = await api.send('POST', `/v1/review/cases/${caseId}/release`, holder);
      if (released.statusCode !== 200) throw new Error(`release failed: ${released.body}`);
    }
  }
  return caseId;
}

/** A determination proposal on the case, as `caller` (its assignee). */
export function propose(
  api: ReviewApi,
  caseId: string,
  caller: Caller,
  body: unknown = {
    outcome: 'non-compliant',
    reasons: 'The declarant omitted the spouse vehicle acquired in 2026.',
  },
) {
  return api.send('POST', `/v1/review/cases/${caseId}/determinations`, caller, body);
}

/** Approval of a determination as `caller`, with an idempotency key. */
export function approve(api: ReviewApi, determinationId: string, caller: Caller) {
  return api.send(
    'POST',
    `/v1/review/determinations/${determinationId}/approve`,
    caller,
    undefined,
    { 'idempotency-key': randomUUID() },
  );
}
