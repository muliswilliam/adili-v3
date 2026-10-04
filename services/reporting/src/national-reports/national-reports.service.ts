import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, NCR } from '@adili/numbering';
import { EACC_TENANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { requireEacc, requireEaccSupervisor } from '../access.js';
import { Clock } from '../clock.js';
import { reportReceipts } from '../compliance-reports/schema.js';
import type { ReportingSchema } from '../db/schema.js';
import { activeCommissions } from '../compliance-reports/commission.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { referencePeriodOf } from '../financial-year.js';
import { officerOf } from '../officer.js';
import { problem, workflowUnavailable } from '../problems.js';
import { buildAggregates } from './aggregates.js';
import type { PatternCandidate } from './candidates.js';
import { eaccContext } from '../system-context.js';
import { NCR_ISSUER } from './contract.js';
import { NCR_APPROVED, NCR_DRAFTED, type NcrApprovedData, type NcrDraftedData } from './events.js';
import { type Narrative, saveSection } from './narrative.js';
import { NarrativeDraftService } from './narrative-draft.service.js';
import {
  lockedUnapprovedReport,
  narrativeInputOf,
  paragraphsOf,
  replaceParagraphs,
  reportOf,
  reportView,
  touch,
} from './national-report-store.js';
import { NationalReportWorkflows } from './national-report-workflows.js';
import type { NationalReportView } from './representation.js';
import { NARRATIVE_SECTIONS, nationalReportAggregates, nationalReports } from './schema.js';

const EACC_ONLY = 'Only EACC analysts and supervisors work on the national consolidated report.';

/**
 * EACC's national consolidated report (spec 09 NCR), one per financial year. An EACC analyst (or
 * supervisor) builds it from the Commissions' submitted reports: the aggregates are recomputed at
 * every build while the narrative is kept; they type the narrative (Overview, Findings,
 * Recommendations), or have the ai-gateway draft it from the figures and pattern candidates
 * (spec 09b, `NarrativeDraftService`) as AI-draft paragraphs they edit. An EACC supervisor who
 * neither built it nor wrote any of it approves it: the `NCR` reference is allocated,
 * `ncr.approved.v1` published, and the approval workflow issues the Restricted PDF and ends the
 * year's chase while the year's annual open-data release is published (spec 09b). Once approved
 * the report no longer changes (409). Everything runs in EACC's row-level security tenant.
 */
@Injectable()
export class NationalReportsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly directory: DirectoryClient,
    private readonly workflows: NationalReportWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly drafts: NarrativeDraftService,
  ) {}

  /**
   * The year's report (EACC roles; anyone else 403); 404 until first built. A narrative draft
   * still being written is polled first (`NarrativeDraftService.settlePending`): reading the
   * report is how a 202 draft is polled.
   */
  async get(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    await this.drafts.settlePending(principal, fy);
    return withTenant(this.db, eaccContext(principal.subject), async (tx) =>
      reportView(tx, await reportOf(tx, fy)),
    );
  }

  /**
   * Builds the year's report, or rebuilds its draft, from the Commissions' submitted reports as
   * they are now: the aggregates are replaced, the narrative kept. The first build makes the
   * caller the author; `ncr.drafted.v1` each time. 409 `no-submitted-reports` before any
   * Commission reported, `ncr-approved` once approved; 503 while the directory is unreachable.
   */
  async build(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    const commissions = await activeCommissions(this.directory);
    const now = this.clock.now();
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const receipts = await tx.select().from(reportReceipts).where(eq(reportReceipts.fy, fy));
      if (receipts.length === 0) {
        throw problem(
          'no-submitted-reports',
          'No Commission has submitted its report for the year yet.',
        );
      }
      await tx
        .insert(nationalReports)
        .values({
          id: uuidv7(),
          fy,
          status: 'draft',
          version: 0,
          authorSubject: principal.subject,
          authorName: officerOf(principal).name,
          contributors: [],
        })
        .onConflictDoNothing();
      const report = await lockedUnapprovedReport(tx, fy);
      const aggregates = buildAggregates({ fy, commissions, receipts });
      const values = {
        fy,
        builtAt: now,
        reportsIncluded: receipts.length,
        reportIds: receipts.map((receipt) => receipt.reportId).sort(),
        aggregates,
      };
      await tx
        .insert(nationalReportAggregates)
        .values({ nationalReportId: report.id, ...values })
        .onConflictDoUpdate({ target: nationalReportAggregates.nationalReportId, set: values });
      const updated = await touch(tx, report, principal.subject);
      await this.events.record<NcrDraftedData>(tx, {
        type: NCR_DRAFTED,
        subject: updated.id,
        tenant: EACC_TENANT,
        data: {
          nationalReportId: updated.id,
          fy,
          version: updated.version,
          status: updated.status,
          reference: null,
          reportsIncluded: receipts.length,
        },
      });
      return reportView(tx, updated);
    });
  }

  /**
   * The year's pattern candidates (spec 09b, EACC roles; anyone else 403), computed from its
   * aggregates as last built and the prior years'; 404 until first built.
   */
  async candidates(principal: Principal, fy: number): Promise<PatternCandidate[]> {
    requireEacc(principal, EACC_ONLY);
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const { candidates } = await narrativeInputOf(tx, fy);
      return candidates;
    });
  }

  /**
   * Saves the narrative's sections (EACC roles). Paragraphs whose text is unchanged keep their id
   * and labels; an edited paragraph loses its AI-draft label. The caller becomes a contributor,
   * who cannot approve. 404 before the first build; 409 `ncr-approved` once approved.
   */
  async saveNarrative(
    principal: Principal,
    fy: number,
    narrative: Narrative,
  ): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const report = await lockedUnapprovedReport(tx, fy);
      const stored = await paragraphsOf(tx, report.id);
      const saved = NARRATIVE_SECTIONS.flatMap((section) =>
        saveSection(section, stored, narrative[section], uuidv7),
      );
      await replaceParagraphs(tx, report.id, stored, saved, principal.subject);
      const updated = await touch(tx, report, principal.subject);
      return reportView(tx, updated);
    });
  }

  /**
   * An EACC supervisor approves the year's report (an `Idempotency-Key` at the controller). The
   * author and anyone who built it or wrote its narrative cannot (403 `separation-of-duties`).
   * Allocates `NCR-EACC-<FY end>-<seq>-<check>`, records the approver, publishes `ncr.approved.v1`
   * and starts the approval and open-data release workflows before the commit, so a Temporal
   * outage approves nothing; once the commit is visible they issue the PDF and end the chase, and
   * build, certify and publish the year's annual open-data release. 404 before the first build;
   * 409 `ncr-approved` once approved.
   */
  async approve(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEaccSupervisor(principal, 'approve the national consolidated report');
    const now = this.clock.now();
    return withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const report = await lockedUnapprovedReport(tx, fy);
      if (
        report.authorSubject === principal.subject ||
        report.contributors.includes(principal.subject)
      ) {
        throw problem(
          'separation-of-duties',
          'The author cannot approve: another EACC supervisor approves the report.',
        );
      }
      const reference = await allocateReference(tx, NCR, {
        issuer: NCR_ISSUER,
        period: referencePeriodOf(fy),
      });
      const [approved] = await tx
        .update(nationalReports)
        .set({
          status: 'approved',
          version: report.version + 1,
          approverSubject: principal.subject,
          approverName: officerOf(principal).name,
          approvedAt: now,
          reference,
        })
        .where(eq(nationalReports.id, report.id))
        .returning();
      if (!approved) throw new Error(`National report ${report.id} vanished while approved`);
      const [aggregates] = await tx
        .select({ reportsIncluded: nationalReportAggregates.reportsIncluded })
        .from(nationalReportAggregates)
        .where(eq(nationalReportAggregates.nationalReportId, report.id));
      await this.events.record<NcrApprovedData>(tx, {
        type: NCR_APPROVED,
        subject: approved.id,
        tenant: EACC_TENANT,
        data: {
          nationalReportId: approved.id,
          fy,
          version: approved.version,
          status: approved.status,
          reference,
          reportsIncluded: aggregates?.reportsIncluded ?? 0,
        },
      });
      await this.startApproval(approved.id, fy);
      return reportView(tx, approved);
    });
  }

  /**
   * Starts the approval and open-data release workflows; 503 while Temporal is unreachable
   * (nothing is approved).
   */
  private async startApproval(nationalReportId: string, fy: number): Promise<void> {
    try {
      await this.workflows.approved({ nationalReportId, fy });
    } catch {
      throw workflowUnavailable('The report could not be approved just now. Try again shortly.');
    }
  }
}
