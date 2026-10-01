/**
 * The registry check workflow (spec 07b). This module is bundled into Temporal's deterministic
 * sandbox: import only `@temporalio/workflow` and types.
 */
import {
  executeChild,
  isCancellation,
  log,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';

import type { RegistryCheckActivities } from './activities.js';
import {
  REGISTRY_SWEEP_BATCH,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistryLookups,
  type RegistrySweepResult,
  registrySweepCheckWorkflowId,
  SWEEP_SPACING,
} from './contract.js';

/**
 * How long to wait before each new attempt at the lookups some registry gave no answer to: three
 * retries, each twice as late as the one before. A registry's own rate limit answers
 * `rate-limited` after a second, so the first wait outlasts it.
 */
export const LOOKUP_RETRY_DELAYS = ['5 seconds', '10 seconds', '20 seconds'] as const;

/**
 * Pulls from declarations and the directory, reads from the gateway and database work: retried
 * with backoff until they succeed, as the processing workflow's pulls are. A version that
 * disappeared fails at once (`version-missing`).
 */
const { lookupRegistries, matchRegistries, registrySweepCandidates } =
  proxyActivities<RegistryCheckActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
  });

/**
 * `RegistryCheckWorkflow`: looks up everyone on the case's version with a national ID in KRA,
 * NTSA, BRS and ArdhiSasa (and the officer's companies against the employer's supplier list),
 * looks up again what a registry or the gateway gave no answer to, three times with backoff, then
 * matches the records against the declared items and stores the flags and statuses on the case.
 * A registry still without an answer is `unavailable` on the case; it never stops the check.
 *
 * Run by `DeclarationProcessingWorkflow` once the case is created or amended; started on its own
 * for a case by a re-check (`POST /v1/review/cases/{caseId}/recheck`) and, as a child, by the
 * hourly `registrySweep`.
 */
export async function registryCheck(request: RegistryCheckRequest): Promise<RegistryCheckResult> {
  let lookups = await lookupRegistries({ check: request, previous: null });
  for (const delay of LOOKUP_RETRY_DELAYS) {
    if (lookups === null || !anyUnavailable(lookups)) break;
    await sleep(delay);
    lookups = await lookupRegistries({ check: request, previous: lookups });
  }
  if (lookups === null) return { outcome: 'stale' };
  return matchRegistries({ check: request, lookups });
}

/** Whether a lookup or supplier check is still without an answer. */
export function anyUnavailable(lookups: RegistryLookups): boolean {
  return [
    ...Object.values(lookups.persons).flatMap((systems) => Object.values(systems)),
    ...Object.values(lookups.suppliers),
  ].some((lookup) => lookup.outcome === 'unavailable');
}

/**
 * `RegistryUnavailableSweep`, started hourly by the service's Temporal schedule: checks the
 * registries again for the open cases with a registry still unavailable, oldest check first, at
 * most `REGISTRY_SWEEP_BATCH` a run, one at a time and `SWEEP_SPACING` apart so a registry that
 * just came back is not flooded. Each check is a `registryCheck` child; one that fails leaves its
 * case for the next run.
 */
export async function registrySweep(): Promise<RegistrySweepResult> {
  const candidates = await registrySweepCandidates({ limit: REGISTRY_SWEEP_BATCH });
  const result: RegistrySweepResult = { checked: 0, stale: 0, failed: 0 };
  for (const [index, request] of candidates.entries()) {
    if (index > 0) await sleep(SWEEP_SPACING);
    try {
      const checked = await executeChild(registryCheck, {
        workflowId: registrySweepCheckWorkflowId(request.caseId, workflowInfo().runId),
        args: [request],
      });
      result[checked.outcome] += 1;
    } catch (error) {
      if (isCancellation(error)) throw error;
      log.warn('Registry check of a swept case failed', { caseId: request.caseId });
      result.failed += 1;
    }
  }
  return result;
}
