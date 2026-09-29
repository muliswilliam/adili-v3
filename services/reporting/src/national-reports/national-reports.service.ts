import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, NCR } from '@adili/numbering';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { EACC_TENANT, requireEacc, requireEaccSupervisor } from '../access.js';
import { Clock } from '../clock.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import { ReportWorkflows } from '../compliance-reports/report-workflows.js';
import { reportReceipts } from '../compliance-reports/schema.js';
import type { ReportingSchema } from '../db/schema.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
} from '../directory/directory-client.js';
import { buildAggregates } from './aggregates.js';
import { NCR_ISSUER } from './contract.js';
import { NCR_APPROVED, NCR_DRAFTED, type NcrApprovedData, type NcrDraftedData } from './events.js';
import { type Narrative, type Paragraph, saveSection } from './narrative.js';
import {
  type NationalReportRow,
  type NationalReportView,
  nationalReportView,
  paragraphOf,
} from './representation.js';
import {
  NARRATIVE_SECTIONS,
  nationalReportAggregates,
  nationalReportParagraphs,
  nationalReports,
} from './schema.js';

const EACC_ONLY = 'Only EACC analysts and supervisors work on the national consolidated report.';

/**
 * EACC's national consolidated report (spec 09 NCR), one per financial year. An EACC analyst (or
 * supervisor) builds it from the Commissions' submitted reports: the aggregates are recomputed at
 * every build while the narrative is kept; they type the narrative (Overview, Findings,
 * Recommendations). An EACC supervisor who neither built it nor wrote any of it approves it: the
 * `NCR` reference is allocated, `ncr.approved.v1` published, and the approval workflow issues the
 * Restricted PDF and ends the year's chase. Once approved the report no longer changes (409).
 * Everything runs in EACC's row-level security tenant.
 */
