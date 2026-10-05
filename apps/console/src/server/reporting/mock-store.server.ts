import type { FormMV1 } from '@adili/forms';

import {
  dayAfter,
  dueDateOf,
  finalCompileOf,
  FIRST_FINANCIAL_YEAR,
  financialYearOf,
  nairobiDayOf,
  nairobiToday,
  previewFromOf,
} from '../../components/form-m/financial-year';
import { env } from '../env.server';
import type { Officer, ReportStatus } from './types';

/**
 * The reporting mocks' shared state: the Public Service Commission's Form M reports by financial
 * year, the mocks' day and the seed of both. The Form M workspace mock (`mock.server.ts`) changes
 * the reports; the EACC intake mock (`eacc-mock.server.ts`) reads them, so a report submitted in
 * the workspace reaches EACC. Neither mock imports the other, only this module, which seeds
 * itself on its first read (from REPORTING_MOCK_TODAY, else today in Nairobi) whichever mock or
 * route reads it first.
 */

type Signatory = FormMV1['partIII']['compiledBy'];
type Complaint = FormMV1['partII']['complaints']['items'][number];

/** What the Commission's officers added to the compiled draft: kept across recompiles. */
export interface Edits {
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

/** One year's report as the workspace mock holds it. */
export interface StoredReport {
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
  /** The document as compiled, before the officers' edits (`storedDocument` lays them over it). */
  compiled: FormMV1 | null;
  edits: Edits;
  /** Once submitted: when the documents service issues the PDF and the receipt. */
  issueAt: number | null;
  formMDocumentId: string | null;
  receiptDocumentId: string | null;
}

/** The Public Service Commission's reports, by financial year (start year). */
export const MOCK_PSC = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };

const reports = new Map<number, StoredReport>();
let day = '';
let corruptDocument = false;

/** The mocks' day (`YYYY-MM-DD`); seeds the store on the first read. */
export function mockDay(): string {
  if (day === '') resetReportingStore(env().REPORTING_MOCK_TODAY);
  return day;
}

/** The year's report, if it has one. */
export function storedReport(fy: number): StoredReport | undefined {
  mockDay();
  return reports.get(fy);
}

/** The years with a report. */
export function storedYears(): number[] {
  mockDay();
  return [...reports.keys()];
}

/** The reports held, every year. */
export function storedReports(): StoredReport[] {
  mockDay();
  return [...reports.values()];
}

/** Stores (or replaces) a year's report. */
export function saveStoredReport(report: StoredReport) {
  mockDay();
  reports.set(report.fy, report);
}

/** Whether the workspace mock answers a document that is not form-m.v1 (contract drift). */
export const mockDocumentCorrupt = () => corruptDocument;

const SUPERVISOR_OFFICER: Officer = { subject: 'mock-supervisor', name: 'Samuel Njoroge' };
const ADMIN_OFFICER: Officer = { subject: 'mock-commission-admin', name: 'Joyce Wanjiku' };
const REVIEWER_DESIGNATION = 'Deputy Director, HRM';

export const noEdits = (): Edits => ({ remarks: new Map(), compiledBy: null, confirmedBy: null });

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

/** The ids of a year's Form M PDF and receipt in the workspace mock's documents. */
const formMDocumentIdOf = (fy: number) => `0199c000-0000-7000-8000-00010000${String(fy)}`;
const receiptDocumentIdOf = (fy: number) => `0199c000-0000-7000-8000-00020000${String(fy)}`;

/**
 * Issues the report's Form M PDF and receipt once `issueAt` has passed (their ids stay null
 * until then). Every mock calls it before reading the ids, so whichever reads them first issues
 * them, and the workspace and EACC offer the same files at the same time.
 */
export function issueDueDocuments(stored: StoredReport) {
  if (stored.issueAt === null || Date.now() < stored.issueAt) return;
  stored.issueAt = null;
  stored.formMDocumentId = formMDocumentIdOf(stored.fy);
  stored.receiptDocumentId = receiptDocumentIdOf(stored.fy);
}

/** The file name of a Form M PDF or receipt issued for a stored report; else null. */
export function storedFileTitle(id: string): string | null {
  for (const stored of storedReports()) {
    if (!stored.reference) continue;
    issueDueDocuments(stored);
    if (id === stored.formMDocumentId) return `Form M ${stored.reference}.pdf`;
    if (id === stored.receiptDocumentId) return `Receipt ${stored.reference}.pdf`;
  }
  return null;
}

