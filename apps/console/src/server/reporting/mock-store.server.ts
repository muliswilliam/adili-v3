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

/** One year's report as the workspace mock holds it. */
export interface StoredReport {
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

/** The Public Service Commission's reports, by financial year (start year). */
export const MOCK_PSC = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };

const reports = new Map<number, StoredReport>();
let day = '';
let corruptDocument = false;

/** The mocks' day (`YYYY-MM-DD`); seeds the store on the first read. */
export function mockDay(): string {
  if (day === '') resetReportingMock(env().REPORTING_MOCK_TODAY);
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

/** Stores (or replaces) a year's report. */
export function saveStoredReport(report: StoredReport) {
  mockDay();
  reports.set(report.fy, report);
}

/** Whether the workspace mock answers a document that is not form-m.v1 (contract drift). */
export const mockDocumentCorrupt = () => corruptDocument;

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

/** The day `days` after `day` (`YYYY-MM-DD`). */
export const plusDays = dayAfter;

/** The Nairobi day (`YYYY-MM-DD`) of an instant (from `financial-year.ts`). */
export { nairobiDayOf };

/** 06:00 in Nairobi on `date`, when the scheduled compile runs. */
export const sixAm = (date: string) => `${date}T03:00:00.000Z`;

/**
 * Seeds the store as it stands on `day` (`YYYY-MM-DD`; today in Nairobi by default).
 * `corruptDocument` answers a report whose document is not form-m.v1 (contract drift);
 * `reviewed` has the supervisor mark the year-before's draft reviewed two days ago.
 */
export function resetReportingMock(
  value: string = nairobiToday(),
  options: { corruptDocument?: boolean; reviewed?: boolean } = {},
) {
  day = value;
  corruptDocument = options.corruptDocument ?? false;
  reports.clear();
  const current = financialYearOf(value);
  const last = current - 1;
  if (last < FIRST_FINANCIAL_YEAR) return;
  if (value >= previewFromOf(current)) {
    reports.set(last, submitted(last, `${plusDays(dueDateOf(last), 57)}T11:42:00.000Z`));
    return;
  }
  const yearStart = finalCompileOf(last);
  const compiledOn = plusDays(value, -11) < yearStart ? yearStart : plusDays(value, -11);
  const reviewedOn = plusDays(value, -2);
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
 * The year's report as the commission-admin's confirmation leaves it at `submittedAt`: reference
 * allocated, reviewed the day before, Part I, Part B and Part III filled, late when its Nairobi
 * day is after 31 July. The seed (April to June) and `submitMockReport` both build it here.
 */
function submitted(fy: number, submittedAt: string): StoredReport {
  const filedOn = nairobiDayOf(submittedAt);
  return {
    fy,
    status: 'submitted',
    compiledAt: sixAm(finalCompileOf(fy)),
    compileStartedAt: null,
    submittedAt,
    late: filedOn > dueDateOf(fy),
    reference: `RPT-PSC-${String(fy + 1)}-0000001-K`,
    reviewedBy: SUPERVISOR_OFFICER,
    confirmedBy: ADMIN_OFFICER,
    document: confirmed(fullDocument(fy), plusDays(filedOn, -1), filedOn),
  };
}

/** Submits the year's report on `on` at 11:20 in Nairobi, as the commission-admin's confirmation would. */
export function submitMockReport(fy: number, on: string) {
  saveStoredReport(submitted(fy, `${on}T08:20:00.000Z`));
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
