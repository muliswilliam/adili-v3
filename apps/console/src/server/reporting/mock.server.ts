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
 *   Part I lacks the contact details and email address, Part B the register answer.
 * - From April to June: the current year can be previewed; the year before was submitted late.
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
 * Idempotency-Key (a replay answers the same); 400 `not-reviewed` or `incomplete` with the paths;
 * 409 `report-compiling` or `report-submitted`. A confirmed report's PDF and receipt are issued
 * four seconds later.
 */
import { STEP_UP_ACR, STEP_UP_WINDOW_SECONDS } from '@adili/api-kit/client';
import { COMMISSION_ADMIN, FORM_M_ROLES, SUPERVISOR } from '@adili/roles';
import type { FormMV1 } from '@adili/forms';
import createClient from 'openapi-fetch';

import {
  dueDateOf,
  finalCompileOf,
  financialYearOf,
  nairobiToday,
  previewFromOf,
} from '../../components/form-m/financial-year';
import { env } from '../env.server';
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
import type { ComplianceReport, Officer, ReportCounts, ReportPeriod, ReportStatus } from './types';

const PSC = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };
const FIRST_FINANCIAL_YEAR = 2025;
/** How long the mock's workflow takes to compile a draft. */
const COMPILE_MS = 3000;
/** How long after confirmation the mock's documents issue the PDF and the receipt. */
const ISSUE_MS = 4000;

type Signatory = FormMV1['partIII']['compiledBy'];
type ManualFields = components['schemas']['ManualFields'];
type Complaint = FormMV1['partII']['complaints']['items'][number];

/** What the Commission's officers added to the compiled draft: kept across recompiles. */
interface Edits {
  /** The supervisor's remarks by obligation id. */
  remarks: Map<string, string>;
  contactDetails?: string;
  physicalAddress?: string;
  emailAddress?: string;
  registerMaintained?: boolean | null;
  complaints?: Complaint[];
  /** Part III, filled on review and on confirmation. */
  compiledBy: Signatory | null;
  confirmedBy: Signatory | null;
}

interface Stored {
  fy: number;
  status: Exclude<ReportStatus, 'not-started'>;
  source: 'hosted' | 'federated';
  compiledAt: string | null;
  /** While compiling: when the compile started. */
  compileStartedAt: number | null;
  submittedAt: string | null;
  late: boolean | null;
  reference: string | null;
  reviewedBy: Officer | null;
  confirmedBy: Officer | null;
  /** The document as compiled, before the officers' edits. */
  compiled: FormMV1 | null;
  edits: Edits;
  /** Once submitted: when the documents service issues the PDF and the receipt. */
  issueAt: number | null;
  formMDocumentId: string | null;
  receiptDocumentId: string | null;
}

const SUPERVISOR_OFFICER: Officer = { subject: 'mock-supervisor', name: 'Samuel Njoroge' };
const ADMIN_OFFICER: Officer = { subject: 'mock-commission-admin', name: 'Joyce Wanjiku' };
const REVIEWER_DESIGNATION = 'Deputy Director, HRM';

const noEdits = (): Edits => ({ remarks: new Map(), compiledBy: null, confirmedBy: null });

/** Part I and Part B as the commission-admin fills them for the seeded reports. */
function filled(edits: Edits): Edits {
  return {
    ...edits,
    contactDetails: '+254 20 222 3901 / +254 720 101 010',
    emailAddress: 'compliance@publicservice.go.ke',
    registerMaintained: true,
    complaints: [],
  };
}

const reports = new Map<number, Stored>();
/** Answers to confirmations by Idempotency-Key, for replays. */
const confirmations = new Map<string, { fy: number; body: string; answer: ComplianceReport }>();
let today = '';
let latency = 1;
let compileMs = COMPILE_MS;
let issueMs = ISSUE_MS;
let corruptDocument = false;
let failingConfirms = 0;

/** `date` plus `days`, as `YYYY-MM-DD`. */
function plusDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** 06:00 in Nairobi on `date`, when the scheduled compile runs. */
const sixAm = (date: string) => `${date}T03:00:00.000Z`;

/** The ids of a year's Form M PDF and receipt in the mock's documents. */
const formMDocumentIdOf = (fy: number) => `0199c000-0000-7000-8000-00010000${String(fy)}`;
const receiptDocumentIdOf = (fy: number) => `0199c000-0000-7000-8000-00020000${String(fy)}`;

