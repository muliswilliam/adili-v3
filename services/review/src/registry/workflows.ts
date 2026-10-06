/**
 * The registry check workflow (spec 07b). This module is bundled into Temporal's deterministic
 * sandbox: import only `@temporalio/workflow` and types.
 */
import {
  executeChild,
  isCancellation,
  log,
  patched,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';

import { requestCaseCopilot } from '../copilot/workflows.js';
import type { RegistryCheckActivities } from './activities.js';
import {
  type RecheckOptions,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistryLookups,
  type RegistrySweepResult,
  lookUpAgain,
  registrySweepCheckWorkflowId,
  SWEEP_CONCURRENCY,
} from './contract.js';

/**
 * How long to wait before each new attempt at the lookups some registry gave no answer to: three
 * retries, each twice as late as the one before. A registry's own rate limit answers
 * `rate-limited` after a second, so the first wait outlasts it.
 */
export const LOOKUP_RETRY_DELAYS = ['5 seconds', '10 seconds', '20 seconds'] as const;

/**
 * Pulls from declarations and the directory, reads from the gateway and database work: each
 * activity retried with backoff for half an hour at most, so no case waits on them for good
 * (#478). The limit is per activity, not for the whole check, which also waits between its
 * lookups. A check that still fails stores nothing: its registries stay not checked, the case
 * goes on to its copilot, and only a reviewer's re-check runs it again (the sweep picks only
 * cases with an `unavailable` registry, #724). The sweep's plan has the same limit; the next
 * hourly sweep plans again. A version that disappeared fails at once (`version-missing`).
 */
const { lookupRegistries, matchAndStoreRegistries, planRegistrySweep } =
  proxyActivities<RegistryCheckActivities>({
    startToCloseTimeout: '5 minutes',
    scheduleToCloseTimeout: '30 minutes',
    retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
  });

/**
 * `registryCheck` (the spec's RegistryCheckWorkflow): looks up everyone on the case's version
 * with a national ID in KRA, NTSA, BRS and ArdhiSasa (and the officer's companies against the
 * employer's supplier list), looks up again what a registry or the gateway gave no answer to (not
 * what the gateway refused), three times with backoff, then matches the records against the
 * declared items and stores the flags and statuses on the case. A registry still without an
 * answer is `unavailable` on the case; it never stops the check.
 *
 * Run by `DeclarationProcessingWorkflow` once the case is created or amended; started on its own
 * for a case by a re-check (`POST /v1/review/cases/{caseId}/recheck`) and, as a child, by the
 * hourly `registrySweep`.
 */
export async function registryCheck(request: RegistryCheckRequest): Promise<RegistryCheckResult> {
  let lookups = await lookupRegistries({ check: request, previous: null });
  for (const delay of LOOKUP_RETRY_DELAYS) {
    if (lookups === null || !anyToLookUpAgain(lookups)) break;
    await sleep(delay);
    lookups = await lookupRegistries({ check: request, previous: lookups });
  }
  if (lookups === null) return { outcome: 'stale' };
  return matchAndStoreRegistries({ check: request, lookups });
}

/**
 * `registryRecheck` (#603): the registry check of a case at its current version, then its copilot
 * asked anew with the check's time, so the summary is marked stale and rebuilt on the statuses the
 * check stored (spec 07c S11). A reviewer's re-check always asks; the sweep asks only when a
 * status changed (`RecheckOptions`). A stale check asks nothing.
 */
export async function registryRecheck(
  request: RegistryCheckRequest,
  options: RecheckOptions,
): Promise<RegistryCheckResult> {
  const result = await registryCheck(request);
  if (result.outcome !== 'checked') return result;
  if (options.refreshCopilot === 'if-changed' && !result.changed) return result;
  await requestCaseCopilot({
    tenant: request.tenant,
    caseId: request.caseId,
    trigger: 're-check',
    registryCheckedAt: result.checkedAt,
  });
  return result;
}

/**
 * Whether a lookup or supplier check is still without an answer worth waiting for (one the
 * gateway refused is not: it needs fixing).
 */
export function anyToLookUpAgain(lookups: RegistryLookups): boolean {
  return [
    ...Object.values(lookups.persons).flatMap((systems) => Object.values(systems)),
    ...Object.values(lookups.suppliers),
  ].some(lookUpAgain);
}

/**
 * `registrySweep` (the spec's RegistryUnavailableSweep), started hourly by the service's Temporal
 * schedule: checks the registries again for the open cases with a registry still unavailable,
 * oldest check first, as `planRegistrySweep` paces them under the systems' rate limits (each case
 * starting once the systems it looks up have room for it, until the plan's window closes), at
 * most `SWEEP_CONCURRENCY` at once. Each check is a `registryRecheck` child, which refreshes the
 * case's copilot when a status changed (#603); one that fails leaves its case for the next run.
 */
export async function registrySweep(): Promise<RegistrySweepResult> {
  const plan = await planRegistrySweep();
  const result: RegistrySweepResult = { checked: 0, stale: 0, failed: 0 };
  const startedAt = Date.now();
  const running = new Set<Promise<void>>();
  for (const { request, startAfterMs } of plan) {
    const wait = startedAt + startAfterMs - Date.now();
    if (wait > 0) await sleep(wait);
    while (running.size >= SWEEP_CONCURRENCY) await Promise.race(running);
    const run: Promise<void> = checkSwept(request, result).then(() => {
      running.delete(run);
    });
    running.add(run);
  }
  await Promise.all(running);
  return result;
}

/**
 * The sweep's child became `registryRecheck` with #603 (ADR-003): a sweep started before keeps its
 * `registryCheck` children on replay. Remove the old branch once no sweep from before #603 runs.
 */
const RECHECK_CHILD_PATCH = 'registry-sweep-recheck-child';

/** One swept case's check as a child, counted in `result`; a failure never stops the run. */
async function checkSwept(
  request: RegistryCheckRequest,
  result: RegistrySweepResult,
): Promise<void> {
  try {
    const workflowId = registrySweepCheckWorkflowId(request.caseId, workflowInfo().runId);
    const checked = patched(RECHECK_CHILD_PATCH)
      ? await executeChild(registryRecheck, {
          workflowId,
          args: [request, { refreshCopilot: 'if-changed' }],
        })
      : await executeChild(registryCheck, { workflowId, args: [request] });
    result[checked.outcome] += 1;
  } catch (error) {
    if (isCancellation(error)) throw error;
    log.warn('Registry check of a swept case failed', { caseId: request.caseId });
    result.failed += 1;
  }
}
