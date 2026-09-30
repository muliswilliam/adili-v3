import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { COMMISSION_ADMIN, REPORTING_OFFICER } from '../access.js';
import { Clock } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { dueDateOf, financialYearAt } from '../financial-year.js';
import { nationalReports } from '../national-reports/schema.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { PLATFORM_TENANT, systemContext } from '../system-context.js';
import type { ChaseOutcome, ChaseRequest, ChaseTargets, ChaseWorkflowInput } from './contract.js';
import { COMPLIANCE_REPORT_CHASED, type ComplianceReportChasedData } from './events.js';
import { findReport } from './reports.js';
import { ReportWorkflows } from './report-workflows.js';
import { reportChases, reportReceipts } from './schema.js';

/**
 * Namespace of the chase emails' idempotency keys: one per Commission, year, round and
 * recipient, so a retried chase never delivers one twice.
 */
const CHASE_KEY_NAMESPACE = '8e3a1c52-6d7f-4b09-a2e4-1f5c9d3b7a60';

/**
 * The activities of EACC's chase (`NationalConsolidationWorkflow`) and of its yearly start,
 * hosted by the reporting worker. Every public method is an activity named after it (keep helpers
 * out of this class); each is safe to retry. An unreachable directory or notifications service
 * propagates, so Temporal retries.
 */
@Injectable()
export class NationalChaseActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly directory: DirectoryClient,
    private readonly notifications: NotificationsClient,
    private readonly events: EventPublisher,
    private readonly workflows: ReportWorkflows,
    private readonly clock: Clock,
  ) {}

  /**
   * The active Commissions (slugs) that have not submitted the year's report; none, with
   * `ncrApproved`, once the year's national consolidated report is approved.
   */
  async chaseTargets({ fy }: ChaseWorkflowInput): Promise<ChaseTargets> {
    const { reported, approved } = await withTenant(
      this.db,
      systemContext(PLATFORM_TENANT),
      async (tx) => ({
        reported: await tx
          .select({ tenant: reportReceipts.tenant })
          .from(reportReceipts)
          .where(eq(reportReceipts.fy, fy)),
        approved: await tx
          .select({ id: nationalReports.id })
          .from(nationalReports)
          .where(and(eq(nationalReports.fy, fy), eq(nationalReports.status, 'approved'))),
      }),
    );
    if (approved.length > 0) return { tenants: [], ncrApproved: true };
    const commissions = await this.directory.listCommissions();
    const done = new Set(reported.map((row) => row.tenant));
    return {
      tenants: commissions
        .map((commission) => commission.slug)
        .filter((slug) => !done.has(slug))
        .sort(),
    };
  }

  /**
   * Chases one Commission for the year's report: emails its reporting officers and
   * commission-admins, records the round once and announces it with
   * `compliance-report.chased.v1`. A Commission that submitted meanwhile is chased no more.
   */
  async chaseCommission({ fy, tenant, round }: ChaseRequest): Promise<ChaseOutcome> {
    const context = systemContext(tenant);
    const { submitted, reportId } = await withTenant(this.db, context, async (tx) => {
      const [receipt] = await tx
        .select({ reportId: reportReceipts.reportId })
        .from(reportReceipts)
        .where(and(eq(reportReceipts.tenant, tenant), eq(reportReceipts.fy, fy)));
      const report = await findReport(tx, tenant, fy);
      return { submitted: receipt !== undefined, reportId: report?.id ?? null };
    });
    if (submitted) return { outcome: 'submitted' };

    const staff = new Map<string, string>();
    for (const role of [REPORTING_OFFICER, COMMISSION_ADMIN]) {
      for (const member of await this.directory.staffWithRole(tenant, role)) {
        staff.set(member.subject, member.email);
      }
    }
    for (const [subject, email] of staff) {
      await this.notifications.send({
        to: email,
        template: 'form-m-chase-email',
        params: {
          financialYear: `${String(fy)}/${String(fy + 1)}`,
          dueDate: dueDateOf(fy),
          round,
        },
        tenant,
        idempotencyKey: uuidv5(
          `${tenant}:${String(fy)}:chase:${String(round)}:${subject}`,
          CHASE_KEY_NAMESPACE,
        ),
      });
    }
    await withTenant(this.db, context, async (tx) => {
      const [recorded] = await tx
        .insert(reportChases)
        .values({ tenant, fy, round, recipients: staff.size, sentAt: this.clock.now() })
        .onConflictDoNothing()
        .returning();
      if (!recorded) return;
      await this.events.record<ComplianceReportChasedData>(tx, {
        type: COMPLIANCE_REPORT_CHASED,
        subject: reportId ?? undefined,
        tenant,
        data: { reportId, fy, round, recipients: staff.size },
      });
    });
    return { outcome: 'chased', recipients: staff.size };
  }

  /**
   * Starts the chase for the financial year whose reports were due on 31 July (the year before
   * the current one), unless it runs already.
   */
  async startNationalChase(): Promise<{ fy: number; started: boolean }> {
    const fy = financialYearAt(this.clock.now()) - 1;
    return { fy, started: await this.workflows.startNationalChase(fy) };
  }
}
