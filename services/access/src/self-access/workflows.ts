/**
 * `CertifiedCopyWorkflow` (ADR-003), hosted by the access worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types (and constants modules that
 * import nothing else).
 */
import { ActivityFailure, log, proxyActivities } from '@temporalio/workflow';

import { ACTIVITY_RETRY } from '../activity-retry.js';
import type { CertifiedCopyActivities } from './activities.js';
import type { CertifiedCopyResult, CertifiedCopyWorkflowInput } from './contract.js';

const { issueCertifiedCopy } = proxyActivities<CertifiedCopyActivities>({
  // The version from declarations (2 s per attempt), rendering and signing at documents (30 s
  // per attempt, ADR-013 §2), then a transaction.
  startToCloseTimeout: '3 minutes',
  retry: ACTIVITY_RETRY,
});

const { certifiedCopyReady, certifiedCopyFailed } = proxyActivities<CertifiedCopyActivities>({
  // Two messages, or a transaction.
  startToCloseTimeout: '1 minute',
  retry: ACTIVITY_RETRY,
});

/**
 * `CertifiedCopyWorkflow(copyId)` (spec 10, Administrative Mechanism 32), started with the
 * certified copy a declarant asked for (or an access officer recorded from their written
 * application), inside the ordering transaction; its first activity waits for that transaction
 * to end. The copy is issued, and the declarant told it is ready to download. Issuing that fails
 * after its retries records the copy `failed` (ordering it again tries again), so a copy is never
 * left `pending` with no workflow behind it; the ready message failing is logged, the copy stays
 * issued.
 */
export async function certifiedCopy(
  input: CertifiedCopyWorkflowInput,
): Promise<CertifiedCopyResult> {
  let outcome;
  try {
    outcome = await issueCertifiedCopy(input);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    log.error('Certified copy not issued after its retries', { copyId: input.copyId });
    await certifiedCopyFailed(input);
    return { outcome: 'failed' };
  }
  if (outcome === 'issued') {
    try {
      await certifiedCopyReady(input);
    } catch (error) {
      if (!(error instanceof ActivityFailure)) throw error;
      log.warn('Could not tell the declarant their certified copy is ready', {
        copyId: input.copyId,
      });
    }
  }
  return { outcome };
}
