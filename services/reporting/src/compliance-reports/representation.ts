import type { FormMV1 } from '@adili/forms';
import { z } from 'zod';

import type { Conforms } from '../conforms.js';
import type { CommissionFacts } from '../directory/directory-client.js';
import { dueDateOf } from '../financial-year.js';
import { type Officer, officerSchema, storedOfficer } from '../officer.js';
import type { ReportRow } from './reports.js';
import { REPORT_STATUSES, type ReportCounts, type ReportSource } from './schema.js';

/** reporting.yaml `ReportStatus`: a period without a report is `not-started`. */
export type ReportStatusView = 'not-started' | 'compiling' | 'draft' | 'reviewed' | 'submitted';

export const reportStatusSchema = z.enum(['not-started', ...REPORT_STATUSES]);
true satisfies Conforms<ReportStatusView, typeof reportStatusSchema>;

export const reportSourceSchema = z.enum(['hosted', 'federated']).meta({
  description: 'Compiled and confirmed on the platform, or submitted by a federated Commission',
});
true satisfies Conforms<ReportSource, typeof reportSourceSchema>;

const sectionCountsSchema = z.object({
  expected: z.number().int().min(0),
  declared: z.number().int().min(0),
  notDeclared: z.number().int().min(0),
});

export const reportCountsSchema = z
  .object({
    initial: sectionCountsSchema,
    biennial: sectionCountsSchema.extend({ noCycleInPeriod: z.boolean() }),
    final: sectionCountsSchema,
    clarifications: z.number().int().min(0),
    accessRequests: z.object({
      received: z.number().int().min(0),
      granted: z.number().int().min(0),
      declined: z.number().int().min(0),
    }),
  })
  .meta({ description: 'Headline counts per Form M section, for lists and the intake' });
true satisfies Conforms<ReportCounts, typeof reportCountsSchema>;

/**
 * A `form-m.v1` document: packages/schemas/forms/form-m.v1.json is its schema. A draft need not be
 * complete against it yet (confirming checks that), so the contract names only its parts.
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
true satisfies Conforms<FormMV1, typeof formMDocumentSchema>;

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

/** reporting.yaml `ComplianceReportSummary`. */
export interface ComplianceReportSummary {
  fy: number;
  status: ReportStatusView;
  dueDate: string;
  reference: string | null;
  submittedAt: string | null;
  late: boolean | null;
  previewAvailable: boolean;
}

/** reporting.yaml `ComplianceReport`. */
export interface ComplianceReportView {
  id: string;
  commission: CommissionFacts;
  fy: number;
  status: ReportStatusView;
  source: ReportSource;
  compiledAt: string | null;
  reviewedBy: Officer | null;
  confirmedBy: Officer | null;
  submittedAt: string | null;
  late: boolean | null;
  reference: string | null;
  dueDate: string;
  /** The `form-m.v1` document; null while compiling. */
  document: FormMV1 | null;
  counts: ReportCounts | Record<string, never>;
  formMDocumentId: string | null;
  receiptDocumentId: string | null;
  accessDataUnavailable: boolean;
}

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
true satisfies Conforms<ComplianceReportView, typeof complianceReportSchema>;
true satisfies Conforms<ComplianceReportSummary, typeof complianceReportSummarySchema>;

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
