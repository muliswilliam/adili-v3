import type { ImportFailureCode } from './representation.js';

/**
 * What `RosterImportWorkflow` and its activities exchange. Types and constants only: the workflow
 * bundle runs in Temporal's sandbox and must not load the service's modules.
 */

/** The import an activity works on; activities run in the tenant's RLS context. */
export interface ImportRef {
  importId: string;
  tenant: string;
}

export interface ImportFailure {
  code: ImportFailureCode;
  detail: string;
}

export type StageResult =
  /** Rows are staged; accepted rows are numbered into `chunkCount` chunks. */
  | { outcome: 'staged'; chunkCount: number; declaredComplete: boolean }
  /** The input cannot be imported (missing columns, unreadable file, upload gone). */
  | { outcome: 'failed'; failure: ImportFailure }
  /** Nothing to do: the import does not exist or has already ended. */
  | { outcome: 'ended' };

/** Outcomes of the rows one `applyChunk` applied; zero when it had already been applied. */
export interface ChunkCounts {
  created: number;
  updated: number;
  unchanged: number;
  /** Rejected when applied (`identity-locked`). */
  rejected: number;
}

export type ImportResult =
  | {
      state: 'completed';
      /** Records flagged absent by this declared-complete import (the flag-absent step). */
      flaggedAbsent?: number;
    }
  | { state: 'failed'; failure: ImportFailure };

/** Failure type of activities that could not reach the documents service or storage. */
export const STORAGE_ERROR = 'storage-error';
