import type { DocumentsClient } from './documents/client';
import { nationalAggregatesSchema } from './reporting/aggregates';
import type { ReportingClient } from './reporting/client.server';
import type {
  Narrative,
  NarrativeDraftSection,
  NationalReport,
  ReportingProblem,
} from './reporting/types';
import { callService, type ServiceResult } from './service-call';

/**
 * EACC's national consolidated report (spec 09 NCR, #233) through the reporting service, as the
 * signed-in EACC analyst or supervisor: read the year's report with how many Commissions have
 * reported, build or rebuild it, save its narrative, approve it, and download its PDF.
 */

export type NationalReportResult<T> = ServiceResult<T, ReportingProblem>;

/** The national report page's data for a financial year. */
export interface NationalReportPage {
  fy: number;
  /** Null until the year's report is first built. */
  report: NationalReport | null;
  /** Commissions whose Form M for the year EACC has received, now (a build may predate some). */
  reported: number;
  notReported: number;
}

type RawReport = Omit<NationalReport, 'aggregates'> & { aggregates: Record<string, unknown> };

/** The report with its aggregates read, or a failed load when they are not what was built. */
function readReport(raw: RawReport): NationalReportResult<NationalReport> {
  const aggregates = nationalAggregatesSchema.safeParse(raw.aggregates);
  if (!aggregates.success) {
    return {
      ok: false,
      error: { kind: 'unavailable', detail: 'The report figures could not be read.' },
    };
  }
  return { ok: true, data: { ...raw, aggregates: aggregates.data } };
}

function readReportResult(
  result: NationalReportResult<RawReport>,
): NationalReportResult<NationalReport> {
  return result.ok ? readReport(result.data) : result;
}

/**
 * The year's report (null before the first build) and how many Commissions have reported, from
 * the intake: the empty state says so, and a draft built before later reports arrived says how
 * many a rebuild would add.
 */
export async function loadNationalReportPage(
  client: ReportingClient,
  fy: number,
): Promise<NationalReportResult<NationalReportPage>> {
  const [report, intake] = await Promise.all([
    callService<RawReport, ReportingProblem>(() =>
      client.GET('/v1/eacc/national-reports/{fy}', { params: { path: { fy } } }),
    ),
    callService(() => client.GET('/v1/eacc/compliance-reports', { params: { query: { fy } } })),
  ]);
  const notBuilt =
    !report.ok && report.error.kind === 'problem' && report.error.problem.status === 404;
  if (!report.ok && !notBuilt) return report;
  if (!intake.ok) return intake;
  const read = report.ok ? readReport(report.data) : null;
  if (read && !read.ok) return read;
  const { onTime, late, notReported } = intake.data.totals;
  return {
    ok: true,
    data: { fy, report: read?.data ?? null, reported: onTime + late, notReported },
  };
}

/** The year's report alone, e.g. to see whether a narrative draft answered 202 has ended. */
export async function loadNationalReport(
  client: ReportingClient,
  fy: number,
): Promise<NationalReportResult<NationalReport>> {
  return readReportResult(
    await callService<RawReport, ReportingProblem>(() =>
      client.GET('/v1/eacc/national-reports/{fy}', { params: { path: { fy } } }),
    ),
  );
}

/** What the analyst asks AI to draft: a section or all, replacing its AI drafts or all of it. */
export interface NarrativeDraftRequest {
  section: NarrativeDraftSection;
  replaceAll: boolean;
}

/**
 * Asks the reporting service for an AI narrative draft (spec 09b S2, S3, #338): the report with the
 * draft's paragraphs inserted as AI drafts (200), or still `drafting` (202: read the report until
 * its `narrativeDraft` has ended). A retry with the same key reads the same job.
 */
export async function draftNationalReportNarrative(
  client: ReportingClient,
  fy: number,
  request: NarrativeDraftRequest,
  idempotencyKey: string,
): Promise<NationalReportResult<NationalReport>> {
  return readReportResult(
    await callService<RawReport, ReportingProblem>(() =>
      client.POST('/v1/eacc/national-reports/{fy}/narrative/draft', {
        params: { path: { fy }, header: { 'Idempotency-Key': idempotencyKey } },
        body: request,
      }),
    ),
  );
}

/** Builds the year's report, or rebuilds its draft keeping the narrative. */
export async function buildNationalReport(
  client: ReportingClient,
  fy: number,
): Promise<NationalReportResult<NationalReport>> {
  return readReportResult(
    await callService<RawReport, ReportingProblem>(() =>
      client.POST('/v1/eacc/national-reports/{fy}/build', { params: { path: { fy } } }),
    ),
  );
}

/** Saves every section's text, paragraphs separated by a blank line. */
export async function saveNationalReportNarrative(
  client: ReportingClient,
  fy: number,
  narrative: Narrative,
): Promise<NationalReportResult<NationalReport>> {
  return readReportResult(
    await callService<RawReport, ReportingProblem>(() =>
      client.PATCH('/v1/eacc/national-reports/{fy}/narrative', {
        params: { path: { fy } },
        body: narrative,
      }),
    ),
  );
}

/** An EACC supervisor who did not write it approves the report; a retry reuses the key. */
export async function approveNationalReport(
  client: ReportingClient,
  fy: number,
  idempotencyKey: string,
): Promise<NationalReportResult<NationalReport>> {
  return readReportResult(
    await callService<RawReport, ReportingProblem>(() =>
      client.POST('/v1/eacc/national-reports/{fy}/approve', {
        params: { path: { fy }, header: { 'Idempotency-Key': idempotencyKey } },
      }),
    ),
  );
}

/** A short-lived link to the approved report's Restricted PDF. */
export interface NationalReportPdf {
  downloadUrl: string;
  expiresAt: string;
}

/**
 * `GET /v1/documents/{documentId}/download` with the officer's own token: documents lets EACC
 * analysts and supervisors download the NCR and audits it.
 */
export async function nationalReportPdf(
  documents: DocumentsClient,
  documentId: string,
): Promise<ServiceResult<NationalReportPdf>> {
  const result = await callService(() =>
    documents.GET('/v1/documents/{documentId}/download', { params: { path: { documentId } } }),
  );
  if (!result.ok) return result;
  const { downloadUrl, expiresAt } = result.data;
  return { ok: true, data: { downloadUrl, expiresAt } };
}