@Injectable()
export class NationalReportsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly directory: DirectoryClient,
    private readonly workflows: ReportWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /** The year's report (EACC roles; anyone else 403); 404 until first built. */
  async get(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    return this.inEacc(principal, async (tx) => {
      const [report] = await tx.select().from(nationalReports).where(eq(nationalReports.fy, fy));
      if (!report) throw notFound();
      return this.viewOf(tx, report);
    });
  }

  /**
   * Builds the year's report, or rebuilds its draft, from the Commissions' submitted reports as
   * they are now: the aggregates are replaced, the narrative kept. The first build makes the
   * caller the author; `ncr.drafted.v1` each time. 409 `no-submitted-reports` before any
   * Commission reported, `ncr-approved` once approved; 503 while the directory is unreachable.
   */
  async build(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEacc(principal, EACC_ONLY);
    const commissions = await this.commissions();
    const now = this.clock.now();
    return this.inEacc(principal, async (tx) => {
      const receipts = await tx.select().from(reportReceipts).where(eq(reportReceipts.fy, fy));
      if (receipts.length === 0) {
        throw conflict(
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
          authorName: nameOf(principal),
          contributors: [],
        })
        .onConflictDoNothing();
      const report = await lockedDraft(tx, fy);
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
      const updated = await touch(tx, report, principal);
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
      return this.viewOf(tx, updated);
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
    return this.inEacc(principal, async (tx) => {
      const report = await lockedDraft(tx, fy);
      const stored = (
        await tx
          .select()
          .from(nationalReportParagraphs)
          .where(eq(nationalReportParagraphs.nationalReportId, report.id))
      ).map(paragraphOf);
      const saved = NARRATIVE_SECTIONS.flatMap((section) =>
        saveSection(section, stored, narrative[section], uuidv7),
      );
      await replaceParagraphs(tx, report.id, stored, saved, principal.subject);
      const updated = await touch(tx, report, principal);
      return this.viewOf(tx, updated);
    });
  }

  /**
   * An EACC supervisor approves the year's report (an `Idempotency-Key` at the controller). The
   * author and anyone who built it or wrote its narrative cannot (403 `separation-of-duties`).
   * Allocates `NCR-EACC-<FY>-<seq>-<check>`, records the approver, publishes `ncr.approved.v1`
   * and starts the approval workflow before the commit, so a Temporal outage approves nothing;
   * the workflow issues the PDF and ends the chase once the commit is visible. 404 before the
   * first build; 409 `ncr-approved` once approved.
   */
  async approve(principal: Principal, fy: number): Promise<NationalReportView> {
    requireEaccSupervisor(principal, 'approve the national consolidated report');
    const now = this.clock.now();
    return this.inEacc(principal, async (tx) => {
      const report = await lockedDraft(tx, fy);
      if (
        report.authorSubject === principal.subject ||
        report.contributors.includes(principal.subject)
      ) {
        throw new ProblemException(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: HttpStatus.FORBIDDEN,
            detail: 'The author cannot approve: another EACC supervisor approves the report.',
          },
          { code: 'separation-of-duties' },
        );
      }
      const reference = await allocateReference(tx, NCR, { issuer: NCR_ISSUER, period: fy });
      const [approved] = await tx
        .update(nationalReports)
        .set({
          status: 'approved',
          version: report.version + 1,
          approverSubject: principal.subject,
          approverName: nameOf(principal),
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
      return this.viewOf(tx, approved);
    });
  }

  private inEacc<T>(principal: Principal, work: (tx: ReportingTransaction) => Promise<T>) {
    return withTenant(this.db, { tenant: EACC_TENANT, subject: principal.subject }, work);
  }

  private async viewOf(
    tx: ReportingTransaction,
    report: NationalReportRow,
  ): Promise<NationalReportView> {
    const [aggregates] = await tx
      .select()
      .from(nationalReportAggregates)
      .where(eq(nationalReportAggregates.nationalReportId, report.id));
    const paragraphs = await tx
      .select()
      .from(nationalReportParagraphs)
      .where(eq(nationalReportParagraphs.nationalReportId, report.id));
    return nationalReportView(report, aggregates, paragraphs.map(paragraphOf));
  }

  /** Starts the approval workflow; 503 while Temporal is unreachable (nothing is approved). */
  private async startApproval(nationalReportId: string, fy: number): Promise<void> {
    try {
      await this.workflows.nationalReportApproved({ nationalReportId, fy });
    } catch {
      throw new ProblemException({
        type: 'workflow-unavailable',
        title: 'Upstream service unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The report could not be approved just now. Try again shortly.',
      });
    }
  }

  /** Every active Commission; 503 while the directory is unreachable. */
  private async commissions(): Promise<CommissionFacts[]> {
    try {
      return await this.directory.listCommissions();
    } catch (error) {
      if (!(error instanceof DirectoryUnavailable)) throw error;
      throw new ProblemException({
        type: 'directory-unavailable',
        title: 'Upstream service unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The Commission directory cannot be reached. Try again shortly.',
      });
    }
  }
}

/** The year's report locked for a change: 404 for none, 409 `ncr-approved` once approved. */
async function lockedDraft(tx: ReportingTransaction, fy: number): Promise<NationalReportRow> {
  const [report] = await tx
    .select()
    .from(nationalReports)
    .where(eq(nationalReports.fy, fy))
    .for('update');
  if (!report) throw notFound();
  if (report.status === 'approved') {
    throw conflict('ncr-approved', 'The report is approved and can no longer change.');
  }
  return report;
}

/** The next version of the report, with `principal` among its contributors. */
async function touch(
  tx: ReportingTransaction,
  report: NationalReportRow,
  principal: Principal,
): Promise<NationalReportRow> {
  const contributors = report.contributors.includes(principal.subject)
    ? report.contributors
    : [...report.contributors, principal.subject];
  const [updated] = await tx
    .update(nationalReports)
    .set({ version: report.version + 1, contributors })
    .where(eq(nationalReports.id, report.id))
    .returning();
  if (!updated) throw new Error(`National report ${report.id} vanished while it was saved`);
  return updated;
}

/**
 * Stores the narrative's paragraphs as `saved`: unchanged paragraphs are left alone (their editor
 * and time kept), changed and new ones written by `subject`, and those no longer there removed.
 */
async function replaceParagraphs(
  tx: ReportingTransaction,
  nationalReportId: string,
  stored: readonly Paragraph[],
  saved: readonly Paragraph[],
  subject: string,
): Promise<void> {
  const before = new Map(stored.map((paragraph) => [paragraph.id, paragraph]));
  const kept = new Set(saved.map((paragraph) => paragraph.id));
  for (const paragraph of stored) {
    if (kept.has(paragraph.id)) continue;
    await tx.delete(nationalReportParagraphs).where(eq(nationalReportParagraphs.id, paragraph.id));
  }
  for (const paragraph of saved) {
    const previous = before.get(paragraph.id);
    if (previous && sameParagraph(previous, paragraph)) continue;
    const values = {
      section: paragraph.section,
      position: paragraph.position,
      text: paragraph.text,
      aiDraft: paragraph.aiDraft,
      aggregateRefs: paragraph.aggregateRefs,
      candidateIds: paragraph.candidateIds,
    };
    // A paragraph only moved keeps its editor; a new or edited one is the caller's.
    const updatedBy = previous?.text === paragraph.text ? undefined : subject;
    await tx
      .insert(nationalReportParagraphs)
      .values({ id: paragraph.id, nationalReportId, ...values, updatedBy: updatedBy ?? subject })
      .onConflictDoUpdate({
        target: nationalReportParagraphs.id,
        set: updatedBy === undefined ? values : { ...values, updatedBy },
      });
  }
}

function sameParagraph(a: Paragraph, b: Paragraph): boolean {
  return a.section === b.section && a.position === b.position && a.text === b.text;
}

function nameOf(principal: Principal): string {
  return principal.name ?? principal.subject;
}

function notFound(): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: 'The national consolidated report for the year has not been built yet.',
  });
}

function conflict(code: string, detail: string): ProblemException {
  return new ProblemException(
    { type: 'about:blank', title: 'Conflict', status: HttpStatus.CONFLICT, detail },
    { code },
  );
}
