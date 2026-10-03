import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { EACC_TENANT } from '@adili/roles';
import { and, count, eq, gte, inArray, isNotNull, lt, max, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import { reportReceipts } from '../compliance-reports/schema.js';
import type { ReportingSchema } from '../db/schema.js';
import { buildAggregates } from '../national-reports/aggregates.js';
import { nationalReportAggregates, nationalReports } from '../national-reports/schema.js';
import {
  ACTION_STEPS,
  actionFacts,
  clarificationFacts,
  determinationFacts,
  referralFacts,
} from '../projections/schema.js';
import { PLATFORM_TENANT } from '../system-context.js';
import { OPEN_DATA_RELEASE_BUILT, type OpenDataReleaseBuiltData } from './events.js';
import { CONTENT_TYPES, datasetFiles, objectKeyOf } from './files.js';
import { OpenDataFiles } from './open-data-files.js';
import { type OpenDataReleaseView, openDataReleaseView } from './representation.js';
import { openDataFiles, openDataReleases, type ReleaseKind } from './schema.js';
import { SUPPRESSION_THRESHOLD } from './suppression.js';
import {
  buildReleaseTables,
  type ComplianceCounts,
  DETERMINATION_OUTCOMES,
  type DeterminationOutcome,
  emptyComplianceCounts,
  reconcile,
} from './tables.js';

/** What to build: the year, the kind, and who asked (null for the release workflow). */
export interface BuildReleaseRequest {
  fy: number;
  kind: ReleaseKind;
  builtBy: string | null;
  /**
   * The release's id, for a caller that retries (a workflow activity): a release already built
   * under it is returned as it is. A new id when not given.
   */
  releaseId?: string;
}

/** The year's national consolidated report has not been built: there is nothing to reconcile with. */
export class NcrNotBuilt extends Error {
  override readonly name = 'NcrNotBuilt';
}

/** An annual release is built from the approved NCR only. */
export class NcrNotApproved extends Error {
  override readonly name = 'NcrNotApproved';
}

/**
 * The year has a published annual release already: one is withdrawn before a corrected one is
 * published, so the year never shows two.
 */
export class AnnualReleasePublished extends Error {
  override readonly name = 'AnnualReleasePublished';

  constructor(fy: number) {
    super(`An annual open-data release of ${String(fy)} is published`);
  }
}

/**
 * Reconciliation failed (spec 09b S9): the release's national totals differ from the NCR's at
 * these dot paths (`national.initial.declared`), so nothing was built.
 */
export class ReconciliationFailed extends Error {
  override readonly name = 'ReconciliationFailed';

  constructor(readonly mismatches: readonly string[]) {
    super(`The release does not reconcile with the NCR at ${mismatches.join(', ')}`);
  }
}

/**
 * Builds an open-data release (spec 09b): tables -> suppression -> reconciliation -> dataset
 * files -> the release, as one step any caller runs, the snapshot endpoint now and
 * `OpenDataReleaseWorkflow`'s activity on NCR approval (#352).
 *
 * The tables are built from the year's submitted reports as they are now, aggregated as the NCR
 * aggregates them over the Commissions its report lists, plus the projection facts for what the
 * NCR does not carry. The national totals must equal the NCR's (`ReconciliationFailed`
 * otherwise): a report submitted or changed since the NCR was built fails the build until the
 * NCR is rebuilt. The files (JSON and CSV per table, the release JSON) go to object storage with
 * their SHA-256, and the release is recorded as `preview`, version 1, 2, ... per year and kind,
 * with `open-data.release.built.v1`. The files are written in the recording transaction, under a
 * lock on the year and kind, so a version is never taken twice; a failed build may leave files
 * under an id no release has, which nothing reads.
 *
 * An annual release is built from the approved NCR only, and only while no annual release of the
 * year is published: a corrected one follows the withdrawal of the one published.
 *
 * Throws `NcrNotBuilt`, `NcrNotApproved` (annual), `AnnualReleasePublished` (annual),
 * `ReconciliationFailed` and `OpenDataStorageUnavailable`; the callers map them (HTTP problems,
 * non-retryable activity failures).
 */
@Injectable()
export class OpenDataReleaseBuilder {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly files: OpenDataFiles,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async build(request: BuildReleaseRequest): Promise<OpenDataReleaseView> {
    const { fy, kind, builtBy } = request;
    const releaseId = request.releaseId ?? uuidv7();
    const context = { tenant: PLATFORM_TENANT, subject: builtBy ?? 'system:reporting' };
    return withTenant(this.db, context, async (tx) => {
      const existing = await releaseView(tx, releaseId);
      if (existing) return existing;

      const [ncr] = await tx
        .select({
          id: nationalReports.id,
          status: nationalReports.status,
          reference: nationalReports.reference,
          aggregates: nationalReportAggregates.aggregates,
        })
        .from(nationalReports)
        .innerJoin(
          nationalReportAggregates,
          eq(nationalReportAggregates.nationalReportId, nationalReports.id),
        )
        .where(eq(nationalReports.fy, fy));
      if (!ncr) throw new NcrNotBuilt(`No national consolidated report is built for ${String(fy)}`);
      if (kind === 'annual' && ncr.status !== 'approved') {
        throw new NcrNotApproved(
          `The national consolidated report for ${String(fy)} is not approved`,
        );
      }
      // One build per year and kind at a time: the version is the next one.
      await lockReleasesOf(tx, fy, kind);
      // A corrected annual release is built once the published one is withdrawn.
      await noPublishedAnnualBesides(tx, { id: releaseId, fy, kind });

      const receipts = await tx.select().from(reportReceipts).where(eq(reportReceipts.fy, fy));
      const aggregates = buildAggregates({
        fy,
        commissions: Object.entries(ncr.aggregates.byCommission).map(([slug, row]) => ({
          slug,
          name: row.name,
          issuerCode: slug.toUpperCase(),
        })),
        receipts,
      });
      const built = buildReleaseTables(
        { aggregates, compliance: await complianceCounts(tx, fy) },
        { threshold: SUPPRESSION_THRESHOLD },
      );
      const mismatches = reconcile(built.totals, ncr.aggregates);
      if (mismatches.length > 0) throw new ReconciliationFailed(mismatches);

      const [latest] = await tx
        .select({ version: max(openDataReleases.version) })
        .from(openDataReleases)
        .where(and(eq(openDataReleases.fy, fy), eq(openDataReleases.kind, kind)));
      const version = (latest?.version ?? 0) + 1;
      const builtAt = this.clock.now();

      const files = datasetFiles(
        {
          id: releaseId,
          fy,
          kind,
          version,
          builtAt: builtAt.toISOString(),
          ncrReference: ncr.status === 'approved' ? ncr.reference : null,
          suppression: { threshold: SUPPRESSION_THRESHOLD },
        },
        built.tables,
      );
      await Promise.all(
        files.map((file) =>
          this.files.put({
            key: objectKeyOf(releaseId, file.table, file.format),
            body: file.body,
            contentType: CONTENT_TYPES[file.format],
          }),
        ),
      );

      await tx.insert(openDataReleases).values({
        id: releaseId,
        fy,
        kind,
        version,
        status: 'preview',
        nationalReportId: ncr.id,
        builtAt,
        builtBy,
      });
      await tx.insert(openDataFiles).values(
        files.map((file) => ({
          releaseId,
          table: file.table,
          format: file.format,
          objectKey: objectKeyOf(releaseId, file.table, file.format),
          sha256: file.sha256,
          rows: file.rows,
          bytes: file.body.byteLength,
        })),
      );
      await this.events.record<OpenDataReleaseBuiltData>(tx, {
        type: OPEN_DATA_RELEASE_BUILT,
        subject: releaseId,
        tenant: EACC_TENANT,
        data: { releaseId, fy, kind, version },
      });
      const view = await releaseView(tx, releaseId);
      if (!view) throw new Error(`Open-data release ${releaseId} vanished while it was built`);
      return view;
    });
  }
}

/**
 * Serialises the builds and annual publications of a year's releases of a kind (publishing an
 * annual release takes the same lock), so a version is never taken twice and two annual releases of a
 * year are never published.
 */
export async function lockReleasesOf(
  tx: ReportingTransaction,
  fy: number,
  kind: ReleaseKind,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`open-data-release:${String(fy)}:${kind}`}))`,
  );
}

/**
 * `AnnualReleasePublished` when the release is annual and another annual release of its year is
 * published (none for a snapshot: a year's snapshots stand side by side).
 */
export async function noPublishedAnnualBesides(
  tx: ReportingTransaction,
  release: { id: string; fy: number; kind: ReleaseKind },
): Promise<void> {
  if (release.kind !== 'annual') return;
  const [published] = await tx
    .select({ id: openDataReleases.id })
    .from(openDataReleases)
    .where(
      and(
        eq(openDataReleases.fy, release.fy),
        eq(openDataReleases.kind, 'annual'),
        eq(openDataReleases.status, 'published'),
        ne(openDataReleases.id, release.id),
      ),
    )
    .limit(1);
  if (published) throw new AnnualReleasePublished(release.fy);
}

/** A release with its files; undefined for none. */
export async function releaseView(
  tx: ReportingTransaction,
  releaseId: string,
): Promise<OpenDataReleaseView | undefined> {
  const [release] = await tx
    .select()
    .from(openDataReleases)
    .where(eq(openDataReleases.id, releaseId));
  if (!release) return undefined;
  const files = await tx.select().from(openDataFiles).where(eq(openDataFiles.releaseId, releaseId));
  return openDataReleaseView(release, files);
}

/** Issued-administrative-action statuses: the action reached the officer. */
const ISSUED_ACTION_STATUSES = ['issued', 'responded', 'complied'] as const;

/**
 * Each Commission's counts for the year from the projection facts: approved determinations by
 * outcome and clarifications resolved (by the year they were issued), administrative actions
 * issued in the year by rung, and referrals sent in the year. Read as the platform: the facts
 * are every Commission's.
 */
async function complianceCounts(
  tx: ReportingTransaction,
  fy: number,
): Promise<Record<string, ComplianceCounts>> {
  const counts: Record<string, ComplianceCounts> = {};
  const of = (tenant: string): ComplianceCounts => (counts[tenant] ??= emptyComplianceCounts());

  const determinations = await tx
    .select({ tenant: determinationFacts.tenant, outcome: determinationFacts.outcome, n: count() })
    .from(determinationFacts)
    .where(
      and(
        eq(determinationFacts.fy, fy),
        inArray(determinationFacts.outcome, [...DETERMINATION_OUTCOMES]),
      ),
    )
    .groupBy(determinationFacts.tenant, determinationFacts.outcome);
  for (const row of determinations) {
    of(row.tenant).determinations[row.outcome as DeterminationOutcome] = row.n;
  }

  const resolved = await tx
    .select({ tenant: clarificationFacts.tenant, n: count() })
    .from(clarificationFacts)
    .where(and(eq(clarificationFacts.fy, fy), eq(clarificationFacts.status, 'resolved')))
    .groupBy(clarificationFacts.tenant);
  for (const row of resolved) of(row.tenant).clarificationsResolved = row.n;

  // The year in Nairobi: 1 July to 30 June.
  const from = new Date(`${String(fy)}-07-01T00:00:00+03:00`);
  const to = new Date(`${String(fy + 1)}-07-01T00:00:00+03:00`);
  const actions = await tx
    .select({ tenant: actionFacts.tenant, step: actionFacts.step, n: count() })
    .from(actionFacts)
    .where(
      and(
        isNotNull(actionFacts.issuedAt),
        gte(actionFacts.issuedAt, from),
        lt(actionFacts.issuedAt, to),
        inArray(actionFacts.status, [...ISSUED_ACTION_STATUSES]),
        inArray(actionFacts.step, [...ACTION_STEPS]),
      ),
    )
    .groupBy(actionFacts.tenant, actionFacts.step);
  for (const row of actions) of(row.tenant).actions[row.step] = row.n;

  const referrals = await tx
    .select({ tenant: referralFacts.tenant, n: count() })
    .from(referralFacts)
    .where(eq(referralFacts.fy, fy))
    .groupBy(referralFacts.tenant);
  for (const row of referrals) of(row.tenant).referrals = row.n;

  return counts;
}
