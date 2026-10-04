/**
 * In-memory stand-in for the reporting service's EACC intake endpoints (reporting.yaml
 * `getEaccIntake`, `getSubmittedReport`) and for documents' downloads of the Form M PDFs and
 * receipts they point at, used when REPORTING_MOCK is set. Fifteen Commissions on the reporting
 * mocks' day (`mockDay` in `mock-store.server.ts`, shared with the Form M workspace) for every
 * financial year from 2025; a report counts as filed once its day has come:
 *
 * - The Public Service Commission (`psc`) is the Form M workspace mock's: EACC sees its report
 *   once it is submitted there (with its date, late flag and reference), and not reported while
 *   it is a draft.
 * - Filed by 31 July: the Parliamentary Service Commission, the National Police Service
 *   Commission and six county public service boards.
 * - Filed late: the Teachers Service Commission (`tsc`, 12 August, through its own system, with
 *   long lists), Nairobi City (3 September, low biennial rate) and Kirinyaga.
 * - Not reported: the Judicial Service Commission (`jsc`), Kisumu and Kisii.
 *
 * EACC's chase runs every Saturday at 06:00 from 1 August while a Commission has not reported.
 * Outliers follow the service's rules with its default thresholds (0.8 for every section).
 * Only EACC analysts and supervisors of tenant `eacc` read the intake (anyone else 403); they and
 * the Commission's own supervisor, commission-admin and reporting officer read a submitted report
 * (anyone else, and a report not filed yet, 404).
 */
import { EACC_ROLES, EACC_TENANT, FORM_M_ROLES } from '@adili/roles';
import { INTAKE_STATUSES } from '@adili/ui';

import { dueDateOf, FIRST_FINANCIAL_YEAR } from '../../components/form-m/financial-year';
import { documentDownloadIdOf, json, type MockCaller, mockCallerOf, problem } from '../mock-http';
import {
  storedDocument,
  mockDay,
  nairobiDayOf,
  plusDays,
  sixAm,
  storedReport,
  type StoredReport,
} from './mock-store.server';
import type {
  Intake,
  IntakeOutlier,
  IntakeRow,
  IntakeStatus,
  ReportSource,
  SubmittedReport,
} from './types';

type FormM = SubmittedReport['document'];
type SectionKey = 'initial' | 'biennial' | 'final';
type NonFiler = FormM['partII']['initial']['nonFilers'][number];

/** The intake total that counts each status. */
const TOTAL_OF = {
  'submitted-on-time': 'onTime',
  'submitted-late': 'late',
  'not-reported': 'notReported',
} as const satisfies Record<IntakeStatus, keyof Intake['totals']>;

/** The service's default `INTAKE_MIN_<SECTION>_RATE`. */
const MIN_RATE = 0.8;

interface Fixture {
  slug: string;
  issuerCode: string;
  name: string;
  /** Days after 31 July it files (negative: before); null when it has not reported. */
  filedAfterDue: number | null;
  source: ReportSource;
  /**
   * Expected and declared per section, in a year with a biennial cycle; null for the Commission
   * whose counts are its filed document's in the Form M workspace mock.
   */
  counts: Record<SectionKey, readonly [expected: number, declared: number]> | null;
  contact: { phone: string; address: string; email: string };
  officers: { compiledBy: string; confirmedBy: string };
}

const fixture = (
  slug: string,
  name: string,
  filedAfterDue: number | null,
  counts: Fixture['counts'],
  extra: Partial<Pick<Fixture, 'source' | 'issuerCode' | 'contact' | 'officers'>> = {},
): Fixture => ({
  slug,
  issuerCode: extra.issuerCode ?? slug.toUpperCase(),
  name,
  filedAfterDue,
  source: extra.source ?? 'hosted',
  counts,
  contact: extra.contact ?? {
    phone: '+254 20 222 0000',
    address: `${name}, P.O. Box 30095, Nairobi`,
    email: `compliance@${slug}.go.ke`,
  },
  officers: extra.officers ?? { compiledBy: 'Grace Wanjiku Mwangi', confirmedBy: 'Peter Otieno' },
});

