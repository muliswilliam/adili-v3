/**
 * `CertifiedCopyWorkflow` (ADR-003), hosted by the access worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { proxyActivities } from '@temporalio/workflow';

import type { CertifiedCopyActivities } from './activities.js';
import type { CertifiedCopyResult, CertifiedCopyWorkflowInput } from './contract.js';

/**
 * Calls to declarations, documents, notifications and the database: retried with backoff until
 * they succeed, so an outage delays a copy, never loses it. The first retry comes after a second,
 * each later one twice as late, at most five minutes apart.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { issueCertifiedCopy } = proxyActivities<CertifiedCopyActivities>({
  // The version from declarations (2 s per attempt), rendering and signing at documents (30 s
  // per attempt, ADR-013 §2), then a transaction.
  startToCloseTimeout: '3 minutes',
  retry: RETRY,
});

const { certifiedCopyReady } = proxyActivities<CertifiedCopyActivities>({
  // Two messages.
  startToCloseTimeout: '1 minute',
  retry: RETRY,
});

/**
 * `CertifiedCopyWorkflow(copyId)` (spec 10, Administrative Mechanism 32), started with the
 * certified copy a declarant asked for (or an access officer recorded from their written
 * application): the copy is issued, and the declarant told it is ready to download.
 */
export async function certifiedCopy(
  input: CertifiedCopyWorkflowInput,
): Promise<CertifiedCopyResult> {
  const outcome = await issueCertifiedCopy(input);
  if (outcome === 'issued') await certifiedCopyReady(input);
  return { outcome };
}
