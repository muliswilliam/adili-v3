import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { EACC_TENANT } from '@adili/roles';
import { and, eq, isNull } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { Clock } from '../clock.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import type { ReportingSchema } from '../db/schema.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { fyLabel } from '../financial-year.js';
import { nationalReports } from '../national-reports/schema.js';
import type { Officer } from '../officer.js';
import { PLATFORM_TENANT } from '../system-context.js';
import type { ReleaseManifest } from './contract.js';
import {
  OPEN_DATA_RELEASE_PUBLISHED,
  OPEN_DATA_RELEASE_WITHDRAWN,
  type OpenDataReleasePublishedData,
  type OpenDataReleaseWithdrawnData,
} from './events.js';
import { objectKeyOf, RELEASE_FILE, type ReleaseDocument } from './files.js';
import { OpenDataFiles } from './open-data-files.js';
import { releaseView } from './release-builder.js';
import type { OpenDataReleaseRow, OpenDataReleaseView } from './representation.js';
import { openDataFiles, openDataReleases, type ReleaseStatus } from './schema.js';
import { OPEN_DATA_TABLES, type OpenDataTable } from './tables.js';

/** Namespace of the manifest's idempotency key: one manifest per release. */
const MANIFEST_KEY_NAMESPACE = '5e0b8c3a-91d4-4f7e-a2c6-0d8f3b17e4a9';

/** Version of the documents service's `open-data-manifest` template the payload fits. */
export const MANIFEST_TEMPLATE_VERSION = 1;

/** No release has the id. */
export class ReleaseNotFound extends Error {
  override readonly name = 'ReleaseNotFound';
}

/** Only a preview is published: this one is published already, or withdrawn. */
export class ReleaseNotInPreview extends Error {
  override readonly name = 'ReleaseNotInPreview';

  constructor(
    releaseId: string,
    readonly status: ReleaseStatus,
  ) {
    super(`Open-data release ${releaseId} is ${status}, not a preview`);
  }
}

/** Only a published release is withdrawn. */
export class ReleaseNotPublished extends Error {
  override readonly name = 'ReleaseNotPublished';

  constructor(
    releaseId: string,
    readonly status: ReleaseStatus,
  ) {
    super(`Open-data release ${releaseId} is ${status}, not published`);
  }
}

/** The annual release's NCR is not approved yet: its approval has not committed. Retried. */
export class ReleaseNcrNotApproved extends Error {
  override readonly name = 'ReleaseNcrNotApproved';
}

/**
 * Publishes and withdraws open-data releases (spec 09b S5 to S7), for the release workflow's
 * activities and EACC's endpoints alike:
 *
 * - `issueManifest`: the release's manifest (year, kind, version, build time, the NCR it
 *   reconciles with, each table's rows, hidden cells and file hashes, the release JSON's hash)
 *   issued once through documents as a Public verifiable document, read back from the files as
 *   written, and kept on the release;
 * - `publish`: a preview with its manifest becomes `published`, by whom and when, with
 *   `open-data.release.published.v1`;
 * - `withdraw`: a published release becomes `withdrawn` with the reason, by whom and when, with
 *   `open-data.release.withdrawn.v1`. Its files stay.
 *
 * Events carry the release's id, year, kind and version only.
 */
@Injectable()
export class OpenDataReleasePublisher {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly files: OpenDataFiles,
    private readonly documents: DocumentsClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * The release's manifest, issued once (a retry, or a second publisher, gets the same document).
   * `publishedBy` is the EACC supervisor publishing it, null when it publishes on its NCR's
   * approval. `ReleaseNotFound`, `ReleaseNotInPreview`; documents' `DocumentsUnavailable` and
   * `InternalApiRejected` and storage's errors propagate.
   */
  async issueManifest(releaseId: string, publishedBy: string | null): Promise<ReleaseManifest> {
    const { release, releaseSha256 } = await this.asPlatform(async (tx) => {
      const row = await found(tx, releaseId);
      const [file] = await tx
        .select({ sha256: openDataFiles.sha256 })
        .from(openDataFiles)
        .where(and(eq(openDataFiles.releaseId, releaseId), eq(openDataFiles.table, RELEASE_FILE)));
      return { release: row, releaseSha256: file?.sha256 };
    });
    if (release.manifestDocumentId && release.verificationId) {
      return { documentId: release.manifestDocumentId, verificationId: release.verificationId };
    }
    if (release.status !== 'preview') throw new ReleaseNotInPreview(releaseId, release.status);
    if (!releaseSha256) throw new Error(`Open-data release ${releaseId} has no release JSON`);

    const document = await this.json<ReleaseDocument>(objectKeyOf(releaseId, RELEASE_FILE, 'json'));
    const tables = await Promise.all(
      OPEN_DATA_TABLES.map(async (table) => {
        const entry = document.tables.find((each) => each.table === table);
        if (!entry) throw new Error(`Open-data release ${releaseId} has no ${table} table`);
        const { suppression } = await this.json<OpenDataTable>(
          objectKeyOf(releaseId, table, 'json'),
        );
        return { ...entry, cellsSuppressed: suppression.cellsSuppressed };
      }),
    );

    const issued = await this.documents.issue({
      type: 'open-data-manifest',
      templateVersion: MANIFEST_TEMPLATE_VERSION,
      issuerTenant: EACC_TENANT,
      subjectRef: `open-data-release:${releaseId}`,
      subjectPersonId: null,
      payload: {
        releaseId,
        financialYear: fyLabel(document.fy),
        kind: release.kind,
        version: document.version,
        builtAt: document.builtAt,
        ncrReference: document.ncrReference,
        publishedBy,
        suppressionThreshold: document.suppression.threshold,
        tables,
        releaseSha256,
      },
      idempotencyKey: uuidv5(`${releaseId}:open-data-manifest`, MANIFEST_KEY_NAMESPACE),
    });
    await this.asPlatform((tx) =>
      tx
        .update(openDataReleases)
        .set({ manifestDocumentId: issued.id, verificationId: issued.verificationId })
        .where(
          and(eq(openDataReleases.id, releaseId), isNull(openDataReleases.manifestDocumentId)),
        ),
    );
    return { documentId: issued.id, verificationId: issued.verificationId };
  }

