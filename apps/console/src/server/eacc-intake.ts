import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asReportingViewer, withViewerClient } from './as-viewer.server';
import {
  type EaccResult,
  type FileLink,
  loadIntake,
  loadSubmittedReport,
  type ReportView,
  reportFileLink,
} from './eacc-intake.server';
import { defaultFinancialYear } from '../components/eacc-intake/intake-view';
import { financialYear, today } from './form-m';
import { reportDocumentsClient } from './reporting/documents-client.server';
import type { Intake } from './reporting/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions of EACC's compliance reports intake and report viewer (spec 09 FE-3), called
 * as the signed-in EACC analyst or supervisor. Tokens stay on the server.
 */

/** The intake page: today in Nairobi (the mock's day under REPORTING_MOCK_TODAY), the year on show and its intake. */
export interface IntakePage {
  today: string;
  fy: number;
  intake: EaccResult<Intake> | { ok: false; error: { kind: 'unauthenticated' } };
}

/** The year `fy`, or the one the intake opens on (the last that ended). */
export const getEaccIntake = createServerFn({ method: 'GET' })
  .validator(z.object({ fy: financialYear.optional() }))
  .handler(async ({ data }): Promise<IntakePage> => {
    const day = today();
    const fy = data.fy ?? defaultFinancialYear(day);
    return { today: day, fy, intake: await asReportingViewer((client) => loadIntake(client, fy)) };
  });

export const getSubmittedReport = createServerFn({ method: 'GET' })
  .validator(z.object({ reportId: z.uuid() }))
  .handler(
    ({
      data,
    }): Promise<EaccResult<ReportView> | { ok: false; error: { kind: 'unauthenticated' } }> =>
      asReportingViewer((client) => loadSubmittedReport(client, data.reportId)),
  );

/** A short-lived link to a filed report's Form M PDF or receipt. */
export const getReportFileLink = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<FileLink>> =>
    withViewerClient(reportDocumentsClient, (client) => reportFileLink(client, data.documentId)),
  );
