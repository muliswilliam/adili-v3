import type { DocumentsClient } from './documents/client';
import type { components } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import type { Intake, IntakeRow, ReportingProblem, SubmittedReport } from './reporting/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The reporting service's EACC intake endpoints (spec 09 FE-3, S9, S10) folded into what the
 * intake dashboard and the report viewer render. Pure: the caller injects the clients
 * (`eacc-intake.ts` makes them for the signed-in EACC analyst or supervisor).
 */

export type EaccResult<T> = ServiceResult<T, ReportingProblem>;

/**
 * `GET /v1/eacc/compliance-reports?fy=`: every Commission for the year, unfiltered. The dashboard
 * filters in the browser, so its chips count every status and the outliers whatever is shown.
 */
export function loadIntake(client: ReportingClient, fy: number): Promise<EaccResult<Intake>> {
  return callService<Intake, ReportingProblem>(() =>
    client.GET('/v1/eacc/compliance-reports', { params: { query: { fy } } }),
  );
}

/** What the report viewer shows: the report as filed and its Commission's line on the intake. */
export interface ReportView {
  report: SubmittedReport;
  /** Its outliers and chases; null when the intake could not be read (the report still shows). */
  intake: IntakeRow | null;
}

/**
 * `GET /v1/eacc/compliance-reports/{reportId}`, then the year's intake for the Commission's
 * outliers and chases, which only the intake computes (thresholds are the service's config).
 */
export async function loadSubmittedReport(
  client: ReportingClient,
  reportId: string,
): Promise<EaccResult<ReportView>> {
  const result = await callService<
    components['schemas']['SubmittedComplianceReport'],
    ReportingProblem
  >(() => client.GET('/v1/eacc/compliance-reports/{reportId}', { params: { path: { reportId } } }));
  if (!result.ok) return result;
  const report = result.data;
  const intake = await loadIntake(client, report.fy);
  const line = intake.ok
    ? (intake.data.commissions.find((row) => row.commission.slug === report.commission.slug) ??
      null)
    : null;
  return { ok: true, data: { report, intake: line } };
}

/** A short-lived link to a filed report's PDF or receipt. */
export interface FileLink {
  downloadUrl: string;
  expiresAt: string;
}

/**
 * `GET /v1/documents/{documentId}/download` with the viewer's own token: documents admits EACC
 * roles to Form M PDFs and receipts across Commissions, hands a five-minute link and audits the
 * download; anyone else gets 404.
 */
export async function reportFileLink(
  client: DocumentsClient,
  documentId: string,
): Promise<ServiceResult<FileLink>> {
  const result = await callService(() =>
    client.GET('/v1/documents/{documentId}/download', { params: { path: { documentId } } }),
  );
  if (!result.ok) return result;
  const { downloadUrl, expiresAt } = result.data;
  return { ok: true, data: { downloadUrl, expiresAt } };
}