  /**
   * Publishes a preview whose manifest is issued, by `by`: the EACC supervisor publishing it, or
   * for none, who approved its NCR (`ReleaseNcrNotApproved` until that approval is committed).
   * `ReleaseNotFound`, `ReleaseNotInPreview`.
   */
  async publish(releaseId: string, by?: Officer): Promise<OpenDataReleaseView> {
    return this.asPlatform(async (tx) => {
      const release = await found(tx, releaseId, { lock: true });
      if (release.status !== 'preview') throw new ReleaseNotInPreview(releaseId, release.status);
      if (!release.manifestDocumentId) {
        throw new Error(`Open-data release ${releaseId} has no manifest to publish with`);
      }
      const publisher = by ?? (await approverOf(tx, release));
      await tx
        .update(openDataReleases)
        .set({
          status: 'published',
          publishedAt: this.clock.now(),
          publishedBy: publisher.subject,
          publishedByName: publisher.name,
        })
        .where(eq(openDataReleases.id, releaseId));
      await this.events.record<OpenDataReleasePublishedData>(tx, {
        type: OPEN_DATA_RELEASE_PUBLISHED,
        subject: releaseId,
        tenant: EACC_TENANT,
        data: idsOf(release),
      });
      return viewOf(tx, releaseId);
    });
  }

  /** Withdraws a published release with `reason`. `ReleaseNotFound`, `ReleaseNotPublished`. */
  async withdraw(releaseId: string, by: Officer, reason: string): Promise<OpenDataReleaseView> {
    return this.asPlatform(async (tx) => {
      const release = await found(tx, releaseId, { lock: true });
      if (release.status !== 'published') throw new ReleaseNotPublished(releaseId, release.status);
      await tx
        .update(openDataReleases)
        .set({
          status: 'withdrawn',
          withdrawnAt: this.clock.now(),
          withdrawnBy: by.subject,
          withdrawnByName: by.name,
          withdrawnReason: reason,
        })
        .where(eq(openDataReleases.id, releaseId));
      await this.events.record<OpenDataReleaseWithdrawnData>(tx, {
        type: OPEN_DATA_RELEASE_WITHDRAWN,
        subject: releaseId,
        tenant: EACC_TENANT,
        data: idsOf(release),
      });
      return viewOf(tx, releaseId);
    });
  }

  /** Releases are EACC's: read and written as the platform, which also serves the public API. */
  private asPlatform<T>(work: (tx: ReportingTransaction) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject: 'system:reporting' }, work);
  }

  private async json<T>(key: string): Promise<T> {
    return JSON.parse(Buffer.from(await this.files.get(key)).toString('utf8')) as T;
  }
}

async function found(
  tx: ReportingTransaction,
  releaseId: string,
  options: { lock?: boolean } = {},
): Promise<OpenDataReleaseRow> {
  const query = tx.select().from(openDataReleases).where(eq(openDataReleases.id, releaseId));
  const [release] = options.lock ? await query.for('update') : await query;
  if (!release) throw new ReleaseNotFound(`No open-data release ${releaseId}`);
  return release;
}

async function viewOf(tx: ReportingTransaction, releaseId: string): Promise<OpenDataReleaseView> {
  const view = await releaseView(tx, releaseId);
  if (!view) throw new Error(`Open-data release ${releaseId} vanished`);
  return view;
}

/** Who approved the release's NCR: the annual release publishes on their approval. */
async function approverOf(tx: ReportingTransaction, release: OpenDataReleaseRow): Promise<Officer> {
  const [ncr] = await tx
    .select({
      status: nationalReports.status,
      subject: nationalReports.approverSubject,
      name: nationalReports.approverName,
    })
    .from(nationalReports)
    .where(eq(nationalReports.id, release.nationalReportId));
  if (ncr?.status !== 'approved' || !ncr.subject) {
    throw new ReleaseNcrNotApproved(
      `The national consolidated report of open-data release ${release.id} is not approved yet`,
    );
  }
  return { subject: ncr.subject, name: ncr.name ?? ncr.subject };
}

function idsOf(release: OpenDataReleaseRow): OpenDataReleasePublishedData {
  return { releaseId: release.id, fy: release.fy, kind: release.kind, version: release.version };
}
