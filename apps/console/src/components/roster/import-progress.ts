import type { RosterImport } from '../../server/directory/client';

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

type ImportFailure = NonNullable<RosterImport['failure']>;

/** Why an import stopped, completing "The import stopped after {n} rows: …". */
export function failureReason(failure: Pick<ImportFailure, 'code'>): string {
  switch (failure.code) {
    case 'missing-columns':
      return 'a required column is missing';
    case 'parse-error':
      return 'the file could not be read';
    case 'storage-error':
      return 'the file could not be read from storage';
    case 'upload-not-clean':
      return 'the file had not passed the security scan';
    case 'upload-missing':
      return 'the uploaded file was no longer available';
    case 'internal':
      return 'a system error interrupted it';
  }
}

/**
 * The directory's own words on what to fix, shown under the reason where they add to it: the
 * columns a file lacks, or where it could not be read. Other codes say all there is to say.
 */
export function failureDetail(failure: ImportFailure): string | null {
  const detail = failure.detail.trim();
  if (!detail) return null;
  return failure.code === 'missing-columns' || failure.code === 'parse-error' ? detail : null;
}
