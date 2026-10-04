import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { asc, desc, eq } from 'drizzle-orm';

import { requireEacc, requireEaccSupervisor } from '../access.js';
import type { ReportingSchema } from '../db/schema.js';
import { DirectoryUnavailable } from '../directory/directory-client.js';
import { DocumentsUnavailable } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { nationalReports } from '../national-reports/schema.js';
import { officerOf, storedOfficer } from '../officer.js';
import { directoryUnavailable, notFound, problem, storageUnavailable } from '../problems.js';
import { eaccContext } from '../system-context.js';
import { OpenDataFiles, OpenDataStorageUnavailable } from './open-data-files.js';
import {
  AnnualReleasePublished,
  FyNotStarted,
  NcrNotApproved,
  NcrNotBuilt,
  OpenDataReleaseBuilder,
  ReconciliationFailed,
  ReleaseBuildInProgress,
} from './release-builder.js';
import {
  OpenDataReleasePublisher,
  ReleaseNotInPreview,
  ReleaseNotPublished,
} from './release-publisher.js';
import {
  type OpenDataReleaseDetail,
  type OpenDataReleaseView,
  openDataReleaseView,
  ReleaseNotFound,
} from './representation.js';
import { openDataFiles, openDataReleases, type ReleaseKind } from './schema.js';
import { OPEN_DATA_TABLES, type OpenDataTable, type OpenDataTableName } from './tables.js';

const EACC_ONLY = 'Only EACC analysts and supervisors work on open-data releases.';

const NOT_FOUND = 'No open-data release has this id.';

/**
 * EACC's open-data releases (spec 09b): every release, previews and withdrawn ones included, and
 * a release built on demand as a preview, a mid-year snapshot or a corrected annual release
 * (EACC analysts and supervisors; anyone else 403); an EACC supervisor publishes a preview (its
 * manifest issued as a Public verifiable document) and withdraws a published release with a
 * reason, its manifest revoked (anyone else 403).
 */
