import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { nairobiToday } from '../components/form-m/financial-year';
import { asReportingViewer } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import { env } from './env.server';
import {
  compileReport,
  type FormMResult,
  type FormMWorkspace,
  loadWorkspace,
} from './form-m.server';

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
export async function today(): Promise<string> {
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
