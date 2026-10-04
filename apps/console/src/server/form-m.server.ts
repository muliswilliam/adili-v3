import type { FormMV1 } from '@adili/forms';

import type { components } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import type {
  ComplianceReport,
  ReportingProblem,
  ReportPeriod,
  ReportStatus,
} from './reporting/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The reporting service's Form M workspace endpoints (spec 09 FE-2, S2-S4, S15) folded into the
 * result the workspace page renders. Pure: the caller injects the client (`form-m.ts` makes it
 * for the signed-in supervisor, commission-admin or reporting officer).
 */

export type FormMResult<T> = ServiceResult<T, ReportingProblem>;

/** What the workspace shows: the periods, the one selected and its report. */
export interface FormMWorkspace {
  /** Today in Nairobi (`YYYY-MM-DD`), for the days left to the due date. */
  today: string;
  /** Newest first; the first is the current financial year. */
  periods: ReportPeriod[];
  /** The selected financial year (start year). */
  fy: number;
  /** The selected year's report; null while it has none (`not-started`). */
  report: ComplianceReport | null;
}

/** Reports with work open on them, which the workspace opens by default. */
const OPEN: readonly ReportStatus[] = ['compiling', 'draft', 'reviewed'];

/**
 * The period to open: `fy` when listed; else the newest with a report in progress (the one that
 * needs work); else the current year.
 */
export function selectedPeriod(periods: readonly ReportPeriod[], fy?: number): ReportPeriod | null {
  return (
    periods.find((period) => period.fy === fy) ??
    periods.find((period) => OPEN.includes(period.status)) ??
    periods[0] ??
    null
  );
}

/**
 * `GET .../compliance-reports`, then the selected year's report (`GET .../{fy}`) unless it has
 * none yet.
 */
export async function loadWorkspace(
  client: ReportingClient,
  slug: string,
  { fy, today }: { fy?: number; today: string },
): Promise<FormMResult<FormMWorkspace>> {
  const listed = await callService<ReportPeriod[], ReportingProblem>(() =>
    client.GET('/v1/commissions/{slug}/compliance-reports', { params: { path: { slug } } }),
  );
  if (!listed.ok) return listed;
  const periods = listed.data;
  const selected = selectedPeriod(periods, fy);
  if (!selected) return UNAVAILABLE;
  if (selected.status === 'not-started') {
    return { ok: true, data: { today, periods, fy: selected.fy, report: null } };
  }
  const report = await loadReport(client, slug, selected.fy);
  if (!report.ok) return report;
  // The report was read after the list: a compile that finished in between shows on both.
  const { status, reference, submittedAt, late } = report.data;
  const current = periods.map((period) =>
    period.fy === selected.fy ? { ...period, status, reference, submittedAt, late } : period,
  );
  return { ok: true, data: { today, periods: current, fy: selected.fy, report: report.data } };
}

/** `GET .../compliance-reports/{fy}`, its document checked as form-m.v1. */
export async function loadReport(
  client: ReportingClient,
  slug: string,
  fy: number,
): Promise<FormMResult<ComplianceReport>> {
  const result = await callService<components['schemas']['ComplianceReport'], ReportingProblem>(
    () =>
      client.GET('/v1/commissions/{slug}/compliance-reports/{fy}', {
        params: { path: { slug, fy } },
      }),
  );
  if (!result.ok) return result;
  const { document } = result.data;
  if (document !== null && !isFormMDocument(document)) return DRIFT;
  return { ok: true, data: { ...result.data, document } };
}

/**
 * `POST .../compliance-reports/{fy}/compile`: a preview (from 1 April) or a recompile; the report
 * is `compiling` until the workflow saves the draft.
 */
export function compileReport(
  client: ReportingClient,
  slug: string,
  fy: number,
): Promise<FormMResult<null>> {
  return callService<null, ReportingProblem>(async () => {
    const outcome = await client.POST('/v1/commissions/{slug}/compliance-reports/{fy}/compile', {
      params: { path: { slug, fy } },
    });
    return { ...outcome, data: null };
  });
}

const UNAVAILABLE = { ok: false, error: { kind: 'unavailable', detail: null } } as const;
const DRIFT = {
  ok: false,
  error: { kind: 'unavailable', detail: 'The report is not a form-m.v1 document.' },
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether the contract's open `FormMDocument` has the parts the workspace reads. A draft need not
 * validate against form-m.v1 yet (Part I contacts may be blank until the commission-admin fills
 * them; confirming checks the whole document), so this checks the shape, not every rule: one
 * without it is contract drift, shown as the service being unavailable rather than read wrongly.
 */
export function isFormMDocument(document: unknown): document is FormMV1 {
  if (!isObject(document) || document.schemaVersion !== 'form-m.v1') return false;
  const { partI, partII, partIII } = document;
  if (!isObject(partI) || !isObject(partII) || !isObject(partIII)) return false;
  const sections = ['initial', 'biennial', 'final'].map((key) => partII[key]);
  return (
    sections.every((section) => isObject(section) && Array.isArray(section.nonFilers)) &&
    isObject(partII.clarifications) &&
    Array.isArray(partII.clarifications.items) &&
    isObject(partII.accessRequests) &&
    isObject(partII.complaints) &&
    Array.isArray(partII.complaints.items) &&
    isObject(partI.period)
  );
}
