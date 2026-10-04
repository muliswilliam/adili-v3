import { Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { EACC_TENANT } from '@adili/roles';
import { and, count, eq, gte, inArray, isNotNull, lt, max, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import { aggregateFacts } from '../compliance-reports/form-m.js';
import { reportReceipts, type ReportCounts } from '../compliance-reports/schema.js';
import type { ReportingSchema } from '../db/schema.js';
import type { Officer } from '../officer.js';
import { type CommissionFacts, DirectoryClient } from '../directory/directory-client.js';
import { financialYearAt } from '../financial-year.js';
import { buildLiveAggregates, type NationalAggregates } from '../national-reports/aggregates.js';
import { nationalReportAggregates, nationalReports } from '../national-reports/schema.js';
import {
  accessRequestFacts,
  ACTION_STEPS,
  actionFacts,
  clarificationFacts,
  determinationFacts,
  obligationFacts,
  referralFacts,
} from '../projections/schema.js';
import { PLATFORM_TENANT, SYSTEM_SUBJECT } from '../system-context.js';
import { OPEN_DATA_RELEASE_BUILT, type OpenDataReleaseBuiltData } from './events.js';
import { CONTENT_TYPES, datasetFiles, objectKeyOf, type ReleaseSourceName } from './files.js';
import { OpenDataFiles } from './open-data-files.js';
import { type OpenDataReleaseView, openDataReleaseView } from './representation.js';
import {
  openDataFiles,
  openDataReleaseBuilds,
  openDataReleases,
  type ReleaseKind,
} from './schema.js';
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
  /** Who asked for it; null for the release workflow on NCR approval. */
  builtBy: Officer | null;
  /**
   * The release's id, for a caller that retries (a workflow activity): a release already built
   * under it is returned as it is. A new id when not given.
   */
  releaseId?: string;
}

/** The year's national consolidated report has not been built: an annual release needs it. */
export class NcrNotBuilt extends Error {
  override readonly name = 'NcrNotBuilt';
}

/** The financial year has not started: a snapshot of it would have nothing to show. */
export class FyNotStarted extends Error {
  override readonly name = 'FyNotStarted';

  constructor(fy: number) {
    super(`The financial year ${String(fy)} has not started`);
  }
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
 * Reconciliation failed (spec 09b S9): the release's national totals differ from those of the
 * aggregates it was built from at these dot paths (`national.initial.declared`), so nothing was
 * built. The tables are built from those very aggregates, so this is a fault of the table
 * builder, never data that moved on.
 */
export class ReconciliationFailed extends Error {
  override readonly name = 'ReconciliationFailed';

  constructor(readonly mismatches: readonly string[]) {
    super(`The release does not reconcile with the NCR at ${mismatches.join(', ')}`);
  }
}

/**
 * How long a build may run before another build of its year and kind takes it over as failed (a
 * process that died mid-build): longer than the release workflow's activity timeout.
 */
export const BUILD_LEASE_MS = 10 * 60 * 1000;

/** Another build of the year's releases of the kind is under way. */
export class ReleaseBuildInProgress extends Error {
  override readonly name = 'ReleaseBuildInProgress';

  constructor(fy: number, kind: ReleaseKind) {
    super(`An open-data ${kind} release of ${String(fy)} is being built`);
  }
}

/** The build ran past its lease and was taken over as failed: its release is not recorded. */
export class ReleaseBuildAbandoned extends Error {
  override readonly name = 'ReleaseBuildAbandoned';

  constructor(releaseId: string) {
    super(`The build of open-data release ${releaseId} was taken over before it finished`);
  }
}

/**
 * Builds an open-data release (spec 09b): tables -> suppression -> reconciliation -> dataset
 * files -> the release, as one step any caller runs, the snapshot endpoint and
 * `OpenDataReleaseWorkflow`'s activity on NCR approval (#352).
 *
 * The tables are built from the same aggregates as the NCR, plus the projection facts for what
 * the NCR does not carry:
 *
 * - once the year's NCR is built, from its frozen aggregates (`national_report_aggregates`):
 *   every annual release, and a snapshot of the year. A report submitted after the NCR was
 *   built changes neither until the NCR is rebuilt, so the release always equals the NCR;
 * - before then, a snapshot (spec 09b: "a mid-year snapshot ... so that Parliament sees progress
 *   before July") is built from the live projections: every Commission's counts as its Form M
 *   would compile them now from the obligation, clarification and access request facts
 *   (`aggregateFacts`), over
 *   the directory's active Commissions (`buildLiveAggregates`). Its status per Commission is
 *   still its report's, so the year's reporting counts read "not reported" until reports come
 *   in. A year that has not started has nothing to show (`FyNotStarted`).
 *
 * Reconciliation (S9) compares the built tables' national totals with those of the aggregates
 * they were built from, the NCR's or the live projections' (`ReconciliationFailed` otherwise):
 * it guards the table builder, not data drift. Suppression is the same either way. The files
 * (JSON and CSV per table, the release JSON naming the source) go to object storage with their
 * SHA-256, and the release is recorded as `preview`, version 1, 2, ... per year and kind, with
 * `open-data.release.built.v1`.
 *
 * In three steps, so no storage call runs under the lock on the year and kind and no object is
 * left that no row names: (1) under the lock, the tables are built and the build claimed with
 * the next version (`open_data_release_builds`, `building`), committed; (2) the files are
 * written, outside any transaction; (3) under the lock again, the release and its files are
 * recorded and the claim goes. A failed write leaves the build `failed`, naming its objects for
 * a sweep, its version free and no release; a retry under the same id claims afresh and
 * overwrites them. One build of a year and kind runs at a time (`ReleaseBuildInProgress`); one
 * past `BUILD_LEASE_MS` is taken over as failed (`ReleaseBuildAbandoned` if it then finishes).
 *
 * An annual release is built from the approved NCR only, and only while no annual release of the
 * year is published: a corrected one follows the withdrawal of the one published.
 *
 * Throws `NcrNotBuilt`, `NcrNotApproved` (annual), `AnnualReleasePublished` (annual),
 * `FyNotStarted` (snapshot), `ReconciliationFailed`, `ReleaseBuildInProgress`,
 * `DirectoryUnavailable` (a snapshot from the live projections) and
 * `OpenDataStorageUnavailable`; the callers map them (HTTP problems, non-retryable activity
 * failures).
 */
@Injectable()
export class OpenDataReleaseBuilder {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly directory: DirectoryClient,
    private readonly files: OpenDataFiles,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  private readonly logger = new Logger(OpenDataReleaseBuilder.name);

  async build(request: BuildReleaseRequest): Promise<OpenDataReleaseView> {
    const { fy, kind, builtBy } = request;
    const releaseId = request.releaseId ?? uuidv7();
    const context = { tenant: PLATFORM_TENANT, subject: builtBy?.subject ?? SYSTEM_SUBJECT };
    // A snapshot of a year without an NCR is of the live projections, over the directory's
    // Commissions, asked outside the transaction. An NCR is never removed, so one not found now
    // is the only way the transaction finds none.
    let live: { commissions: CommissionFacts[] } | undefined;
    if (kind === 'snapshot' && !(await withTenant(this.db, context, (tx) => hasNcr(tx, fy)))) {
      if (financialYearAt(this.clock.now()) < fy) throw new FyNotStarted(fy);
      live = { commissions: await this.directory.listCommissions() };
    }

    // 1. Under the lock: the tables, and the build claimed with its version, committed.
    const plan = await withTenant(this.db, context, async (tx) => {
      const existing = await releaseView(tx, releaseId);
      if (existing) return { built: true as const, release: existing };

      const ncr = await ncrOf(tx, fy);
      if (kind === 'annual') {
        if (!ncr)
          throw new NcrNotBuilt(`No national consolidated report is built for ${String(fy)}`);
        if (ncr.status !== 'approved') {
          throw new NcrNotApproved(
            `The national consolidated report for ${String(fy)} is not approved`,
          );
        }
      }
      // One build per year and kind at a time: the version is the next one.
      await lockReleasesOf(tx, fy, kind);
      // A corrected annual release is built once the published one is withdrawn.
      await noPublishedAnnualBesides(tx, { id: releaseId, fy, kind });

      let aggregates: NationalAggregates;
      let source: ReleaseSourceName;
      if (ncr) {
        aggregates = ncr.aggregates;
        source = 'national-report';
      } else {
        if (!live) throw new Error(`The NCR for ${String(fy)} vanished while a release was built`);
        aggregates = buildLiveAggregates({
          fy,
          commissions: live.commissions,
          counts: await liveCounts(tx, fy),
          receipts: await tx.select().from(reportReceipts).where(eq(reportReceipts.fy, fy)),
        });
        source = 'live-projections';
      }
      const built = buildReleaseTables(
        { aggregates, compliance: await complianceCounts(tx, fy) },
        { threshold: SUPPRESSION_THRESHOLD },
      );
      const mismatches = reconcile(built.totals, aggregates);
      if (mismatches.length > 0) throw new ReconciliationFailed(mismatches);

      const builtAt = this.clock.now();
      const version = await this.claimBuild(tx, {
        releaseId,
        fy,
        kind,
        builtBy: builtBy?.subject ?? null,
        builtAt,
      });
      const files = datasetFiles(
        {
          id: releaseId,
          fy,
          kind,
          version,
          builtAt: builtAt.toISOString(),
          source,
          ncrReference: ncr?.status === 'approved' ? ncr.reference : null,
          suppression: { threshold: SUPPRESSION_THRESHOLD },
        },
        built.tables,
      );
      return {
        built: false as const,
        files,
        version,
        builtAt,
        nationalReportId: ncr?.id ?? null,
      };
    });
    if (plan.built) return plan.release;

    // 2. The files, outside any transaction: a failure leaves the build `failed`, naming them.
    try {
      await Promise.all(
        plan.files.map((file) =>
          this.files.put({
            key: objectKeyOf(releaseId, file.table, file.format),
            body: file.body,
            contentType: CONTENT_TYPES[file.format],
          }),
        ),
      );
    } catch (error) {
      await withTenant(this.db, context, (tx) =>
        tx
          .update(openDataReleaseBuilds)
          .set({ status: 'failed' })
          .where(
            and(
              eq(openDataReleaseBuilds.releaseId, releaseId),
              eq(openDataReleaseBuilds.status, 'building'),
            ),
          ),
      ).catch((marking: unknown) => {
        // Left `building`, the lease lapses and the next build takes it over as failed.
        this.logger.warn(
          { releaseId, err: errorType(marking) },
          'A failed open-data release build could not be marked failed',
        );
      });
      throw error;
    }

    // 3. The release, its files and the event, once the build is still this one's.
    return withTenant(this.db, context, async (tx) => {
      await lockReleasesOf(tx, fy, kind);
      const [claim] = await tx
        .select()
        .from(openDataReleaseBuilds)
        .where(eq(openDataReleaseBuilds.releaseId, releaseId));
      if (claim?.status !== 'building' || claim.version !== plan.version) {
        throw new ReleaseBuildAbandoned(releaseId);
      }
      await tx.insert(openDataReleases).values({
        id: releaseId,
        fy,
        kind,
        version: plan.version,
        status: 'preview',
        nationalReportId: plan.nationalReportId,
        builtAt: plan.builtAt,
        builtBy: builtBy?.subject ?? null,
        builtByName: builtBy?.name ?? null,
      });
      await tx.insert(openDataFiles).values(
        plan.files.map((file) => ({
          releaseId,
          table: file.table,
          format: file.format,
          objectKey: objectKeyOf(releaseId, file.table, file.format),
          sha256: file.sha256,
          rows: file.rows,
          bytes: file.body.byteLength,
        })),
      );
      await tx.delete(openDataReleaseBuilds).where(eq(openDataReleaseBuilds.releaseId, releaseId));
      await this.events.record<OpenDataReleaseBuiltData>(tx, {
        type: OPEN_DATA_RELEASE_BUILT,
        subject: releaseId,
        tenant: EACC_TENANT,
        data: { releaseId, fy, kind, version: plan.version },
      });
      const view = await releaseView(tx, releaseId);
      if (!view) throw new Error(`Open-data release ${releaseId} vanished while it was built`);
      return view;
    });
  }

  /**
   * Claims the build of the year's next release of the kind, under the lock, and gives its
   * version. A retry of a failed build (its id) claims afresh, as the version it took may have
   * gone to a later release. Another build `building` within its lease refuses
   * (`ReleaseBuildInProgress`); one past it is taken over as failed.
   */
  private async claimBuild(
    tx: ReportingTransaction,
    build: {
      releaseId: string;
      fy: number;
      kind: ReleaseKind;
      builtBy: string | null;
      builtAt: Date;
    },
  ): Promise<number> {
    const { releaseId, fy, kind, builtBy, builtAt } = build;
    await tx.delete(openDataReleaseBuilds).where(eq(openDataReleaseBuilds.releaseId, releaseId));
    const [running] = await tx
      .select()
      .from(openDataReleaseBuilds)
      .where(
        and(
          eq(openDataReleaseBuilds.fy, fy),
          eq(openDataReleaseBuilds.kind, kind),
          eq(openDataReleaseBuilds.status, 'building'),
        ),
      );
    if (running) {
      if (builtAt.getTime() - running.startedAt.getTime() < BUILD_LEASE_MS) {
        throw new ReleaseBuildInProgress(fy, kind);
      }
      await tx
        .update(openDataReleaseBuilds)
        .set({ status: 'failed' })
        .where(eq(openDataReleaseBuilds.releaseId, running.releaseId));
    }
    const [latest] = await tx
      .select({ version: max(openDataReleases.version) })
      .from(openDataReleases)
      .where(and(eq(openDataReleases.fy, fy), eq(openDataReleases.kind, kind)));
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(openDataReleaseBuilds).values({
      releaseId,
      fy,
      kind,
      version,
      status: 'building',
      startedAt: builtAt,
      builtBy,
    });
    return version;
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

/** Whether the year's national consolidated report is built. */
async function hasNcr(tx: ReportingTransaction, fy: number): Promise<boolean> {
  return (await ncrOf(tx, fy)) !== undefined;
}

/** The year's national consolidated report with its aggregates as last built; undefined for none. */
async function ncrOf(tx: ReportingTransaction, fy: number) {
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
  return ncr;
}

/**
 * Every Commission's Form M counts for the year as they would compile now, from the obligation,
 * clarification and access request facts (`aggregateFacts`, as the compile reads them), by slug.
 * Read as the platform: the facts are every Commission's.
 */
async function liveCounts(
  tx: ReportingTransaction,
  fy: number,
): Promise<Map<string, ReportCounts>> {
  const obligations = await tx
    .select({
      tenant: obligationFacts.tenant,
      obligationId: obligationFacts.obligationId,
      type: obligationFacts.type,
      statementDate: obligationFacts.statementDate,
      status: obligationFacts.status,
      filedAt: obligationFacts.filedAt,
      late: obligationFacts.late,
    })
    .from(obligationFacts)
    .where(eq(obligationFacts.fy, fy));
  const clarifications = await tx
    .select({
      tenant: clarificationFacts.tenant,
      clarificationId: clarificationFacts.clarificationId,
      issuedAt: clarificationFacts.issuedAt,
    })
    .from(clarificationFacts)
    .where(eq(clarificationFacts.fy, fy));
  const accessRequests = await tx
    .select({
      tenant: accessRequestFacts.tenant,
      outcome: accessRequestFacts.outcome,
      grounds: accessRequestFacts.grounds,
      withdrawn: sql<boolean>`${accessRequestFacts.withdrawnAt} is not null`,
    })
    .from(accessRequestFacts)
    .where(eq(accessRequestFacts.fy, fy));
  const tenants = new Set(
    [...obligations, ...clarifications, ...accessRequests].map((row) => row.tenant),
  );
  return new Map(
    [...tenants].map((tenant) => [
      tenant,
      aggregateFacts(
        obligations.filter((row) => row.tenant === tenant),
        clarifications.filter((row) => row.tenant === tenant),
        accessRequests.filter((row) => row.tenant === tenant),
      ).counts,
    ]),
  );
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
