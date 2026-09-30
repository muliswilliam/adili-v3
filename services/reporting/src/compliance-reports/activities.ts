import { Injectable } from '@nestjs/common';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { formMIssues } from '@adili/forms';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { COMMISSION_ADMIN, SUPERVISOR } from '../access.js';
import { Clock, nairobiDate } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
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
  ReminderOutcome,
  ReminderRequest,
  ReportWorkflowInput,
  SubmissionDocuments,
} from './contract.js';
import {
  COMPLIANCE_REPORT_DRAFTED,
  COMPLIANCE_REPORT_REMINDER_SENT,
  type ComplianceReportDraftedData,
  type ComplianceReportReminderSentData,
} from './events.js';
import { aggregateFacts, assemble, carriedContacts, manualEntriesOf } from './form-m.js';
import { isSubmitted, notSubmitted, statusAfterCompile } from './report-status.js';
import { ensureReport, findReport, type ReportRow } from './reports.js';
import { complianceReports, reportReceipts, reportReminders, reportRemarks } from './schema.js';
import { openSnapshot, sealSnapshot } from './snapshot.js';

/**
 * Namespace of the emails' idempotency keys: one per report, message and recipient, so a retry
 * (or a later run of the workflow) never delivers one twice.
 */
const MESSAGE_KEY_NAMESPACE = '0c7f4e1a-3b52-4d8e-9a61-2f5d8b7c4e90';

/** Namespace of the documents' idempotency keys: one per report and document type. */
const DOCUMENT_KEY_NAMESPACE = '5b2d8e61-9c4f-4a07-8e13-6f2a9d4c7b18';

/** The version of the Form M and receipt templates documents renders. */
export const REPORT_TEMPLATE_VERSION = 1;

