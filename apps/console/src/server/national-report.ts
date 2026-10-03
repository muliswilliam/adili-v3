import { NARRATIVE_MAX_LENGTH } from '@adili/ui';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import { createDocumentsClient } from './documents/client';
import { env } from './env.server';
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
import { reportingClient, type ReportingClient } from './reporting/client.server';
import type { NationalReport } from './reporting/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions for EACC's national consolidated report (spec 09 NCR, #233), called as the
 * signed-in EACC analyst or supervisor. The reporting service checks the roles and the separation
 * of duties; tokens stay on the server and the PDF comes back as a short-lived link.
 */

/** reporting.yaml `FinancialYear`: the start year, 2025 at the earliest. */
const fy = z.number().int().min(2025).max(2100);

/** reporting.yaml `Narrative`, with its limits. */
const narrative = z.strictObject({
  overview: z.string().max(NARRATIVE_MAX_LENGTH.overview),
  findings: z.string().max(NARRATIVE_MAX_LENGTH.findings),
  recommendations: z.string().max(NARRATIVE_MAX_LENGTH.recommendations),
});

const UNAUTHENTICATED = { ok: false, error: { kind: 'unauthenticated' } } as const;

async function withReporting<T>(
  work: (client: ReportingClient, accessToken: string) => Promise<NationalReportResult<T>>,
): Promise<NationalReportResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return UNAUTHENTICATED;
  return work(reportingClient(session.accessToken), session.accessToken);
}

export const getNationalReportPage = createServerFn({ method: 'GET' })
  .validator(z.object({ fy }))
  .handler(({ data }): Promise<NationalReportResult<NationalReportPage>> =>
    withReporting((client) => loadNationalReportPage(client, data.fy)),
  );

export const buildNationalReportFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy }))
  .handler(({ data }): Promise<NationalReportResult<NationalReport>> =>
    withReporting((client) => buildNationalReport(client, data.fy)),
  );

export const saveNationalReportNarrativeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy, narrative }))
  .handler(({ data }): Promise<NationalReportResult<NationalReport>> =>
    withReporting((client) => saveNationalReportNarrative(client, data.fy, data.narrative)),
  );

export const approveNationalReportFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy, idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<NationalReportResult<NationalReport>> =>
    withReporting((client) => approveNationalReport(client, data.fy, data.idempotencyKey)),
  );

export const getNationalReportPdf = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(async ({ data }): Promise<ServiceResult<NationalReportPdf>> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return UNAUTHENTICATED;
    const config = env();
    const documents = createDocumentsClient({
      baseUrl: config.DOCUMENTS_API_URL,
      accessToken: session.accessToken,
      // Inline, so production builds drop the mock (see mockableClient).
      mock:
        import.meta.env.DEV && config.REPORTING_MOCK
          ? async (request) =>
              (await import('./reporting/mock.server')).mockReportingDocumentsFetch(request)
          : null,
    });
    return nationalReportPdf(documents, data.documentId);
  });
