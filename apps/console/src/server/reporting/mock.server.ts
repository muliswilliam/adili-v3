/**
 * In-memory stand-in for the reporting service's Form M workspace endpoints (reporting.yaml
 * `listComplianceReports`, `getComplianceReport`, `compileComplianceReport`, and the sign-off:
 * `updateReportRemarks`, `updateReportManualFields`, `markReportReviewed`,
 * `confirmComplianceReport`), with the documents service's downloads of the Form M PDFs and
 * receipts it issues, used when REPORTING_MOCK is set, for screens without the reporting service
 * and its upstreams (directory, declarations, review, documents, Temporal) running. One store for
 * every caller, seeded for the Public Service Commission (`psc`) relative to "today"
 * (REPORTING_MOCK_TODAY, else the day in Nairobi):
 *
 * - From July to March: the current financial year has no report yet and no preview (it opens on
 *   1 April); the year before is a draft compiled eleven days ago (not before 1 July), overdue
 *   once 31 July has passed: 12 appointed and 10 initial declarations, 100 in service and 95
 *   biennial, 4 exits and 3 final, 6 clarifications, no access request data yet (section 5 note).
 *   Part I lacks the contact details and email address, Part B the register answer. With
 *   `reviewed`, that draft was marked reviewed by the supervisor two days ago (Part III's
 *   compiled-by filled); with `filled`, Part I and Part B are filled too.
 * - From April to June: the current year can be previewed; the year before was submitted late,
 *   reviewed by Samuel Njoroge and confirmed by Joyce Wanjiku, with Part I and Part B filled.
 *   A preview compiled then has no biennial cycle and section 5 counts from access requests.
 *
 * Only the Commission's supervisor, commission-admin and reporting officer see it (anyone else,
 * and any other Commission, gets 404); only the supervisor compiles (403), from 1 April after the
 * year (409 `preview-not-available`) and until the report is submitted (409 `report-submitted`).
 * A compile leaves the report `compiling` for three seconds, then a draft as at that moment, to
 * be reviewed again; remarks and Part I and Part B are kept, as the service keeps them.
 *
 * The sign-off follows the service's rules: the supervisor edits remarks and marks the draft
 * reviewed, the commission-admin fills Part I and Part B and confirms, with a step-up token (`acr`
 * `step-up`, `auth_time` at most five minutes old: 403 `step-up-required`) and an
 * Idempotency-Key, checked first as api-kit's interceptor does (a replay answers the same, another
 * request under the key is 422 `idempotency-key-reused`; the in-flight 409 is not simulated);
 * 400 `not-reviewed` or `incomplete` with the paths; 409 `report-compiling` or `report-submitted`.
 * A confirmed report's PDF and receipt are issued four seconds later.
 *
 * The store and the day live in `mock-store.server.ts`, which the EACC intake mock
 * (`eacc-mock.server.ts`) reads: psc is not reported there until it is submitted here;
 * `submitMockReport` submits it on a day.
 *
 * EACC's referrals intake and its evidence package downloads answer from
 * `referral-intake-mock.server.ts`. The Commission open-data preview is `open-data-mock.server.ts`.
 */
import { STEP_UP_ACR, STEP_UP_WINDOW_SECONDS } from '@adili/api-kit/client';
import { COMMISSION_ADMIN, FORM_M_ROLES, SUPERVISOR } from '@adili/roles';
import type { FormMV1 } from '@adili/forms';
import createClient from 'openapi-fetch';

import {
  dueDateOf,
  finalCompileOf,
  FIRST_FINANCIAL_YEAR,
  financialYearOf,
  nairobiToday,
  previewFromOf,
} from '../../components/form-m/financial-year';
import {
  isRecord,
  json,
  type MockCaller,
  mockCallerOf,
  problem,
  readJson,
  unsignedMockToken,
} from '../mock-http';
import type { paths as DocumentsPaths } from '../documents/api.gen';
import type { components, paths } from './api.gen';
import {
  storedDocument,
  fullDocument,
  issuedDocumentIdsOf,
  MOCK_PSC,
  mockDay,
  mockDocumentCorrupt,
  noEdits,
  previewDocument,
  type ReportingStoreSeed,
  resetReportingStore,
  saveStoredReport,
  storedFileTitle,
  storedReport,
  type StoredReport,
  storedYears,
} from './mock-store.server';
import { isNarrativeDraftPath, mockNarrativeDraftFetch } from './narrative-draft-mock.server';
import { mockOpenDataFetch } from './open-data-mock.server';
import { referralIntakeFetch } from './referral-intake-mock.server';
import type { ComplianceReport, Officer, ReportCounts, ReportPeriod } from './types';

