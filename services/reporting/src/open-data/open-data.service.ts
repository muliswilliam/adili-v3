import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { asc, desc } from 'drizzle-orm';

import { requireEacc } from '../access.js';
import type { ReportingSchema } from '../db/schema.js';
import { conflict } from '../problems.js';
import { eaccContext } from '../system-context.js';
import { OpenDataStorageUnavailable } from './open-data-files.js';
import { NcrNotBuilt, OpenDataReleaseBuilder, ReconciliationFailed } from './release-builder.js';
import { type OpenDataReleaseView, openDataReleaseView } from './representation.js';
import { openDataFiles, openDataReleases } from './schema.js';

const EACC_ONLY = 'Only EACC analysts and supervisors work on open-data releases.';

/**
 * EACC's open-data releases (spec 09b): every release, previews and withdrawn ones included, and
 * a mid-year snapshot built on demand as a preview (EACC analysts and supervisors; anyone else
 * 403). Publishing and withdrawing are #352's.
 */
@Injectable()
export class OpenDataService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly builder: OpenDataReleaseBuilder,
  ) {}

  /** Every release, the latest year first, then by kind and the latest version first. */
  async list(principal: Principal): Promise<OpenDataReleaseView[]> {
    requireEacc(principal, EACC_ONLY);
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const releases = await tx
        .select()
        .from(openDataReleases)
        .orderBy(
          desc(openDataReleases.fy),
          asc(openDataReleases.kind),
          desc(openDataReleases.version),
        );
      const files = await tx.select().from(openDataFiles);
      return releases.map((release) =>
        openDataReleaseView(
          release,
          files.filter((file) => file.releaseId === release.id),
        ),
      );
    });
  }

  /**
   * Builds a snapshot of the year as a preview. 409 `ncr-not-built` before the year's NCR is
   * built, `reconciliation-failed` when the reports have changed since it was; 503
   * `storage-unavailable` while object storage cannot be reached.
   */
  async buildSnapshot(principal: Principal, fy: number): Promise<OpenDataReleaseView> {
    requireEacc(principal, EACC_ONLY);
    try {
      return await this.builder.build({ fy, kind: 'snapshot', builtBy: principal.subject });
    } catch (error) {
      if (error instanceof NcrNotBuilt) {
        throw conflict(
          'ncr-not-built',
          'Build the national consolidated report for the year before a release of it.',
        );
      }
      if (error instanceof ReconciliationFailed) {
        throw new ProblemException(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail:
              'The release does not reconcile with the national consolidated report: the submitted reports have changed since it was built. Rebuild the report, then the release.',
          },
          { code: 'reconciliation-failed', mismatches: [...error.mismatches] },
        );
      }
      if (error instanceof OpenDataStorageUnavailable) {
        throw new ProblemException({
          type: 'storage-unavailable',
          title: 'Upstream service unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'The release files could not be written just now. Try again shortly.',
        });
      }
      throw error;
    }
  }
}
