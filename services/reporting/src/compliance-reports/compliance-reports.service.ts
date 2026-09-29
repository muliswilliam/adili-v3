import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, isNotNull } from 'drizzle-orm';

import { formMTenant, requireSupervisor } from '../access.js';
import { Clock, nairobiDate } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { FIRST_FINANCIAL_YEAR, financialYearAt, previewFromOf } from '../financial-year.js';
import { clarificationFacts, obligationFacts } from '../projections/schema.js';
import { commissionOf } from './commission.js';
import { findReport, markCompiling } from './reports.js';
import { ReportWorkflows } from './report-workflows.js';
import {
  type ComplianceReportSummary,
  type ComplianceReportView,
  reportSummary,
  reportView,
} from './representation.js';
import { complianceReports } from './schema.js';
import { openSnapshot } from './snapshot.js';

/**
 * A Commission's Form M workspace (spec 09): its report periods, the report of a year with its
 * decrypted document, and compiling a preview or recompiling. The Commission's supervisor,
 * commission-admin and reporting officer see it; only the supervisor compiles. Everyone else gets
 * 404. Reads and writes run under the Commission's row-level security.
 */
@Injectable()
export class ComplianceReportsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly cipher: FieldCipher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ReportWorkflows,
    private readonly clock: Clock,
  ) {}

  /**
   * The report periods: every financial year the Commission has facts or a report for, and the
   * current and previous years, newest first, each with its report's status.
   */
  async periods(principal: Principal, slug: string): Promise<ComplianceReportSummary[]> {
    const tenant = formMTenant(principal, slug);
    const now = this.clock.now();
    const current = financialYearAt(now);
    const { reports, years } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const reports = await tx
          .select()
          .from(complianceReports)
          .where(eq(complianceReports.tenant, tenant));
        const obligationYears = await tx
          .selectDistinct({ fy: obligationFacts.fy })
          .from(obligationFacts)
          .where(and(eq(obligationFacts.tenant, tenant), isNotNull(obligationFacts.fy)));
        const clarificationYears = await tx
          .selectDistinct({ fy: clarificationFacts.fy })
          .from(clarificationFacts)
          .where(and(eq(clarificationFacts.tenant, tenant), isNotNull(clarificationFacts.fy)));
        return { reports, years: [...obligationYears, ...clarificationYears] };
      },
    );
    const fys = new Set<number>([current, current - 1, ...reports.map((report) => report.fy)]);
    for (const { fy } of years) if (fy !== null) fys.add(fy);
    const today = nairobiDate(now);
    return [...fys]
      .filter((fy) => fy >= FIRST_FINANCIAL_YEAR && fy <= current)
      .sort((a, b) => b - a)
      .map((fy) =>
        reportSummary(
          fy,
          reports.find((report) => report.fy === fy),
          today >= previewFromOf(fy),
        ),
      );
  }

  /** The report of a financial year with its document (null while compiling); 404 for none. */
  async get(principal: Principal, slug: string, fy: number): Promise<ComplianceReportView> {
    const tenant = formMTenant(principal, slug);
    const report = await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      findReport(tx, tenant, fy),
    );
    if (!report) throw notFound();
    const document =
      report.status === 'compiling' ? null : await openSnapshot(this.cipher, tenant, report);
    return reportView(report, await commissionOf(this.directory, tenant), document);
  }

  /**
   * Compiles the year's draft: a preview from 1 April after the year ends, then the draft,
   * recompiled on demand until the report is submitted. The report is `compiling` until the
   * workflow saves the draft. 409 before previews open and once submitted.
   */
  async compile(principal: Principal, slug: string, fy: number): Promise<void> {
    const tenant = formMTenant(principal, slug);
    requireSupervisor(principal);
    const now = this.clock.now();
    if (nairobiDate(now) < previewFromOf(fy)) {
      throw new ProblemException(
        {
          type: 'about:blank',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail: `A preview of Form M for ${String(fy)}/${String(fy + 1)} can be compiled from ${previewFromOf(fy)}.`,
        },
        { code: 'preview-not-available' },
      );
    }
    await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const report = await markCompiling(tx, tenant, fy, now);
      if (!report) {
        throw new ProblemException(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: 'The report is submitted and can no longer be compiled.',
          },
          { code: 'report-submitted' },
        );
      }
    });
    await this.workflows.compile({ tenant, fy });
  }
}

function notFound(): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: 'The resource does not exist or is not visible to you.',
  });
}