export { type ReportingStoreSeed, submitMockReport } from './mock-store.server';

/** How long the mock's workflow takes to compile a draft. */
const COMPILE_MS = 3000;
/** How long after confirmation the mock's documents issue the PDF and the receipt. */
const ISSUE_MS = 4000;

type ManualFields = components['schemas']['ManualFields'];

/** Answers to confirmations by Idempotency-Key, for replays. */
const confirmations = new Map<string, { fy: number; body: string; answer: ComplianceReport }>();
let latency = 1;
let compileMs = COMPILE_MS;
let issueMs = ISSUE_MS;
let failingConfirms = 0;

/** Seeds the store as it stands on `day` (`YYYY-MM-DD`; today in Nairobi by default). */
export function resetReportingMock(day: string = nairobiToday(), options: ReportingStoreSeed = {}) {
  failingConfirms = 0;
  confirmations.clear();
  resetReportingStore(day, options);
}

/**
 * Scales the mock's answer delays (0 in tests); `compileMs` sets how long a compile takes
 * (three seconds by default), also for one already running, and `issueMs` how long the PDF and
 * receipt take after confirmation (four seconds by default).
 */
export function setReportingMockLatency(
  factor: number,
  options: { compileMs?: number; issueMs?: number } = {},
) {
  latency = factor;
  compileMs = options.compileMs ?? COMPILE_MS;
  issueMs = options.issueMs ?? ISSUE_MS;
}

/** The next `count` confirmations fail with a 503 (the confirm dialog's retry). */
export function failNextReportingConfirms(count = 1) {
  failingConfirms = count;
}