/** The compiled document with the officers' edits laid over it, as the service assembles it. */
export function storedDocument(stored: StoredReport): FormMV1 {
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

/** The day `days` after `day` (`YYYY-MM-DD`). */
export const plusDays = dayAfter;

/** The Nairobi day (`YYYY-MM-DD`) of an instant (from `financial-year.ts`). */
export { nairobiDayOf };

/** 06:00 in Nairobi on `date`, when the scheduled compile runs. */
export const sixAm = (date: string) => `${date}T03:00:00.000Z`;

export interface ReportingStoreSeed {
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

/** Seeds the store as it stands on `value` (`YYYY-MM-DD`; today in Nairobi by default). */
export function resetReportingStore(
  value: string = nairobiToday(),
  options: ReportingStoreSeed = {},
) {
  day = value;
  corruptDocument = options.corruptDocument ?? false;
  reports.clear();
  const current = financialYearOf(value);
  const last = current - 1;
  if (last < FIRST_FINANCIAL_YEAR) return;
  const submitted = options.submitted ?? (value >= previewFromOf(current) ? 'late' : undefined);
  if (submitted) {
    const submittedOn = submitted === 'late' ? plusDays(dueDateOf(last), 57) : value;
    reports.set(
      last,
      submittedReport(last, `${submittedOn}T11:42:00.000Z`, {
        federated: submitted === 'federated',
        issuing: options.issuing,
      }),
    );
    return;
  }
  const yearStart = finalCompileOf(last);
  const compiledOn = plusDays(value, -11) < yearStart ? yearStart : plusDays(value, -11);
  const edits = noEdits();
  if (options.reviewed) {
    edits.compiledBy = {
      name: SUPERVISOR_OFFICER.name,
      designation: REVIEWER_DESIGNATION,
      date: plusDays(value, -2),
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
 * The year's report as the commission-admin's confirmation leaves it at `submittedAt` (or the
 * Commission's own system, `federated`, with no confirming officer): reference allocated,
 * reviewed the day before, Part I, Part B and Part III filled, late when its Nairobi day is after
 * 31 July, the PDF and receipt issued unless `issuing`. The seed and `submitMockReport` both
 * build it here.
 */
function submittedReport(
  fy: number,
  submittedAt: string,
  { federated = false, issuing = false }: { federated?: boolean; issuing?: boolean } = {},
): StoredReport {
  const filedOn = nairobiDayOf(submittedAt);
  return {
    fy,
    status: 'submitted',
    source: federated ? 'federated' : 'hosted',
    compiledAt: sixAm(finalCompileOf(fy)),
    compileStartedAt: null,
    submittedAt,
    late: filedOn > dueDateOf(fy),
    reference: `RPT-PSC-${String(fy + 1)}-0000001-K`,
    reviewedBy: SUPERVISOR_OFFICER,
    confirmedBy: federated ? null : ADMIN_OFFICER,
    compiled: fullDocument(fy),
    edits: filled({
      ...noEdits(),
      compiledBy: {
        name: SUPERVISOR_OFFICER.name,
        designation: REVIEWER_DESIGNATION,
        date: plusDays(filedOn, -1),
      },
      confirmedBy: { name: ADMIN_OFFICER.name, designation: 'Secretary/CEO', date: filedOn },
    }),
    issueAt: issuing ? Number.POSITIVE_INFINITY : null,
    formMDocumentId: issuing ? null : formMDocumentIdOf(fy),
    receiptDocumentId: issuing ? null : receiptDocumentIdOf(fy),
  };
}

/** Submits the year's report on `on` at 11:20 in Nairobi, as the commission-admin's confirmation would. */
export function submitMockReport(fy: number, on: string) {
  saveStoredReport(submittedReport(fy, `${on}T08:20:00.000Z`));
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
    commissionName: MOCK_PSC.name,
    issuerCode: MOCK_PSC.issuerCode,
    contactDetails: '',
    physicalAddress: 'Commission House, Harambee Avenue, Nairobi',
    emailAddress: '',
    period: { from: `${String(fy)}-07-01`, to: `${String(fy + 1)}-06-30`, financialYearStart: fy },
  };
}

/** The year's draft as the scheduled compile assembles it (the prototype's PSC fixture). */
export function fullDocument(fy: number): FormMV1 {
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
export function previewDocument(fy: number): FormMV1 {
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
