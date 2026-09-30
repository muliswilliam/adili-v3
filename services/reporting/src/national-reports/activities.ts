import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { EACC_TENANT } from '../access.js';
import { ReportWorkflows } from '../compliance-reports/report-workflows.js';
import type { ReportingSchema } from '../db/schema.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { fyLabel } from '../financial-year.js';
import { eaccContext } from '../system-context.js';
import {
  type NationalReportApprovalInput,
  type NationalReportDocument,
  NCR_ISSUER,
} from './contract.js';
import { narrativeOf } from './narrative.js';
import { paragraphOf } from './representation.js';
import { nationalReportAggregates, nationalReportParagraphs, nationalReports } from './schema.js';

/** Namespace of the NCR PDF's idempotency key: one per national report. */
const DOCUMENT_KEY_NAMESPACE = 'c4a7e2d9-3b61-4f85-9d0a-72e1b6c3f845';

/** Version of the documents service's `ncr` template the payload fits. */
export const NCR_TEMPLATE_VERSION = 1;

/** The approval workflow ran before the approval's commit was visible; Temporal retries. */
export class NationalReportNotApproved extends Error {
  constructor(nationalReportId: string) {
    super(`National report ${nationalReportId} is not approved yet`);
    this.name = 'NationalReportNotApproved';
  }
}

/**
 * The activities of `NationalReportApprovalWorkflow`, hosted by the reporting worker. Every
 * public method is an activity named after it (keep helpers out of this class); each is safe to
 * retry. An unreachable documents service or Temporal propagates, so Temporal retries.
 */
@Injectable()
export class NationalReportActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly documents: DocumentsClient,
    private readonly workflows: ReportWorkflows,
  ) {}

  /**
   * Issues the approved report's Restricted PDF through documents (the `ncr` template: reference,
   * year, aggregates, narrative, author and approver) once, and keeps its id on the report. The
   * payload travels in the request body only.
   */
  async issueNationalReportDocument({
    nationalReportId,
  }: NationalReportApprovalInput): Promise<NationalReportDocument> {
    const found = await withTenant(this.db, eaccContext(), async (tx) => {
      const [report] = await tx
        .select()
        .from(nationalReports)
        .where(eq(nationalReports.id, nationalReportId));
      const [aggregates] = await tx
        .select()
        .from(nationalReportAggregates)
        .where(eq(nationalReportAggregates.nationalReportId, nationalReportId));
      const paragraphs = await tx
        .select()
        .from(nationalReportParagraphs)
        .where(eq(nationalReportParagraphs.nationalReportId, nationalReportId));
      return { report, aggregates, paragraphs };
    });
    const { report, aggregates } = found;
    if (report?.status !== 'approved' || !report.reference || !report.approvedAt || !aggregates) {
      throw new NationalReportNotApproved(nationalReportId);
    }
    if (report.documentId) return { documentId: report.documentId };

    const issued = await this.documents.issue({
      type: 'ncr',
      templateVersion: NCR_TEMPLATE_VERSION,
      disclosureLevel: 'restricted',
      issuerTenant: EACC_TENANT,
      subjectRef: `national-report:${report.id}`,
      subjectPersonId: null,
      payload: {
        reference: report.reference,
        financialYear: fyLabel(report.fy),
        builtAt: aggregates.builtAt.toISOString(),
        reportsIncluded: aggregates.reportsIncluded,
        aggregates: aggregates.aggregates,
        narrative: narrativeOf(found.paragraphs.map(paragraphOf)),
        author: report.authorName,
        approver: report.approverName,
        approvedAt: report.approvedAt.toISOString(),
      },
      publicPayload: {
        reference: report.reference,
        type: 'ncr',
        issuer: NCR_ISSUER,
        issuedAt: report.approvedAt.toISOString(),
      },
      idempotencyKey: uuidv5(`${report.id}:ncr`, DOCUMENT_KEY_NAMESPACE),
    });
    await withTenant(this.db, eaccContext(), (tx) =>
      tx
        .update(nationalReports)
        .set({ documentId: issued.id })
        .where(eq(nationalReports.id, report.id)),
    );
    return { documentId: issued.id };
  }

  /** Tells the year's chase to end; false when no chase runs. */
  endNationalChase({ fy }: NationalReportApprovalInput): Promise<boolean> {
    return this.workflows.endNationalChase(fy);
  }
}
