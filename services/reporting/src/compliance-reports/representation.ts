import type { FormMV1 } from '@adili/forms';

import type { CommissionFacts } from '../directory/directory-client.js';
import { dueDateOf } from '../financial-year.js';
import { type Officer, storedOfficer } from '../officer.js';
import type { ReportRow } from './reports.js';
import type { ReportCounts, ReportSource } from './schema.js';

/** reporting.yaml `ReportStatus`: a period without a report is `not-started`. */
export type ReportStatusView = 'not-started' | 'compiling' | 'draft' | 'reviewed' | 'submitted';

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