/** By name, as the service lists them. */
const COMMISSIONS: readonly Fixture[] = (
  [
    fixture('cpsb039', 'Bungoma County Public Service Board', -5, {
      initial: [388, 371],
      biennial: [5120, 4987],
      final: [96, 88],
    }),
    fixture('cpsb045', 'Kisii County Public Service Board', null, {
      initial: [402, 0],
      biennial: [5530, 0],
      final: [120, 0],
    }),
    fixture('cpsb022', 'Kiambu County Public Service Board', -2, {
      initial: [455, 440],
      biennial: [6120, 5890],
      final: [148, 101],
    }),
    fixture('cpsb020', 'Kirinyaga County Public Service Board', 19, {
      initial: [214, 199],
      biennial: [3010, 2876],
      final: [61, 55],
    }),
    fixture('cpsb042', 'Kisumu County Public Service Board', null, {
      initial: [512, 0],
      biennial: [6400, 0],
      final: [131, 0],
    }),
    fixture('cpsb012', 'Meru County Public Service Board', -9, {
      initial: [366, 352],
      biennial: [5410, 5302],
      final: [102, 95],
    }),
    fixture('cpsb001', 'Mombasa County Public Service Board', -1, {
      initial: [620, 598],
      // The board left its officers in service out: a section missing.
      biennial: [0, 0],
      final: [0, 3],
    }),
    fixture('cpsb047', 'Nairobi City County Public Service Board', 34, {
      initial: [1840, 1702],
      biennial: [16240, 10069],
      final: [410, 351],
    }),
    fixture('cpsb032', 'Nakuru County Public Service Board', -16, {
      initial: [512, 501],
      biennial: [6802, 6590],
      final: [133, 127],
    }),
    fixture(
      'npsc',
      'National Police Service Commission',
      -9,
      { initial: [6120, 5988], biennial: [104300, 101120], final: [2410, 2209] },
      { source: 'federated' },
    ),
    fixture(
      'parlsc',
      'Parliamentary Service Commission',
      -3,
      { initial: [214, 206], biennial: [2890, 2811], final: [96, 90] },
      {
        contact: {
          phone: '+254 20 226 9274',
          address: 'Parliament Buildings, Parliament Road, Nairobi',
          email: 'compliance@parlsc.go.ke',
        },
        officers: { compiledBy: 'Stanley Mwendwa', confirmedBy: 'Joyce Wangari' },
      },
    ),
    fixture('jsc', 'Judicial Service Commission', null, {
      initial: [310, 0],
      biennial: [5800, 0],
      final: [90, 0],
    }),
    fixture(
      'psc',
      'Public Service Commission',
      // Filed when the Form M workspace mock submits it, with its counts (see `filingOf`).
      null,
      null,
    ),
    fixture(
      'tsc',
      'Teachers Service Commission',
      12,
      { initial: [9412, 8960], biennial: [12870, 12402], final: [905, 811] },
      {
        source: 'federated',
        contact: {
          phone: '+254 20 223 5137',
          address: 'TSC House, Kilimanjaro Road, Upper Hill, Nairobi',
          email: 'compliance@tsc.go.ke',
        },
        officers: { compiledBy: 'Margaret Chepkoech', confirmedBy: 'Dr. Joseph Karanja' },
      },
    ),
    fixture('cpsb027', 'Uasin Gishu County Public Service Board', -6, {
      initial: [301, 290],
      biennial: [4310, 4180],
      final: [77, 71],
    }),
  ] satisfies Fixture[]
).sort((a, b) => a.name.localeCompare(b.name));

let latency = 1;
let offline = false;

/** `offline` answers 503 to every read, as when the Commission directory cannot be reached. */
export function setEaccIntakeMockOffline(value: boolean) {
  offline = value;
}

/** Scales the mock's answer delays (0 in tests). */
export function setEaccIntakeMockLatency(factor: number) {
  latency = factor;
}

/** Waits `ms` scaled by the mocks' latency (0 in tests); the national report mock shares it. */
export const mockDelay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

/** A report EACC has received. */
interface Filing {
  /** The day it came in. */
  day: string;
  submittedAt: string;
  late: boolean;
  reference: string;
  /** The form as filed, for the workspace mock's report; built from the fixture otherwise. */
  document: FormM | null;
  /** The workspace mock's report as stored (its compile and sign-off), for psc only. */
  stored: StoredReport | null;
}

