import type {
  DirectoryError,
  RosterImport,
  RosterImportRow,
  RowError,
} from '../../server/directory/client';
import type { RosterColumnName } from './template-columns';

/**
 * The import report (wizard step 5, the import report page and the history list), pure: what
 * the rejected rows show, whether they are still kept, and how an import reads in a list.
 */

/**
 * The template column a row error names, as the officer's file spells it: the directory names
 * fields in camelCase (`personnelFileNumber`), the template and the report CSV in snake_case.
 */
export function columnName(field: RowError['field']): RosterColumnName {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) as RosterColumnName;
}

/** The personnel file number a rejected row carried, or null when it had none. */
export function rowFileNumber(row: Pick<RosterImportRow, 'raw'>): string | null {
  const value = row.raw.personnelFileNumber?.trim();
  return value === undefined || value === '' ? null : value;
}

/**
 * Whether the import's rows (and its rejected rows report) are gone: they are purged 30 days
 * after the import ended, and the directory then answers 410. The counts stay.
 */
export function rowsPurged(
  imp: Pick<RosterImport, 'rowsRetainedUntil'>,
  now: Date = new Date(),
): boolean {
  return imp.rowsRetainedUntil !== null && new Date(imp.rowsRetainedUntil) <= now;
}

/** Why the rejected rows cannot be listed, as the report shows it. */
export type RowsFailure =
  /** 410 `import-rows-purged`: kept 30 days after the import ended. */
  | 'purged'
  /** 403: rows hold personal data, which only the Commission sees (EACC). */
  | 'commission-only'
  /** Anything else, worth retrying. */
  | 'failed';

export function rowsFailure(error: DirectoryError): RowsFailure {
  if (error.kind !== 'problem') return 'failed';
  if (error.problem.status === 410) return 'purged';
  if (error.problem.status === 403) return 'commission-only';
  return 'failed';
}

/**
 * The name the rejected rows CSV is saved under when the answer carries none: the directory's
 * own rule, `<uploaded file name>-rejected-rows.csv`.
 */
export function reportFileName(uploadedName: string | null): string {
  const stem = (uploadedName ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return `${stem === '' ? 'roster-import' : stem}-rejected-rows.csv`;
}

/** The console's own route that fetches an import's rejected rows CSV (a server route). */
export function reportCsvUrl(importId: string): string {
  return `/roster/imports/${importId}/report.csv`;
}

/**
 * The running import a refused start names (409 `import-in-progress` carries its `importId`),
 * or null when the answer names none (it ended in the meantime, or an older directory).
 */
export function runningImportId(error: DirectoryError): string | null {
  if (error.kind !== 'problem' || error.problem.status !== 409) return null;
  const { problem } = error;
  const importId = 'importId' in problem ? problem.importId : undefined;
  return typeof importId === 'string' && importId !== '' ? importId : null;
}

/** Whether an import is still going: its counts are not final. */
export function importRunning(imp: Pick<RosterImport, 'state'>): boolean {
  return imp.state === 'pending' || imp.state === 'processing';
}
