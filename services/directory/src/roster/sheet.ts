/** One cell as read from a file. */
export interface SheetCell {
  /** The value as the spreadsheet displays it (numbers rendered with their number format). */
  text: string;
  /** `YYYY-MM-DD` when the cell is an Excel date cell. */
  isoDate?: string;
}

/** One row as read from a file; `rowNumber` is the spreadsheet row number (header is row 1). */
export interface SheetRow {
  rowNumber: number;
  cells: SheetCell[];
}

export type RosterFileErrorCode = 'malformed' | 'too-large' | 'too-many-rows';

/**
 * The file as a whole cannot be parsed. The import fails with `parse-error` and this message as
 * the detail.
 */
export class RosterFileError extends Error {
  constructor(
    readonly code: RosterFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RosterFileError';
  }
}
