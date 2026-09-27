import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';

import {
  canSeeCommission,
  REPORTING_OFFICER_ROLE,
  tenantContextOf,
} from '../../commissions/access.js';
import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { violatedUniqueConstraint } from '../../db/errors.js';
import { commissions, type DirectorySchema } from '../../db/schema.js';
import { rosterImports } from '../schema.js';
import { RosterFileError } from '../sheet.js';
import { previewRosterFile } from './preview.js';
import {
  columnMappingSchema,
  importCountsSchema,
  type PreviewRosterImportBody,
  type RosterImport,
  type RosterImportPreview,
  type StartFileImportBody,
} from './representation.js';
import {
  DocumentsUnavailable,
  RosterUploads,
  UploadNotClean,
  UploadNotFound,
} from './roster-uploads.js';
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
   * Starts importing a clean roster upload of the caller's Commission: records the import as
   * `pending` and starts its workflow before the transaction commits. No import is left pending
   * without a workflow (which would block the tenant's imports); a workflow whose import then
   * fails to commit finds none and ends (staging retries briefly, for the commit to land).
   * 409 `import-in-progress` while another import of the tenant is pending or processing.
   */
  async startFile(
    principal: Principal,
    slug: string,
    body: StartFileImportBody,
  ): Promise<RosterImport> {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    const upload = await this.uploads.describe(slug, body.uploadId).catch((error: unknown) => {
      throw this.asProblem(error);
    });
    try {
      return await withTenant(this.db, { tenant: slug, subject: principal.subject }, async (tx) => {
        await requireCommission(tx, slug);
        const [row] = await tx
          .insert(rosterImports)
          .values({
            tenant: slug,
            channel: 'file',
            declaredComplete: body.declaredComplete,
            uploadId: upload.id,
            fileName: upload.fileName,
            format: upload.format,
            ...startedBy(principal),
          })
          .returning();
        if (!row) throw new Error('insert returned no row');
        await this.startWorkflow(row);
        return toRosterImport(row);
      });
    } catch (error) {
      if (violatedUniqueConstraint(error) === 'roster_imports_one_in_progress_key') {
        throw new ProblemException({
          type: 'import-in-progress',
          title: 'Import in progress',
          status: HttpStatus.CONFLICT,
          detail:
            'Another roster import for this Commission is still running. Start this one when it has finished.',
        });
      }
      throw error;
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
   * How a clean roster upload's header lines up with the template, and roughly how many rows it
   * has, before the officer starts the import (decision 1). Reads the file; writes nothing.
   */
  async preview(
    principal: Principal,
    slug: string,
    body: PreviewRosterImportBody,
  ): Promise<RosterImportPreview> {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    try {
      const upload = await this.uploads.open(slug, body.uploadId);
      return { uploadId: upload.id, ...(await previewRosterFile(upload)) };
    } catch (error) {
      throw this.asProblem(error);
    }
  }

  private async startWorkflow(row: ImportRow): Promise<void> {
    try {
      await this.temporal.workflow.start<typeof rosterImport>(ROSTER_IMPORT_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: row.id,
        args: [{ importId: row.id, tenant: row.tenant }],
      });
    } catch (error) {
      this.logger.error({ err: error }, `Could not start the workflow of roster import ${row.id}`);
      throw new ProblemException({
        type: 'import-unavailable',
        title: 'Imports unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'Imports cannot start right now, so nothing was imported. Try again shortly.',
      });
    }
  }

  /** Maps failures to read an upload to the problems callers receive; others pass through. */
  private asProblem(error: unknown): unknown {
    if (error instanceof UploadNotFound) {
      return new ProblemException({
        type: 'upload-not-found',
        title: 'Upload not found',
        status: HttpStatus.NOT_FOUND,
        detail: 'This Commission has no roster upload with that id.',
      });
    }
    if (error instanceof UploadNotClean) {
      return new ProblemException({
        type: 'upload-not-clean',
        title: 'Upload not clean',
        status: HttpStatus.CONFLICT,
        detail: 'The upload has not passed its checks, so it cannot be imported.',
      });
    }
    if (error instanceof RosterFileError) {
      return new ProblemException({
        type: 'unreadable-file',
        title: 'Unreadable file',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail: error.message,
      });
    }
    if (error instanceof DocumentsUnavailable) {
      this.logger.warn({ err: error }, 'Documents unavailable for a roster upload');
      return new ProblemException({
        type: 'documents-unavailable',
        title: 'Documents unavailable',
        status: HttpStatus.BAD_GATEWAY,
        detail: 'The uploaded file cannot be read right now. Try again shortly.',
      });
    }
    return error;
  }
}

async function requireCommission(tx: Transaction, slug: string): Promise<void> {
  const [commission] = await tx
    .select({ slug: commissions.slug })
    .from(commissions)
    .where(eq(commissions.slug, slug));
  notFoundIfInvisible(commission);
}

/**
 * Who started an import (decision 10): a user with their token's display name, or an HR system
 * by its client id.
 */
function startedBy(
  principal: Principal,
): Pick<ImportRow, 'startedByKind' | 'startedBy' | 'startedByName'> {
  if (principal.roles.includes(REPORTING_OFFICER_ROLE) || principal.clientId === null) {
    return { startedByKind: 'user', startedBy: principal.subject, startedByName: principal.name };
  }
  return {
    startedByKind: 'client',
    startedBy: principal.clientId,
    startedByName: principal.clientId,
  };
}

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
    counts: row.counts && importCountsSchema.parse(row.counts),
    mapping: row.mapping && columnMappingSchema.parse(row.mapping),
    failure:
      row.failureCode === null ? null : { code: row.failureCode, detail: row.failureDetail ?? '' },
    startedBy: { kind: row.startedByKind, id: row.startedBy, name: row.startedByName },
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
