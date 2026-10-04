/**
 * In-memory stand-in for the reporting service's Form M workspace endpoints (reporting.yaml
 * `listComplianceReports`, `getComplianceReport`, `compileComplianceReport`), used when
 * REPORTING_MOCK is set, for screens without the reporting service and its upstreams (directory,
 * declarations, review, Temporal) running. One store for every caller, seeded for the Public
 * Service Commission (`psc`) relative to "today" (REPORTING_MOCK_TODAY, else the day in Nairobi):
 *
 * - From July to March: the current financial year has no report yet and no preview (it opens on
 *   1 April); the year before is a draft compiled eleven days ago (not before 1 July), overdue
 *   once 31 July has passed: 12 appointed and 10 initial declarations, 100 in service and 95
 *   biennial, 4 exits and 3 final, 6 clarifications, no access request data yet (section 5 note).
 *   With `reviewed`, that draft was marked reviewed by the supervisor two days ago (Part III's
 *   compiled-by filled).
 * - From April to June: the current year can be previewed; the year before was submitted late,
 *   reviewed by Samuel Njoroge and confirmed by Joyce Wanjiku, with Part I and Part B filled.
 *   A preview compiled then has no biennial cycle and section 5 counts from access requests.
 *
 * The store and the day live in `mock-store.server.ts`, which the EACC intake mock
 * (`eacc-mock.server.ts`) reads: psc is not reported there until it is submitted here;
 * `submitMockReport` submits it on a day.
 *
 * Only the Commission's supervisor, commission-admin and reporting officer see it (anyone else,
 * and any other Commission, gets 404); only the supervisor compiles (403), from 1 April after the
 * year (409 `preview-not-available`) and until the report is submitted (409 `report-submitted`).
 * A compile leaves the report `compiling` for three seconds, then a draft as at that moment.
 *
 * EACC's referrals intake and its evidence package downloads answer from
 * `referral-intake-mock.server.ts`.
 */
import { FORM_M_ROLES, SUPERVISOR } from '@adili/roles';
import type { FormMV1 } from '@adili/forms';
import createClient from 'openapi-fetch';