export interface ReportingMockSeed {
  /** The year-before's document is not form-m.v1 (contract drift). */
  corruptDocument?: boolean;
  /** The supervisor marked the year-before's draft reviewed two days ago. */
  reviewed?: boolean;
  /** The commission-admin filled Part I and Part B of the year-before's draft. */
  filled?: boolean;
  /**
   * The year-before's report is submitted: confirmed `late` (57 days after 31 July) or `on-time`
   * (today), or filed by the Commission's own system (`federated`, today).
   */
  submitted?: 'late' | 'on-time' | 'federated';
  /** The PDF and receipt of a seeded submitted report are still being issued. */
  issuing?: boolean;
}

/** Seeds the store as it stands on `day` (`YYYY-MM-DD`; today in Nairobi by default). */
export function resetReportingMock(day: string = nairobiToday(), options: ReportingMockSeed = {}) {
  today = day;
  corruptDocument = options.corruptDocument ?? false;
  failingConfirms = 0;
  reports.clear();
  confirmations.clear();
  const current = financialYearOf(day);
  const last = current - 1;
  if (last < FIRST_FINANCIAL_YEAR) return;
  const submitted = options.submitted ?? (day >= previewFromOf(current) ? 'late' : undefined);
  if (submitted) {
    const submittedOn = submitted === 'late' ? plusDays(dueDateOf(last), 57) : day;
    const reviewedOn = plusDays(submittedOn, -1);
    const federated = submitted === 'federated';
    reports.set(last, {
      fy: last,
      status: 'submitted',
      source: federated ? 'federated' : 'hosted',
      compiledAt: sixAm(finalCompileOf(last)),
      compileStartedAt: null,
      submittedAt: `${submittedOn}T11:42:00.000Z`,
      late: submittedOn > dueDateOf(last),
      reference: `RPT-PSC-${String(last + 1)}-0000001-K`,
      reviewedBy: SUPERVISOR_OFFICER,
      confirmedBy: federated ? null : ADMIN_OFFICER,
      compiled: fullDocument(last),
      edits: filled({
        ...noEdits(),
        compiledBy: {
          name: SUPERVISOR_OFFICER.name,
          designation: REVIEWER_DESIGNATION,
          date: reviewedOn,
        },
        confirmedBy: { name: ADMIN_OFFICER.name, designation: 'Secretary/CEO', date: submittedOn },
      }),
      issueAt: options.issuing ? Number.POSITIVE_INFINITY : null,
      formMDocumentId: options.issuing ? null : formMDocumentIdOf(last),
      receiptDocumentId: options.issuing ? null : receiptDocumentIdOf(last),
    });
    return;
  }
  const yearStart = finalCompileOf(last);
  const compiledOn = plusDays(day, -11) < yearStart ? yearStart : plusDays(day, -11);
  const reviewedOn = plusDays(day, -2);
  const edits = noEdits();
  if (options.reviewed) {
    edits.compiledBy = {
      name: SUPERVISOR_OFFICER.name,
      designation: REVIEWER_DESIGNATION,
      date: reviewedOn,
    };
  }
  reports.set(last, {
    fy: last,
    status: options.reviewed ? 'reviewed' : 'draft',
    source: 'hosted',
    compiledAt: sixAm(compiledOn),
    compileStartedAt: null,
    submittedAt: null,
    late: null,
    reference: null,
    reviewedBy: options.reviewed ? SUPERVISOR_OFFICER : null,
    confirmedBy: null,
    compiled: fullDocument(last),
    edits: options.filled ? filled(edits) : edits,
    issueAt: null,
    formMDocumentId: null,
    receiptDocumentId: null,
  });
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
  ensureSeeded();
  return today;
}

