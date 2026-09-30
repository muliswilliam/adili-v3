import { Injectable } from '@nestjs/common';
import { type Principal, type SetAuditedTenant } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { and, count, eq, max } from 'drizzle-orm';

import { requireEacc, submittedReportReader } from '../access.js';
import { config } from '../config.js';
import type { ReportingSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { notFound } from '../problems.js';
import { eaccContext } from '../system-context.js';
import { activeCommissions, commissionOf } from './commission.js';
import { REPORTS_SUBMIT_SCOPE } from './federated-submission.js';
import { buildIntake, type IntakeFilters, type IntakeView, type RateThresholds } from './intake.js';
import { type ComplianceReportView, reportView } from './representation.js';
import { complianceReports, reportChases, reportReceipts } from './schema.js';
import { openSnapshot } from './snapshot.js';

/** The configured outlier thresholds of the intake. */
export const INTAKE_THRESHOLDS: RateThresholds = {
  initial: config.INTAKE_MIN_INITIAL_RATE,
  biennial: config.INTAKE_MIN_BIENNIAL_RATE,
  final: config.INTAKE_MIN_FINAL_RATE,
};

/**
 * EACC's side of compliance reports (spec 09): the intake of a financial year across Commissions,
 * built from EACC's receipts of submitted reports, the directory's list of Commissions and the
 * chases; and the report viewer, which reads a submitted report as filed. EACC's analysts and
 * supervisors read every Commission's (in EACC's row-level security tenant, which sees submitted
 * reports only); a Commission's own staff and system read their own. Drafts are never shown here.
 */
@Injectable()
export class EaccReportsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly cipher: FieldCipher,
    private readonly directory: DirectoryClient,
  ) {}

  /** The year's intake (EACC roles; anyone else 403). 503 while the directory is unreachable. */
  async intake(principal: Principal, fy: number, filters: IntakeFilters): Promise<IntakeView> {
    requireEacc(principal);
    const commissions = await activeCommissions(this.directory);
    const { receipts, chases } = await withTenant(
      this.db,
      eaccContext(principal.subject),
      async (tx) => {
        const receipts = await tx.select().from(reportReceipts).where(eq(reportReceipts.fy, fy));
        const chases = await tx
          .select({
            tenant: reportChases.tenant,
            count: count(),
            lastAt: max(reportChases.sentAt),
          })
          .from(reportChases)
          .where(eq(reportChases.fy, fy))
          .groupBy(reportChases.tenant);
        return { receipts, chases };
      },
    );
    return buildIntake({
      fy,
      commissions,
      receipts,
      chases,
      thresholds: INTAKE_THRESHOLDS,
      filters,
    });
  }

  /**
   * A submitted report as filed, with its document and the ids of its PDF and receipt. EACC
   * roles read any Commission's; a Commission's staff and federated system their own. A draft,
   * another Commission's report and an unknown id are all 404. The read is audited under the
   * report's Commission (`audit`), whoever reads it (ADR-008).
   */
  async submittedReport(
    principal: Principal,
    reportId: string,
    audit: SetAuditedTenant,
  ): Promise<ComplianceReportView> {
    const reader = submittedReportReader(principal, REPORTS_SUBMIT_SCOPE);
    const report = await withTenant(
      this.db,
      { tenant: reader.tenant, subject: principal.subject },
      async (tx) => {
        const [found] = await tx
          .select()
          .from(complianceReports)
          .where(
            and(
              eq(complianceReports.id, reportId),
              eq(complianceReports.status, 'submitted'),
              ...(reader.everyCommission ? [] : [eq(complianceReports.tenant, reader.tenant)]),
            ),
          );
        return found;
      },
    );
    if (!report) throw notFound();
    audit(report.tenant);
    const document = await openSnapshot(this.cipher, report.tenant, report);
    return reportView(report, await commissionOf(this.directory, report.tenant), document);
  }
}