@Injectable()
export class OpenDataService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly builder: OpenDataReleaseBuilder,
    private readonly publisher: OpenDataReleasePublisher,
    private readonly files: OpenDataFiles,
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
   * A release of any status, a preview included (the one checked before it is published, S6),
   * with who built it, its source and its six table files read from object storage as stored.
   * The source is the release's record: the NCR it was built from, its reference when it was
   * approved by then (as the release JSON names it), or the live projections. 404 for no
   * release; 503 `storage-unavailable` while the files cannot be read.
   */
  async get(principal: Principal, releaseId: string): Promise<OpenDataReleaseDetail> {
    requireEacc(principal, EACC_ONLY);
    const found = await withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const [row] = await tx
        .select({
          release: openDataReleases,
          ncrReference: nationalReports.reference,
          ncrApprovedAt: nationalReports.approvedAt,
        })
        .from(openDataReleases)
        .leftJoin(nationalReports, eq(nationalReports.id, openDataReleases.nationalReportId))
        .where(eq(openDataReleases.id, releaseId));
      if (!row) return null;
      const files = await tx
        .select()
        .from(openDataFiles)
        .where(eq(openDataFiles.releaseId, releaseId));
      return { ...row, files };
    });
    if (!found) throw notFound(NOT_FOUND);
    const { release, files, ncrReference, ncrApprovedAt } = found;

    const tables = {} as Record<OpenDataTableName, OpenDataTable>;
    try {
      await Promise.all(
        OPEN_DATA_TABLES.map(async (table) => {
          const file = files.find((each) => each.table === table && each.format === 'json');
          if (!file) throw new Error(`Open-data release ${releaseId} has no ${table} JSON`);
          const body = await this.files.get(file.objectKey);
          tables[table] = JSON.parse(Buffer.from(body).toString('utf8')) as OpenDataTable;
        }),
      );
    } catch (error) {
      if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
      throw error;
    }

    const approvedAtBuild = ncrApprovedAt !== null && ncrApprovedAt <= release.builtAt;
    return {
      release: openDataReleaseView(release, files),
      builtBy: storedOfficer(release.builtBy, release.builtByName),
      source: {
        kind: release.nationalReportId === null ? 'live-projections' : 'national-report',
        nationalReportReference: approvedAtBuild ? ncrReference : null,
      },
      tables,
    };
  }

  /**
   * Builds a release of the year as a preview: a snapshot (of the NCR's aggregates once built, of
   * the live projections before then, so a year in progress can be shown), or an annual release
   * of the approved NCR (a corrected one, the next annual version, after the published one is
   * withdrawn; it is published deliberately). 409 `fy-not-started` for a snapshot of a year not
   * started, `ncr-not-built` for an annual release before the year's NCR is built,
   * `ncr-not-approved` before it is approved, `annual-release-published` for an annual release
   * while one of the year is published, `release-building` while another build of the year and
   * kind is under way, `reconciliation-failed` when the tables' national totals
   * differ from their source's (a fault of the table builder); 503 `storage-unavailable` while
   * object storage cannot be reached, `directory-unavailable` while the directory cannot (a
   * snapshot of the live projections).
   */
  async build(principal: Principal, fy: number, kind: ReleaseKind): Promise<OpenDataReleaseView> {
    requireEacc(principal, EACC_ONLY);
    try {
      return await this.builder.build({ fy, kind, builtBy: officerOf(principal) });
    } catch (error) {
      if (error instanceof NcrNotBuilt) {
        throw problem(
          'ncr-not-built',
          'Build the national consolidated report for the year before an annual release of it.',
        );
      }
      if (error instanceof FyNotStarted) {
        throw problem(
          'fy-not-started',
          'The financial year has not started: there is nothing to release for it yet.',
        );
      }
      if (error instanceof NcrNotApproved) {
        throw problem(
          'ncr-not-approved',
          'An annual release is built from the approved national consolidated report: approve it first.',
        );
      }
      if (error instanceof AnnualReleasePublished) throw annualReleasePublished();
      if (error instanceof ReleaseBuildInProgress) {
        throw problem(
          'release-building',
          'A release of this year and kind is being built. Try again once it is done.',
        );
      }
      if (error instanceof ReconciliationFailed) {
        throw problem(
          'reconciliation-failed',
          'The release tables do not reconcile with the national totals they were built from, so nothing was built. Report this fault to the platform team.',
          { extensions: { mismatches: [...error.mismatches] } },
        );
      }
      if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
  }

  /**
   * An EACC supervisor publishes a preview: its manifest is issued through documents as a Public
   * verifiable document, then it is `published` with `open-data.release.published.v1`. 404 for no
   * release; 409 `release-not-preview` once published or withdrawn, `annual-release-published`
   * for an annual preview while another annual release of the year is published; 503
   * `documents-unavailable`
   * while documents cannot be reached and 502 `manifest-refused` when it refuses the manifest
   * (nothing is published either way).
   */
  async publish(principal: Principal, releaseId: string): Promise<OpenDataReleaseView> {
    requireEaccSupervisor(principal, 'publish an open-data release');
    const officer = officerOf(principal);
    try {
      await this.publisher.issueManifest(releaseId, officer.name);
      return await this.publisher.publish(releaseId, officer);
    } catch (error) {
      if (error instanceof ReleaseNotFound) throw notFound(NOT_FOUND);
      if (error instanceof ReleaseNotInPreview) {
        throw problem(
          'release-not-preview',
          `The release is ${error.status}: only a preview is published.`,
        );
      }
      if (error instanceof AnnualReleasePublished) throw annualReleasePublished();
      if (error instanceof DocumentsUnavailable) {
        throw documentsUnavailable('The release manifest could not be issued just now.');
      }
      if (error instanceof InternalApiRejected) {
        throw problem('manifest-refused', 'The documents service refused the release manifest.');
      }
      if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
      throw error;
    }
  }

  /**
   * An EACC supervisor withdraws a published release with a public reason: its manifest is
   * revoked through documents (the verify page shows it revoked, reason `withdrawn`), then it is
   * `withdrawn` with `open-data.release.withdrawn.v1`; its files are still served. 404 for no
   * release; 409 `release-not-published` for a preview or a release withdrawn already; 503
   * `documents-unavailable` while documents cannot be reached and 502
   * `manifest-revocation-refused` when it refuses the revocation (nothing is withdrawn either
   * way).
   */
  async withdraw(
    principal: Principal,
    releaseId: string,
    reason: string,
  ): Promise<OpenDataReleaseView> {
    requireEaccSupervisor(principal, 'withdraw an open-data release');
    try {
      return await this.publisher.withdraw(releaseId, officerOf(principal), reason);
    } catch (error) {
      if (error instanceof ReleaseNotFound) throw notFound(NOT_FOUND);
      if (error instanceof ReleaseNotPublished) {
        throw problem(
          'release-not-published',
          `The release is ${error.status}: only a published release is withdrawn.`,
        );
      }
      if (error instanceof DocumentsUnavailable) {
        throw documentsUnavailable('The release manifest could not be revoked just now.');
      }
      if (error instanceof InternalApiRejected) {
        throw problem(
          'manifest-revocation-refused',
          'The documents service refused to revoke the release manifest.',
        );
      }
      throw error;
    }
  }
}

function annualReleasePublished(): ProblemException {
  return problem(
    'annual-release-published',
    'The year has a published annual release: withdraw it before a corrected one.',
  );
}

function documentsUnavailable(what: string): ProblemException {
  return new ProblemException({
    type: 'documents-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: `${what} Try again shortly.`,
  });
}