/** The day the mock takes as today: REPORTING_MOCK_TODAY, else today in Nairobi. */
export function mockReportingToday(): string {
  return mockDay();
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

/**
 * A client of the mock as `roles` of `tenant` (tests); `stepUpAt` (epoch ms) gives its token a
 * step-up made then, as the BFF holds after `/auth/step-up`.
 */
export function mockReportingClient(
  roles: readonly string[],
  {
    name = 'Samuel Njoroge',
    subject = 'mock-officer',
    tenant = 'psc',
    stepUpAt,
    fetch = mockReportingFetch,
  }: {
    name?: string;
    subject?: string;
    tenant?: string;
    stepUpAt?: number;
    fetch?: (request: Request) => Promise<Response>;
  } = {},
) {
  const token = unsignedMockToken({
    subject,
    name,
    roles,
    tenant,
    ...(stepUpAt === undefined ? {} : { acr: 'step-up', authTime: Math.floor(stepUpAt / 1000) }),
  });
  return createClient<paths>({
    baseUrl: 'http://reporting.test',
    headers: { authorization: `Bearer ${token}` },
    fetch,
  });
}

const notFound = () => problem(404, 'Not found');

const ACTIONS = ['compile', 'remarks', 'manual', 'reviewed', 'confirm'] as const;
type Action = (typeof ACTIONS)[number];

export async function mockReportingFetch(input: Request): Promise<Response> {
  // EACC's open-data releases (releases-mock.server.ts, #350).
  if (new URL(input.url).pathname.startsWith('/v1/eacc/open-data/releases')) {
    return (await import('./releases-mock.server')).mockReleasesFetch(input);
  }
  // The national report's AI narrative drafts (#341).
  if (isNarrativeDraftPath(new URL(input.url).pathname)) return mockNarrativeDraftFetch(input);
  // EACC's intake and report viewer have their own Commissions (eacc-mock.server.ts).
  if (new URL(input.url).pathname.startsWith('/v1/eacc/compliance-reports')) {
    return (await import('./eacc-mock.server')).mockEaccIntakeFetch(input);
  }
  // EACC's national consolidated report (ncr-mock.server.ts).
  if (new URL(input.url).pathname.startsWith('/v1/eacc/national-reports/')) {
    return (await import('./ncr-mock.server')).mockNcrFetch(input);
  }
  await delay(250);
  // The Commission open-data preview (spec 09b) is its own part of the mock.
  const openData = mockOpenDataFetch(input);
  if (openData) return openData;
  // EACC's referrals intake is its own part of the mock.
  const intake = referralIntakeFetch(input);
  if (intake) return intake;
  const url = new URL(input.url);
  const match = /^\/v1\/commissions\/([^/]+)\/compliance-reports(?:\/(\d+)(?:\/([a-z]+))?)?$/.exec(
    url.pathname,
  );
  if (!match) return notFound();
  const [, slug, fyText, actionText] = match;
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
  if (actionText !== undefined) {
    const action = ACTIONS.find((each) => each === actionText);
    if (!action) return notFound();
    const method = action === 'remarks' || action === 'manual' ? 'PATCH' : 'POST';
    if (input.method !== method) return notFound();
    return act(action, fy, input, caller);
  }
  if (input.method !== 'GET') return notFound();
  const stored = storedReport(fy);
  if (!stored) return notFound();
  advance(stored);
  return json(200, view(stored));
}

function act(action: Action, fy: number, input: Request, caller: MockCaller) {
  switch (action) {
    case 'compile':
      if (!caller.roles.includes(SUPERVISOR)) {
        return problem(403, 'Only a supervisor of the Commission can compile its Form M.');
      }
      return startCompile(fy);
    case 'remarks':
      return updateRemarks(fy, input, caller);
    case 'manual':
      return updateManual(fy, input, caller);
    case 'reviewed':
      return markReviewed(fy, input, caller);
    case 'confirm':
      return confirm(fy, input, caller);
  }
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
  if (stored?.status === 'submitted') return reportSubmitted();
  const next: StoredReport = stored ?? {
    fy,
    status: 'compiling',
    source: 'hosted',
    compiledAt: null,
    compileStartedAt: null,
    submittedAt: null,
    late: null,
    reference: null,
    reviewedBy: null,
    confirmedBy: null,
    compiled: null,
    edits: noEdits(),
    issueAt: null,
    formMDocumentId: null,
    receiptDocumentId: null,
  };
  next.status = 'compiling';
  next.compileStartedAt = Date.now();
  saveStoredReport(next);
  return new Response(null, { status: 202 });
}

/** Runs the mock workflows: a compile finishes, or the PDF and receipt are issued, in time. */
function advance(stored: StoredReport) {
  issuedDocumentIdsOf(stored);
  if (stored.status !== 'compiling' || stored.compileStartedAt === null) return;
  if (Date.now() < stored.compileStartedAt + compileMs) return;
  stored.status = 'draft';
  stored.compileStartedAt = null;
  // New numbers are reviewed again: Part III's compiled-by goes with the review.
  stored.reviewedBy = null;
  stored.edits.compiledBy = null;
  // As at now, on the mock's day (its clock may be set to another day).
  const time = new Date().toISOString().slice(10);
  stored.compiledAt = `${mockDay()}${time}`;
  // A year compiled before it ends is a preview of today's data.
  stored.compiled =
    mockDay() < finalCompileOf(stored.fy) ? previewDocument(stored.fy) : fullDocument(stored.fy);
}

const reportSubmitted = () =>
  problem(409, 'The report is submitted and can no longer change', 'report-submitted');

/** The report, if it can be edited: 404 without one, 409 once submitted or while compiling. */
function editable(fy: number): StoredReport | Response {
  const stored = storedReport(fy);
  if (!stored) return notFound();
  advance(stored);
  if (stored.status === 'submitted') return reportSubmitted();
  if (stored.status === 'compiling' || !stored.compiled) {
    return problem(409, 'The report is being compiled', 'report-compiling');
  }
  return stored;
}

function problemWith(
  status: number,
  title: string,
  code: string,
  errors: { path: string; message: string }[],
) {
  return json(status, { type: 'about:blank', title, status, code, errors });
}

async function updateRemarks(fy: number, input: Request, caller: MockCaller) {
  if (!caller.roles.includes(SUPERVISOR)) {
    return problem(403, 'Only a supervisor edits the remarks of its Form M.');
  }
  const stored = editable(fy);
  if (stored instanceof Response) return stored;
  const body = await readJson(input);
  const remarks = isRecord(body) && Array.isArray(body.remarks) ? body.remarks : null;
  if (!remarks || remarks.length === 0) return problem(400, 'Validation failed');
  const listed = new Set(rowsOf(storedDocument(stored)).map((row) => row.obligationId));
  const errors = remarks.flatMap((remark: unknown, i) =>
    isRecord(remark) &&
    typeof remark.obligationId === 'string' &&
    typeof remark.remark === 'string' &&
    remark.remark.length <= 500 &&
    listed.has(remark.obligationId)
      ? []
      : [{ path: `remarks.${String(i)}.obligationId`, message: 'Not a row of this report' }],
  );
  if (errors.length > 0) {
    return problemWith(400, 'The draft lists no such officer.', 'invalid-remarks', errors);
  }
  for (const { obligationId, remark } of remarks as { obligationId: string; remark: string }[]) {
    if (remark.trim() === '') stored.edits.remarks.delete(obligationId);
    else stored.edits.remarks.set(obligationId, remark.trim());
  }
  return json(200, view(stored));
}

const optionalText = (value: unknown, max: number) =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= max);

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function updateManual(fy: number, input: Request, caller: MockCaller) {
  if (!caller.roles.includes(COMMISSION_ADMIN)) {
    return problem(403, 'Only a commission-admin enters Part I and Part B.');
  }
  const stored = editable(fy);
  if (stored instanceof Response) return stored;
  const body = await readJson(input);
  if (!isRecord(body)) return problem(400, 'Validation failed');
  const fields = body as ManualFields;
  const errors = [
    !optionalText(fields.contactDetails, 200) && 'contactDetails',
    !optionalText(fields.physicalAddress, 200) && 'physicalAddress',
    (!optionalText(fields.emailAddress, 254) ||
      (typeof fields.emailAddress === 'string' && !EMAIL.test(fields.emailAddress))) &&
      'emailAddress',
    fields.complaints !== undefined && !Array.isArray(fields.complaints) && 'complaints',
  ]
    .filter((path) => typeof path === 'string')
    .map((path) => ({ path, message: 'Invalid' }));
  if (errors.length > 0) return problemWith(400, 'Validation failed', 'invalid-document', errors);
  const { edits } = stored;
  if (fields.contactDetails !== undefined) edits.contactDetails = fields.contactDetails ?? '';
  if (fields.physicalAddress !== undefined) edits.physicalAddress = fields.physicalAddress ?? '';
  if (fields.emailAddress !== undefined) edits.emailAddress = fields.emailAddress ?? '';
  if (fields.complaintsRegisterMaintained !== undefined) {
    edits.registerMaintained = fields.complaintsRegisterMaintained;
  }
  if (fields.complaints !== undefined) edits.complaints = fields.complaints;
  return json(200, view(stored));
}