function ensureSeeded() {
  // The dev server's first request: seed from REPORTING_MOCK_TODAY. Tests seed explicitly.
  if (today === '') resetReportingMock(env().REPORTING_MOCK_TODAY);
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
    tenant = 'psc',
    stepUpAt,
    fetch = mockReportingFetch,
  }: {
    name?: string;
    tenant?: string;
    stepUpAt?: number;
    fetch?: (request: Request) => Promise<Response>;
  } = {},
) {
  const token = unsignedMockToken({
    subject: 'mock-officer',
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
  ensureSeeded();
  await delay(250);
  const url = new URL(input.url);
  const match = /^\/v1\/commissions\/([^/]+)\/compliance-reports(?:\/(\d+)(?:\/([a-z]+))?)?$/.exec(
    url.pathname,
  );
  if (!match) return notFound();
  const [, slug, fyText, actionText] = match;
  const caller = mockCallerOf(input);
  const visible =
    slug === PSC.slug &&
    caller.tenant === PSC.slug &&
    caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  if (!visible) return notFound();

  if (fyText === undefined) {
    return input.method === 'GET' ? json(200, periods()) : notFound();
  }
  const fy = Number(fyText);
  if (fy < FIRST_FINANCIAL_YEAR || fy > financialYearOf(today)) {
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
  const stored = reports.get(fy);
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
  const current = financialYearOf(today);
  const years = new Set([current, current - 1, ...reports.keys()]);
  return [...years]
    .filter((fy) => fy >= FIRST_FINANCIAL_YEAR && fy <= current)
    .sort((a, b) => b - a)
    .map((fy) => {
      const stored = reports.get(fy);
      if (stored) advance(stored);
      return {
        fy,
        status: stored?.status ?? 'not-started',
        dueDate: dueDateOf(fy),
        reference: stored?.reference ?? null,
        submittedAt: stored?.submittedAt ?? null,
        late: stored?.late ?? null,
        previewAvailable: today >= previewFromOf(fy) && stored?.status !== 'submitted',
      };
    });
}

function startCompile(fy: number): Response {
  if (today < previewFromOf(fy)) {
    return problem(409, 'A preview of Form M opens on 1 April', 'preview-not-available');
  }
  const stored = reports.get(fy);
  if (stored?.status === 'submitted') return reportSubmitted();
  const next: Stored = stored ?? {
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
  reports.set(fy, next);
  return new Response(null, { status: 202 });
}

/** Runs the mock workflows: a compile finishes, or the PDF and receipt are issued, in time. */
function advance(stored: Stored) {
  if (stored.issueAt !== null && Date.now() >= stored.issueAt) {
    stored.issueAt = null;
    stored.formMDocumentId = formMDocumentIdOf(stored.fy);
    stored.receiptDocumentId = receiptDocumentIdOf(stored.fy);
  }
  if (stored.status !== 'compiling' || stored.compileStartedAt === null) return;
  if (Date.now() < stored.compileStartedAt + compileMs) return;
  stored.status = 'draft';
  stored.compileStartedAt = null;
  // New numbers are reviewed again: Part III's compiled-by goes with the review.
  stored.reviewedBy = null;
  stored.edits.compiledBy = null;
  // As at now, on the mock's day (its clock may be set to another day).
  const time = new Date().toISOString().slice(10);
  stored.compiledAt = `${today}${time}`;
  // A year compiled before it ends is a preview of today's data.
  stored.compiled =
    today < finalCompileOf(stored.fy) ? previewDocument(stored.fy) : fullDocument(stored.fy);
}

const reportSubmitted = () =>
  problem(409, 'The report is submitted and can no longer change', 'report-submitted');

/** The report, if it can be edited: 404 without one, 409 once submitted or while compiling. */
function editable(fy: number): Stored | Response {
  const stored = reports.get(fy);
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
  const listed = new Set(rowsOf(documentOf(stored)).map((row) => row.obligationId));
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
  stored.edits.compiledBy = { name: officer.name, designation: designation.trim(), date: today };
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
  const missing = incompleteOf(documentOf(stored));
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

/** The compiled document with the officers' edits laid over it, as the service assembles it. */
function documentOf(stored: Stored): FormMV1 {
  const compiled = stored.compiled ?? fullDocument(stored.fy);
  const { edits } = stored;
  const remarked = (section: FormMV1['partII']['biennial']) => ({
    ...section,
    nonFilers: section.nonFilers.map((row) => {
      const remark = row.obligationId ? edits.remarks.get(row.obligationId) : undefined;
      return remark === undefined ? row : { ...row, remarks: remark };
    }),
  });
  const { partI, partII, partIII } = compiled;
  return {
    ...compiled,
    partI: {
      ...partI,
      contactDetails: edits.contactDetails ?? partI.contactDetails,
      physicalAddress: edits.physicalAddress ?? partI.physicalAddress,
      emailAddress: edits.emailAddress ?? partI.emailAddress,
    },
    partII: {
      ...partII,
      initial: remarked(partII.initial),
      biennial: remarked(partII.biennial),
      final: remarked(partII.final),
      complaints: {
        registerMaintained:
          edits.registerMaintained === undefined
            ? partII.complaints.registerMaintained
            : edits.registerMaintained,
        items: edits.complaints ?? partII.complaints.items,
      },
    },
    partIII: {
      compiledBy: edits.compiledBy ?? partIII.compiledBy,
      confirmedBy: edits.confirmedBy ?? partIII.confirmedBy,
    },
  };
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

function view(stored: Stored): ComplianceReport {
  const document = stored.status === 'compiling' || !stored.compiled ? null : documentOf(stored);
  return {
    id: `0199a000-0000-7000-8000-00000000${String(stored.fy)}`,
    commission: PSC,
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
      document && corruptDocument
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
    fetch: mockReportingDocumentsFetch,
  });
}

/** The file name of a Form M PDF or receipt the mock issued, for `/api/mock-files`; else null. */
export function mockReportingFileTitle(id: string): string | null {
  for (const stored of reports.values()) {
    if (!stored.reference) continue;
    if (id === stored.formMDocumentId) return `Form M ${stored.reference}.pdf`;
    if (id === stored.receiptDocumentId) return `Receipt ${stored.reference}.pdf`;
  }
  return null;
}

/**
 * The documents service as the Form M workspace calls it: `GET /v1/documents/{id}/download` for
 * the PDF and receipt of a report the mock issued, to the Commission's officers.
 */
export async function mockReportingDocumentsFetch(input: Request): Promise<Response> {
  ensureSeeded();
  await delay(150);
  const download = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(input.url).pathname);
  const id = download?.[1];
  const caller = mockCallerOf(input);
  const staff =
    caller.tenant === PSC.slug &&
    caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  if (input.method !== 'GET' || !id || !staff || !mockReportingFileTitle(id)) return notFound();
  return json(200, {
    downloadUrl: `/api/mock-files/${id}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}

type NonFiler = FormMV1['partII']['initial']['nonFilers'][number];

const REMARKS: Record<NonFiler['actionTaken'], string> = {
  none: 'No administrative action taken',
  'notice-to-comply': 'Notice to comply issued',
  warning: 'Warning issued',
  'salary-stoppage': 'Salary stopped',
  'disciplinary-referral': 'Referred for disciplinary action',
  'referred-to-eacc': 'Referred to EACC',
};

function nonFiler(
  obligation: number,
  name: string,
  designation: string,
  identifier: string,
  date: string,
  actionTaken: NonFiler['actionTaken'],
  complied: NonFiler['complied'],
): NonFiler {
  return {
    obligationId: `0199b000-0000-7000-8000-${String(obligation).padStart(12, '0')}`,
    name,
    designation,
    identifier,
    date,
    actionTaken,
    complied,
    remarks: REMARKS[actionTaken],
  };
}

const UNSIGNED: FormMV1['partIII'] = {
  compiledBy: { name: null, designation: null, date: null },
  confirmedBy: { name: null, designation: null, date: null },
};

function partI(fy: number): FormMV1['partI'] {
  return {
    commissionName: PSC.name,
    issuerCode: PSC.issuerCode,
    contactDetails: '',
    physicalAddress: 'Commission House, Harambee Avenue, Nairobi',
    emailAddress: '',
    period: { from: `${String(fy)}-07-01`, to: `${String(fy + 1)}-06-30`, financialYearStart: fy },
  };
}

/** The year's draft as the scheduled compile assembles it (the prototype's PSC fixture). */
function fullDocument(fy: number): FormMV1 {
  const y = (offset: number) => String(fy + offset);
  return {
    schemaVersion: 'form-m.v1',
    partI: partI(fy),
    partII: {
      initial: {
        expected: 12,
        declared: 10,
        notDeclared: 2,
        nonFilers: [
          nonFiler(
            101,
            'Kevin Omondi Ochieng',
            'Human Resource Officer II',
            `PSC/${y(0)}/0418`,
            `${y(0)}-09-01`,
            'notice-to-comply',
            'yes',
          ),
          nonFiler(
            102,
            'Mercy Chebet Rotich',
            'Records Management Officer',
            `PSC/${y(1)}/0032`,
            `${y(1)}-05-18`,
            'none',
            'no',
          ),
        ],
      },
      biennial: {
        expected: 100,
        declared: 95,
        notDeclared: 5,
        noCycleInPeriod: false,
        nonFilers: [
          nonFiler(
            201,
            'Peter Mwangi Githinji',
            'Principal Accountant',
            'PSC/2011/0217',
            '2011-03-01',
            'salary-stoppage',
            'pending',
          ),
          nonFiler(
            202,
            'Halima Abdi Hassan',
            'Senior Legal Officer',
            'PSC/2016/0098',
            '2016-08-15',
            'warning',
            'pending',
          ),
          nonFiler(
            203,
            'Joseph Kiprono Langat',
            'Driver III',
            'PSC/2008/0544',
            '2008-01-07',
            'notice-to-comply',
            'yes',
          ),
          nonFiler(
            204,
            'Esther Nyambura Wairimu',
            'Office Administrator',
            'PSC/2019/0310',
            '2019-06-03',
            'referred-to-eacc',
            'no',
          ),
          nonFiler(
            205,
            'Collins Barasa Wekesa',
            'ICT Officer I',
            'PSC/2021/0127',
            '2021-10-11',
            'disciplinary-referral',
            'no',
          ),
        ],
      },
      final: {
        expected: 4,
        declared: 3,
        notDeclared: 1,
        nonFilers: [
          nonFiler(
            301,
            'Lucy Atieno Odhiambo',
            'Deputy Director, Finance',
            'PSC/2004/0061',
            `${y(1)}-03-31`,
            'notice-to-comply',
            'pending',
          ),
        ],
      },
      clarifications: { items: CLARIFICATIONS.map((item) => ({ ...item })) },
      accessRequests: {
        received: 0,
        granted: 0,
        declined: 0,
        declineReasons: [],
        dataUnavailable: true,
      },
      complaints: { registerMaintained: null, items: [] },
    },
    partIII: UNSIGNED,
  };
}

/** A preview of the year from today's data: no biennial cycle, access requests captured. */
function previewDocument(fy: number): FormMV1 {
  const y = (offset: number) => String(fy + offset);
  const full = fullDocument(fy);
  return {
    ...full,
    partII: {
      ...full.partII,
      initial: {
        expected: 7,
        declared: 5,
        notDeclared: 2,
        nonFilers: [
          nonFiler(
            401,
            'Nelson Kibet Cheruiyot',
            'Economist II',
            `PSC/${y(0)}/0107`,
            `${y(0)}-11-02`,
            'notice-to-comply',
            'pending',
          ),
          nonFiler(
            402,
            'Janet Moraa Nyakundi',
            'Clerical Officer',
            `PSC/${y(1)}/0004`,
            `${y(1)}-02-15`,
            'none',
            'no',
          ),
        ],
      },
      biennial: { expected: 0, declared: 0, notDeclared: 0, nonFilers: [], noCycleInPeriod: true },
      final: { expected: 2, declared: 2, notDeclared: 0, nonFilers: [] },
      clarifications: {
        items: CLARIFICATIONS.slice(0, 2).map((item) => ({
          ...item,
          statusOfCompliance: 'pending',
        })),
      },
      accessRequests: {
        received: 3,
        granted: 2,
        declined: 1,
        declineReasons: [{ reason: 'frivolous-vexatious', count: 1 }],
        dataUnavailable: false,
      },
    },
  };
}

const CLARIFICATIONS: FormMV1['partII']['clarifications']['items'] = [
  {
    name: "Samuel Kariuki Ndung'u",
    designation: 'Director, Establishment',
    identifier: 'PSC/2002/0015',
    natureInGeneralTerms: 'Supporting documents for an asset',
    statusOfCompliance: 'resolved',
    clarificationReference: 'CLR-PSC-2025-0000011-3',
  },
  {
    name: 'Ann Wambui Mugo',
    designation: 'Senior Economist',
    identifier: 'PSC/2013/0205',
    natureInGeneralTerms: 'Explanation of the source of funds for an asset',
    statusOfCompliance: 'responded',
    clarificationReference: 'CLR-PSC-2026-0000003-6',
  },
  {
    name: 'Hassan Omar Mohamed',
    designation: 'Principal Administrative Officer',
    identifier: 'PSC/2009/0133',
    natureInGeneralTerms: 'Missing liability details',
    statusOfCompliance: 'pending',
    clarificationReference: 'CLR-PSC-2026-0000009-T',
  },
  {
    name: 'Beatrice Njeri Kimani',
    designation: 'Accountant I',
    identifier: 'PSC/2018/0276',
    natureInGeneralTerms: "Incomplete spouse's financial statement",
    statusOfCompliance: 'overdue',
    clarificationReference: 'CLR-PSC-2026-0000014-Z',
  },
  {
    name: 'Daniel Mutua Musyoka',
    designation: 'Supply Chain Officer II',
    identifier: 'PSC/2020/0391',
    natureInGeneralTerms: 'Undisclosed directorship or membership',
    statusOfCompliance: 'resolved',
    clarificationReference: 'CLR-PSC-2026-0000017-T',
  },
  {
    name: 'Rose Akinyi Otieno',
    designation: 'Assistant Director, HRM',
    identifier: 'PSC/2012/0188',
    natureInGeneralTerms: 'Basis of valuation not stated',
    statusOfCompliance: 'withdrawn',
    clarificationReference: 'CLR-PSC-2026-0000021-2',
  },
];