/** `commission`'s report for the year as EACC has it by today; null when it has not reported. */
function filingOf(commission: Fixture, fy: number): Filing | null {
  if (commission.counts === null) {
    const stored = storedReport(fy);
    if (stored?.status !== 'submitted') return null;
    const { submittedAt, late, reference, compiled } = stored;
    if (submittedAt === null || late === null || reference === null || compiled === null) {
      throw new Error(`The workspace mock's submitted report for ${String(fy)} lacks a field`);
    }
    return {
      day: nairobiDayOf(submittedAt),
      submittedAt,
      late,
      reference,
      document: storedDocument(stored),
      stored,
    };
  }
  if (commission.filedAfterDue === null) return null;
  const day = plusDays(dueDateOf(fy), commission.filedAfterDue);
  if (day > mockDay()) return null;
  return {
    day,
    submittedAt: `${day}T08:05:00.000Z`,
    late: day > dueDateOf(fy),
    reference: referenceOf(commission, fy),
    document: null,
    stored: null,
  };
}

/**
 * EACC's chase rounds for the year: every Saturday from the first on or after 1 August, up to
 * today, before the day the report was filed (if it was).
 */
function chaseRounds(fy: number, filed: string | null): string[] {
  const august = plusDays(dueDateOf(fy), 1);
  const weekday = new Date(`${august}T00:00:00Z`).getUTCDay();
  const today = mockDay();
  const rounds: string[] = [];
  for (
    let day = plusDays(august, (6 - weekday + 7) % 7);
    day <= today && (filed === null || day < filed);
    day = plusDays(day, 7)
  ) {
    rounds.push(day);
  }
  return rounds;
}

/** Whether the year has a biennial declaration cycle (odd start years, as FY 2027 in spec 09). */
export const hasBiennialCycle = (fy: number) => fy % 2 === 1;

function sectionCounts(
  commission: Fixture,
  fy: number,
  section: SectionKey,
  filing: Filing | null = null,
) {
  if (filing?.document) return filing.document.partII[section];
  if (section === 'biennial' && !hasBiennialCycle(fy)) return { expected: 0, declared: 0 };
  if (!commission.counts) throw new Error(`${commission.slug} counts come from its filed report`);
  const [expected, declared] = commission.counts[section];
  return { expected, declared };
}

const rateOf = (declared: number, expected: number) =>
  expected === 0 ? null : Math.round((declared / expected) * 10_000) / 10_000;

const SECTIONS: readonly SectionKey[] = ['initial', 'biennial', 'final'];

/** Whether the year had a biennial cycle: as the filed document says, else by the year. */
const biennialCycleOf = (fy: number, filing: Filing | null) =>
  filing?.document
    ? filing.document.partII.biennial.noCycleInPeriod !== true
    : hasBiennialCycle(fy);

function outliersOf(rates: IntakeRow['rates'], biennialCycle: boolean): IntakeOutlier[] {
  const outliers: IntakeOutlier[] = [];
  for (const section of SECTIONS) {
    const rate = rates[section]?.rate;
    if (rate !== null && rate !== undefined && rate < MIN_RATE) {
      outliers.push(`low-${section}-rate`);
    }
  }
  if (biennialCycle && rates.biennial?.expected === 0) outliers.push('section-missing');
  return outliers;
}

/** A deterministic UUID for `kind` and `n` (the mock's ids). */
function uuid(kind: number, fy: number, n: number): string {
  return `0199c${String(kind)}00-0000-7000-8000-${String(fy).padStart(4, '0')}${String(n).padStart(8, '0')}`;
}

const reportIdOf = (index: number, fy: number) => uuid(1, fy, index);
const formMDocumentIdOf = (index: number, fy: number) => uuid(2, fy, index);
const receiptDocumentIdOf = (index: number, fy: number) => uuid(3, fy, index);

/** The year's reference: `RPT-<ISSUER>-<FY end>-<seq>-<check>`. */
const referenceOf = (commission: Fixture, fy: number) =>
  `RPT-${commission.issuerCode}-${String(fy + 1)}-0000001-K`;

