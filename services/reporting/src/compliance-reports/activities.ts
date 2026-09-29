import { Injectable } from '@nestjs/common';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { formMIssues } from '@adili/forms';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { COMMISSION_ADMIN, SUPERVISOR } from '../access.js';
import { Clock } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { dueDateOf } from '../financial-year.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { actionFacts, clarificationFacts, obligationFacts } from '../projections/schema.js';
import { ReviewClient } from '../review/review-client.js';
import { systemContext } from '../system-context.js';
import type {
  Aggregate,
  CompileOutcome,
  CompileRequest,
  NotifyRequest,
  ReportWorkflowInput,
} from './contract.js';
import { COMPLIANCE_REPORT_DRAFTED, type ComplianceReportDraftedData } from './events.js';
import { aggregateFacts, assemble, manualEntriesOf } from './form-m.js';
import { ensureReport } from './reports.js';
import { complianceReports, reportRemarks } from './schema.js';
import { openSnapshot, sealSnapshot } from './snapshot.js';

/** Namespace of the draft-ready emails' idempotency keys: one per report and recipient. */
const MESSAGE_KEY_NAMESPACE = '0c7f4e1a-3b52-4d8e-9a61-2f5d8b7c4e90';

/** An obligation fact as Form M reads it (`ObligationFactRow`). */
const OBLIGATION_FACT_COLUMNS = {
  obligationId: obligationFacts.obligationId,
  type: obligationFacts.type,
  statementDate: obligationFacts.statementDate,
  status: obligationFacts.status,
  filedAt: obligationFacts.filedAt,
  late: obligationFacts.late,
};

/**
 * The activities of `ComplianceReportWorkflow`, hosted by the reporting worker. Every public
 * method is an activity named after it (keep helpers out of this class); each is safe to retry.
 * An unreachable declarations, review, directory or notifications service propagates, so
 * Temporal retries.
 */
