/**
 * What the console accepts as a roster file before any request (spec 02, wizard step 2). The
 * documents service applies the same limits to the `roster-import` purpose and has the last word.
 */

/** 50 MB, as the directory's parser and the documents service count it. */
export const ROSTER_FILE_MAX_BYTES = 50 * 1024 * 1024;

export const ROSTER_CONTENT_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export type RosterFileFormat = keyof typeof ROSTER_CONTENT_TYPES;
export type RosterContentType = (typeof ROSTER_CONTENT_TYPES)[RosterFileFormat];

/**
 * Extensions only: browsers report CSVs as `text/csv`, `application/vnd.ms-excel` or nothing,
 * so the reported type would reject good files. The documents service sniffs the bytes.
 */
export const ROSTER_FILE_ACCEPT = ['.csv', '.xlsx'];

/** The roster format a file name says it is, or null. */
export function rosterFileFormat(fileName: string): RosterFileFormat | null {
  const extension = /\.(csv|xlsx)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  return extension === 'csv' || extension === 'xlsx' ? extension : null;
}

/**
 * The content type to declare and PUT a roster file with, from its name rather than the type
 * the browser reports (see `ROSTER_FILE_ACCEPT`). The presigned PUT is signed for this type.
 */
export function rosterContentType(fileName: string): RosterContentType | null {
  const format = rosterFileFormat(fileName);
  return format ? ROSTER_CONTENT_TYPES[format] : null;
}
