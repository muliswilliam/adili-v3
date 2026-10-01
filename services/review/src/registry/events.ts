import type { RegistryCheckStatus, RegistrySystem } from '../rules/index.js';
import type { CheckStatus } from './contract.js';

/**
 * Events the review service publishes about registry checks (spec 07b, outbox, CloudEvents).
 * Identifiers and statuses only: no national ID, no registry record, no name. The tenant
 * extension is the Commission's slug and the subject the case id.
 */
export const REVIEW_REGISTRY_CHECKED = 'review.registry.checked.v1';
export const REVIEW_CASE_RECHECKED = 'review.case.rechecked.v1';

/**
 * `review.case.rechecked.v1`: a reviewer or supervisor asked for the case's registries to be
 * checked again; `review.registry.checked.v1` follows once the check is stored.
 */
export interface CaseRecheckedData extends Record<string, unknown> {
  caseId: string;
  versionId: string;
  /** The subject of the reviewer or supervisor who asked. */
  by: string;
}

/**
 * `review.registry.checked.v1`: a registry check stored on the case. `systems` is each registry's
 * status over the household (unavailable for anyone first, then mismatched, then matched), and
 * `checks` the status per person; `band` the case's priority band with the registry flags.
 */
export interface RegistryCheckedData extends Record<string, unknown> {
  caseId: string;
  versionId: string;
  band: 'low' | 'medium' | 'high';
  flags: number;
  /** Registry flags of the version this check no longer raised, closed `superseded-by-recheck`. */
  superseded: number;
  systems: Record<RegistrySystem, RegistryCheckStatus>;
  checks: CheckStatus[];
}
