/**
 * What passes between `OpenDataReleaseWorkflow`, its activities and the service that starts it.
 * Bundled into the workflow sandbox: types and constants only. Ids, the year, the kind and the
 * version only: the tables, their figures and who published are read and written by the
 * activities, never carried in Temporal history.
 */

/** reporting.yaml `OpenDataRelease.kind` (schema.ts `RELEASE_KINDS`). */
export type OpenDataReleaseKind = 'annual' | 'snapshot';

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const OPEN_DATA_RELEASE_WORKFLOW = 'openDataRelease';

/** One workflow per release: `open-data-release:<fy>:<kind>:<release id>`. */
export function openDataReleaseWorkflowId(input: OpenDataReleaseInput): string {
  return `open-data-release:${String(input.fy)}:${input.kind}:${input.releaseId}`;
}

export interface OpenDataReleaseInput {
  /** The release to build under, so a retried build finds the one it built. */
  releaseId: string;
  /** Financial year start year. */
  fy: number;
  kind: OpenDataReleaseKind;
}

/** The release built, at its version. */
export interface BuiltRelease {
  version: number;
}

/** The release's manifest as a Public verifiable document. */
export interface ReleaseManifest {
  documentId: string;
  verificationId: string;
}

/** How the workflow ended: the release published at its version, with its manifest. */
export interface OpenDataReleaseResult extends ReleaseManifest {
  releaseId: string;
  version: number;
}

/**
 * Activity failures that are not retried (their error names, which Temporal takes as the failure
 * type): the NCR is not built, the release tables do not reconcile, the release is gone or no
 * longer a preview (withdrawn), another annual release of the year is published, documents
 * refused the manifest.
 */
export const NON_RETRYABLE_RELEASE_FAILURES = [
  'NcrNotBuilt',
  'AnnualReleasePublished',
  'ReconciliationFailed',
  'ReleaseNotFound',
  'ReleaseNotInPreview',
  'InternalApiRejected',
];
