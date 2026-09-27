import type { ColumnMapping, DirectoryError, RosterSummary } from '../../server/directory/client';
import { REQUIRED_COLUMNS, TEMPLATE_COLUMNS } from './template-columns';

/**
 * The column check of wizard step 3, pure: how the file's header lines up with the template,
 * what the "complete roster" box starts as, and what a refused preview or start means.
 */

/** One line of the mapping table, in the order the table shows them. */
export type MappingRow =
  /** A required template column the file does not have: the import cannot start. */
  | { status: 'missing'; field: string }
  | { status: 'matched'; source: string; field: string }
  /** An optional template column the file does not have. */
  | { status: 'not-in-file'; field: string }
  /** A file column that matches no template column; it is not imported. */
  | { status: 'ignored'; source: string };

/** Header matching as the directory does it: case, whitespace, `_` and `-` do not count. */
const columnKey = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');

/** The template's name for a mapped field, whichever spelling the directory reports. */
const templateName = (field: string) =>
  TEMPLATE_COLUMNS.find((column) => columnKey(column.name) === columnKey(field))?.name ?? field;

/**
 * Required template columns the file lacks. The mapping lists only optional columns as missing,
 * so the required ones are those the file did not match.
 */
export function missingRequired(mapping: ColumnMapping): string[] {
  const matched = new Set(mapping.matched.map((match) => columnKey(match.field)));
  return REQUIRED_COLUMNS.filter((name) => !matched.has(columnKey(name)));
}

/** The mapping table: missing required columns first, then matched, not in file, ignored. */
export function mappingRows(mapping: ColumnMapping): MappingRow[] {
  const required = missingRequired(mapping);
  const requiredKeys = new Set(required.map(columnKey));
  return [
    ...required.map((field): MappingRow => ({ status: 'missing', field })),
    ...mapping.matched.map((match): MappingRow => ({
      status: 'matched',
      source: match.source,
      field: templateName(match.field),
    })),
    ...mapping.missing
      .filter((field) => !requiredKeys.has(columnKey(field)))
      .map((field): MappingRow => ({ status: 'not-in-file', field: templateName(field) })),
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