import {
  dueDateOf,
  finalCompileOf,
  FIRST_FINANCIAL_YEAR,
  financialYearOf,
  previewFromOf,
} from '../../components/form-m/financial-year';
import { json, mockCallerOf, problem, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import {
  fullDocument,
  MOCK_PSC,
  mockDay,
  mockDocumentCorrupt,
  previewDocument,
  saveStoredReport,
  storedReport,
  type StoredReport,
  storedYears,
} from './mock-store.server';
import { referralIntakeFetch } from './referral-intake-mock.server';

export { resetReportingMock, submitMockReport } from './mock-store.server';
import type { ComplianceReport, ReportCounts, ReportPeriod } from './types';

/** How long the mock's workflow takes to compile a draft. */
const COMPILE_MS = 3000;

let latency = 1;
let compileMs = COMPILE_MS;

/**
 * Scales the mock's answer delays (0 in tests); `compileMs` sets how long a compile takes
 * (three seconds by default), also for one already running.
 */
export function setReportingMockLatency(factor: number, options: { compileMs?: number } = {}) {
  latency = factor;
  compileMs = options.compileMs ?? COMPILE_MS;
}

/** The day the mock takes as today: REPORTING_MOCK_TODAY, else today in Nairobi. */
export function mockReportingToday(): string {
  return mockDay();
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

/** A client of the mock as `roles` of `tenant` (tests). */
export function mockReportingClient(
  roles: readonly string[],
  {
    name = 'Samuel Njoroge',
    tenant = 'psc',
    fetch = mockReportingFetch,
  }: { name?: string; tenant?: string; fetch?: (request: Request) => Promise<Response> } = {},
) {
  const token = unsignedMockToken({ subject: 'mock-officer', name, roles, tenant });
  return createClient<paths>({
    baseUrl: 'http://reporting.test',
    headers: { authorization: `Bearer ${token}` },
    fetch,
  });
}

const notFound = () => problem(404, 'Not found');

export async function mockReportingFetch(input: Request): Promise<Response> {
  // EACC's intake and report viewer have their own Commissions (eacc-mock.server.ts).
  if (new URL(input.url).pathname.startsWith('/v1/eacc/compliance-reports')) {
    return (await import('./eacc-mock.server')).mockEaccIntakeFetch(input);
  }
  await delay(250);
  // EACC's referrals intake is its own part of the mock.
  const intake = referralIntakeFetch(input);
  if (intake) return intake;
  const url = new URL(input.url);
  const match = /^\/v1\/commissions\/([^/]+)\/compliance-reports(?:\/(\d+)(\/compile)?)?$/.exec(
    url.pathname,
  );
  if (!match) return notFound();
  const [, slug, fyText, compile] = match;
  const caller = mockCallerOf(input);
  const visible =
    slug === MOCK_PSC.slug &&
    caller.tenant === MOCK_PSC.slug &&
    caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  if (!visible) return notFound();

  if (fyText === undefined) {
    return input.method === 'GET' ? json(200, periods()) : notFound();
  }
  const fy = Number(fyText);
  if (fy < FIRST_FINANCIAL_YEAR || fy > financialYearOf(mockDay())) {
    return problem(400, 'The financial year is not one reports exist for');
  }
  if (compile) {
    if (input.method !== 'POST') return notFound();
    if (!caller.roles.includes(SUPERVISOR)) {
      return problem(403, 'Only a supervisor of the Commission can compile its Form M.');
    }
    return startCompile(fy);
  }
  if (input.method !== 'GET') return notFound();
  const stored = storedReport(fy);
  if (!stored) return notFound();
  advance(stored);
  return json(200, view(stored));
}

function periods(): ReportPeriod[] {
  const current = financialYearOf(mockDay());
  const years = new Set([current, current - 1, ...storedYears()]);
  return [...years]
    .filter((fy) => fy >= FIRST_FINANCIAL_YEAR && fy <= current)
    .sort((a, b) => b - a)
    .map((fy) => {
      const stored = storedReport(fy);
      if (stored) advance(stored);
      return {
        fy,
        status: stored?.status ?? 'not-started',
        dueDate: dueDateOf(fy),
        reference: stored?.reference ?? null,
        submittedAt: stored?.submittedAt ?? null,
        late: stored?.late ?? null,
        previewAvailable: mockDay() >= previewFromOf(fy) && stored?.status !== 'submitted',
      };
    });
}

function startCompile(fy: number): Response {
  if (mockDay() < previewFromOf(fy)) {
    return problem(409, 'A preview of Form M opens on 1 April', 'preview-not-available');
  }
  const stored = storedReport(fy);
  if (stored?.status === 'submitted') {
    return problem(
      409,
      'The report is submitted and can no longer be compiled',
      'report-submitted',
    );
  }
  const next: StoredReport = stored ?? {
    fy,
    status: 'compiling',
    compiledAt: null,
    compileStartedAt: null,
    submittedAt: null,
    late: null,
    reference: null,
    reviewedBy: null,
    confirmedBy: null,
    document: null,
  };
  next.status = 'compiling';
  next.compileStartedAt = Date.now();
  saveStoredReport(next);
  return new Response(null, { status: 202 });
}

/** Runs the mock workflow: a compile finishes once its time has come. */
function advance(stored: StoredReport) {
  if (stored.status !== 'compiling' || stored.compileStartedAt === null) return;
  if (Date.now() < stored.compileStartedAt + compileMs) return;
  stored.status = 'draft';
  stored.compileStartedAt = null;
  // As at now, on the mock's day (its clock may be set to another day).
  const time = new Date().toISOString().slice(10);
  stored.compiledAt = `${mockDay()}${time}`;
  // A year compiled before it ends is a preview of today's data.
  stored.document =
    mockDay() < finalCompileOf(stored.fy) ? previewDocument(stored.fy) : fullDocument(stored.fy);
}

function countsOf(document: FormMV1): ReportCounts {
  const { initial, biennial, final, clarifications, accessRequests } = document.partII;
  const section = ({ expected, declared, notDeclared }: typeof initial) => ({
    expected,
    declared,
    notDeclared,
  });
  return {
    initial: section(initial),
    biennial: { ...section(biennial), noCycleInPeriod: biennial.noCycleInPeriod ?? false },
    final: section(final),
    clarifications: clarifications.items.length,
    accessRequests: {
      received: accessRequests.received,
      granted: accessRequests.granted,
      declined: accessRequests.declined,
    },
  };
}

function view(stored: StoredReport): ComplianceReport {
  const document = stored.status === 'compiling' ? null : stored.document;
  return {
    id: `0199a000-0000-7000-8000-00000000${String(stored.fy)}`,
    commission: MOCK_PSC,
    fy: stored.fy,
    status: stored.status,
    source: 'hosted',
    compiledAt: stored.compiledAt,
    reviewedBy: stored.reviewedBy,
    confirmedBy: stored.confirmedBy,
    submittedAt: stored.submittedAt,
    late: stored.late,
    reference: stored.reference,
    dueDate: dueDateOf(stored.fy),
    document:
      document && mockDocumentCorrupt()
        ? ({ ...document, schemaVersion: 'form-m.v0' } as unknown as FormMV1)
        : document,
    counts: stored.document ? countsOf(stored.document) : {},
    formMDocumentId: null,
    receiptDocumentId: null,
    accessDataUnavailable: stored.document?.partII.accessRequests.dataUnavailable ?? true,
  };
}
