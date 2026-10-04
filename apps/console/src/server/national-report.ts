import { NARRATIVE_MAX_LENGTH } from '@adili/ui';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { defaultFinancialYear } from '../components/eacc-intake/intake-view';
import { asReportingViewer, type Unauthenticated, withViewerClient } from './as-viewer.server';
import { reportDocumentsClient } from './documents/report-client.server';
import { financialYear } from './form-m';
import {
  approveNationalReport,
  buildNationalReport,
  loadNationalReportPage,
  nationalReportPdf,
  type NationalReportPage,
  type NationalReportPdf,
  type NationalReportResult,
  saveNationalReportNarrative,
} from './national-report.server';
import { reportingToday } from './reporting/today.server';
import type { NationalReport } from './reporting/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions for EACC's national consolidated report (spec 09 NCR, #233), called as the
 * signed-in EACC analyst or supervisor. The reporting service checks the roles and the separation
 * of duties; tokens stay on the server and the PDF comes back as a short-lived link.
 */

/** reporting.yaml `Narrative`, with its limits. */
const narrative = z.strictObject({
  overview: z.string().max(NARRATIVE_MAX_LENGTH.overview),
  findings: z.string().max(NARRATIVE_MAX_LENGTH.findings),
  recommendations: z.string().max(NARRATIVE_MAX_LENGTH.recommendations),
});

/**
 * The national report page: today in Nairobi (the mock's day under REPORTING_MOCK_TODAY), the
 * year on show and its report.
 */
export interface NationalReportScreen {
  today: string;
  fy: number;
  page: NationalReportResult<NationalReportPage> | Unauthenticated;
}

/** The year `fy`, or the one the page opens on (the last that ended), with its report. */
export const getNationalReportPage = createServerFn({ method: 'GET' })
  .validator(z.object({ fy: financialYear.optional() }))
  .handler(async ({ data }): Promise<NationalReportScreen> => {
    const day = await reportingToday();
    const fy = data.fy ?? defaultFinancialYear(day);
    return {
      today: day,
      fy,
      page: await asReportingViewer((client) => loadNationalReportPage(client, fy)),
    };
  });

export const buildNationalReportFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy: financialYear }))
  .handler(({ data }): Promise<NationalReportResult<NationalReport> | Unauthenticated> =>
    asReportingViewer((client) => buildNationalReport(client, data.fy)),
  );

export const saveNationalReportNarrativeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy: financialYear, narrative }))
  .handler(({ data }): Promise<NationalReportResult<NationalReport> | Unauthenticated> =>
    asReportingViewer((client) => saveNationalReportNarrative(client, data.fy, data.narrative)),
  );

export const approveNationalReportFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy: financialYear, idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<NationalReportResult<NationalReport> | Unauthenticated> =>
    asReportingViewer((client) => approveNationalReport(client, data.fy, data.idempotencyKey)),
  );

/** A short-lived link to the approved report's Restricted PDF. */
export const getNationalReportPdf = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<NationalReportPdf>> =>
    withViewerClient(reportDocumentsClient, (client) => nationalReportPdf(client, data.documentId)),
  );
