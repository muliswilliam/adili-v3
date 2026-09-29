import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { canonicalJson, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { type FormMV1, validateFormM } from '@adili/forms';
import { allocateReference, RPT } from '@adili/numbering';
import { and, eq } from 'drizzle-orm';

import {
  formMTenant,
  requireCommissionAdmin,
  requireStepUp,
  requireSupervisor,
} from '../access.js';
import { Clock, nairobiDate } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { dueDateOf } from '../financial-year.js';
import { commissionOf } from './commission.js';
import {
  COMPLIANCE_REPORT_REVIEWED,
  COMPLIANCE_REPORT_SUBMITTED,
  type ComplianceReportReviewedData,
  type ComplianceReportSubmittedData,
} from './events.js';
import { ACTION_LABELS } from './form-m.js';
import type { ReportingTransaction, ReportRow } from './reports.js';
import { ReportWorkflows } from './report-workflows.js';
import { type ComplianceReportView, reportView } from './representation.js';
import { complianceReports, reportReceipts, reportRemarks } from './schema.js';
import { openSnapshot, sealSnapshot } from './snapshot.js';
import type { ConfirmBody, ManualFieldsBody, RemarksBody, ReviewedBody } from './sign-off-input.js';

type NonFilerRow = FormMV1['partII']['initial']['nonFilers'][number];

/**
 * Review and sign-off of a Commission's Form M draft (spec 09): the supervisor edits remarks on
 * non-filer rows and marks the draft reviewed (Part III compiled-by); the commission-admin enters
 * Part I contact details and Part B, then confirms with a fresh step-up, which allocates the `RPT`
 * reference, completes Part III, freezes the document with its hash and submits it to EACC. The
 * workflow then issues the Form M PDF and the receipt and tells both officers. Edits keep the
 * report's status; a report being compiled or already submitted refuses them with 409.
 */
@Injectable()
export class ReportSignOffService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly cipher: FieldCipher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ReportWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * The supervisor's remarks on non-filer rows, by obligation id; a blank remark returns the row
   * to its default (the latest action step's label). Kept across recompiles. 400 for an
   * obligation the draft does not list.
   */
  async updateRemarks(
    principal: Principal,
    slug: string,
    fy: number,
    body: RemarksBody,
  ): Promise<ComplianceReportView> {
    const tenant = formMTenant(principal, slug);
    requireSupervisor(principal, 'edit the remarks of its Form M');
    return this.editDraft(principal, tenant, fy, async (tx, report, document) => {
      const rows = new Map<string, NonFilerRow>();
      for (const section of [
        document.partII.initial,
        document.partII.biennial,
        document.partII.final,
      ]) {
        for (const row of section.nonFilers) {
          if (row.obligationId) rows.set(row.obligationId, row);
        }
      }
      const unknown = body.remarks.flatMap(({ obligationId }, i) =>
        rows.has(obligationId)
          ? []
          : [{ path: `remarks.${String(i)}.obligationId`, message: 'Not a row of this report' }],
      );
      if (unknown.length > 0) throw invalid('The draft lists no such officer.', unknown);
      for (const { obligationId, remark } of body.remarks) {
        const row = rows.get(obligationId);
        if (!row) continue;
        const text = remark.trim();
        if (text === '') {
          await tx
            .delete(reportRemarks)
            .where(
              and(
                eq(reportRemarks.reportId, report.id),
                eq(reportRemarks.obligationId, obligationId),
              ),
            );
          row.remarks = ACTION_LABELS[row.actionTaken];
          continue;
        }
        const values = { remark: text, updatedBy: principal.subject };
        await tx
          .insert(reportRemarks)
          .values({ reportId: report.id, tenant, obligationId, ...values })
          .onConflictDoUpdate({
            target: [reportRemarks.reportId, reportRemarks.obligationId],
            set: values,
          });
        row.remarks = text;
      }
      return {};
    });
  }

  /**
   * The commission-admin's Part I contact details and Part B complaints: each field given replaces
   * the draft's; null clears it. Kept across recompiles.
   */
  async updateManualFields(
    principal: Principal,
    slug: string,
    fy: number,
    body: ManualFieldsBody,
  ): Promise<ComplianceReportView> {
    const tenant = formMTenant(principal, slug);
    requireCommissionAdmin(principal, 'enter the contact details and complaints of its Form M');
    return this.editDraft(principal, tenant, fy, (_tx, _report, document) => {
      const { partI, partII } = document;
      if (body.contactDetails !== undefined) partI.contactDetails = body.contactDetails ?? '';
      if (body.physicalAddress !== undefined) partI.physicalAddress = body.physicalAddress ?? '';
      if (body.emailAddress !== undefined) partI.emailAddress = body.emailAddress ?? '';
      if (body.complaintsRegisterMaintained !== undefined) {
        partII.complaints.registerMaintained = body.complaintsRegisterMaintained;
      }
      if (body.complaints !== undefined) partII.complaints.items = body.complaints;
      return Promise.resolve({});
    });
  }

  /**
   * The supervisor marks the draft reviewed: Part III "Compiled by" names them (their name from
   * the token, the designation they give) with today's date, and `compliance-report.reviewed.v1`.
   */
  async markReviewed(
    principal: Principal,
    slug: string,
    fy: number,
    body: ReviewedBody,
  ): Promise<ComplianceReportView> {
    const tenant = formMTenant(principal, slug);
    requireSupervisor(principal, 'mark its Form M reviewed');
    const now = this.clock.now();
    return this.editDraft(principal, tenant, fy, async (tx, report, document) => {
      document.partIII.compiledBy = {
        name: principal.name,
        designation: body.designation,
        date: nairobiDate(now),
      };
      await this.events.record<ComplianceReportReviewedData>(tx, {
        type: COMPLIANCE_REPORT_REVIEWED,
        subject: report.id,
        tenant,
        data: { reportId: report.id, fy, status: 'reviewed', source: report.source },
      });
      return {
        status: 'reviewed',
        reviewedBy: principal.subject,
        reviewedByName: principal.name,
        reviewedAt: now,
      };
    });
  }

  /**
   * The commission-admin confirms and submits the reviewed report (a fresh step-up, and an
   * `Idempotency-Key` at the controller): Part III "Confirmed by" names them, the document must
   * then be complete against `form-m.v1`, the `RPT` reference is allocated, the document is frozen
   * with its canonical SHA-256, the report is `submitted` (late after 31 July), EACC's receipt is
   * recorded and `compliance-report.submitted.v1` published. The workflow is told before the
   * commit, so a Temporal outage submits nothing; it issues the PDF and the receipt and tells the
   * officers once the commit is visible. 400 until reviewed or complete; 409 once submitted.
   * The answer leaves the document out (null).
   */
  async confirm(
    principal: Principal,
    slug: string,
    fy: number,
    body: ConfirmBody,
  ): Promise<ComplianceReportView> {
    const tenant = formMTenant(principal, slug);
    requireCommissionAdmin(principal, 'confirm and submit its Form M');
    const now = this.clock.now();
    requireStepUp(principal, now);
    const commission = await commissionOf(this.directory, tenant);
    const submitted = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const report = await lockedReport(tx, tenant, fy);
        if (report.status !== 'reviewed') {
          throw new ProblemException(
            {
              type: 'about:blank',
              title: 'Bad Request',
              status: HttpStatus.BAD_REQUEST,
              detail: 'A supervisor marks the draft reviewed before it is confirmed.',
            },
            { code: 'not-reviewed' },
          );
        }
        const document = await this.draftOf(tenant, report);
        document.partIII.confirmedBy = {
          name: principal.name,
          designation: body.designation ?? null,
          date: nairobiDate(now),
        };
        const checked = validateFormM(document);
        if (!checked.ok) {
          throw new ProblemException(
            {
              type: 'about:blank',
              title: 'Bad Request',
              status: HttpStatus.BAD_REQUEST,
              detail: 'The report is incomplete: complete the sections named before confirming.',
              errors: checked.errors,
            },
            { code: 'incomplete' },
          );
        }
        const reference = await allocateReference(tx, RPT, {
          issuer: commission.issuerCode,
          period: fy,
        });
        document.meta = { ...document.meta, reference, source: report.source };
        const sha256 = createHash('sha256').update(canonicalJson(document)).digest('hex');
        const sealed = await sealSnapshot(this.cipher, tenant, report.id, document);
        const late = nairobiDate(now) > dueDateOf(fy);
        const [row] = await tx
          .update(complianceReports)
          .set({
            status: 'submitted',
            reference,
            confirmedBy: principal.subject,
            confirmedByName: principal.name,
            confirmedAt: now,
            submittedAt: now,
            late,
            snapshotCiphertext: sealed.ciphertext,
            envelope: sealed.envelope,
            canonicalSha256: sha256,
          })
          .where(eq(complianceReports.id, report.id))
          .returning();
        if (!row?.counts) throw new Error(`Report ${report.id} has no counts to submit`);
        await tx.insert(reportReceipts).values({
          reportId: row.id,
          tenant,
          fy,
          reference,
          source: row.source,
          submittedAt: now,
          late,
          counts: row.counts,
        });
        await this.events.record<ComplianceReportSubmittedData>(tx, {
          type: COMPLIANCE_REPORT_SUBMITTED,
          subject: row.id,
          tenant,
          data: { reportId: row.id, fy, status: 'submitted', reference, late, source: row.source },
        });
        await this.tellWorkflow(tenant, fy);
        return row;
      },
    );
    // Without the document: this answer is kept for replays of the key, and names live only in
    // the encrypted snapshot. The console reads the report as filed with `getComplianceReport`.
    return reportView(submitted, commission, null);
  }

  /**
   * Runs `edit` on the locked draft's document, then saves the document encrypted with the
   * column changes `edit` answers, and returns the report as the Commission sees it.
   */
  private async editDraft(
    principal: Principal,
    tenant: string,
    fy: number,
    edit: (
      tx: ReportingTransaction,
      report: ReportRow,
      document: FormMV1,
    ) => Promise<Partial<typeof complianceReports.$inferInsert>>,
  ): Promise<ComplianceReportView> {
    const commission = await commissionOf(this.directory, tenant);
    const saved = await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const report = await lockedReport(tx, tenant, fy);
      const document = await this.draftOf(tenant, report);
      const changes = await edit(tx, report, document);
      const sealed = await sealSnapshot(this.cipher, tenant, report.id, document);
      const [row] = await tx
        .update(complianceReports)
        .set({ ...changes, snapshotCiphertext: sealed.ciphertext, envelope: sealed.envelope })
        .where(eq(complianceReports.id, report.id))
        .returning();
      if (!row) throw new Error(`Report ${report.id} vanished while it was edited`);
      return { row, document };
    });
    return reportView(saved.row, commission, saved.document);
  }

  /** The draft's document; a draft always has one once compiled. */
  private async draftOf(tenant: string, report: ReportRow): Promise<FormMV1> {
    const document = await openSnapshot(this.cipher, tenant, report);
    if (!document) throw new Error(`Report ${report.id} has no document`);
    return document;
  }

  /** Signals the workflow that the report is submitted; 503 while Temporal is unreachable. */
  private async tellWorkflow(tenant: string, fy: number): Promise<void> {
    try {
      await this.workflows.submitted({ tenant, fy });
    } catch {
      throw new ProblemException({
        type: 'workflow-unavailable',
        title: 'Upstream service unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The report could not be submitted just now. Try again shortly.',
      });
    }
  }
}

