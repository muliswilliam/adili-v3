import type { RosterImport } from '../../server/directory/client';
import { formatNumber } from '../format';

/** How often step 4 asks for the import's progress (spec 02). */
export const IMPORT_POLL_MS = 2_000;

/**
 * What the progress bar of an import shows: `reading` while staging, when the number of rows is
 * not known yet, then the rows applied.
 */
export type ImportProgress =
  { kind: 'reading' } | { kind: 'rows'; processed: number; total: number; percent: number };

export function importProgress(
  imp: Pick<RosterImport, 'state' | 'totalRows' | 'processedRows'>,
): ImportProgress {
  if (imp.state === 'pending' || imp.totalRows === null) return { kind: 'reading' };
  const total = imp.totalRows;
  const processed = Math.min(Math.max(imp.processedRows, 0), total);
  // An empty file, or a finished one, is all done; round down so 100% means every row.
  const percent =
    total === 0 || imp.state === 'completed' ? 100 : Math.floor((processed / total) * 100);
  return { kind: 'rows', processed, total, percent };
}

/** Whether the import has ended, so polling stops. */
export function importEnded(imp: Pick<RosterImport, 'state'>): boolean {
  return imp.state === 'completed' || imp.state === 'failed';
}

/** Missing-columns detail as the directory writes it: the column names, comma-separated. */
const columnList = (detail: string) =>
  detail
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .join(', ');

/**
 * Why an import stopped, completing "The import stopped after {n} rows: …". The detail is
 * shown only where its shape is known (column names, a row number); otherwise a plain reason.
 */
export function failureReason(failure: NonNullable<RosterImport['failure']>): string {
  switch (failure.code) {
    case 'missing-columns': {
      const columns = columnList(failure.detail);
      return columns ? `the file has no ${columns} column` : 'a required column is missing';
    }
    case 'parse-error':
      return /^\d+$/.test(failure.detail.trim())
        ? `row ${formatNumber(Number(failure.detail.trim()))} could not be read`
        : 'the file could not be read';
    case 'storage-error':
      return 'the file could not be read from storage';
    case 'upload-not-clean':
      return 'the file had not passed the security scan';
    case 'internal':
      return 'a system error interrupted it';
  }
}
