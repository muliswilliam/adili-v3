import type { NationalReportResult } from './national-report.server';
import type { ReportingClient } from './reporting/client.server';
import type { PatternCandidate, ReportingProblem } from './reporting/types';
import { callService } from './service-call';

/**
 * `GET /v1/eacc/national-reports/{fy}/candidates` (spec 09b S1, #331): the notable patterns the
 * reporting service computed from the year's report as last built and the years before, for the
 * Notable patterns panel. EACC analysts and supervisors only (403); 404 before the first build.
 */
export function loadPatternCandidates(
  client: ReportingClient,
  fy: number,
): Promise<NationalReportResult<PatternCandidate[]>> {
  return callService<PatternCandidate[], ReportingProblem>(() =>
    client.GET('/v1/eacc/national-reports/{fy}/candidates', { params: { path: { fy } } }),
  );
}
