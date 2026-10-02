/**
 * Workflows hosted by the review worker (ADR-003). This module is bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { proxyActivities } from '@temporalio/workflow';

import { requestCaseCopilot } from '../copilot/workflows.js';
import type { ProcessingActivities } from './activities.js';
import type { ProcessingInput, ProcessingResult } from './contract.js';

// The worker bundles this module: every workflow of the review service is exported from it.
export { clarification } from '../clarifications/workflows.js';
export { closureNotices, closureSweep, closureSweeps } from '../closures/workflows.js';
export { copilotJobFinished, copilotPolicyChanged } from '../copilot/workflows.js';
export { determinationIssuance } from '../determinations/workflows.js';
export { enforcement } from '../enforcement/workflows.js';
export { referralSending, referralSweep, referralSweeps } from '../referrals/workflows.js';

/**
 * Pulls from declarations and the directory, and database work: retried with backoff until they
 * succeed, so an outage of either service delays a case, never loses it. The first retry comes
 * after a second, each later one twice as late, at most five minutes apart. A version that
 * disappeared between pulls fails at once (a non-retryable `version-missing`).
 */
const PULL_RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { pullVersion, pullPreviousVersion, runRules, upsertCase } =
  proxyActivities<ProcessingActivities>({
    startToCloseTimeout: '1 minute',
    retry: PULL_RETRY,
  });

/**
 * `DeclarationProcessingWorkflow` (spec 07a), started by the `declaration.submitted.v1` consumer
 * with the version as workflow id: pull the version's metadata, look up the person's previous
 * submitted version at the Commission, run the deterministic rules, then create the review case
 * (or, for a later version, update the case: flags recomputed against the previous version,
 * reviewed flags kept and marked, assignee kept). The case, its flags, the timeline entry and the
 * event are written in one transaction, so a retried or repeated run changes nothing twice.
 *
 * A case created or amended then gets its copilot (spec 07c): `requestCopilot` asks the
 * ai-gateway for the summary and flag explanations, and the case shows them `pending` (or, after
 * an amendment, the earlier ones `stale`) until they arrive. The copilot never holds a case up: a
 * gateway that cannot be reached leaves it `failed`, for the assignee to try again.
 */
export async function declarationProcessing(input: ProcessingInput): Promise<ProcessingResult> {
  const facts = await pullVersion(input);
  if (!facts) return { outcome: 'missing' };
  const previous = await pullPreviousVersion({
    tenant: input.tenant,
    personId: facts.personId,
    versionId: input.versionId,
  });
  const flags = await runRules({ input, facts, previous });
  const outcome = await upsertCase({ input, facts, flags });
  if (outcome.outcome === 'unchanged') return outcome;
  await afterRegistryMatching(input, outcome);
  return outcome;
}

/**
 * The steps after registry matching. Spec 07b's `matchRegistries` is not built yet: when it is,
 * it runs before this and passes its `registryCheckedAt` to the copilot request.
 */
async function afterRegistryMatching(
  input: ProcessingInput,
  { outcome, caseId }: { outcome: 'created' | 'updated'; caseId: string },
): Promise<void> {
  await requestCaseCopilot({
    tenant: input.tenant,
    caseId,
    trigger: outcome === 'created' ? 'case-created' : 'amendment',
  });
}
