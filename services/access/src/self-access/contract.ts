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

/** One workflow per certified copy being issued (a failed copy ordered again runs it afresh). */
export function certifiedCopyWorkflowId(copyId: string): string {
  return `certified-copy:${copyId}`;
}

export interface CertifiedCopyWorkflowInput {
  /** The Commission the declaration was filed with. */
  tenant: string;
  copyId: string;
  /**
   * The ordering transaction (Postgres `xid8`): the copy is read only once it has ended, so a
   * copy not committed yet is never taken as missing, nor a failed copy ordered again as still
   * failed (workflow-control.ts).
   */
  transactionId: string;
}

/**
 * What issuing did: the copy is `issued` (now or before); declarations has no such submitted
 * version of the declarant at the Commission, or the copy failed before, so it is `not-found`
 * (recorded `failed`); or the copy is `missing` (the ordering transaction rolled back).
 */
export type IssueOutcome = 'issued' | 'not-found' | 'missing';

/**
 * How a run ended: as issuing did, or `failed` when issuing failed after its retries (a refusal
 * by declarations or documents, or an outage longer than the retries): the copy is recorded
 * `failed`, and ordering it again tries again.
 */
export interface CertifiedCopyResult {
  outcome: IssueOutcome | 'failed';
}
