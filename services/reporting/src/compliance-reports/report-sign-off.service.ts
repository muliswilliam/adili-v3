import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { canonicalJson, type Principal } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { type FormMV1, type FormValidationError, validateFormM } from '@adili/forms';
import { allocateReference, RPT } from '@adili/numbering';
import { and, eq } from 'drizzle-orm';

import {
  federatedTenant,
  formMTenant,
  requireCommissionAdmin,
  requireStepUp,
  requireSupervisor,
} from '../access.js';
import { Clock, nairobiDate } from '../clock.js';
import type { ReportingSchema } from '../db/schema.js';
import { type CommissionFacts, DirectoryClient } from '../directory/directory-client.js';
import { dueDateOf, referencePeriodOf } from '../financial-year.js';
import { officerOf } from '../officer.js';
import { notFound, problem, type ProblemError, workflowUnavailable } from '../problems.js';
import { commissionOf } from './commission.js';
import {
  COMPLIANCE_REPORT_REVIEWED,
  COMPLIANCE_REPORT_SUBMITTED,
  type ComplianceReportReviewedData,
  type ComplianceReportSubmittedData,
} from './events.js';
import { federatedRuleProblems, reportCountsOf } from './federated-submission.js';
import { ACTION_LABELS } from './form-m.js';
import {
  REVIEWED,
  requireEditable,
  requireFinal,
  requireNotSubmitted,
  requireReviewed,
  SUBMITTED,
} from './report-status.js';
import { ensureReport, type ReportingTransaction, type ReportRow } from './reports.js';
import { ReportWorkflows } from './report-workflows.js';
import { type ComplianceReportView, reportView } from './representation.js';
import { complianceReports, reportReceipts, reportRemarks, type ReportSource } from './schema.js';
import { openSnapshot, sealSnapshot } from './snapshot.js';
import type { ConfirmBody, ManualFieldsBody, RemarksBody, ReviewedBody } from './sign-off-input.js';

type NonFilerRow = FormMV1['partII']['initial']['nonFilers'][number];

