import { FormMSchema, type FormMV1 } from '@adili/forms';
import { z } from 'zod';

import type { CommissionFacts } from '../directory/directory-client.js';
import { dueDateOf } from '../financial-year.js';
import { officerSchema, storedOfficer } from '../officer.js';
import type { ReportRow } from './reports.js';
import { REPORT_SOURCES, REPORT_STATUSES } from './schema.js';

/** reporting.yaml `ReportStatus`: a period without a report is `not-started`. */
export const reportStatusSchema = z.enum(['not-started', ...REPORT_STATUSES]);
export type ReportStatusView = z.infer<typeof reportStatusSchema>;

export const reportSourceSchema = z.enum(REPORT_SOURCES).meta({
  description: 'Compiled and confirmed on the platform, or submitted by a federated Commission',
});

/** A count in the contract: a non-negative integer. */
export const countSchema = z.number().int().min(0);

/** Form M section 5's headline counts, in a report and in the NCR's aggregates. */
export const accessRequestCountsSchema = z.object({
  received: countSchema,
  granted: countSchema,
  declined: countSchema,
});

const sectionCountsSchema = z.object({
  expected: countSchema,
  declared: countSchema,
  notDeclared: countSchema,
});

export const reportCountsSchema = z
  .object({
    initial: sectionCountsSchema,
    biennial: sectionCountsSchema.extend({ noCycleInPeriod: z.boolean() }),
    final: sectionCountsSchema,
    clarifications: countSchema,
    accessRequests: accessRequestCountsSchema,
  })
  .meta({ description: 'Headline counts per Form M section, for lists and the intake' });

/**
 * A draft `form-m.v1` document. A draft need not be complete against form-m.v1 yet (confirming
 * checks that), so the contract names only its parts; a submitted document is `FormM` itself.
 */
export const formMDocumentSchema = z
  .object({
    schemaVersion: z.literal('form-m.v1'),
    partI: z.looseObject({}),
    partII: z.looseObject({}),
    partIII: z.looseObject({}),
    meta: z.looseObject({}).optional(),
  })
  .meta({
    description:
      'A form-m.v1 document (packages/schemas/forms/form-m.v1.json, also published for federated Commissions)',
  });

/** reporting.yaml `ComplianceReportSummary`. */
export const complianceReportSummarySchema = z.object({
  fy: z.number().int().meta({ description: 'Financial year start year' }),
  status: reportStatusSchema,
  dueDate: z.iso.date().meta({ description: '31 July after the financial year' }),
  reference: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  late: z.boolean().nullable(),
  previewAvailable: z.boolean().meta({
    description: 'A supervisor may compile the year now (from 1 April of its last half)',
  }),
});
export type ComplianceReportSummary = z.infer<typeof complianceReportSummarySchema>;

/** reporting.yaml `ComplianceReport`. */
export const complianceReportSchema = z.object({
  id: z.uuid(),
  commission: z.object({ slug: z.string(), issuerCode: z.string(), name: z.string() }),
  fy: z.number().int().meta({ description: 'Financial year start year' }),
  status: reportStatusSchema,
  source: reportSourceSchema,
  compiledAt: z.iso.datetime().nullable(),
  reviewedBy: officerSchema.nullable(),
  confirmedBy: officerSchema.nullable(),
  submittedAt: z.iso.datetime().nullable(),
  late: z.boolean().nullable(),
  reference: z
    .string()
    .nullable()
    .meta({ description: '`RPT-<ISSUER>-<FY end>-<seq>-<check>`, allocated at confirmation' }),
  dueDate: z.iso.date(),
  document: formMDocumentSchema.nullable().meta({
    description:
      'The form-m.v1 document (draft or frozen); null while compiling, and in the answers to confirmComplianceReport and submitComplianceReport',
  }),
  counts: z
    .union([reportCountsSchema, z.strictObject({})])
    .meta({ description: 'Empty until the first compile' }),
  formMDocumentId: z
    .uuid()
    .nullable()
    .meta({ description: 'The Restricted Form M PDF, once issued' }),
  receiptDocumentId: z
    .uuid()
    .nullable()
    .meta({ description: 'The signed acknowledgement receipt, once issued' }),
  accessDataUnavailable: z.boolean().meta({
    description: 'Form M section 5 holds no access request data for the year (zeros with a note)',
  }),
});
export type ComplianceReportView = z.infer<typeof complianceReportSchema>;

/**
 * A submitted report as filed (`getSubmittedReport`): its document is the frozen `form-m.v1`
 * (`FormM`, packages/schemas/forms/form-m.v1.json), complete and with its `meta.reference`.
 */
export const submittedComplianceReportSchema = complianceReportSchema.extend({
  document: FormMSchema.meta({
    description: 'The form-m.v1 document as filed, frozen at submission',
  }),
});

/** reporting.yaml `SubmittedComplianceReport`. */
export type SubmittedReportView = z.infer<typeof submittedComplianceReportSchema>;

export function reportSummary(
  fy: number,
  report: ReportRow | undefined,
  previewAvailable: boolean,
): ComplianceReportSummary {
  return {
    fy,
    status: report?.status ?? 'not-started',
    dueDate: dueDateOf(fy),
    reference: report?.reference ?? null,
    submittedAt: report?.submittedAt?.toISOString() ?? null,
    late: report?.late ?? null,
    previewAvailable: previewAvailable && report?.status !== 'submitted',
  };
}

export function reportView(
  report: ReportRow,
  commission: CommissionFacts,
  document: FormMV1 | null,
): ComplianceReportView {
  return {
    id: report.id,
    commission,
    fy: report.fy,
    status: report.status,
    source: report.source,
    compiledAt: report.compiledAt?.toISOString() ?? null,
    reviewedBy: storedOfficer(report.reviewedBy, report.reviewedByName),
    confirmedBy: storedOfficer(report.confirmedBy, report.confirmedByName),
    submittedAt: report.submittedAt?.toISOString() ?? null,
    late: report.late,
    reference: report.reference,
    dueDate: dueDateOf(report.fy),
    document: report.status === 'compiling' ? null : document,
    counts: report.counts ?? {},
    formMDocumentId: report.formMDocumentId,
    receiptDocumentId: report.receiptDocumentId,
    accessDataUnavailable: document?.partII.accessRequests.dataUnavailable ?? true,
  };
}
