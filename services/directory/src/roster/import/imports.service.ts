import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  notFoundIfInvisible,
  type Principal,
  type ProblemDetails,
  ProblemException,
} from '@adili/api-kit';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { canSeeCommission, ownTenantContext, tenantContextOf } from '../../commissions/access.js';
import { requireCommission } from '../../commissions/require-commission.js';
import { config } from '../../config.js';
import { violatedUniqueConstraint } from '../../db/errors.js';
import type { DirectorySchema } from '../../db/schema.js';
import { rosterActorOf, startedByColumns, startedByOf } from '../actor.js';
import { isHrSystem } from '../api-credential/hr-system-access.js';
import type { RawRosterRow } from '../row-validation.js';
import { rosterImportBatches, rosterImports } from '../schema.js';
import { decodeImportCursor, encodeImportCursor } from './cursors.js';
import { rowsRetainedUntil } from './import-rows-purge.js';
import { previewRosterFile } from './preview.js';
import {
  columnMappingSchema,
  importCountsSchema,
  type ListRosterImportsQuery,
  type PreviewRosterImportBody,
  type RosterImport,
  type RosterImportPage,
  type RosterImportPreview,
  type StartBatchImportBody,
  type StartFileImportBody,
} from './representation.js';
import { RosterUploads } from './roster-uploads.js';
import { type UploadFailureKind, uploadFailureOf } from './upload-failure.js';
import type { rosterImport } from './workflows.js';

type ImportRow = typeof rosterImports.$inferSelect;

/** Workflow type of `RosterImportWorkflow` (the exported function's name). */
const ROSTER_IMPORT_WORKFLOW = 'rosterImport';

/**
 * Starting and reading roster imports (spec #27). An import runs as `RosterImportWorkflow` on
 * the directory's task queue, with the import id as workflow id; its state is read from the
 * import row, which the workflow's activities keep current.
 */
@Injectable()
export class RosterImportsService {
  private readonly logger = new Logger(RosterImportsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly uploads: RosterUploads,
    @InjectTemporalClient() private readonly temporal: Client,
  ) {}

