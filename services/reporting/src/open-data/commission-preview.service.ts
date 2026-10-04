import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { desc, eq, inArray } from 'drizzle-orm';

import { formMTenant, requireCommissionAdmin } from '../access.js';
import type { ReportingSchema } from '../db/schema.js';
import { notFound, storageUnavailable } from '../problems.js';
import { PLATFORM_TENANT, systemContext } from '../system-context.js';
import { OpenDataFiles, OpenDataStorageUnavailable } from './open-data-files.js';
import { type OpenDataReleaseView, openDataReleaseView } from './representation.js';
import { openDataFiles, openDataReleases, type ReleaseStatus } from './schema.js';
import type { OpenDataTable, OpenDataTableName, TableRow } from './tables.js';

/** The tables with a row per Commission; the national ones never reach a Commission. */
export const COMMISSION_TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'access-requests',
] as const satisfies readonly OpenDataTableName[];
export type CommissionTable = (typeof COMMISSION_TABLES)[number];

/** reporting.yaml `getCommissionOpenDataPreview` body. */
export interface CommissionOpenDataPreview {
  release: OpenDataReleaseView;
  tables: Record<CommissionTable, TableRow[]>;
}

/** A withdrawn release is never shown: its figures were wrong, or superseded by the next version. */
const SHOWN_STATUSES: ReleaseStatus[] = ['preview', 'published'];

/**
 * A commission-admin's preview of their own Commission's open-data rows (spec 09b S6,
 * authorisation "preview release": own Commission rows). The release shown is the current one:
 * of the most recent financial year with a preview or published release, the one built last, so
 * a preview built since the last publication wins and a stale preview an annual release has
 * overtaken does not; withdrawn releases are skipped. Its Commission tables are read from the
 * stored JSON (suppression as released) and filtered to the caller's Commission; the national
 * tables, and every other Commission's rows, are never returned.
 *
 * Releases are EACC data (RLS admits `eacc` and `platform`), so the read runs in the platform's
 * context and the Commission scoping is this code's: `formMTenant` (anyone not of the Commission
 * gets 404) and `requireCommissionAdmin` (its other staff get 403).
 */
@Injectable()
export class CommissionOpenDataPreviewService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly files: OpenDataFiles,
  ) {}

  /** 404 while no release has been built; 503 `storage-unavailable` when the files cannot be read. */
  async preview(principal: Principal, slug: string): Promise<CommissionOpenDataPreview> {
    const tenant = formMTenant(principal, slug);
    requireCommissionAdmin(principal, "preview the Commission's open data");

    const found = await withTenant(this.db, systemContext(PLATFORM_TENANT), async (tx) => {
      const [release] = await tx
        .select()
        .from(openDataReleases)
        .where(inArray(openDataReleases.status, SHOWN_STATUSES))
        .orderBy(
          desc(openDataReleases.fy),
          desc(openDataReleases.builtAt),
          desc(openDataReleases.version),
        )
        .limit(1);
      if (!release) return null;
      const files = await tx
        .select()
        .from(openDataFiles)
        .where(eq(openDataFiles.releaseId, release.id));
      return { release, files };
    });
    if (!found) throw notFound('No open-data release has been built yet.');

    const tables = {} as Record<CommissionTable, TableRow[]>;
    for (const table of COMMISSION_TABLES) {
      const file = found.files.find((row) => row.table === table && row.format === 'json');
      if (!file) throw new Error(`Release ${found.release.id} has no ${table} JSON`);
      const stored = await this.read(file.objectKey);
      tables[table] = stored.rows.filter((row) => row.commission === tenant);
    }
    return { release: openDataReleaseView(found.release, found.files), tables };
  }

  private async read(key: string): Promise<OpenDataTable> {
    try {
      const body = await this.files.get(key);
      return JSON.parse(Buffer.from(body).toString('utf8')) as OpenDataTable;
    } catch (error) {
      if (error instanceof OpenDataStorageUnavailable) {
        throw storageUnavailable();
      }
      throw error;
    }
  }
}
