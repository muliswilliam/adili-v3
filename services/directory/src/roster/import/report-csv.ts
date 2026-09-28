import { ROSTER_COLUMNS, type RosterField } from '../columns.js';
import type { RawRosterRow, RowError } from '../row-validation.js';

/**
 * The rejected rows report: the template columns with the values as sent, then the reason
 * columns. Uploading the fixed file again works as it is: the reason columns match no template
 * column, so the import ignores them.
 */
export const REPORT_REASON_COLUMNS = [
  'row_number',
  'error_fields',
  'error_codes',
  'error_messages',
] as const;

/** Separates the errors of a row within a reason column. */
const ERROR_SEPARATOR = '; ';

export const UTF8_BOM = '\uFEFF';

const COLUMN_NAME = new Map<RosterField, string>(
  ROSTER_COLUMNS.map((column) => [column.field, column.name]),
);

export interface ReportRow {
  rowNumber: number;
  raw: RawRosterRow;
  errors: RowError[];
}

/** The header line, preceded by a byte order mark so Excel reads the file as UTF-8. */
export function reportHeader(): string {
  return (
    UTF8_BOM + line([...ROSTER_COLUMNS.map((column) => column.name), ...REPORT_REASON_COLUMNS])
  );
}

/** One rejected row as a CSV line (RFC 4180, CRLF). */
export function reportLine(row: ReportRow): string {
  return line([
    ...ROSTER_COLUMNS.map((column) => row.raw[column.field] ?? ''),
    String(row.rowNumber),
    row.errors.map((error) => COLUMN_NAME.get(error.field) ?? error.field).join(ERROR_SEPARATOR),
    row.errors.map((error) => error.code).join(ERROR_SEPARATOR),
    row.errors.map((error) => error.message).join(ERROR_SEPARATOR),
  ]);
}

/**
 * The report's file name, from the uploaded file's: `<name>-rejected-rows.csv`, reduced to
 * characters safe in a quoted `Content-Disposition` file name.
 */
export function reportFileName(uploadedName: string | null): string {
  const stem = (uploadedName ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return `${stem === '' ? 'roster-import' : stem}-rejected-rows.csv`;
}

function line(values: string[]): string {
  return values.map((value) => field(neutraliseFormula(value))).join(',') + '\r\n';
}

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A value starting with `+` or `-` that is only a number or phone number, e.g. `+254 712 000 001`. */
const SIGNED_NUMBER = /^[+-][\d\s().-]*$/;

/**
 * Keeps a spreadsheet from running a value as a formula (CSV injection) by prefixing `'`,
 * which Excel and LibreOffice show as text. Values sent from an HR system end up in the
 * officer's spreadsheet here. Phone and signed numbers are left as they are.
 */
function neutraliseFormula(value: string): string {
  const first = value.charAt(0);
  if (first === '=' || first === '@' || first === '\t' || first === '\r') return `'${value}`;
  if ((first === '+' || first === '-') && !SIGNED_NUMBER.test(value)) return `'${value}`;
  return value;
}