function intakeRow(commission: Fixture, index: number, fy: number): IntakeRow {
  const filing = filingOf(commission, fy);
  const rounds = chaseRounds(fy, filing?.day ?? null);
  const chases = {
    count: rounds.length,
    lastAt: rounds.length ? sixAm(rounds.at(-1) ?? '') : null,
  };
  const base = { commission: { slug: commission.slug, name: commission.name }, chases };
  if (!filing) {
    return {
      ...base,
      status: 'not-reported',
      reportId: null,
      reference: null,
      submittedAt: null,
      rates: {},
      outliers: [],
      formMDocumentId: null,
      receiptDocumentId: null,
    };
  }
  const rates = Object.fromEntries(
    SECTIONS.map((section) => {
      const { expected, declared } = sectionCounts(commission, fy, section, filing);
      return [section, { expected, declared, rate: rateOf(declared, expected) }];
    }),
  ) as IntakeRow['rates'];
  return {
    ...base,
    status: filing.late ? 'submitted-late' : 'submitted-on-time',
    reportId: reportIdOf(index, fy),
    reference: filing.reference,
    submittedAt: filing.submittedAt,
    rates,
    outliers: outliersOf(rates, biennialCycleOf(fy, filing)),
    formMDocumentId: formMDocumentIdOf(index, fy),
    receiptDocumentId: receiptDocumentIdOf(index, fy),
  };
}

function intake(fy: number): Intake {
  const commissions = COMMISSIONS.map((commission, index) => intakeRow(commission, index, fy));
  let expected = 0;
  let declared = 0;
  for (const row of commissions) {
    for (const section of SECTIONS) {
      expected += row.rates[section]?.expected ?? 0;
      declared += row.rates[section]?.declared ?? 0;
    }
  }
  return {
    fy,
    totals: {
      ...(Object.fromEntries(
        INTAKE_STATUSES.map((status) => [
          TOTAL_OF[status],
          commissions.filter((row) => row.status === status).length,
        ]),
      ) as Record<(typeof TOTAL_OF)[IntakeStatus], number>),
      nationalDeclaredRate: rateOf(declared, expected),
    },
    commissions,
  };
}

const FIRST_NAMES = [
  'Moses',
  'Ruth',
  'Victor',
  'Mercy',
  'Kennedy',
  'Grace',
  'Stephen',
  'Beatrice',
  'Daniel',
  'Purity',
  'Faith',
  'Brian',
  'Agnes',
  'Collins',
  'Esther',
];
const MIDDLE_NAMES = ['Nyokabi', 'Kiprotich', 'Nafula', 'Kipchumba', 'Moraa', 'Akoth', 'Juma'];
const LAST_NAMES = ['Otieno', 'Kariuki', 'Jepkosgei', 'Ochieng', 'Njeri', 'Kimani', 'Rotich'];
const DESIGNATIONS = ['Senior Officer', 'Officer I', 'Principal Officer', 'Assistant Director'];
const NO_ACTION = ['none', 'no', 'No action taken yet.'] as const;
const ACTIONS: readonly (readonly [NonFiler['actionTaken'], NonFiler['complied'], string])[] = [
  ['disciplinary-referral', 'no', 'Referred for disciplinary action. Awaiting compliance.'],
  ['none', 'no', 'No action taken yet.'],
  ['warning', 'yes', 'Warning issued. Declaration filed after it.'],
  ['notice-to-comply', 'pending', 'Notice to comply issued. Awaiting compliance.'],
  ['salary-stoppage', 'pending', 'Salary stopped. Awaiting compliance.'],
  ['referred-to-eacc', 'pending', 'Referred to EACC. Awaiting compliance.'],
];

/** The officers who did not declare in a section, named as the report's snapshot holds them. */
function nonFilers(commission: Fixture, fy: number, section: SectionKey, count: number) {
  const rows: NonFiler[] = [];
  for (let n = 0; n < count; n += 1) {
    const name = [
      FIRST_NAMES[n % FIRST_NAMES.length],
      MIDDLE_NAMES[(n * 3 + section.length) % MIDDLE_NAMES.length],
      LAST_NAMES[(n * 5 + commission.slug.length) % LAST_NAMES.length],
    ].join(' ');
    const [actionTaken, complied, remarks] = ACTIONS[n % ACTIONS.length] ?? NO_ACTION;
    // Appointed (or exited) within the year for sections 1 and 3; years before for those in
    // service.
    const date =
      section === 'biennial'
        ? `${String(2008 + (n % 15))}-${String(1 + ((n * 7) % 12)).padStart(2, '0')}-${String(1 + ((n * 11) % 27)).padStart(2, '0')}`
        : plusDays(`${String(fy)}-07-01`, (n * 37) % 365);
    const joined = date.slice(0, 4);
    rows.push({
      name,
      designation: DESIGNATIONS[n % DESIGNATIONS.length] ?? 'Officer',
      identifier: `${commission.issuerCode}/${joined}/${String(1000 + n * 37).padStart(5, '0')}`,
      date,
      actionTaken,
      complied,
      remarks,
    });
  }
  return rows;
}

