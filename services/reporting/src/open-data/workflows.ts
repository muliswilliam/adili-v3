/**
 * The open-data release workflow (ADR-003, spec 09b), hosted by the reporting worker
 * (`../workflows.ts`). Bundled into Temporal's deterministic sandbox: import only
 * `@temporalio/workflow` and types.
 */
import { proxyActivities } from '@temporalio/workflow';

import type { OpenDataReleaseActivities } from './activities.js';
import {
  NON_RETRYABLE_RELEASE_FAILURES,
  type OpenDataReleaseInput,
  type OpenDataReleaseResult,
} from './contract.js';

/**
 * Building writes a dozen files and issuing the manifest renders and signs a PDF: seconds each.
 * Retried with backoff while storage, documents or the approval's commit are not there yet; a
 * release that does not reconcile, or a manifest documents refuses, fails the workflow.
 */
const { buildRelease, issueReleaseManifest, publishRelease } =
  proxyActivities<OpenDataReleaseActivities>({
    startToCloseTimeout: '5 minutes',
    retry: {
      initialInterval: '1 second',
      backoffCoefficient: 2,
      maximumInterval: '5 minutes',
      nonRetryableErrorTypes: NON_RETRYABLE_RELEASE_FAILURES,
    },
  });

/**
 * `OpenDataReleaseWorkflow(fy, kind)` (spec 09b S5): builds the year's release (tables,
 * suppression, reconciliation with the NCR, files with their SHA-256; `preview`,
 * `open-data.release.built.v1`), issues its manifest through documents as a Public verifiable
 * document, and publishes it (`published`, `open-data.release.published.v1`). Started when an
 * EACC supervisor approves the year's national consolidated report, for its annual release.
 * History holds ids, the year, the kind, the version and the manifest's verification code only.
 */
export async function openDataRelease(input: OpenDataReleaseInput): Promise<OpenDataReleaseResult> {
  const { version } = await buildRelease(input);
  const manifest = await issueReleaseManifest(input);
  await publishRelease(input);
  return { releaseId: input.releaseId, version, ...manifest };
}
