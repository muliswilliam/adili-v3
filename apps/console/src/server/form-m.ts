import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { nairobiToday } from '../components/form-m/financial-year';
import { asReportingViewer, type Unauthenticated, withViewerClient } from './as-viewer.server';
import { getBff } from './bff.server';
import { commissionSlug } from './commission-slug';
import { env } from './env.server';
import {
  compileReport,
  type FormMResult,
  type FormMWorkspace,
  loadWorkspace,
} from './form-m.server';
import {
  confirmReport,
  type ConfirmOutcome,
  type DocumentLink,
  documentLink,
  markReviewed,
  saveManualFields,
  saveRemarks,
} from './form-m-sign-off.server';
import { reportingDocumentsClient } from './reporting/documents-client.server';
import { type StepUpStatus, stepUpStatus } from './step-up.server';

/**
 * Server functions of the Form M workspace (spec 09 FE-2), called as the signed-in supervisor,
 * commission-admin or reporting officer of the viewer's own Commission. Tokens stay on the server.
 */

/** A financial year (start year) reports exist for (reporting.yaml `FinancialYear`). */
export const financialYear = z.int().min(2025).max(9999);

/**
 * Today in Nairobi, the day the workspace counts days to the due date from; with the reporting
 * mock in development, the mock's day, so the page and the mock agree.
 */
async function today(): Promise<string> {
  if (import.meta.env.DEV && env().REPORTING_MOCK) {
    return (await import('./reporting/mock.server')).mockReportingToday();
  }
  return nairobiToday();
}

export const getFormMWorkspace = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, fy: financialYear.optional() }))
  .handler(({ data }): Promise<FormMResult<FormMWorkspace>> =>
    asReportingViewer(async (client) =>
      loadWorkspace(client, data.slug, { fy: data.fy, today: await today() }),
    ),
  );

/** Compiles a preview (from 1 April) or recompiles the draft: the supervisor only. */
export const compileFormM = createServerFn({ method: 'POST' })
  .validator(z.object({ slug: commissionSlug, fy: financialYear }))
  .handler(({ data }): Promise<FormMResult<null>> =>
    asReportingViewer((client) => compileReport(client, data.slug, data.fy)),
  );

const report = z.object({ slug: commissionSlug, fy: financialYear });
const text = (max: number) => z.string().max(max);

/** The supervisor's remarks by obligation id (a blank one returns the row to its default). */
export const saveFormMRemarks = createServerFn({ method: 'POST' })
  .validator(
    report.extend({
      remarks: z
        .record(z.uuid(), text(500))
        .refine((remarks) => Object.keys(remarks).length > 0, 'No remarks')
        .refine((remarks) => Object.keys(remarks).length <= 1000, 'Too many remarks'),
    }),
  )
  .handler(({ data }): Promise<FormMResult<null>> =>
    asReportingViewer((client) => saveRemarks(client, data.slug, data.fy, data.remarks)),
  );

const complaint = z.object({
  name: text(200),
  designation: text(100),
  identifier: text(100),
  nature: text(300),
  status: text(100),
});

/** The commission-admin's Part I contact details and Part B; null clears a field. */
export const saveFormMManualFields = createServerFn({ method: 'POST' })
  .validator(
    report.extend({
      fields: z
        .object({
          contactDetails: text(200).nullable(),
          physicalAddress: text(200).nullable(),
          emailAddress: z.email().max(254).nullable(),
          complaintsRegisterMaintained: z.boolean().nullable(),
          complaints: z.array(complaint).max(500),
        })
        .partial()
        .strict(),
    }),
  )
  .handler(({ data }): Promise<FormMResult<null>> =>
    asReportingViewer((client) => saveManualFields(client, data.slug, data.fy, data.fields)),
  );

/** The supervisor marks the draft reviewed, with the designation Part III records. */
export const markFormMReviewed = createServerFn({ method: 'POST' })
  .validator(report.extend({ designation: z.string().trim().min(1).max(100) }))
  .handler(({ data }): Promise<FormMResult<null>> =>
    asReportingViewer((client) => markReviewed(client, data.slug, data.fy, data.designation)),
  );

/** The commission-admin confirms and submits, on the session's step-up token. */
export const confirmFormM = createServerFn({ method: 'POST' })
  .validator(report.extend({ idempotencyKey: z.uuid() }))
  .handler(
    async ({ data }): Promise<ConfirmOutcome> =>
      await asReportingViewer(async (client) => ({
        ok: true as const,
        outcome: await confirmReport(client, data.slug, data.fy, data.idempotencyKey),
      })).then((result) => (result.ok ? result.outcome : { status: 'unauthenticated' })),
  );

/** A short-lived link to a submitted report's Form M PDF or receipt. */
export const getFormMDocumentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(({ data }): Promise<FormMResult<DocumentLink>> =>
    withViewerClient(reportingDocumentsClient, (client) => documentLink(client, data.documentId)),
  );

/** The session's step-up state (`auth_time`, fresh or not). Tokens never leave the server. */
export const getStepUpStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StepUpStatus | Unauthenticated> =>
    stepUpStatus(await getBff().getSession(getRequest())),
);