@Injectable()
export class ComplianceReportActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly review: ReviewClient,
    private readonly directory: DirectoryClient,
    private readonly notifications: NotificationsClient,
    private readonly cipher: FieldCipher,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Form M's counts and lists from the projections as they are now: ids and counts only. */
  async aggregate({ tenant, fy }: ReportWorkflowInput): Promise<Aggregate> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const obligations = await tx
        .select(OBLIGATION_FACT_COLUMNS)
        .from(obligationFacts)
        .where(and(eq(obligationFacts.tenant, tenant), eq(obligationFacts.fy, fy)));
      const clarifications = await tx
        .select({
          clarificationId: clarificationFacts.clarificationId,
          issuedAt: clarificationFacts.issuedAt,
        })
        .from(clarificationFacts)
        .where(and(eq(clarificationFacts.tenant, tenant), eq(clarificationFacts.fy, fy)));
      return aggregateFacts(obligations, clarifications);
    });
  }

  /**
   * Pulls the officers and clarifications the lists name, assembles the `form-m.v1` draft with
   * the remarks and manual entries of the previous one, and saves it encrypted with its counts
   * and a `compliance-report.drafted.v1` event. A submitted report is left as it is. The draft
   * is saved even with schema problems left (Part I contacts before the commission-admin enters
   * them): the console shows them per section.
   */
  async compileDraft({ tenant, fy, aggregate }: CompileRequest): Promise<CompileOutcome> {
    const compiledAt = this.clock.now();
    const listed = [
      ...aggregate.nonFilers.initial,
      ...aggregate.nonFilers.biennial,
      ...aggregate.nonFilers.final,
    ];
    const read = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const report = await ensureReport(tx, tenant, fy, compiledAt);
      if (report.status === 'submitted') return { report, facts: null };
      const obligations =
        listed.length === 0
          ? []
          : await tx
              .select(OBLIGATION_FACT_COLUMNS)
              .from(obligationFacts)
              .where(inArray(obligationFacts.obligationId, listed));
      const actions =
        listed.length === 0
          ? []
          : await tx
              .select({
                subjectId: actionFacts.subjectId,
                step: actionFacts.step,
                status: actionFacts.status,
              })
              .from(actionFacts)
              .where(
                and(
                  eq(actionFacts.subjectKind, 'obligation'),
                  inArray(actionFacts.subjectId, listed),
                ),
              );
      const clarifications =
        aggregate.clarificationIds.length === 0
          ? []
          : await tx
              .select({
                clarificationId: clarificationFacts.clarificationId,
                status: clarificationFacts.status,
              })
              .from(clarificationFacts)
              .where(inArray(clarificationFacts.clarificationId, aggregate.clarificationIds));
      const remarks = await tx
        .select({ obligationId: reportRemarks.obligationId, remark: reportRemarks.remark })
        .from(reportRemarks)
        .where(eq(reportRemarks.reportId, report.id));
      return { report, facts: { obligations, actions, clarifications, remarks } };
    });
    const { report, facts } = read;
    if (!facts) return { outcome: 'submitted', reportId: report.id };

    const previous = await openSnapshot(this.cipher, tenant, report);
    const commission = await this.directory.getCommission(tenant);
    const officers =
      listed.length === 0 ? [] : await this.declarations.officerDetails(tenant, listed);
    const clarifications =
      aggregate.clarificationIds.length === 0
        ? []
        : await this.review.clarificationDetails(tenant, aggregate.clarificationIds);
    const document = assemble({
      fy,
      commission,
      aggregate,
      obligations: new Map(facts.obligations.map((row) => [row.obligationId, row])),
      actions: facts.actions,
      officers,
      clarificationStatuses: new Map(
        facts.clarifications.map((row) => [row.clarificationId, row.status]),
      ),
      clarifications,
      remarks: new Map(facts.remarks.map((row) => [row.obligationId, row.remark])),
      manual: manualEntriesOf(previous),
      compiledAt,
    });
    const { issues, report: unplaced } = formMIssues(document);
    const sealed = await sealSnapshot(this.cipher, tenant, report.id, document);

    const saved = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [updated] = await tx
        .update(complianceReports)
        .set({
          snapshotCiphertext: sealed.ciphertext,
          envelope: sealed.envelope,
          counts: aggregate.counts,
          compiledAt,
          // A recompile asked for while this one ran leaves the report compiling: the workflow
          // compiles again.
          status: sql`case when ${complianceReports.compileRequestedAt} > ${compiledAt.toISOString()}::timestamptz then 'compiling' else 'draft' end`,
        })
        .where(and(eq(complianceReports.id, report.id), ne(complianceReports.status, 'submitted')))
        .returning({ status: complianceReports.status });
      if (!updated) return false;
      await this.events.record<ComplianceReportDraftedData>(tx, {
        type: COMPLIANCE_REPORT_DRAFTED,
        subject: report.id,
        tenant,
        data: { reportId: report.id, fy, status: updated.status, source: 'hosted' },
      });
      return true;
    });
    if (!saved) return { outcome: 'submitted', reportId: report.id };
    return {
      outcome: 'saved',
      reportId: report.id,
      first: report.snapshotCiphertext === null,
      issues: issues.length + unplaced.length,
    };
  }

  /**
   * Emails the Commission's supervisors and commission-admins that the draft is ready to review.
   * Each recipient's message has one idempotency key per report, so a retry (or a later run of
   * the workflow) never delivers it twice. Answers how many were sent.
   */
  async notifyDraftReady({ tenant, fy, reportId }: NotifyRequest): Promise<number> {
    const staff = new Map<string, string>();
    for (const role of [SUPERVISOR, COMMISSION_ADMIN]) {
      for (const member of await this.directory.staffWithRole(tenant, role)) {
        staff.set(member.subject, member.email);
      }
    }
    for (const [subject, email] of staff) {
      await this.notifications.send({
        to: email,
        template: 'form-m-draft-ready-email',
        params: { financialYear: `${String(fy)}/${String(fy + 1)}`, dueDate: dueDateOf(fy) },
        tenant,
        idempotencyKey: uuidv5(`${reportId}:draft-ready:${subject}`, MESSAGE_KEY_NAMESPACE),
      });
    }
    return staff.size;
  }
}
