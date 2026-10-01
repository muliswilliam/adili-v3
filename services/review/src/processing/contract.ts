/**
 * What passes between `DeclarationProcessingWorkflow`, its activities and the consumer that starts
 * it. Bundled into the workflow sandbox: types and constants only.
 *
 * Declaration content and personal data never pass through the workflow: they would sit in
 * Temporal's history, a second store. Activities pull the document where they use it and hand on
 * ids, versions, numbers, flags and dates only (flags' evidence is percentages, counts and dates).
 * The declarant's name and personnel file number, the queue's read model, are pulled and written
 * by `upsertCase` itself.
 */
import type { Flag } from '../rules/index.js';

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const DECLARATION_PROCESSING_WORKFLOW = 'declarationProcessing';

/** One workflow per submitted version, ever (a failed run may be started again). */
export function processingWorkflowId(versionId: string): string {
  return `declaration-processing:${versionId}`;
}

/** The submitted version to process, from `declaration.submitted.v1`. */
export interface ProcessingInput {
  tenant: string;
  declarationId: string;
  versionId: string;
  version: number;
}

/** The version's metadata as `pullVersion` found it: no content, no names. */
export interface VersionFacts {
  personId: string;
  reference: string;
  type: 'initial' | 'biennial' | 'final';
  statementDate: string;
  submittedAt: string;
  late: boolean;
  dueDate: string;
}

/** The person's previous submitted version at the Commission, as the declarations lookup gives it. */
export interface PreviousVersion {
  declarationId: string;
  versionId: string;
  version: number;
}

export interface RulesRequest {
  input: ProcessingInput;
  facts: VersionFacts;
  previous: PreviousVersion | null;
}

export interface UpsertCaseRequest {
  input: ProcessingInput;
  facts: VersionFacts;
  flags: Flag[];
}

/**
 * What `upsertCase` did: `created` a case for the declaration, `updated` its case from an earlier
 * version to this one (the amendment path), or found it `unchanged` (this version, or a later one,
 * was already processed: a redelivery or an out-of-order run).
 */
export type UpsertCaseOutcome =
  | { outcome: 'created'; caseId: string }
  | { outcome: 'unchanged'; caseId: string }
  | { outcome: 'updated'; caseId: string };

/** How a run ended; `missing` when declarations has no such version for the Commission. */
export type ProcessingResult = UpsertCaseOutcome | { outcome: 'missing' };

/** Failure type of a version that disappeared between two pulls; not retried. */
export const VERSION_MISSING = 'version-missing';
