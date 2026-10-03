import { createHash } from 'node:crypto';

import {
  OPEN_DATA_TABLES,
  type OpenDataTable,
  type OpenDataTableName,
  type ReleaseTables,
  type TableRow,
} from './tables.js';

/**
 * A release's dataset files (spec 09b): JSON and CSV per table and the release JSON, each with
 * its SHA-256, as written to object storage. Pure and deterministic: the same tables always give
 * the same bytes, so a file's hash identifies its content.
 *
 * - Table JSON is reporting.yaml's `getOpenDataTable` body (`table`, `columns`, `rows`,
 *   `suppression`), served as stored.
 * - Table CSV (RFC 4180, CRLF) has a header row of the columns; a suppressed or missing figure is
 *   an empty cell, and the marker column is `_suppressed` (`true` / `false`).
 * - The release JSON lists the release and every table file's rows and hashes.
 */

export const FILE_FORMATS = ['json', 'csv'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/** The release JSON's table name in `open_data_files`, beside the six tables. */
export const RELEASE_FILE = 'release';
export type ReleaseFileName = OpenDataTableName | typeof RELEASE_FILE;

export const CONTENT_TYPES: Record<FileFormat, string> = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

/** A file ready to write: its name, format, bytes, data rows and SHA-256 (hex). */
export interface DatasetFile {
  table: ReleaseFileName;
  format: FileFormat;
  body: Buffer;
  rows: number;
  sha256: string;
}

/** A table's entry in the release JSON (and reporting.yaml `OpenDataRelease.tables`). */
export interface ReleaseTableEntry {
  table: OpenDataTableName;
  rows: number;
  sha256Json: string;
  sha256Csv: string;
}

/**
 * What a release's tables were built from: the year's NCR aggregates, or, for a snapshot of a
 * year with no NCR yet, the live projections.
 */
export type ReleaseSourceName = 'national-report' | 'live-projections';

/** The release JSON. */
export interface ReleaseDocument {
  id: string;
  fy: number;
  kind: string;
  version: number;
  builtAt: string;
  source: ReleaseSourceName;
  /**
   * The approved national consolidated report the release reconciles with; null for a draft,
   * or for a snapshot of the live projections.
   */
  ncrReference: string | null;
  suppression: { threshold: number };
  tables: ReleaseTableEntry[];
}

export function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

export function tableJson(table: OpenDataTable): Buffer {
  return Buffer.from(`${JSON.stringify(table)}\n`, 'utf8');
}

export function tableCsv(table: OpenDataTable): Buffer {
  const header = table.columns.map((column) =>
    csvField(column === 'suppressed' ? '_suppressed' : column),
  );
  const lines = [header.join(',')];
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvField(row[column])).join(','));
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

/** Every file of a release: each table as JSON then CSV, in table order, then the release JSON. */
export function datasetFiles(
  release: Omit<ReleaseDocument, 'tables'>,
  tables: ReleaseTables,
): DatasetFile[] {
  const files: DatasetFile[] = [];
  const entries: ReleaseTableEntry[] = [];
  for (const name of OPEN_DATA_TABLES) {
    const table = tables[name];
    const json = fileOf(name, 'json', tableJson(table), table.rows.length);
    const csv = fileOf(name, 'csv', tableCsv(table), table.rows.length);
    files.push(json, csv);
    entries.push({
      table: name,
      rows: table.rows.length,
      sha256Json: json.sha256,
      sha256Csv: csv.sha256,
    });
  }
  const document: ReleaseDocument = { ...release, tables: entries };
  files.push(
    fileOf(
      RELEASE_FILE,
      'json',
      Buffer.from(`${JSON.stringify(document)}\n`, 'utf8'),
      entries.length,
    ),
  );
  return files;
}

/** Where a release's file lives in the open-data bucket. */
export function objectKeyOf(releaseId: string, table: ReleaseFileName, format: FileFormat): string {
  return `releases/${releaseId}/${table}.${format}`;
}

function fileOf(
  table: ReleaseFileName,
  format: FileFormat,
  body: Buffer,
  rows: number,
): DatasetFile {
  return { table, format, body, rows, sha256: sha256(body) };
}

function csvField(value: TableRow[string] | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
