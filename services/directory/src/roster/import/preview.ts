import { parseRosterFile, toBuffer } from '../roster-file.js';
import type { RosterImportPreview } from './representation.js';
import type { OpenedRosterUpload } from './roster-uploads.js';

/** Rows counted exactly before the preview falls back to an estimate. */
export const PREVIEW_COUNTED_ROWS = 10_000;

/**
 * The column mapping of a roster file and its data rows: counted when there are up to
 * `PREVIEW_COUNTED_ROWS`, otherwise estimated from the line breaks of a CSV file (quoted
 * multi-line cells count extra) and unknown (null) for a large XLSX file.
 * Throws `RosterFileError` for a file that cannot be read or is too large.
 */
export async function previewRosterFile(
  upload: OpenedRosterUpload,
): Promise<Omit<RosterImportPreview, 'uploadId'>> {
  const bytes = await toBuffer(upload.body);
  const file = await parseRosterFile(bytes, upload.format);
  const base = { fileName: upload.fileName, format: upload.format, mapping: file.mapping };
  if (!file.ok) {
    return { ...base, missingRequired: file.missingRequired, estimatedRows: null };
  }

  // One row past the limit tells a file of exactly the limit from a larger one.
  const rows = file.rows[Symbol.asyncIterator]();
  let counted = 0;
  while (counted <= PREVIEW_COUNTED_ROWS && (await rows.next()).done !== true) counted += 1;
  const exhausted = counted <= PREVIEW_COUNTED_ROWS;
  await file.close();
  const estimatedRows = exhausted
    ? counted
    : upload.format === 'csv'
      ? Math.max(PREVIEW_COUNTED_ROWS, lineCount(bytes) - 1)
      : null;
  return { ...base, missingRequired: [], estimatedRows };
}

/** Lines in a text file: line feeds, plus one for a last line without one. */
function lineCount(bytes: Buffer): number {
  let lines = 0;
  for (let index = bytes.indexOf(0x0a); index !== -1; index = bytes.indexOf(0x0a, index + 1)) {
    lines += 1;
  }
  return bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a ? lines + 1 : lines;
}