function documentOf(commission: Fixture, fy: number, filed: string): FormM {
  const section = (key: SectionKey) => {
    const { expected, declared } = sectionCounts(commission, fy, key);
    const notDeclared = Math.max(0, expected - declared);
    return {
      expected,
      declared,
      notDeclared,
      nonFilers: nonFilers(commission, fy, key, notDeclared),
      ...(key === 'biennial' ? { noCycleInPeriod: !hasBiennialCycle(fy) } : {}),
    };
  };
  const signedOn = plusDays(filed, -1);
  return {
    schemaVersion: 'form-m.v1',
    partI: {
      commissionName: commission.name,
      issuerCode: commission.issuerCode,
      contactDetails: commission.contact.phone,
      physicalAddress: commission.contact.address,
      emailAddress: commission.contact.email,
      period: {
        from: `${String(fy)}-07-01`,
        to: `${String(fy + 1)}-06-30`,
        financialYearStart: fy,
      },
    },
    partII: {
      initial: section('initial'),
      biennial: section('biennial'),
      final: section('final'),
      clarifications: {
        items: [
          {
            name: 'Ann Wambui Mugo',
            designation: 'Senior Economist',
            identifier: `${commission.issuerCode}/2013/0205`,
            natureInGeneralTerms: 'Explanation of the source of funds for an asset',
            statusOfCompliance: 'resolved',
          },
          {
            name: 'Hassan Omar Mohamed',
            designation: 'Principal Administrative Officer',
            identifier: `${commission.issuerCode}/2009/0133`,
            natureInGeneralTerms: 'Missing liability details',
            statusOfCompliance: 'pending',
          },
        ],
      },
      accessRequests: {
        received: 0,
        granted: 0,
        declined: 0,
        declineReasons: [],
        dataUnavailable: true,
      },
      complaints: { registerMaintained: true, items: [] },
    },
    partIII: {
      compiledBy: {
        name: commission.officers.compiledBy,
        designation: 'Deputy Director, Human Resource',
        date: plusDays(signedOn, -2),
      },
      confirmedBy: {
        name: commission.officers.confirmedBy,
        designation: 'Secretary',
        date: signedOn,
      },
    },
  };
}

function submittedReport(index: number, fy: number): SubmittedReport | null {
  const commission = COMMISSIONS[index];
  if (!commission) return null;
  const filing = filingOf(commission, fy);
  if (!filing) return null;
  const document = filing.document ?? documentOf(commission, fy, filing.day);
  const counts = (key: SectionKey) => {
    const { expected, declared, notDeclared } = document.partII[key];
    return { expected, declared, notDeclared };
  };
  const { compiledBy, confirmedBy } = document.partIII;
  return {
    id: reportIdOf(index, fy),
    commission: { slug: commission.slug, issuerCode: commission.issuerCode, name: commission.name },
    fy,
    status: 'submitted',
    source: commission.source,
    ...(filing.stored
      ? {
          compiledAt: filing.stored.compiledAt,
          reviewedBy: filing.stored.reviewedBy,
          confirmedBy: filing.stored.confirmedBy,
        }
      : {
          compiledAt: sixAm(plusDays(filing.day, -5)),
          reviewedBy:
            commission.source === 'hosted' && compiledBy.name
              ? { subject: `mock-${commission.slug}-supervisor`, name: compiledBy.name }
              : null,
          confirmedBy:
            commission.source === 'hosted' && confirmedBy.name
              ? { subject: `mock-${commission.slug}-admin`, name: confirmedBy.name }
              : null,
        }),
    submittedAt: filing.submittedAt,
    late: filing.late,
    reference: filing.reference,
    dueDate: dueDateOf(fy),
    document,
    counts: {
      initial: counts('initial'),
      biennial: { ...counts('biennial'), noCycleInPeriod: !biennialCycleOf(fy, filing) },
      final: counts('final'),
      clarifications: document.partII.clarifications.items.length,
      accessRequests: {
        received: document.partII.accessRequests.received,
        granted: document.partII.accessRequests.granted,
        declined: document.partII.accessRequests.declined,
      },
    },
    formMDocumentId: formMDocumentIdOf(index, fy),
    receiptDocumentId: receiptDocumentIdOf(index, fy),
    accessDataUnavailable: document.partII.accessRequests.dataUnavailable,
  };
}

