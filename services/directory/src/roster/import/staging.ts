import { randomUUID } from 'node:crypto';

import { type Database, withTenant } from '@adili/data-access';
import { and, eq, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import type { DirectorySchema } from '../../db/schema.js';
import type { ColumnMapping } from '../header-mapping.js';
import { type ParsedRosterRow, parseRosterFile } from '../roster-file.js';
import { createRowValidator } from '../row-validation.js';
import { rosterImportBatches, rosterImportRows, rosterImports } from '../schema.js';
import type { RosterUploads } from './roster-uploads.js';
import { type UploadFailureKind, uploadFailureOf } from './upload-failure.js';
import type { ImportFailure, ImportRef, StageResult } from './workflow-contract.js';

/** Accepted rows applied per `applyChunk`, each chunk in one transaction. */
export const CHUNK_SIZE = 1000;

/** Staged rows written per insert (and per heartbeat). */
const INSERT_BATCH = 1000;

/** `app.subject` of the import activities' transactions. */
export const IMPORT_SUBJECT = 'roster-import';

/** Rows to stage: from a file or (spec #27 API channel) an inline batch, already validated. */
export type StagingSource =
  | {
      ok: true;
      mapping: ColumnMapping | null;
      rows: AsyncIterable<ParsedRosterRow> | Iterable<ParsedRosterRow>;
    }
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
 * staging cut short (crash, retry) starts over, deleting the rows it had written. Each attempt
 * claims the import when it starts over and writes only while it holds the claim, so an attempt
 * still running when its successor starts (one Temporal took for lost) stops with
 * `StagingSuperseded` at its next write instead of writing alongside it. Input that cannot be
 * imported (missing required columns, unreadable file, upload gone) returns `failed` with no rows
 * staged. Throws `DocumentsUnavailable` when the file cannot be fetched, for a retry.
 */
export async function stageImport(
  db: Database<DirectorySchema>,
  uploads: RosterUploads,
  ref: ImportRef,
  options: StageOptions = {},
): Promise<StageResult> {
  const context = { tenant: ref.tenant, subject: IMPORT_SUBJECT };
  const attempt = randomUUID();
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
      .set({ state: 'processing', processedRows: 0, stagingAttempt: attempt })
      .where(eq(rosterImports.id, ref.importId));
    return row;
  });
  // The import commits before its workflow starts: one not found was withdrawn.
  if (!current || current.state === 'completed' || current.state === 'failed') {
    return { outcome: 'ended' };
  }
  if (current.chunkCount !== null) {
    return {
      outcome: 'staged',
      chunkCount: current.chunkCount,
      declaredComplete: current.declaredComplete,
    };
  }

  const claim: StagingClaim = { ...ref, attempt };
  const source = await openSource(db, uploads, current);
  if (!source.ok) {
    await recordUnimportable(db, claim, source.mapping);
    return { outcome: 'failed', failure: source.failure };
  }

  const writer = new RowWriter(db, claim, options);
  try {
    for await (const row of source.rows) await writer.add(row);
    await writer.flush();
  } catch (error) {
    const failure = importFailureOf(error);
    if (!failure) throw error;
    await recordUnimportable(db, claim, source.mapping);
    return { outcome: 'failed', failure };
  }

  const chunkCount = Math.ceil(writer.accepted / CHUNK_SIZE);
  await withTenant(db, context, async (tx) => {
    await holdClaim(tx, claim);
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
    // An API batch's rows are now the import's rows.
    await tx.delete(rosterImportBatches).where(eq(rosterImportBatches.importId, ref.importId));
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
  // The records are locked in id order first, as everywhere records are locked.
  await tx.execute(sql`
    with rejected as (
      select distinct lower(regexp_replace(
        raw ->> 'personnelFileNumber', ${`^${WHITESPACE}+|${WHITESPACE}+$`}, '', 'g'
      )) as file_number_key
      from roster_import_rows
      where import_id = ${ref.importId} and status = 'rejected' and chunk_index is null
    ), seen as (
      select record.id
      from roster_records as record
      join rejected on lower(record.personnel_file_number) = rejected.file_number_key
      where record.tenant = ${ref.tenant}
      order by record.id
      for update of record
    )
    update roster_records as record set last_seen_import_id = ${ref.importId}
    from seen
    where record.id = seen.id
  `);
}

async function openSource(
  db: Database<DirectorySchema>,
  uploads: RosterUploads,
  row: ImportRow,
): Promise<StagingSource> {
  if (row.channel === 'api') return openBatch(db, row);
  if (row.uploadId === null) {
    return {
      ok: false,
      mapping: null,
      failure: { code: 'internal', detail: 'The import names no upload.' },
    };
  }
  try {
    const upload = await uploads.open({ tenant: row.tenant, uploadId: row.uploadId });
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
    const failure = importFailureOf(error);
    if (!failure) throw error;
    return { ok: false, mapping: null, failure };
  }
}

/**
 * How an upload that cannot be read fails the import, or undefined when the error does not fail
 * it: documents being unavailable is not the file's fault, so the activity retries.
 */
function importFailureOf(error: unknown): ImportFailure | undefined {
  const failure = uploadFailureOf(error);
  if (!failure || failure.kind === 'unavailable') return undefined;
  return IMPORT_FAILURES[failure.kind](failure.detail);
}

const IMPORT_FAILURES: Record<
  Exclude<UploadFailureKind, 'unavailable'>,
  (detail: string) => ImportFailure
> = {
  'not-found': () => ({
    code: 'upload-missing',
    detail: 'The uploaded file is no longer available. Upload it again.',
  }),
  'not-clean': () => ({
    code: 'upload-not-clean',
    detail: 'The uploaded file has not passed its checks. Upload it again.',
  }),
  unreadable: (detail) => ({ code: 'parse-error', detail }),
};

/**
 * The rows of an API batch, as stored when the import started, validated in order like a file's
 * rows (numbered from 1). No column mapping: the fields are named.
 */
async function openBatch(db: Database<DirectorySchema>, row: ImportRow): Promise<StagingSource> {
  const [batch] = await withTenant(db, { tenant: row.tenant, subject: IMPORT_SUBJECT }, (tx) =>
    tx
      .select({ rows: rosterImportBatches.rows })
      .from(rosterImportBatches)
      .where(eq(rosterImportBatches.importId, row.id)),
  );
  if (!batch) {
    return {
      ok: false,
      mapping: null,
      failure: { code: 'internal', detail: "The batch's rows are missing." },
    };
  }
  const stored = batch.rows;
  const validate = createRowValidator();
  function* rows(): Generator<ParsedRosterRow> {
    for (const [index, raw] of stored.entries()) {
      yield { rowNumber: index + 1, raw, ...validate(raw, index + 1) };
    }
  }
  return { ok: true, mapping: null, rows: rows() };
}

/** Leaves an import that cannot be imported with its mapping (if read) and no staged rows. */
async function recordUnimportable(
  db: Database<DirectorySchema>,
  claim: StagingClaim,
  mapping: ColumnMapping | null,
): Promise<void> {
  await withTenant(db, { tenant: claim.tenant, subject: IMPORT_SUBJECT }, async (tx) => {
    await holdClaim(tx, claim);
    await tx.delete(rosterImportRows).where(eq(rosterImportRows.importId, claim.importId));
    await tx.update(rosterImports).set({ mapping }).where(eq(rosterImports.id, claim.importId));
  });
}

/** A later staging attempt of the import has started over: this one must stop writing. */
export class StagingSuperseded extends Error {
  constructor(importId: string) {
    super(`A later staging attempt of roster import ${importId} took over`);
    this.name = 'StagingSuperseded';
  }
}

/** The import a staging attempt works on, and the attempt's claim on it. */
interface StagingClaim extends ImportRef {
  attempt: string;
}

/**
 * Holds the attempt's claim until the transaction ends (a share lock on the import, which a
 * successor's claim waits for), so what the transaction writes cannot land after a successor has
 * started over. Throws `StagingSuperseded` when a successor already has.
 */
async function holdClaim(tx: Transaction, claim: StagingClaim): Promise<void> {
  const [held] = await tx
    .select({ id: rosterImports.id })
    .from(rosterImports)
    .where(
      and(eq(rosterImports.id, claim.importId), eq(rosterImports.stagingAttempt, claim.attempt)),
    )
    .for('share');
  if (!held) throw new StagingSuperseded(claim.importId);
}

/** Writes staged rows in batches, numbering accepted rows into chunks. */
class RowWriter {
  accepted = 0;
  rejected = 0;
  private batch: (typeof rosterImportRows.$inferInsert)[] = [];

  constructor(
    private readonly db: Database<DirectorySchema>,
    private readonly ref: StagingClaim,
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
    await withTenant(this.db, { tenant: this.ref.tenant, subject: IMPORT_SUBJECT }, async (tx) => {
      await holdClaim(tx, this.ref);
      await tx.insert(rosterImportRows).values(rows);
    });
    this.options.heartbeat?.(this.accepted + this.rejected);
  }
}