/**
 * Review and sign-off of a Commission's Form M draft (spec 09): the supervisor edits remarks on
 * non-filer rows and marks the draft reviewed (Part III compiled-by); the commission-admin enters
 * Part I contact details and Part B, then confirms with a fresh step-up, which allocates the `RPT`
 * reference, completes Part III, freezes the document with its hash and submits it to EACC. The
 * workflow then issues the Form M PDF and the receipt and tells both officers. Edits keep the
 * report's status; a report being compiled or already submitted refuses them with 409. A
 * federated Commission's system files its own document along the same submission path.
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
      requireFinal(report);
      document.partIII.compiledBy = {
        name: principal.name,
        designation: body.designation,
        date: nairobiDate(now),
      };
      await this.events.record<ComplianceReportReviewedData>(tx, {
        type: COMPLIANCE_REPORT_REVIEWED,
        subject: report.id,
        tenant,
        data: { reportId: report.id, fy, status: REVIEWED, source: report.source },
      });
      return {
        status: REVIEWED,
        reviewedBy: principal.subject,
        reviewedByName: officerOf(principal).name,
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
        requireFinal(report);
        requireReviewed(report);
        const document = await this.draftOf(tenant, report);
        document.partIII.confirmedBy = {
          name: principal.name,
          designation: body.designation ?? null,
          date: nairobiDate(now),
        };
        const checked = validateFormM(document);
        if (!checked.ok) {
          throw problem(
            'incomplete',
            'The report is incomplete: complete the sections named before confirming.',
            { errors: checked.errors },
          );
        }
        return this.submit(tx, report, document, {
          commission,
          signedBy: principal,
          now,
          source: report.source,
        });
      },
    );
    // Without the document: this answer is kept for replays of the key, and names live only in
    // the encrypted snapshot. The console reads the report as filed with `getComplianceReport`.
    return reportView(submitted, commission, null);
  }

  /**
   * A federated Commission's system files its `form-m.v1` document (a client-credentials token
   * with `reports:submit` for the Commission, and an `Idempotency-Key` at the controller). The
   * document must be valid against the schema (400 `invalid-document`), name the token's
   * Commission (403 `tenant-mismatch`) and keep the business rules (400 `inconsistent-document`);
   * then it is submitted along the hosted confirm's path with `source = federated`: the `RPT`
   * reference, the frozen document and its hash, EACC's receipt, the event, and from the workflow
   * the Form M PDF, the receipt and the officers' emails. A draft the platform compiled for the
   * year is superseded; a submitted report is 409 `report-submitted`. The answer leaves the
   * document out (null), as confirm's does.
   */
  async submitFederated(principal: Principal, body: unknown): Promise<ComplianceReportView> {
    const tenant = federatedTenant(principal);
    const checked = validateFormM(body);
    if (!checked.ok) {
      throw documentProblem(
        'invalid-document',
        'The document is not a valid form-m.v1 document: fix the fields named.',
        checked.errors,
      );
    }
    const document = checked.value;
    const commission = await commissionOf(this.directory, tenant);
    if (document.partI.issuerCode !== commission.issuerCode) {
      throw problem(
        'tenant-mismatch',
        'The document names another Commission than the one the token is issued for.',
      );
    }
    const now = this.clock.now();
    const broken = federatedRuleProblems(document, nairobiDate(now));
    if (broken.length > 0) {
      throw documentProblem(
        'inconsistent-document',
        'The document breaks the rules of Form M: fix the fields named.',
        broken,
      );
    }
    const fy = document.partI.period.financialYearStart;
    const submitted = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const { id } = await ensureReport(tx, tenant, fy, now);
        const [report] = await tx
          .select()
          .from(complianceReports)
          .where(eq(complianceReports.id, id))
          .for('update');
        if (!report) throw new Error(`Report ${id} vanished while it was submitted`);
        requireNotSubmitted(report);
        // The federated document supersedes a draft compiled here, remarks and review included.
        await tx.delete(reportRemarks).where(eq(reportRemarks.reportId, report.id));
        return this.submit(tx, report, document, {
          commission,
          signedBy: principal,
          now,
          source: 'federated',
          changes: {
            counts: reportCountsOf(document),
            compiledAt: now,
            reviewedBy: null,
            reviewedByName: null,
            reviewedAt: null,
          },
        });
      },
    );
    return reportView(submitted, commission, null);
  }

  /**
   * Submits the locked `report` with its complete `document`, for the hosted confirm and the
   * federated submission alike: allocates the `RPT` reference, puts it and the source in the
   * document's `meta`, freezes the document with its canonical SHA-256, marks the report
   * `submitted` (late after 31 July) as signed by `signedBy` with `changes`, records EACC's
   * receipt, publishes `compliance-report.submitted.v1` and tells the workflow before the commit,
   * so a Temporal outage submits nothing. The workflow issues the Form M PDF and the receipt and
   * tells the officers once the commit is visible.
   */
  private async submit(
    tx: ReportingTransaction,
    report: ReportRow,
    document: FormMV1,
    options: {
      commission: CommissionFacts;
      signedBy: Principal;
      now: Date;
      source: ReportSource;
      changes?: Partial<typeof complianceReports.$inferInsert>;
    },
  ): Promise<ReportRow> {
    const { commission, signedBy, now, source, changes = {} } = options;
    const { tenant, fy } = report;
    const reference = await allocateReference(tx, RPT, {
      issuer: commission.issuerCode,
      period: referencePeriodOf(fy),
    });
    document.meta = { ...document.meta, reference, source };
    const sha256 = createHash('sha256').update(canonicalJson(document)).digest('hex');
    const sealed = await sealSnapshot(this.cipher, tenant, report.id, document);
    const late = nairobiDate(now) > dueDateOf(fy);
    const [row] = await tx
      .update(complianceReports)
      .set({
        ...changes,
        status: SUBMITTED,
        source,
        reference,
        confirmedBy: signedBy.subject,
        confirmedByName: officerOf(signedBy).name,
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
      source,
      submittedAt: now,
      late,
      counts: row.counts,
    });
    await this.events.record<ComplianceReportSubmittedData>(tx, {
      type: COMPLIANCE_REPORT_SUBMITTED,
      subject: row.id,
      tenant,
      data: { reportId: row.id, fy, status: SUBMITTED, reference, late, source },
    });
    await this.tellWorkflow(tenant, fy);
    return row;
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
      throw workflowUnavailable('The report could not be submitted just now. Try again shortly.');
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
  if (!report) throw notFound();
  requireEditable(report);
  return report;
}

/** 400 with the document's problems by field path (`errors`), under `code`. */
function documentProblem(
  code: 'invalid-document' | 'inconsistent-document',
  detail: string,
  errors: FormValidationError[],
) {
  return problem(code, detail, { errors });
}

function invalid(detail: string, errors: ProblemError[]) {
  return problem('invalid-remarks', detail, { errors });
}
