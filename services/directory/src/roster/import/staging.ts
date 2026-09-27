import { type Database, withTenant } from '@adili/data-access';
import { and, eq, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import type { DirectorySchema } from '../../db/schema.js';
import type { ColumnMapping } from '../header-mapping.js';
import { type ParsedRosterRow, parseRosterFile } from '../roster-file.js';
import { rosterImportRows, rosterImports } from '../schema.js';
import { RosterFileError } from '../sheet.js';
import { type RosterUploads, UploadNotClean, UploadNotFound } from './roster-uploads.js';
import type { ImportFailure, ImportRef, StageResult } from './workflow-contract.js';

/** Accepted rows applied per `applyChunk`, each chunk in one transaction. */
export const CHUNK_SIZE = 1000;

/** Staged rows written per insert (and per heartbeat). */
const INSERT_BATCH = 1000;

/** `app.subject` of the import activities' transactions. */
export const IMPORT_SUBJECT = 'roster-import';

/** The import started, but its transaction has not committed yet or rolled back. Retry. */
export class ImportNotFound extends Error {
  constructor(importId: string) {
    super(`Roster import ${importId} not found`);
    this.name = 'ImportNotFound';
  }
}

/** Rows to stage: from a file or (spec #27 API channel) an inline batch, already validated. */
export type StagingSource =
  | { ok: true; mapping: ColumnMapping | null; rows: AsyncIterable<ParsedRosterRow> }
  | { ok: false; mapping: ColumnMapping | null; failure: ImportFailure };

export interface StageOptions {
  /** Called after each batch of staged rows, with the rows staged so far. */
  heartbeat?: (rowsStaged: number) => void;
}

type ImportRow = typeof rosterImports.$inferSelect;

/**
 * Stages an import's rows: reads the input, validates every row and writes it to
 * `roster_import_rows` as accepted (numbered into chunks of `CHUNK_SIZE`) or rejected with its
 * errors, then records the totals and the column mapping. Moves the import to `processing`.
 *
 * Restart-safe: an import already staged returns its plan without reading the input again; a
 * staging cut short (crash, retry) starts over, deleting the rows it had written. Input that
 * cannot be imported (missing required columns, unreadable file, upload gone) returns `failed`
 * with no rows staged. Throws `DocumentsUnavailable` when the file cannot be fetched, for a retry.
 */
export async function stageImport(
  db: Database<DirectorySchema>,
  uploads: RosterUploads,
  ref: ImportRef,
  options: StageOptions = {},
): Promise<StageResult> {
  const context = { tenant: ref.tenant, subject: IMPORT_SUBJECT };
  const current = await withTenant(db, context, async (tx) => {
    const [row] = await tx
      .select()
      .from(rosterImports)
      .where(and(eq(rosterImports.id, ref.importId), eq(rosterImports.tenant, ref.tenant)))
      .for('update');
    if (!row || row.state === 'completed' || row.state === 'failed' || row.chunkCount !== null) {
      return row;
    }
    await tx.delete(rosterImportRows).where(eq(rosterImportRows.importId, ref.importId));
    await tx
      .update(rosterImports)
      .set({ state: 'processing', processedRows: 0 })
      .where(eq(rosterImports.id, ref.importId));
    return row;
  });
  if (!current) throw new ImportNotFound(ref.importId);
  if (current.state === 'completed' || current.state === 'failed') return { outcome: 'ended' };
  if (current.chunkCount !== null) {
    return {
      outcome: 'staged',
      chunkCount: current.chunkCount,
      declaredComplete: current.declaredComplete,
    };
  }

  const source = await openSource(uploads, current);
  if (!source.ok) {
    await recordUnimportable(db, ref, source.mapping);
    return { outcome: 'failed', failure: source.failure };
  }

  const writer = new RowWriter(db, ref, options);
  try {
    for await (const row of source.rows) await writer.add(row);
    await writer.flush();
  } catch (error) {
    if (!(error instanceof RosterFileError)) throw error;
    await recordUnimportable(db, ref, source.mapping);
    return { outcome: 'failed', failure: { code: 'parse-error', detail: error.message } };
  }

  const chunkCount = Math.ceil(writer.accepted / CHUNK_SIZE);
  await withTenant(db, context, async (tx) => {
    await tx
      .update(rosterImports)
      .set({
        totalRows: writer.accepted + writer.rejected,
        processedRows: writer.rejected,
        chunkCount,
        mapping: source.mapping,
      })
      .where(eq(rosterImports.id, ref.importId));
    await markRejectedRowsSeen(tx, ref);
  });
  return { outcome: 'staged', chunkCount, declaredComplete: current.declaredComplete };
}

/**
 * Whitespace as the row validator's `\s` trims it (JavaScript's `\s`, which Postgres's does not
 * fully cover), for reading a rejected row's personnel file number as the validator would.
 */
const WHITESPACE = String.raw`[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]`;

/**
 * Marks the records that rows rejected when staged were for as seen in this import: the officer
 * is in the file even though their row has errors, so a declared-complete import must not flag
 * them absent (decision in #41). A row names a record when its personnel file number, trimmed,
 * is the record's (case-insensitively); an invalid file number names none, because every record's
 * is valid. Rows rejected later (`identity-locked`) are marked seen when applied.
 */
async function markRejectedRowsSeen(tx: Transaction, ref: ImportRef): Promise<void> {
  await tx.execute(sql`
    update roster_records as record set last_seen_import_id = ${ref.importId}
    from (
      select distinct lower(regexp_replace(
        raw ->> 'personnelFileNumber', ${`^${WHITESPACE}+|${WHITESPACE}+$`}, '', 'g'
      )) as file_number_key
      from roster_import_rows
      where import_id = ${ref.importId} and status = 'rejected' and chunk_index is null
    ) as rejected
    where record.tenant = ${ref.tenant}
      and lower(record.personnel_file_number) = rejected.file_number_key
  `);
}

async function openSource(uploads: RosterUploads, row: ImportRow): Promise<StagingSource> {
  if (row.channel !== 'file' || row.uploadId === null) {
    return {
      ok: false,
      mapping: null,
      failure: { code: 'internal', detail: 'API batches are not supported yet.' },
    };
  }
  try {
    const upload = await uploads.open(row.tenant, row.uploadId);
    const file = await parseRosterFile(upload.body, upload.format);
    if (!file.ok) {
      return {
        ok: false,
        mapping: file.mapping,
        failure: {
          code: 'missing-columns',
          detail: `The file has no ${file.missingRequired.join(', ')} column. Add ${file.missingRequired.length === 1 ? 'it' : 'them'} and upload the file again.`,
        },
      };
    }
    return { ok: true, mapping: file.mapping, rows: file.rows };
  } catch (error) {
    if (error instanceof UploadNotFound || error instanceof UploadNotClean) {
      return {
        ok: false,
        mapping: null,
        failure: {
          code: 'upload-not-clean',
          detail: 'The uploaded file is no longer available. Upload it again.',
        },
      };
    }
    if (error instanceof RosterFileError) {
      return { ok: false, mapping: null, failure: { code: 'parse-error', detail: error.message } };
    }
    throw error;
  }
}

/** Leaves an import that cannot be imported with its mapping (if read) and no staged rows. */
async function recordUnimportable(
  db: Database<DirectorySchema>,
  ref: ImportRef,
  mapping: ColumnMapping | null,
): Promise<void> {
  await withTenant(db, { tenant: ref.tenant, subject: IMPORT_SUBJECT }, async (tx) => {
    await tx.delete(rosterImportRows).where(eq(rosterImportRows.importId, ref.importId));
    await tx.update(rosterImports).set({ mapping }).where(eq(rosterImports.id, ref.importId));
  });
}

/** Writes staged rows in batches, numbering accepted rows into chunks. */
class RowWriter {
  accepted = 0;
  rejected = 0;
  private batch: (typeof rosterImportRows.$inferInsert)[] = [];

  constructor(
    private readonly db: Database<DirectorySchema>,
    private readonly ref: ImportRef,
    private readonly options: StageOptions,
  ) {}

  async add(row: ParsedRosterRow): Promise<void> {
    let chunkIndex: number | null = null;
    if (row.status === 'accepted') {
      chunkIndex = Math.floor(this.accepted / CHUNK_SIZE);
      this.accepted += 1;
    } else {
      this.rejected += 1;
    }
    this.batch.push({
      importId: this.ref.importId,
      rowNumber: row.rowNumber,
      tenant: this.ref.tenant,
      raw: row.raw,
      normalised: row.normalised,
      status: row.status,
      errors: row.errors,
      chunkIndex,
    });
    if (this.batch.length >= INSERT_BATCH) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const rows = this.batch;
    this.batch = [];
    await withTenant(this.db, { tenant: this.ref.tenant, subject: IMPORT_SUBJECT }, (tx) =>
      tx.insert(rosterImportRows).values(rows),
    );
    this.options.heartbeat?.(this.accepted + this.rejected);
  }
}
