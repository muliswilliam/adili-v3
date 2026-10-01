/**
 * What passes between the registry check workflow, its activities and the workflows that run it
 * (spec 07b). Bundled into the workflow sandbox: types and constants only.
 *
 * No national ID and no registry record passes through a workflow: they would sit in Temporal's
 * history, a second store. `lookupRegistries` reads the IDs where it uses them and hands on, per
 * person and registry, the outcome and the gateway's result id; `matchRegistries` reads the
 * records back from the gateway by result id. Person keys, outcomes, reasons, result ids and
 * company registration numbers are all that is handed on.
 */
import type { RegistryCheckStatus, RegistrySystem } from '../rules/index.js';

/** Workflow type names, for starting by name (the worker bundles the code, not the caller). */
export const REGISTRY_CHECK_WORKFLOW = 'registryCheck';
export const REGISTRY_SWEEP_WORKFLOW = 'registrySweep';

/** The Temporal schedule that starts `registrySweep` hourly, one per task queue. */
export function registrySweepScheduleId(taskQueue: string): string {
  return `registry-sweep-schedule:${taskQueue}`;
}

/** A re-check a reviewer or supervisor asked for: one registry check per request. */
export function registryRecheckWorkflowId(caseId: string, recheckId: string): string {
  return `registry-recheck:${caseId}:${recheckId}`;
}

/** The check of one case by one run of the sweep. */
export function registrySweepCheckWorkflowId(caseId: string, sweepRunId: string): string {
  return `registry-sweep-check:${caseId}:${sweepRunId}`;
}

/** How long after a re-check of a case the next one is refused (429), in minutes. */
export const RECHECK_COOLDOWN_MINUTES = 10;

/**
 * Cases one sweep run checks at most, oldest check first. With `SWEEP_SPACING` between them a run
 * fits in the hour even when every check waits out its retries, and the registries see a few
 * cases a minute, under their rate limits (only what was unavailable reaches a registry: the
 * other answers come from the gateway's cache).
 */
export const REGISTRY_SWEEP_BATCH = 50;
export const SWEEP_SPACING = '10 seconds';

export interface SweepCandidatesRequest {
  limit: number;
}

/** What one sweep run did. */
export interface RegistrySweepResult {
  checked: number;
  /** Cases that had moved on to another version by the time their check ran. */
  stale: number;
  /** Checks that failed for good; the next run tries them again. */
  failed: number;
}

/** The case and the version whose declared items are checked against the registries. */
export interface RegistryCheckRequest {
  tenant: string;
  caseId: string;
  declarationId: string;
  versionId: string;
  version: number;
}

/**
 * One answer of the gateway, or the lack of one: `unavailable` with the gateway's reason, or
 * `gateway-unavailable` / `gateway-rejected` (no result id) when the gateway itself gave none.
 */
export interface LookupOutcome {
  outcome: 'found' | 'not-found' | 'unavailable';
  reason: string | null;
  resultId: string | null;
  checkedAt: string | null;
}

/** A supplier check of one of the officer's companies; `supplies` is null unless found. */
export interface SupplierOutcome extends LookupOutcome {
  supplies: boolean | null;
}

/**
 * The lookups of a check so far. `persons` has every person of the version with a national ID
 * (people without one are not looked up); `suppliers` the supplier checks of the officer's BRS
 * companies against the officer's employer, by company registration number.
 */
export interface RegistryLookups {
  persons: Record<string, Partial<Record<RegistrySystem, LookupOutcome>>>;
  suppliers: Record<string, SupplierOutcome>;
}

export interface LookupRequest {
  check: RegistryCheckRequest;
  /** The lookups of the previous attempt: only what was unavailable is looked up again. */
  previous: RegistryLookups | null;
}

export interface MatchRequest {
  check: RegistryCheckRequest;
  lookups: RegistryLookups;
}

/** A person's status in a registry, as `review.registry.checked.v1` and the workflow see it. */
export interface CheckStatus {
  personKey: string;
  system: RegistrySystem;
  status: RegistryCheckStatus;
  reason: string | null;
}

/**
 * How a check ended: `checked` (statuses stored, flags merged into the case) or `stale` (the case
 * moved on to a later version or is gone, so nothing was looked up or stored).
 */
export type RegistryCheckResult =
  { outcome: 'checked'; flags: number; statuses: CheckStatus[] } | { outcome: 'stale' };

/** The legal basis of lookups at processing: comparing with other sources (Regs r.20(1)(b)). */
export const PROCESSING_LEGAL_BASIS = 'regs-r20-1-b';

/**
 * Why the gateway gave no answer of its own: it could not be reached (or could not record the
 * lookup), or it refused the request (a missing scope, say). Both are retried like a registry's
 * `unavailable`.
 */
export const GATEWAY_UNAVAILABLE = 'gateway-unavailable';
export const GATEWAY_REJECTED = 'gateway-rejected';

/** Why a stored result could not be read back for matching: the gateway does not have it. */
export const RESULT_MISSING = 'result-missing';
