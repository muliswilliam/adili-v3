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

/** Workflow type name of the registry check, for starting it by name (#187: re-check, sweep). */
export const REGISTRY_CHECK_WORKFLOW = 'registryCheck';

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