async function markReviewed(fy: number, input: Request, caller: MockCaller) {
  if (!caller.roles.includes(SUPERVISOR)) {
    return problem(403, 'Only a supervisor marks the draft reviewed.');
  }
  const stored = editable(fy);
  if (stored instanceof Response) return stored;
  const body = await readJson(input);
  const designation = isRecord(body) ? body.designation : undefined;
  if (typeof designation !== 'string' || !designation.trim() || designation.length > 100) {
    return problemWith(400, 'Validation failed', 'invalid-document', [
      { path: 'designation', message: 'Required' },
    ]);
  }
  const officer = officerOf(caller);
  stored.status = 'reviewed';
  stored.reviewedBy = officer;
  stored.edits.compiledBy = {
    name: officer.name,
    designation: designation.trim(),
    date: mockDay(),
  };
  return json(200, view(stored));
}

const officerOf = (caller: MockCaller): Officer => ({
  subject: caller.subject ?? 'mock-officer',
  name: caller.name ?? 'Officer',
});

function hasFreshStepUp(caller: MockCaller): boolean {
  return (
    caller.acr === STEP_UP_ACR &&
    caller.authTime !== null &&
    Date.now() / 1000 - caller.authTime <= STEP_UP_WINDOW_SECONDS
  );
}

/**
 * `confirmComplianceReport`, in the service's order: the Idempotency-Key and its replay first
 * (api-kit's interceptor), then the role and the step-up (the handler), then the report.
 */