/** The submitted report is not committed yet (its confirm is finishing): the activity retries. */
export class ReportNotSubmitted extends Error {
  constructor(tenant: string, fy: number) {
    super(`The report of ${tenant} for ${String(fy)} is not submitted yet`);
    this.name = 'ReportNotSubmitted';
  }
}

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
    private readonly documents: DocumentsClient,
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
   * and a `compliance-report.drafted.v1` event. Part I contact details not entered yet carry over
   * from the Commission's previous submitted report. A submitted report is left as it is; a
   * reviewed one goes back to review with its new numbers. The draft is saved even with schema
   * problems left (Part I contacts before the commission-admin enters them): the console shows
   * them per section.
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
      if (isSubmitted(report)) return { report, facts: null };
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
                issuedAt: actionFacts.issuedAt,
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
      const [lastSubmitted] = await tx
        .select()
        .from(complianceReports)
        .where(
          and(
            eq(complianceReports.tenant, tenant),
            eq(complianceReports.status, 'submitted'),
            lt(complianceReports.fy, fy),
          ),
        )
        .orderBy(desc(complianceReports.fy))
        .limit(1);
      return { report, facts: { obligations, actions, clarifications, remarks }, lastSubmitted };
    });
    const { report, facts, lastSubmitted } = read;
    if (!facts) return { outcome: 'submitted', reportId: report.id };

    const previous = await openSnapshot(this.cipher, tenant, report);
    const lastReport = lastSubmitted
      ? await openSnapshot(this.cipher, tenant, lastSubmitted)
      : null;
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
      manual: carriedContacts(manualEntriesOf(previous), lastReport),
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
          // New numbers are reviewed again.
          reviewedBy: null,
          reviewedByName: null,
          reviewedAt: null,
          // A recompile asked for while this one ran leaves the report compiling: the workflow
          // compiles again.
          status: statusAfterCompile(compiledAt),
        })
        .where(and(eq(complianceReports.id, report.id), notSubmitted()))
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
    const staff = await reportOfficers(this.directory, tenant);
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

  /**
   * The deadline reminder `daysBefore` 31 July: emails the Commission's supervisors and
   * commission-admins while the report is not submitted, records it once and announces it with
   * `compliance-report.reminder-sent.v1`. A submitted report is reminded of nothing.
   */
  async remind({ tenant, fy, daysBefore }: ReminderRequest): Promise<ReminderOutcome> {
    const report = await withTenant(this.db, systemContext(tenant), (tx) =>
      findReport(tx, tenant, fy),
    );
    if (!report) return { outcome: 'sent', recipients: 0 };
    if (isSubmitted(report)) return { outcome: 'submitted' };
    const staff = await reportOfficers(this.directory, tenant);
    for (const [subject, email] of staff) {
      await this.notifications.send({
        to: email,
        template: 'form-m-reminder-email',
        params: {
          financialYear: `${String(fy)}/${String(fy + 1)}`,
          dueDate: dueDateOf(fy),
          daysLeft: daysBefore,
        },
        tenant,
        idempotencyKey: uuidv5(
          `${report.id}:reminder:${String(daysBefore)}:${subject}`,
          MESSAGE_KEY_NAMESPACE,
        ),
      });
    }
    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [recorded] = await tx
        .insert(reportReminders)
        .values({
          reportId: report.id,
          tenant,
          daysBefore,
          recipients: staff.size,
          sentAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      if (!recorded) return;
      await this.events.record<ComplianceReportReminderSentData>(tx, {
        type: COMPLIANCE_REPORT_REMINDER_SENT,
        subject: report.id,
        tenant,
        data: { reportId: report.id, fy, daysBefore, recipients: staff.size },
      });
    });
    return { outcome: 'sent', recipients: staff.size };
  }

  /**
   * Issues the submitted report's Restricted Form M PDF (the frozen document as filed) and its
   * signed acknowledgement receipt (reference, hash, submission time, Commission) through the
   * documents service, and keeps their ids. A document issued already is not issued again. Throws
   * `ReportNotSubmitted` while the confirm that signalled the workflow is still committing.
   */
  async issueSubmissionDocuments({
    tenant,
    fy,
  }: ReportWorkflowInput): Promise<SubmissionDocuments> {
    const report = await withTenant(this.db, systemContext(tenant), (tx) =>
      findReport(tx, tenant, fy),
    );
    if (!report || !isSubmitted(report)) throw new ReportNotSubmitted(tenant, fy);
    const submitted = submittedFacts(report);
    const document = await openSnapshot(this.cipher, tenant, report);
    if (!document) throw new Error(`The submitted report ${report.id} has no document`);
    const commission = await this.directory.getCommission(tenant);
    const request = {
      templateVersion: REPORT_TEMPLATE_VERSION,
      disclosureLevel: 'restricted',
      issuerTenant: tenant,
      subjectRef: `compliance-report:${report.id}`,
      subjectPersonId: null,
    } as const;
    const publicPayload = (type: 'form-m' | 'compliance-report-receipt') => ({
      reference: submitted.reference,
      type,
      issuer: commission.issuerCode,
      issuedAt: submitted.submittedAt.toISOString(),
    });

    let formMDocumentId = report.formMDocumentId;
    if (formMDocumentId === null) {
      const issued = await this.documents.issue({
        ...request,
        type: 'form-m',
        payload: document,
        publicPayload: publicPayload('form-m'),
        idempotencyKey: uuidv5(`${report.id}:form-m`, DOCUMENT_KEY_NAMESPACE),
      });
      formMDocumentId = issued.id;
      await keepDocument(this.db, tenant, report.id, { formMDocumentId });
    }
    let receiptDocumentId = report.receiptDocumentId;
    if (receiptDocumentId === null) {
      const issued = await this.documents.issue({
        ...request,
        type: 'compliance-report-receipt',
        payload: {
          reference: submitted.reference,
          sha256: submitted.sha256,
          submittedAt: submitted.submittedAt.toISOString(),
          commissionName: commission.name,
          issuerCode: commission.issuerCode,
          financialYear: `${String(fy)}/${String(fy + 1)}`,
          dueDate: dueDateOf(fy),
          late: submitted.late,
          source: report.source,
        },
        publicPayload: publicPayload('compliance-report-receipt'),
        idempotencyKey: uuidv5(`${report.id}:receipt`, DOCUMENT_KEY_NAMESPACE),
      });
      receiptDocumentId = issued.id;
      await keepDocument(this.db, tenant, report.id, { receiptDocumentId });
    }
    return { reportId: report.id, formMDocumentId, receiptDocumentId };
  }

  /**
   * Emails the Commission's supervisors and commission-admins that the report was submitted, with
   * its reference, when, and whether late. Answers how many were sent.
   */
  async notifySubmitted({ tenant, fy, reportId }: NotifyRequest): Promise<number> {
    const report = await withTenant(this.db, systemContext(tenant), (tx) =>
      findReport(tx, tenant, fy),
    );
    if (!report || !isSubmitted(report)) throw new ReportNotSubmitted(tenant, fy);
    const submitted = submittedFacts(report);
    const staff = await reportOfficers(this.directory, tenant);
    for (const [subject, email] of staff) {
      await this.notifications.send({
        to: email,
        template: 'form-m-receipt-email',
        params: {
          financialYear: `${String(fy)}/${String(fy + 1)}`,
          reference: submitted.reference,
          submittedOn: nairobiDate(submitted.submittedAt),
          late: submitted.late ? 'yes' : 'no',
        },
        tenant,
        idempotencyKey: uuidv5(`${reportId}:submitted:${subject}`, MESSAGE_KEY_NAMESPACE),
      });
    }
    return staff.size;
  }
}

/** The Commission's supervisors and commission-admins, by subject, with their sign-in email. */
async function reportOfficers(
  directory: DirectoryClient,
  tenant: string,
): Promise<Map<string, string>> {
  const staff = new Map<string, string>();
  for (const role of [SUPERVISOR, COMMISSION_ADMIN]) {
    for (const member of await directory.staffWithRole(tenant, role)) {
      staff.set(member.subject, member.email);
    }
  }
  return staff;
}

/** Keeps the id of a document issued for the report, on the report and EACC's receipt of it. */
async function keepDocument(
  db: Database<ReportingSchema>,
  tenant: string,
  reportId: string,
  ids: { formMDocumentId: string } | { receiptDocumentId: string },
): Promise<void> {
  await withTenant(db, systemContext(tenant), async (tx) => {
    await tx.update(complianceReports).set(ids).where(eq(complianceReports.id, reportId));
    await tx.update(reportReceipts).set(ids).where(eq(reportReceipts.reportId, reportId));
  });
}

/** What a submitted report always has. */
function submittedFacts(report: ReportRow) {
  const { reference, submittedAt, late, canonicalSha256 } = report;
  if (reference === null || submittedAt === null || late === null || canonicalSha256 === null) {
    throw new Error(`The submitted report ${report.id} lacks its reference, time or hash`);
  }
  return { reference, submittedAt, late, sha256: canonicalSha256 };
}
