import type {
  DirectoryError,
  RosterImportPreview,
  RosterSummary,
} from '../../server/directory/client';
import type { RosterColumnName } from './template-columns';

/**
 * The column check of wizard step 3, pure: how the file's header lines up with the template,
 * what the "complete roster" box starts as, and what a refused preview or start means.
 */

/** One line of the mapping table, in the order the table shows them. */
export type MappingRow =
  /** A required template column the file does not have: the import cannot start. */
  | { status: 'missing'; field: RosterColumnName }
  | { status: 'matched'; source: string; field: RosterColumnName }
  /** An optional template column the file does not have. */
  | { status: 'not-in-file'; field: RosterColumnName }
  /** A file column that matches no template column; it is not imported. */
  | { status: 'ignored'; source: string };

/**
 * The mapping table: required columns the file lacks first (they block the import), then the
 * matched columns in file order, optional columns not in the file, and ignored file columns.
 */
export function mappingRows({ mapping, missingRequired }: RosterImportPreview): MappingRow[] {
  return [
    ...missingRequired.map((field): MappingRow => ({ status: 'missing', field })),
    ...mapping.matched.map(({ source, field }): MappingRow => ({
      status: 'matched',
      source,
      field,
    })),
    ...mapping.missing.map((field): MappingRow => ({ status: 'not-in-file', field })),
    ...mapping.ignored.map((source): MappingRow => ({ status: 'ignored', source })),
  ];
}

/**
 * Whether "This file is the complete roster" starts ticked: on a first import (nothing to flag
 * yet) it is, otherwise not, so nobody is flagged as absent without the officer choosing it.
 * Unknown roster (it could not be read) counts as not empty.
 */
export function defaultDeclaredComplete(roster: RosterSummary | null): boolean {
  return roster !== null && (roster.status === 'none' || roster.expectedDeclarants === 0);
}

/** Why the columns could not be checked, as the step shows it. */
export type CheckFailure =
  /** The upload is gone, expired or not clean any more: upload it again. */
  | 'upload-gone'
  /** The file cannot be read as CSV or Excel. */
  | 'unreadable'
  /** Anything else, worth retrying. */
  | 'failed';

export function checkFailure(error: DirectoryError): CheckFailure {
  if (error.kind !== 'problem') return 'failed';
  const { status } = error.problem;
  // 404 `upload-not-found`, 409 `upload-not-clean`; 422 `unreadable-file`.
  if (status === 404 || status === 409) return 'upload-gone';
  if (status === 422) return 'unreadable';
  return 'failed';
}

/** Why "Start import" was refused, as the step shows it. */
export type StartFailure =
  /** Another import of the Commission is running (409 `import-in-progress`). */
  | 'running'
  /** Rate limited (429). */
  | 'limited'
  /** The upload is gone or not clean (404, or 409 `upload-not-clean`). */
  | 'upload-gone'
  | 'failed';

export function startFailure(error: DirectoryError): StartFailure {
  if (error.kind !== 'problem') return 'failed';
  const { status, type } = error.problem;
  if (status === 429) return 'limited';
  if (status === 409) return type === 'upload-not-clean' ? 'upload-gone' : 'running';
  if (status === 404) return 'upload-gone';
  return 'failed';
}

/**
 * Whether a refused start is final for its Idempotency-Key. A problem answer is recorded against
 * the key, so trying again after the other import finishes needs a new one; a timeout or outage
 * keeps the key, so a start that did go through is not doubled.
 */
export function needsNewIdempotencyKey(error: DirectoryError): boolean {
  return error.kind === 'problem';
}
