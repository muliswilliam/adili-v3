import { Readable } from 'node:stream';

import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { and, asc, eq, gt } from 'drizzle-orm';

import type { DirectorySchema } from '../../db/schema.js';
import { isHrSystem } from '../api-credential/hr-system-access.js';
import { recordsReadContext } from '../records/access.js';
import { type ImportRowStatus, rosterImportRows, rosterImports } from '../schema.js';
import { decodeRowCursor, encodeRowCursor } from './cursors.js';
import { rowsExpired } from './import-rows-purge.js';
import { reportFileName, reportHeader, reportLine } from './report-csv.js';
import type {
  ListRosterImportRowsQuery,
  RosterImportRow,
  RosterImportRowPage,
} from './representation.js';

/** Rows read per query while streaming the report. */
const REPORT_PAGE_SIZE = 1000;

export interface ImportReport {
  fileName: string;
  /** The CSV, read from the database a page at a time as it is consumed. */
  body: Readable;
}

type StagedRow = typeof rosterImportRows.$inferSelect;

/**
 * The staged rows of an import (spec #27): the report's rejected rows, and the rejected rows CSV
 * the officer fixes and uploads again. Rows hold the roster's personal data, so they are read
 * like roster records (`recordsReadContext`): the Commission's own staff and platform admins,
 * never EACC. The Commission's HR system reads them too.
 */
@Injectable()
export class RosterImportRowsService {
  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  /** One page of an import's rows in row-number order, optionally only accepted or rejected. */
  async list(
    principal: Principal,
    slug: string,
    importId: string,
    query: ListRosterImportRowsQuery,
  ): Promise<RosterImportRowPage> {
    const after = query.cursor === undefined ? undefined : decodeRowCursor(query.cursor);
    const context = await this.requireRows(principal, slug, importId);
    const rows = await this.page(context, importId, query.status, after, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toRosterImportRow),
      nextCursor: rows.length > query.limit && last ? encodeRowCursor(last.rowNumber) : null,
    };
  }

  /**
   * The rejected rows as CSV: the values as sent under the template headers, then the reason
   * columns. Streamed a page at a time, so a report of any size is never held in memory.
   */
  async report(principal: Principal, slug: string, importId: string): Promise<ImportReport> {
    const context = await this.requireRows(principal, slug, importId);
    return {
      fileName: reportFileName(context.fileName),
      body: Readable.from(this.reportLines(context, importId)),
    };
  }

  private async *reportLines(context: TenantContext, importId: string): AsyncGenerator<string> {
    yield reportHeader();
    let after: number | undefined;
    for (;;) {
      const rows = await this.page(context, importId, 'rejected', after, REPORT_PAGE_SIZE);
      if (rows.length > 0) yield rows.map(reportLine).join('');
      const last = rows.at(-1);
      if (rows.length < REPORT_PAGE_SIZE || !last) return;
      after = last.rowNumber;
    }
  }

  /**
   * The RLS context to read the import's rows in, with its file name, when the caller may read
   * them and they are still kept: 404 for an import of another Commission or none, 403 for EACC,
   * 410 once its rows are purged (30 days after it ended).
   */
  private async requireRows(
    principal: Principal,
    slug: string,
    importId: string,
  ): Promise<TenantContext & { fileName: string | null }> {
    const context = rowsReadContext(principal, slug);
    const [found] = await withTenant(this.db, context, (tx) =>
      tx
        .select({ fileName: rosterImports.fileName, completedAt: rosterImports.completedAt })
        .from(rosterImports)
        .where(and(eq(rosterImports.id, importId), eq(rosterImports.tenant, slug))),
    );
    const visible = notFoundIfInvisible(found);
    if (rowsExpired(visible.completedAt)) {
      throw new ProblemException({
        type: 'import-rows-purged',
        title: 'Import rows purged',
        status: HttpStatus.GONE,
        detail:
          'The rows of an import are kept for 30 days after it ends. Its counts are still in the import history.',
      });
    }
    return { ...context, fileName: visible.fileName };
  }

  private page(
    context: TenantContext,
    importId: string,
    status: ImportRowStatus | undefined,
    after: number | undefined,
    limit: number,
  ): Promise<StagedRow[]> {
    return withTenant(this.db, context, (tx) =>
      tx
        .select()
        .from(rosterImportRows)
        .where(
          and(
            eq(rosterImportRows.importId, importId),
            status && eq(rosterImportRows.status, status),
            after === undefined ? undefined : gt(rosterImportRows.rowNumber, after),
          ),
        )
        .orderBy(asc(rosterImportRows.rowNumber))
        .limit(limit),
    );
  }
}

/**
 * Rows are read like roster records (`recordsReadContext`), and also by the Commission's own HR
 * system, which reads the reports of the batches it sent (user story 36) but not the records.
 */
function rowsReadContext(principal: Principal, slug: string): TenantContext {
  if (isHrSystem(principal)) {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    return { tenant: slug, subject: principal.subject };
  }
  return recordsReadContext(principal, slug);
}

function toRosterImportRow(row: StagedRow): RosterImportRow {
  return {
    rowNumber: row.rowNumber,
    status: row.status,
    raw: row.raw,
    errors: row.errors,
    notes: row.notes,
    outcome: row.outcome,
    recordId: row.recordId,
  };
}