/**
 * The year's intake of every Commission, unfiltered: what the national report mock builds its
 * aggregates from, so both EACC screens count the same reports.
 */
export function mockEaccIntake(fy: number): Intake {
  return intake(fy);
}

export const isEacc = (caller: MockCaller) =>
  caller.tenant === EACC_TENANT &&
  caller.roles.some((role) => (EACC_ROLES as readonly string[]).includes(role));

const readsOwnReport = (caller: MockCaller, slug: string) =>
  caller.tenant === slug &&
  caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));

/** The report a mock id names: which Commission (index) and year. */
function parseReportId(id: string): { index: number; fy: number } | null {
  const match = /^0199c100-0000-7000-8000-(\d{4})(\d{8})$/.exec(id);
  if (!match) return null;
  return { fy: Number(match[1]), index: Number(match[2]) };
}

/** Answers `/v1/eacc/compliance-reports` and `/v1/eacc/compliance-reports/{reportId}`. */
export async function mockEaccIntakeFetch(input: Request): Promise<Response> {
  await mockDelay(300);
  const url = new URL(input.url);
  const caller = mockCallerOf(input);
  if (input.method !== 'GET') return problem(404, 'Not found');
  if (url.pathname === '/v1/eacc/compliance-reports') {
    // The query is validated before the caller, as the controller's pipes run before its guard.
    const fy = Number(url.searchParams.get('fy'));
    const status = url.searchParams.get('status');
    if (
      !Number.isInteger(fy) ||
      fy < FIRST_FINANCIAL_YEAR ||
      (status !== null && !(INTAKE_STATUSES as readonly string[]).includes(status))
    ) {
      return problem(400, 'Query failed validation');
    }
    if (!isEacc(caller)) return problem(403, 'Only EACC analysts and supervisors');
    if (offline) return problem(503, 'The Commission directory could not be reached');
    const outliersOnly = url.searchParams.get('outliersOnly') === 'true';
    const whole = intake(fy);
    return json(200, {
      ...whole,
      commissions: whole.commissions.filter(
        (row) => (!status || row.status === status) && (!outliersOnly || row.outliers.length > 0),
      ),
    });
  }
  const match = /^\/v1\/eacc\/compliance-reports\/([^/]+)$/.exec(url.pathname);
  const id = match?.[1];
  if (!id) return problem(404, 'Not found');
  if (offline) return problem(503, 'The Commission directory could not be reached');
  const parsed = parseReportId(id);
  const report = parsed ? submittedReport(parsed.index, parsed.fy) : null;
  if (!report || !(isEacc(caller) || readsOwnReport(caller, report.commission.slug))) {
    return problem(404, 'Not found');
  }
  return json(200, report);
}

/** The file a mock document id names, for `/api/mock-files/{id}`: null when it is not one. */
export function mockReportingFileTitle(documentId: string): string | null {
  const match = /^0199c([23])00-0000-7000-8000-(\d{4})(\d{8})$/.exec(documentId);
  if (!match) return null;
  const fy = Number(match[2]);
  const commission = COMMISSIONS[Number(match[3])];
  const filing = commission ? filingOf(commission, fy) : null;
  if (!filing) return null;
  const { reference } = filing;
  return match[1] === '2' ? `Form M ${reference}.pdf` : `Receipt ${reference}.pdf`;
}

/**
 * Documents' `GET /v1/documents/{documentId}/download` for the Form M PDFs and receipts: EACC
 * staff get a five-minute link to `/api/mock-files/{id}`; anyone else, and any other document,
 * 404.
 */
export async function mockReportingDocumentsFetch(input: Request): Promise<Response> {
  await mockDelay(200);
  const id = documentDownloadIdOf(input);
  if (!id || !mockReportingFileTitle(id)) {
    return problem(404, 'Not found');
  }
  if (!isEacc(mockCallerOf(input))) return problem(404, 'Not found');
  return json(200, {
    downloadUrl: `/api/mock-files/${id}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    sha256: 'a2a251d951d9518cccc71395e0c6a1f9b4d2e8f7a6c5b4d3e2f1a0b9c8d7e6f5',
  });
}
