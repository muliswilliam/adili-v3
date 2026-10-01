/**
 * What passes between `CertifiedCopyWorkflow`, its activities and the transaction that starts it.
 * Bundled into the workflow sandbox: types and constants only.
 *
 * Identifiers only: the activities read the certified copy where they use it, and the version's
 * content goes from declarations to documents inside one activity, so no declaration content,
 * name or reference enters Temporal's history.
 */

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const CERTIFIED_COPY_WORKFLOW = 'certifiedCopy';

/** One workflow per certified copy being issued. */
export function certifiedCopyWorkflowId(copyId: string): string {
  return `certified-copy:${copyId}`;
}

export interface CertifiedCopyWorkflowInput {
  /** The Commission the declaration was filed with. */
  tenant: string;
  copyId: string;
}

/**
 * What issuing did: the copy is `issued` (now or before); declarations has no such submitted
 * version of the declarant at the Commission, so the copy `failed`; or the copy is `missing`
 * (its request rolled back after the workflow started).
 */
export type IssueOutcome = 'issued' | 'not-found' | 'missing';

/** How a run ended. */
export interface CertifiedCopyResult {
  outcome: IssueOutcome;
}