  /**
   * Starts importing a clean roster upload of the caller's Commission. See `start`. Files are the
   * reporting officer's: an HR system sends batches only (spec #27 matrix), so its token gets 403.
   */
  async startFile(
    principal: Principal,
    slug: string,
    body: StartFileImportBody,
  ): Promise<RosterImport> {
    const context = ownTenantContext(principal, slug);
    if (isHrSystem(principal)) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: 'An HR system imports rows inline (channel `api`), not uploaded files.',
      });
    }
    const upload = await this.uploads
      .describe({ tenant: slug, uploadId: body.uploadId })
      .catch((error: unknown) => {
        throw this.asProblem(error);
      });
    return this.start(principal, context, {
      channel: 'file',
      declaredComplete: body.declaredComplete,
      uploadId: upload.id,
      fileName: upload.fileName,
      format: upload.format,
    });
  }

  /**
   * Starts importing a batch of rows an HR system (or anyone who may import) sent inline
   * (channel `api`): the rows are stored with the import and staged by its workflow like a
   * file's, so row rules reject rows in the report rather than the request. A batch is never
   * declared complete. See `start`.
   */
  async startBatch(
    principal: Principal,
    slug: string,
    body: StartBatchImportBody,
  ): Promise<RosterImport> {
    return this.start(
      principal,
      ownTenantContext(principal, slug),
      { channel: 'api', declaredComplete: false, uploadId: null, fileName: null, format: 'json' },
      body.rows,
    );
  }

  /**
   * Records the import as `pending` (with the batch's rows, for an API batch), then starts its
   * workflow once that has committed, so the workflow always finds its import. When the workflow
   * cannot be started the import is withdrawn (503, nothing imported, safe to retry); an import
   * left pending anyway (a crash between the two) gets its workflow when the next import of the
   * tenant runs into it.
   * 409 `import-in-progress` while another import of the tenant is pending or processing.
   */
  private async start(
    principal: Principal,
    context: TenantContext,
    source: Pick<ImportRow, 'channel' | 'declaredComplete' | 'uploadId' | 'fileName' | 'format'>,
    batchRows?: RawRosterRow[],
  ): Promise<RosterImport> {
    const slug = context.tenant;
    let row: ImportRow;
    try {
      row = await withTenant(this.db, context, async (tx) => {
        await requireCommission(tx, slug);
        const [inserted] = await tx
          .insert(rosterImports)
          .values({ tenant: slug, ...source, ...startedByColumns(rosterActorOf(principal)) })
          .returning();
        if (!inserted) throw new Error('insert returned no row');
        if (batchRows) {
          await tx
            .insert(rosterImportBatches)
            .values({ importId: inserted.id, tenant: slug, rows: batchRows });
        }
        return inserted;
      });
    } catch (error) {
      if (violatedUniqueConstraint(error) === 'roster_imports_one_in_progress_key') {
        const running = await this.runningImport(context);
        if (running?.state === 'pending') await this.recoverPending(running);
        throw new ProblemException(
          {
            type: 'import-in-progress',
            title: 'Import in progress',
            status: HttpStatus.CONFLICT,
            detail:
              'Another roster import for this Commission is still running. Start this one when it has finished.',
          },
          running === undefined ? {} : { importId: running.id },
        );
      }
      throw error;
    }

    try {
      await this.ensureWorkflow(row);
    } catch (error) {
      this.logger.error({ err: error }, `Could not start the workflow of roster import ${row.id}`);
      const started = await this.withdraw(row, context);
      if (started) return toRosterImport(started);
      throw new ProblemException({
        type: 'import-unavailable',
        title: 'Imports unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'Imports cannot start right now, so nothing was imported. Try again shortly.',
      });
    }
    return toRosterImport(row);
  }

  /**
   * Deletes an import whose workflow could not be started (its batch rows go with it), unless
   * the workflow did start after all (the start's outcome was lost) and has picked it up: then
   * returns it as it is now.
   */
  private async withdraw(row: ImportRow, context: TenantContext): Promise<ImportRow | undefined> {
    return withTenant(this.db, context, async (tx) => {
      const deleted = await tx
        .delete(rosterImports)
        .where(and(eq(rosterImports.id, row.id), eq(rosterImports.state, 'pending')))
        .returning({ id: rosterImports.id });
      if (deleted.length > 0) return undefined;
      const [current] = await tx.select().from(rosterImports).where(eq(rosterImports.id, row.id));
      return current;
    });
  }

  /**
   * Starts the workflow of a pending import whose start was cut short, so it cannot block the
   * tenant's imports forever. A no-op while its workflow runs. Best effort: the caller answers
   * 409 either way.
   */
  private async recoverPending(row: ImportRow): Promise<void> {
    try {
      await this.ensureWorkflow(row);
    } catch (error) {
      this.logger.warn({ err: error }, `Could not recover roster import ${row.id}`);
    }
  }

  /** One import of the Commission, for its own staff and the national readers; 404 otherwise. */
  async get(principal: Principal, slug: string, importId: string): Promise<RosterImport> {
    notFoundIfInvisible(slug, () => canSeeCommission(principal, slug));
    const [row] = await withTenant(this.db, tenantContextOf(principal), (tx) =>
      tx
        .select()
        .from(rosterImports)
        .where(and(eq(rosterImports.id, importId), eq(rosterImports.tenant, slug))),
    );
    return toRosterImport(notFoundIfInvisible(row));
  }

  /**
   * The Commission's import history, newest first, for its own staff and the national readers;
   * 404 otherwise. Keyset-paged on (started at, id).
   */
  async list(
    principal: Principal,
    slug: string,
    query: ListRosterImportsQuery,
  ): Promise<RosterImportPage> {
    notFoundIfInvisible(slug, () => canSeeCommission(principal, slug));
    const after = query.cursor === undefined ? undefined : decodeImportCursor(query.cursor);
    // Microsecond precision, so the cursor sits exactly after the page's last import.
    const startedAtText = sql<string>`to_char(${rosterImports.startedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await withTenant(this.db, tenantContextOf(principal), (tx) =>
      tx
        .select({ row: rosterImports, startedAtText })
        .from(rosterImports)
        .where(
          and(
            eq(rosterImports.tenant, slug),
            after &&
              sql`(${rosterImports.startedAt}, ${rosterImports.id}) < (${after.startedAt}::timestamptz, ${after.id}::uuid)`,
          ),
        )
        .orderBy(desc(rosterImports.startedAt), desc(rosterImports.id))
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ row }) => toRosterImport(row)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeImportCursor({ startedAt: last.startedAtText, id: last.row.id })
          : null,
    };
  }

  /**
   * How a clean roster upload's header lines up with the template, and roughly how many rows it
   * has, before the officer starts the import (decision 1). Reads the file; writes nothing.
   */
  async preview(
    principal: Principal,
    slug: string,
    body: PreviewRosterImportBody,
  ): Promise<RosterImportPreview> {
    const { tenant } = ownTenantContext(principal, slug);
    try {
      const upload = await this.uploads.open({ tenant, uploadId: body.uploadId });
      return { uploadId: upload.id, ...(await previewRosterFile(upload)) };
    } catch (error) {
      throw this.asProblem(error);
    }
  }

  /** The tenant's pending or processing import, if it has not ended in the meantime. */
  private async runningImport(context: TenantContext): Promise<ImportRow | undefined> {
    const [running] = await withTenant(this.db, context, (tx) =>
      tx
        .select()
        .from(rosterImports)
        .where(
          and(
            eq(rosterImports.tenant, context.tenant),
            inArray(rosterImports.state, ['pending', 'processing']),
          ),
        ),
    );
    return running;
  }

  /**
   * Starts the import's workflow (workflow id = import id), or leaves the one already running:
   * safe to repeat. A workflow that ended while its import is still pending is run again.
   */
  private async ensureWorkflow(row: ImportRow): Promise<void> {
    await this.temporal.workflow.start<typeof rosterImport>(ROSTER_IMPORT_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: row.id,
      workflowIdConflictPolicy: 'USE_EXISTING',
      args: [{ importId: row.id, tenant: row.tenant }],
    });
  }

  /** Maps failures to read an upload to the problems callers receive; others pass through. */
  private asProblem(error: unknown): unknown {
    const failure = uploadFailureOf(error);
    if (!failure) return error;
    if (failure.kind === 'unavailable') {
      this.logger.warn({ err: error }, 'Documents unavailable for a roster upload');
    }
    return new ProblemException(UPLOAD_PROBLEMS[failure.kind](failure.detail));
  }
}

/** The problems callers receive for an upload that cannot be read. */
const UPLOAD_PROBLEMS: Record<
  UploadFailureKind,
  (detail: string) => Omit<ProblemDetails, 'instance'>
> = {
  'not-found': () => ({
    type: 'upload-not-found',
    title: 'Upload not found',
    status: HttpStatus.NOT_FOUND,
    detail: 'This Commission has no roster upload with that id.',
  }),
  'not-clean': () => ({
    type: 'upload-not-clean',
    title: 'Upload not clean',
    status: HttpStatus.CONFLICT,
    detail: 'The upload has not passed its checks, so it cannot be imported.',
  }),
  unreadable: (detail) => ({
    type: 'unreadable-file',
    title: 'Unreadable file',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    detail,
  }),
  unavailable: () => ({
    type: 'documents-unavailable',
    title: 'Documents unavailable',
    status: HttpStatus.BAD_GATEWAY,
    detail: 'The uploaded file cannot be read right now. Try again shortly.',
  }),
};

export function toRosterImport(row: ImportRow): RosterImport {
  return {
    id: row.id,
    channel: row.channel,
    declaredComplete: row.declaredComplete,
    state: row.state,
    fileName: row.fileName,
    format: row.format,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    // Parsed for the contract's key order: jsonb stores keys in its own.
    // Imports that ended before `noted` existed have none: nothing was noted then.
    counts: row.counts && importCountsSchema.parse({ noted: 0, ...(row.counts as object) }),
    mapping: row.mapping && columnMappingSchema.parse(row.mapping),
    failure:
      row.failureCode === null ? null : { code: row.failureCode, detail: row.failureDetail ?? '' },
    // Who started it (decision 10): a user, or an HR system by its client id.
    startedBy: startedByOf(row),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    rowsRetainedUntil: rowsRetainedUntil(row.completedAt)?.toISOString() ?? null,
  };
}
