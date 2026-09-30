import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { financialYearAt } from '../financial-year.js';
import { obligationFacts } from '../projections/schema.js';
import { PLATFORM_TENANT, systemContext } from '../system-context.js';
import type { AnnualCompilePlan, ReportWorkflowInput } from './contract.js';
import { markCompiling } from './reports.js';
import { ReportWorkflows } from './report-workflows.js';
import { complianceReports } from './schema.js';

/**
 * The activities of the yearly compile (`annualCompile`), hosted by the reporting worker. Every
 * public method is an activity named after it; each is safe to retry.
 */
@Injectable()
export class AnnualCompileActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly workflows: ReportWorkflows,
    private readonly clock: Clock,
  ) {}

  /**
   * The financial year that just ended and the Commissions to compile it for: every Commission
   * the projections know (its roster's obligations reached the reporting service), and any with a
   * report for the year. Slugs only.
   */
  async annualCompileTargets(): Promise<AnnualCompilePlan> {
    const fy = financialYearAt(this.clock.now()) - 1;
    const tenants = await withTenant(this.db, systemContext(PLATFORM_TENANT), async (tx) => {
      const known = await tx
        .selectDistinct({ tenant: obligationFacts.tenant })
        .from(obligationFacts);
      const reported = await tx
        .selectDistinct({ tenant: complianceReports.tenant })
        .from(complianceReports)
        .where(eq(complianceReports.fy, fy));
      return [...known, ...reported].map((row) => row.tenant);
    });
    return { fy, tenants: [...new Set(tenants)].sort() };
  }

  /**
   * Starts (or asks to recompile) the Commission's report for the year, as a supervisor's compile
   * would. False, and nothing started, for a report already submitted.
   */
  async startCompile({ tenant, fy }: ReportWorkflowInput): Promise<boolean> {
    const report = await withTenant(this.db, systemContext(tenant), (tx) =>
      markCompiling(tx, tenant, fy, this.clock.now()),
    );
    if (!report) return false;
    await this.workflows.compile({ tenant, fy });
    return true;
  }
}
