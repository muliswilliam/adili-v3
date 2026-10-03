import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { asc, desc } from 'drizzle-orm';

import { requireEacc, requireEaccSupervisor } from '../access.js';
import type { ReportingSchema } from '../db/schema.js';
import { DocumentsUnavailable } from '../documents/documents-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { officerOf } from '../officer.js';
import { badGateway, conflict, notFound } from '../problems.js';
import { eaccContext } from '../system-context.js';
import { OpenDataStorageUnavailable } from './open-data-files.js';
import { NcrNotBuilt, OpenDataReleaseBuilder, ReconciliationFailed } from './release-builder.js';
import {
  OpenDataReleasePublisher,
  ReleaseNotFound,
  ReleaseNotInPreview,
  ReleaseNotPublished,
} from './release-publisher.js';
import { type OpenDataReleaseView, openDataReleaseView } from './representation.js';
import { openDataFiles, openDataReleases } from './schema.js';

const EACC_ONLY = 'Only EACC analysts and supervisors work on open-data releases.';

const NOT_FOUND = 'No open-data release has this id.';

/**
 * EACC's open-data releases (spec 09b): every release, previews and withdrawn ones included, and
 * a mid-year snapshot built on demand as a preview (EACC analysts and supervisors; anyone else
 * 403); an EACC supervisor publishes a preview (its manifest issued as a Public verifiable
 * document) and withdraws a published release with a reason (anyone else 403).
 */
@Injectable()
export class OpenDataService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly builder: OpenDataReleaseBuilder,
    private readonly publisher: OpenDataReleasePublisher,
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
      if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
      throw error;
    }
  }

  /**
   * An EACC supervisor publishes a preview: its manifest is issued through documents as a Public
   * verifiable document, then it is `published` with `open-data.release.published.v1`. 404 for no
   * release; 409 `release-not-preview` once published or withdrawn; 503 `documents-unavailable`
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
        throw conflict(
          'release-not-preview',
          `The release is ${error.status}: only a preview is published.`,
        );
      }
      if (error instanceof DocumentsUnavailable) {
        throw new ProblemException({
          type: 'documents-unavailable',
          title: 'Upstream service unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'The release manifest could not be issued just now. Try again shortly.',
        });
      }
      if (error instanceof InternalApiRejected) {
        throw badGateway('manifest-refused', 'The documents service refused the release manifest.');
      }
      if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
      throw error;
    }
  }

  /**
   * An EACC supervisor withdraws a published release with a public reason: `withdrawn` with
   * `open-data.release.withdrawn.v1`; its files are still served. 404 for no release; 409
   * `release-not-published` for a preview or a release withdrawn already.
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
        throw conflict(
          'release-not-published',
          `The release is ${error.status}: only a published release is withdrawn.`,
        );
      }
      throw error;
    }
  }
}

function storageUnavailable(): ProblemException {
  return new ProblemException({
    type: 'storage-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The release files could not be reached just now. Try again shortly.',
  });
}