/**
 * The Commission's report for the year, locked for the edit: 404 for none, 409 while it is
 * compiled (`report-compiling`) or once submitted (`report-submitted`).
 */
async function lockedReport(
  tx: ReportingTransaction,
  tenant: string,
  fy: number,
): Promise<ReportRow> {
  const [report] = await tx
    .select()
    .from(complianceReports)
    .where(and(eq(complianceReports.tenant, tenant), eq(complianceReports.fy, fy)))
    .for('update');
  if (!report) {
    throw new ProblemException({
      type: 'about:blank',
      title: 'Not Found',
      status: HttpStatus.NOT_FOUND,
      detail: 'The resource does not exist or is not visible to you.',
    });
  }
  if (report.status === 'submitted' || report.status === 'compiling') {
    const submitted = report.status === 'submitted';
    throw new ProblemException(
      {
        type: 'about:blank',
        title: 'Conflict',
        status: HttpStatus.CONFLICT,
        detail: submitted
          ? 'The report is submitted and can no longer change.'
          : 'The report is being compiled. Try again once the draft is ready.',
      },
      { code: submitted ? 'report-submitted' : 'report-compiling' },
    );
  }
  return report;
}

function invalid(detail: string, errors: { path: string; message: string }[]): ProblemException {
  return new ProblemException(
    { type: 'about:blank', title: 'Bad Request', status: HttpStatus.BAD_REQUEST, detail, errors },
    { code: 'invalid-remarks' },
  );
}
