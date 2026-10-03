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
 * - From April to June: the current year can be previewed; the year before was submitted late.
 *   A preview compiled then has no biennial cycle and section 5 counts from access requests.
 *
 * The open-data preview is `open-data-mock.server.ts`.
 *
 * Only the Commission's supervisor, commission-admin and reporting officer see it (anyone else,
 * and any other Commission, gets 404); only the supervisor compiles (403), from 1 April after the
 * year (409 `preview-not-available`) and until the report is submitted (409 `report-submitted`).
 * A compile leaves the report `compiling` for three seconds, then a draft as at that moment.
 */
import { FORM_M_ROLES, SUPERVISOR } from '@adili/roles';
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
import { json, mockCallerOf, problem, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import { MOCK_PSC } from './mock-commissions';
import {
  mockOpenDataFetch,
  type OpenDataMockScenario,
  setOpenDataMockScenario,
} from './open-data-mock.server';
import type { ComplianceReport, Officer, ReportCounts, ReportPeriod, ReportStatus } from './types';

const PSC = MOCK_PSC;
const FIRST_FINANCIAL_YEAR = 2025;
/** How long the mock's workflow takes to compile a draft. */
const COMPILE_MS = 3000;

interface Stored {
  fy: number;
  status: Exclude<ReportStatus, 'not-started'>;
  compiledAt: string | null;
  /** While compiling: when the compile started. */
  compileStartedAt: number | null;
  submittedAt: string | null;
  late: boolean | null;
  reference: string | null;
  reviewedBy: Officer | null;
  confirmedBy: Officer | null;
  document: FormMV1 | null;
}

const SUPERVISOR_OFFICER: Officer = { subject: 'mock-supervisor', name: 'Samuel Njoroge' };
const ADMIN_OFFICER: Officer = { subject: 'mock-commission-admin', name: 'Joyce Wanjiku' };

/** The draft as a supervisor marks it reviewed: Part III's compiled-by filled (spec 09 S5). */
function reviewed(document: FormMV1, on: string): FormMV1 {
  return {
    ...document,
    partIII: {
      ...document.partIII,
      compiledBy: { name: SUPERVISOR_OFFICER.name, designation: 'Deputy Director, HRM', date: on },
    },
  };
}

/** The document as the commission-admin confirmed it: Part I, Part B and Part III filled. */
function confirmed(document: FormMV1, reviewedOn: string, confirmedOn: string): FormMV1 {
  const done = reviewed(document, reviewedOn);
  return {
    ...done,
    partI: {
      ...done.partI,
      contactDetails: '+254 20 222 3901',
      emailAddress: 'compliance@publicservice.go.ke',
    },
    partII: { ...done.partII, complaints: { registerMaintained: true, items: [] } },
    partIII: {
      ...done.partIII,
      confirmedBy: { name: ADMIN_OFFICER.name, designation: 'Secretary/CEO', date: confirmedOn },
    },
  };
}

const reports = new Map<number, Stored>();
let today = '';
let latency = 1;
let compileMs = COMPILE_MS;
let corruptDocument = false;

/** `date` plus `days`, as `YYYY-MM-DD`. */
function plusDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** 06:00 in Nairobi on `date`, when the scheduled compile runs. */
const sixAm = (date: string) => `${date}T03:00:00.000Z`;

/**
 * Seeds the store as it stands on `day` (`YYYY-MM-DD`; today in Nairobi by default).
 * `corruptDocument` answers a report whose document is not form-m.v1 (contract drift);
 * `reviewed` has the supervisor mark the year-before's draft reviewed two days ago. `openData`
 * is what the Commission open-data preview answers (`open-data-mock.server.ts`);
 * `REPORTING_MOCK_OPEN_DATA` when not given.
 */
export function resetReportingMock(
  day: string = nairobiToday(),
  options: {
    corruptDocument?: boolean;
    reviewed?: boolean;
    openData?: OpenDataMockScenario;
  } = {},
) {
  today = day;
  setOpenDataMockScenario(options.openData ?? null);
  corruptDocument = options.corruptDocument ?? false;
  reports.clear();
  const current = financialYearOf(day);
  const last = current - 1;
  if (last < FIRST_FINANCIAL_YEAR) return;
  if (day >= previewFromOf(current)) {
    const submittedOn = plusDays(dueDateOf(last), 57);
    const reviewedOn = plusDays(submittedOn, -1);
    reports.set(last, {
      fy: last,
      status: 'submitted',
      compiledAt: sixAm(finalCompileOf(last)),
      compileStartedAt: null,
      submittedAt: `${submittedOn}T11:42:00.000Z`,
      late: true,
      reference: `RPT-PSC-${String(last + 1)}-0000001-K`,
      reviewedBy: SUPERVISOR_OFFICER,
      confirmedBy: ADMIN_OFFICER,
      document: confirmed(fullDocument(last), reviewedOn, submittedOn),
    });
    return;
  }
  const yearStart = finalCompileOf(last);
  const compiledOn = plusDays(day, -11) < yearStart ? yearStart : plusDays(day, -11);
  const reviewedOn = plusDays(day, -2);
  reports.set(last, {
    fy: last,
    status: options.reviewed ? 'reviewed' : 'draft',
    compiledAt: sixAm(compiledOn),
    compileStartedAt: null,
    submittedAt: null,
    late: null,
    reference: null,
    reviewedBy: options.reviewed ? SUPERVISOR_OFFICER : null,
    confirmedBy: null,
    document: options.reviewed ? reviewed(fullDocument(last), reviewedOn) : fullDocument(last),
  });
}

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
  ensureSeeded();
  await delay(250);
  // The Commission open-data preview (spec 09b) is its own part of the mock.
  const openData = mockOpenDataFetch(input);
  if (openData) return openData;
  const url = new URL(input.url);
  const match = /^\/v1\/commissions\/([^/]+)\/compliance-reports(?:\/(\d+)(\/compile)?)?$/.exec(
    url.pathname,
  );
  if (!match) return notFound();
  const [, slug, fyText, compile] = match;
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
  if (compile) {
    if (input.method !== 'POST') return notFound();
    if (!caller.roles.includes(SUPERVISOR)) {
      return problem(403, 'Only a supervisor of the Commission can compile its Form M.');
    }
    return startCompile(fy);
  }
  if (input.method !== 'GET') return notFound();
  const stored = reports.get(fy);
  if (!stored) return notFound();
  advance(stored);
  return json(200, view(stored));
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
  if (stored?.status === 'submitted') {
    return problem(
      409,
      'The report is submitted and can no longer be compiled',
      'report-submitted',
    );
  }
  const next: Stored = stored ?? {
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
  reports.set(fy, next);
  return new Response(null, { status: 202 });
}

/** Runs the mock workflow: a compile finishes once its time has come. */
function advance(stored: Stored) {
  if (stored.status !== 'compiling' || stored.compileStartedAt === null) return;
  if (Date.now() < stored.compileStartedAt + compileMs) return;
  stored.status = 'draft';
  stored.compileStartedAt = null;
  // As at now, on the mock's day (its clock may be set to another day).
  const time = new Date().toISOString().slice(10);
  stored.compiledAt = `${today}${time}`;
  // A year compiled before it ends is a preview of today's data.
  stored.document =
    today < finalCompileOf(stored.fy) ? previewDocument(stored.fy) : fullDocument(stored.fy);
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
  const document = stored.status === 'compiling' ? null : stored.document;
  return {
    id: `0199a000-0000-7000-8000-00000000${String(stored.fy)}`,
    commission: PSC,
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
      document && corruptDocument
        ? ({ ...document, schemaVersion: 'form-m.v0' } as unknown as FormMV1)
        : document,
    counts: stored.document ? countsOf(stored.document) : {},
    formMDocumentId: null,
    receiptDocumentId: null,
    accessDataUnavailable: stored.document?.partII.accessRequests.dataUnavailable ?? true,
  };
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
