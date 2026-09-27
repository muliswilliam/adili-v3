import { Readable } from 'node:stream';

import type { RosterColumnName, RosterField } from './columns.js';
import { readCsvRows } from './csv-reader.js';
import { type ColumnMapping, mapHeader } from './header-mapping.js';
import {
  createRowValidator,
  type RawRosterRow,
  type RowValidation,
  type RowValidatorOptions,
} from './row-validation.js';
import { RosterFileError, type SheetRow } from './sheet.js';
import { readXlsxRows } from './xlsx-reader.js';

export type RosterFileFormat = 'csv' | 'xlsx';

/** File limits of the roster import (spec 02). */
export const ROSTER_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const ROSTER_FILE_MAX_ROWS = 1_000_000;

export type ParsedRosterRow = { rowNumber: number; raw: RawRosterRow } & RowValidation;

export interface RosterFileTotals {
  rows: number;
  accepted: number;
  rejected: number;
}

export type RosterFile =
  | {
      ok: true;
      mapping: ColumnMapping;
      /**
       * Data rows in file order, validated, read as they are consumed; blank rows are skipped.
       * Iterate once. Throws `RosterFileError` if the file turns out unreadable part way.
       */
      rows: AsyncIterable<ParsedRosterRow>;
      /** Running totals; final once `rows` has been consumed. */
      totals: RosterFileTotals;
      /** Stops reading, e.g. after looking at the mapping only. Not needed once `rows` is done. */
      close: () => Promise<void>;
    }
  | { ok: false; mapping: ColumnMapping; missingRequired: RosterColumnName[] };

export interface ParseRosterFileOptions extends RowValidatorOptions {
  maxRows?: number;
}

/**
 * Reads a roster file: maps its header row to the template columns, then streams its data rows
 * normalised and validated. When a required column is missing the file is not read further.
 *
 * CSV is streamed from the source; XLSX is buffered (bounded by `ROSTER_FILE_MAX_BYTES`) because
 * a zip is read from its central directory at the end, and its first sheet is then streamed.
 * Throws `RosterFileError` for a file that cannot be read at all.
 */
export async function parseRosterFile(
  source: AsyncIterable<Uint8Array> | Uint8Array,
  format: RosterFileFormat,
  options: ParseRosterFileOptions = {},
): Promise<RosterFile> {
  const sheet =
    format === 'csv'
      ? readCsvRows(source instanceof Uint8Array ? Readable.from([source]) : source)
      : readXlsxRows(await toBuffer(source));

  let header: SheetRow | undefined;
  for (;;) {
    const next = await sheet.next();
    if (next.done === true) break;
    if (!isBlank(next.value)) {
      header = next.value;
      break;
    }
  }
  if (header === undefined) {
    throw new RosterFileError('malformed', 'The file is empty');
  }

  const { mapping, missingRequired, positions } = mapHeader(header.cells.map((cell) => cell.text));
  if (missingRequired.length > 0) {
    await sheet.return(undefined);
    return { ok: false, mapping, missingRequired };
  }

  const totals: RosterFileTotals = { rows: 0, accepted: 0, rejected: 0 };
  const validate = createRowValidator(options);
  const maxRows = options.maxRows ?? ROSTER_FILE_MAX_ROWS;

  async function* rows(): AsyncGenerator<ParsedRosterRow> {
    try {
      for (;;) {
        const next = await sheet.next();
        if (next.done === true) return;
        const row = next.value;
        if (isBlank(row)) continue;
        if (totals.rows === maxRows) {
          throw new RosterFileError(
            'too-many-rows',
            `The file has more than ${maxRows.toLocaleString('en')} rows`,
          );
        }
        const raw = rawRow(row, positions);
        const validation = validate(raw, row.rowNumber);
        totals.rows += 1;
        totals[validation.status] += 1;
        yield { rowNumber: row.rowNumber, raw, ...validation };
      }
    } finally {
      await sheet.return(undefined);
    }
  }

  return {
    ok: true,
    mapping,
    rows: rows(),
    totals,
    close: async () => {
      await sheet.return(undefined);
    },
  };
}

function rawRow(row: SheetRow, positions: { field: RosterField; index: number }[]): RawRosterRow {
  const raw: RawRosterRow = {};
  for (const { field, index } of positions) {
    const cell = row.cells[index];
    raw[field] =
      field === 'appointmentDate' ? (cell?.isoDate ?? cell?.text ?? '') : (cell?.text ?? '');
  }
  return raw;
}

function isBlank(row: SheetRow): boolean {
  return row.cells.every((cell) => cell.text.trim() === '');
}

/**
 * The whole of a roster file's bytes, read into memory. Throws `RosterFileError` (`too-large`)
 * past `ROSTER_FILE_MAX_BYTES`, without reading further.
 */
export async function toBuffer(source: AsyncIterable<Uint8Array> | Uint8Array): Promise<Buffer> {
  if (source instanceof Uint8Array) return Buffer.from(source);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > ROSTER_FILE_MAX_BYTES) {
      throw new RosterFileError('too-large', 'The file is over 50 MB');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