async function confirm(fy: number, input: Request, caller: MockCaller) {
  const key = input.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const body = JSON.stringify((await readJson(input)) ?? {});
  const replay = confirmations.get(key);
  if (replay) {
    return replay.fy === fy && replay.body === body
      ? json(200, replay.answer)
      : json(422, {
          type: 'idempotency-key-reused',
          title: 'Idempotency-Key reused',
          status: 422,
        });
  }
  if (!caller.roles.includes(COMMISSION_ADMIN)) {
    return problem(403, 'Only a commission-admin confirms and submits its Form M.');
  }
  if (!hasFreshStepUp(caller)) {
    return problem(403, 'Confirm your identity to submit Form M', 'step-up-required');
  }
  if (failingConfirms > 0) {
    failingConfirms -= 1;
    return problem(503, 'Service unavailable');
  }
  const stored = editable(fy);
  if (stored instanceof Response) return stored;
  if (stored.status !== 'reviewed') {
    return problem(400, 'The draft must be reviewed before it is confirmed', 'not-reviewed');
  }
  const missing = incompleteOf(storedDocument(stored));
  if (missing.length > 0) {
    return problemWith(
      400,
      'The report is incomplete: complete the sections named before confirming.',
      'incomplete',
      missing.map((path) => ({ path, message: 'Required' })),
    );
  }
  const officer = officerOf(caller);
  stored.status = 'submitted';
  const today = mockDay();
  stored.submittedAt = `${today}${new Date().toISOString().slice(10)}`;
  stored.late = today > dueDateOf(fy);
  stored.reference = `RPT-PSC-${String(fy + 1)}-0000001-K`;
  stored.confirmedBy = officer;
  stored.edits.confirmedBy = { name: officer.name, designation: null, date: today };
  stored.issueAt = Date.now() + issueMs;
  const answer = { ...view(stored), document: null };
  confirmations.set(key, { fy, body, answer });
  return json(200, answer);
}

/**
 * The form-m.v1 paths a document has still to fill before it validates (Part I's contacts; the
 * schema lets Part B's register answer be null).
 */
function incompleteOf(document: FormMV1): string[] {
  const { partI } = document;
  return [
    !partI.contactDetails.trim() && 'partI.contactDetails',
    !partI.physicalAddress.trim() && 'partI.physicalAddress',
    !EMAIL.test(partI.emailAddress) && 'partI.emailAddress',
  ].filter((path) => typeof path === 'string');
}

function rowsOf(document: FormMV1) {
  const { initial, biennial, final } = document.partII;
  return [...initial.nonFilers, ...biennial.nonFilers, ...final.nonFilers];
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
  const document =
    stored.status === 'compiling' || !stored.compiled ? null : storedDocument(stored);
  return {
    id: `0199a000-0000-7000-8000-00000000${String(stored.fy)}`,
    commission: MOCK_PSC,
    fy: stored.fy,
    status: stored.status,
    source: stored.source,
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
    counts: stored.compiled ? countsOf(stored.compiled) : {},
    formMDocumentId: stored.formMDocumentId,
    receiptDocumentId: stored.receiptDocumentId,
    accessDataUnavailable: stored.compiled?.partII.accessRequests.dataUnavailable ?? true,
  };
}

/** A documents client of the mock as `roles` of `tenant` (tests). */
export function mockReportingDocumentsClient(roles: readonly string[], tenant = 'psc') {
  const token = unsignedMockToken({ subject: 'mock-officer', name: 'Officer', roles, tenant });
  return createClient<DocumentsPaths>({
    baseUrl: 'http://documents.test',
    headers: { authorization: `Bearer ${token}` },
    fetch: mockWorkspaceDocumentsFetch,
  });
}

/** The file name of a Form M PDF or receipt the mock issued, for `/api/mock-files`; else null. */
export const mockWorkspaceFileTitle = storedFileTitle;

/**
 * The documents service as the Form M workspace calls it: `GET /v1/documents/{id}/download` for
 * the PDF and receipt of a report the mock issued, to the Commission's officers.
 */
export async function mockWorkspaceDocumentsFetch(input: Request): Promise<Response> {
  await delay(150);
  const download = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(input.url).pathname);
  const id = download?.[1];
  const caller = mockCallerOf(input);
  const staff =
    caller.tenant === MOCK_PSC.slug &&
    caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  if (input.method !== 'GET' || !id || !staff || !mockWorkspaceFileTitle(id)) return notFound();
  return json(200, {
    downloadUrl: `/api/mock-files/${id}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}
