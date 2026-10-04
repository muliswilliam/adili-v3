/**
 * In-memory stand-in for the review service's case and clarification endpoints (review.yaml)
 * (the clarification letter's download included), used when REVIEW_MOCK is set until the review
 * service implements spec 07a (#174). One store for every caller. Dated relative to when the
 * store was seeded:
 *
 * - Case `mine` (DCI-TSC-2026-0003418-P, version 2 of 2), held by whoever is signed in (the
 *   token's `sub` and `name`), window open, Peter Mwangi held it before: `issued` (8 days ago),
 *   `late` (responded 3 days late, two documents), `onTime` (responded), `overdue`, `resolved`,
 *   `withdrawn` (letter revoked). Five flags (one reviewed), two notes, a timeline.
 * - Case `windowClosed`, also held by the caller, past its six-month window: `closedWindow`
 *   (responded), so Raise follow-up is disabled.
 * - Case `peters`, held by Peter Mwangi (Mercy Wambui held it before): `petersOverdue`,
 *   read-only for everyone else.
 * - Case `unassigned`, a first declaration on Adili, filed late, nobody holds it.
 * - Case `contested`, unassigned until someone claims it: Mercy Wambui claims it a moment
 *   before, so the claim is a 409 and she holds it after.
 * - Case `unavailable`, held by the caller: the declarations service does not answer, so the
 *   case detail is a 502 carrying the case without its document.
 *
 * - Case `mine` also has `draft`, saved with one item, which the composer continues.
 *
 * - Spec 08's cases and their determinations (`ready` to `bulkClosure`, and a proposal on
 *   `peters`): see the notes on `MOCK_CASE_IDS` and `MOCK_DETERMINATION_IDS`.
 *
 * The version comparison (spec 07a #167) of every case on the mock declaration comes from
 * `compare-mock.server.ts`; the first declarations (`unassigned`, `contested`) answer 409.
 *
 * As review.yaml has it: claim an unassigned case (409 `case-already-assigned` otherwise),
 * release your own (403 otherwise), reassign or unassign as a supervisor (the mock does not
 * check roles), add a note (1-2,000 characters), mark a flag reviewed once (note 1-1,000
 * characters; 409 after). Each is a timeline entry.
 *
 * The composer's endpoints (spec 07a #170): create a draft on a case (Idempotency-Key replays
 * the first answer), update it while it is a draft (else 409), and issue it (Idempotency-Key
 * required and replayed): 400 without items, 409 `clarification-window-closed` past the case's
 * window (with `windowEndsAt`), else a CLR reference, due in 30 days, and a letter `pending`
 * for `MOCK_LETTER_DELAY_MS`, then `issued`.
 *
 * Only the case's assignee may act on its clarifications; anyone else gets 403: resolve an
 * issued or responded clarification (note 1-2,000 characters; else 409), withdraw an issued
 * one, overdue included (reason 1-1,000 characters; the letter is revoked; else 409), or raise
 * a follow-up (a draft with `followUpOf`; the contract defines no 409 for it). The contract
 * pre-fills a follow-up with the unresolved items; items carry no resolved state, so the mock
 * copies them all. Resolving the last outstanding clarification makes the case ready for
 * determination. Downloads point at
 * `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`). The copilot endpoints (spec 07c),
 * and the declaration document and flags of case `mine`, come from `copilot-mock.server.ts`.
 *
 * A Commission's AI status (`GET /v1/commissions/{slug}/ai-status`, spec 07c) comes from the
 * ai-gateway mock's store, as the service proxies the gateway; only commission admins read it.
 */
import { randomUUID } from 'node:crypto';

import { COMMISSION_ADMIN, REVIEWER } from '@adili/roles';
import { addDays } from '@adili/ui';

import createClient from 'openapi-fetch';

import { isOutstanding } from '../../clarification/labels';
import { mockTenantAiStatus } from '../ai-gateway/mock.server';
import { type Env, envSchema } from '../env.server';
import { isRecord, json, mockCallerOf, problem, readJson, unsignedMockToken } from '../mock-http';
import {
  actionApprovals,
  actionsRoute,
  mockActionFileTitle,
  resetActionsMock,
} from './actions-mock.server';
import type { paths } from './api.gen';
import { mockComparison } from './compare-mock.server';
import {
  copilotRoute,
  declarationOf,
  type MockDeclarant,
  MOCK_DECLARATION,
  MOCK_FLAG_IDS,
  mockDraftLanguage,
  mockFlags,
  resetCopilotMock,
} from './copilot-mock.server';
import { approvalsRoute, resetApprovalsMock } from './approvals-mock.server';
import {
  determinationApprovals,
  determinationsOf,
  determinationsRoute,
  mockDecisionLetterTitle,
  resetDeterminationsMock,
} from './determinations-mock.server';
import { reviewClock } from './mock-clock.server';
import { MOCK_CALLER, type MockCases } from './mock-parts.server';
import type {
  Assignee,
  CaseDetail,
  CaseListItem,
  Clarification,
  Flag,
  Note,
  TimelineEntry,
} from './types';

export const MOCK_CASE_IDS = {
  mine: 'ca5e0000-0000-4000-8000-000000000001',
  windowClosed: 'ca5e0000-0000-4000-8000-000000000002',
  peters: 'ca5e0000-0000-4000-8000-000000000003',
  unassigned: 'ca5e0000-0000-4000-8000-000000000004',
  contested: 'ca5e0000-0000-4000-8000-000000000005',
  unavailable: 'ca5e0000-0000-4000-8000-000000000006',
  /** Spec 08: held by the caller, ready for determination, nothing proposed yet. */
  ready: 'ca5e0000-0000-4000-8000-000000000007',
  /** Held by the caller; Lucy Wambui returned the caller's proposal with a reason. */
  returned: 'ca5e0000-0000-4000-8000-000000000008',
  /** Held by the caller; Lucy Wambui approved the caller's proposal (CMP, letter). */
  determined: 'ca5e0000-0000-4000-8000-000000000009',
  /** Held by Mercy Wambui, who proposed non-compliant 35 days ago; reassigned to the caller. */
  awaitingOld: 'ca5e0000-0000-4000-8000-00000000000a',
  /** Held by Mercy Wambui after the caller: the caller is a reviewer of record. */
  awaitingOfRecord: 'ca5e0000-0000-4000-8000-00000000000b',
  /** Held by Peter Mwangi, who proposed further action 3 days ago. */
  awaitingFurther: 'ca5e0000-0000-4000-8000-00000000000c',
  /**
   * Low band, no flags, nothing open, nobody holds it: once its window closed (8 days ago) the
   * system proposed "no issues" (a bulk closure, never in the inbox, #202).
   */
  bulkClosure: 'ca5e0000-0000-4000-8000-00000000000d',
} as const;

/** The seeded determinations (spec 08). */
export const MOCK_DETERMINATION_IDS = {
  /** Peter Mwangi proposed compliant on his case 9 days ago. */
  peters: 'de7e0000-0000-4000-8000-000000000001',
  awaitingOld: 'de7e0000-0000-4000-8000-000000000002',
  awaitingOfRecord: 'de7e0000-0000-4000-8000-000000000003',
  awaitingFurther: 'de7e0000-0000-4000-8000-000000000004',
  /** The system's "no issues" proposal: a bulk closure, never in the inbox (#202). */
  bulkClosure: 'de7e0000-0000-4000-8000-000000000007',
  returned: 'de7e0000-0000-4000-8000-000000000005',
  determined: 'de7e0000-0000-4000-8000-000000000006',
} as const;

/** The Draft with AI job behind the AI-assisted parts of the issued clarification. */
export const MOCK_DRAFT_JOB_ID = '0199a000-0000-7000-8000-00000000d0b1';

export const MOCK_CLARIFICATION_IDS = {
  issued: 'c1a70000-0000-4000-8000-000000000101',
  late: 'c1a70000-0000-4000-8000-000000000102',
  onTime: 'c1a70000-0000-4000-8000-000000000103',
  overdue: 'c1a70000-0000-4000-8000-000000000104',
  resolved: 'c1a70000-0000-4000-8000-000000000105',
  withdrawn: 'c1a70000-0000-4000-8000-000000000106',
  closedWindow: 'c1a70000-0000-4000-8000-000000000107',
  petersOverdue: 'c1a70000-0000-4000-8000-000000000108',
  draft: 'c1a70000-0000-4000-8000-000000000109',
} as const;

/** How long an issued clarification's letter stays `pending` before it reads `issued`. */
export const MOCK_LETTER_DELAY_MS = 4_000;

const REQUIREMENTS: readonly Item['requirement'][] = [
  'provide-omitted',
  'explain-discrepancy',
  'correct',
];

/** Stands for "whoever is signed in" in the seeded assignee, notes and timeline. */
const CALLER = '(caller)';
type Officer = Assignee | typeof CALLER;

export const MOCK_OFFICERS = {
  peter: { subject: 'f7a0c1de-0000-4000-8000-000000000009', name: 'Peter Mwangi' },
  mercy: { subject: 'f7a0c1de-0000-4000-8000-000000000010', name: 'Mercy Wambui' },
  /** Supervisors (spec 08): they approve, return and are reassigned approvals. */
  lucy: { subject: 'f7a0c1de-0000-4000-8000-000000000011', name: 'Lucy Wambui' },
  joseph: { subject: 'f7a0c1de-0000-4000-8000-000000000012', name: 'Joseph Mutua' },
} as const satisfies Record<string, Assignee>;
const PETER: Assignee = MOCK_OFFICERS.peter;
const MERCY: Assignee = MOCK_OFFICERS.mercy;
const LUCY: Assignee = MOCK_OFFICERS.lucy;

type Item = Clarification['items'][number];

/** The declarants of the cases that reuse the mock declaration with their own name. */
const DECLARANTS = {
  grace: { firstName: 'Grace', surname: 'Atieno' },
  mary: { firstName: 'Mary', surname: 'Achieng' },
  gitau: { firstName: 'Mary', otherNames: 'Njambi', surname: 'Gitau' },
  wekesa: { firstName: 'Brian', surname: 'Wekesa' },
  mutiso: { firstName: 'Patrick', otherNames: 'Mutiso', surname: 'Kyalo' },
  onyango: { firstName: 'Esther', otherNames: 'Moraa', surname: 'Onyango' },
  wafula: { firstName: 'Ruth', otherNames: 'Nekesa', surname: 'Wafula' },
  kamau: { firstName: 'Joyce', otherNames: 'Wairimu', surname: 'Kamau' },
  rono: { firstName: 'Kennedy', otherNames: 'Kiprop', surname: 'Rono' },
  njeri: { firstName: 'Agnes', surname: 'Njeri' },
} as const satisfies Record<string, MockDeclarant>;

const PLOT: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: '1e2d3c4b-0000-4000-8000-000000000001',
  requirement: 'explain-discrepancy',
  text: 'The value of this plot is 150% higher than in your 2024 declaration, but no acquisition or improvement is recorded. Explain the change.',
  label: 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy',
  aiJobId: null,
  aiLanguage: null,
};
const SACCO: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: null,
  requirement: 'provide-omitted',
  text: 'Your payslip shows a monthly deduction to Mwalimu National SACCO, but no SACCO loan is declared. Provide the loan details.',
  label: 'Liabilities · John Kennedy',
  aiJobId: null,
  aiLanguage: null,
};

interface StoredNote {
  id: string;
  author: Officer;
  text: string;
  at: string;
}

interface StoredEntry extends Omit<TimelineEntry, 'actor'> {
  actor: Officer | null;
}

interface StoredCase {
  item: CaseListItem;
  /** CALLER, a fixed reviewer, or nobody. */
  holder: Officer | null;
  /** Everyone who held the case, first first. */
  history: Officer[];
  flags: Flag[];
  notes: StoredNote[];
  timeline: StoredEntry[];
  document: Record<string, unknown> | null;
  versions: CaseDetail['versions'];
  /** The declarations service does not answer for this case: the detail is a 502. */
  declarationsDown: boolean;
  /** Someone claims the case just before the caller does (a claim race). */
  claimedFirstBy: Assignee | null;
}

const cases = new Map<string, StoredCase>();
const clarifications = new Map<string, Clarification>();
/** When each letter issued here stops being `pending`. */
const letterReadyAt = new Map<string, number>();
/** Answers already given, by method, path and Idempotency-Key. */
const replays = new Map<string, { status: number; body: unknown }>();

function at(now: number, days: number): string {
  return addDays(new Date(now).toISOString(), days);
}

/** `days` from `now`, `minutes` later in the day, so a seeded timeline reads like a real one. */
function atMinutes(now: number, days: number, minutes: number): string {
  return new Date(Date.parse(at(now, days)) + minutes * 60_000).toISOString();
}

function caseItem(
  id: string,
  reference: string,
  declarantName: string,
  now: number,
  windowDays: number,
): CaseListItem {
  return {
    id,
    reference,
    declarantName,
    personnelFileNumber: `TSC/${reference.slice(-9, -2)}`,
    type: 'biennial',
    cycleYear: 2026,
    receivedAt: at(now, windowDays - 182),
    windowEndsAt: at(now, windowDays),
    late: false,
    band: 'medium',
    status: 'awaiting-clarification',
    assignee: null,
    openFlags: 0,
    registryUnavailable: false,
    clarification: { open: 0, status: null, dueAt: null },
    currentVersion: 1,
  };
}

function storedCase(item: CaseListItem, overrides: Partial<StoredCase> = {}): StoredCase {
  return {
    item,
    holder: null,
    history: [],
    flags: [],
    notes: [],
    timeline: [],
    document: null,
    versions: [
      {
        versionId: item.id,
        version: 1,
        submittedAt: item.receivedAt,
        late: item.late,
        amendment: false,
        firstOnAdili: (overrides.flags ?? []).some((flag) => flag.ruleId === 'no-previous-version'),
      },
    ],
    declarationsDown: false,
    claimedFirstBy: null,
    ...overrides,
  };
}

function entry(
  kind: string,
  actor: Officer | null,
  when: string,
  summary: string,
  ref: string | null = null,
): StoredEntry {
  return { id: randomUUID(), kind, actor, at: when, summary, ref };
}

function reference(n: number): string {
  return `CLR-TSC-2026-${String(n).padStart(7, '0')}-${'KMPRTX'[n % 6] ?? 'K'}`;
}

function clarification(
  id: string,
  caseId: string,
  n: number,
  items: Item[],
  issuedDaysAgo: number,
  now: number,
  overrides: Partial<Clarification> = {},
): Clarification {
  const issuedAt = at(now, -issuedDaysAgo);
  return {
    id,
    caseId,
    reference: reference(n),
    status: 'issued',
    items,
    issuedAt,
    dueAt: at(Date.parse(issuedAt), 30),
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: {
      documentId: id.replace('c1a7', 'd0c0'),
      verificationId: `V-${String(n).padStart(4, '0')}-7K2Q`,
      status: 'issued',
    },
    followUpOf: null,
    opening: null,
    openingAiJobId: null,
    openingAiLanguage: null,
    language: 'en',
    response: null,
    ...overrides,
  };
}

function response(
  items: Item[],
  submittedAt: string,
  files: string[] = [],
): NonNullable<Clarification['response']> {
  return {
    submittedAt,
    items: items.map((_, index) => ({
      index,
      text:
        index === 0
          ? 'I built a three-bedroom house on the plot between 2024 and 2026 with a SACCO loan. The bill of quantities and the loan statement are attached.'
          : 'The loan is from Mwalimu National SACCO, taken in March 2025. The balance on the statement date is on the attached statement.',
      attachments:
        index === 0
          ? files.map((fileName, k) => ({
              uploadId: `a77a0000-0000-4000-8000-00000000000${String(k + 1)}`,
              fileName,
              sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
            }))
          : [],
    })),
  };
}

const kes = (shillings: number) => ({ kesCents: shillings * 100 });

/**
 * A short `declaration.v1` document for one officer with no household: a salary, a plot and a
 * bank account (one held abroad when `abroad`).
 */
function officerDeclaration(
  name: { surname: string; firstName: string; otherNames?: string },
  employer: string,
  designation: string,
  ids: string[],
): Record<string, unknown> {
  const [salary = randomUUID(), land = randomUUID(), bank = randomUUID()] = ids;
  const period = { from: '2024-01-01', to: '2025-12-31' };
  return {
    schemaVersion: 'declaration.v1',
    type: 'biennial',
    statementDate: '2025-12-31',
    incomePeriod: { ...period, fromSource: 'assumed' },
    officer: {
      name,
      birth: { date: '1978-06-02', place: 'Kisumu' },
      maritalStatus: 'single',
      address: { postal: 'P.O. Box 30095-00100, Nairobi', physical: 'South B, Nairobi' },
      employment: { designation, employer, nature: 'permanent', responsibleCommission: 'tsc' },
    },
    spouses: { none: true, items: [] },
    children: { none: true, items: [] },
    statements: [
      {
        personKey: 'officer',
        personName: name,
        statementDate: '2025-12-31',
        incomePeriod: period,
        incomeNil: false,
        income: [
          {
            id: salary,
            type: 'salary-emoluments',
            description: `Salary from ${employer}`,
            amount: kes(3_120_000),
            location: { inKenya: true, county: '047' },
            change: { changed: false },
          },
        ],
        assetsNil: false,
        assets: [
          {
            id: land,
            type: 'land',
            description: 'Plot Nyeri/Mukurwe-ini/1187',
            value: kes(2_400_000),
            location: { inKenya: true, county: '019', detail: 'Mukurwe-ini' },
            joint: { isJoint: false },
            change: { changed: false },
          },
          {
            id: bank,
            type: 'bank-account',
            description: 'Stanbic Bank savings account ending 0932',
            value: kes(410_000),
            location: { inKenya: false, country: 'UG', detail: 'Kampala' },
            joint: { isJoint: false },
            change: { changed: false },
          },
        ],
        liabilitiesNil: true,
        liabilities: [],
      },
    ],
    otherInformation: {
      materialChanges: [],
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: '',
    },
    attestation: {
      text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
      declaredAt: '2026-03-28T07:42:00.000Z',
    },
  };
}

/** The rules' flags on a first declaration filed late with an asset abroad. */
function firstDeclarationFlags(versionId: string, bankId: string, daysLate: number): Flag[] {
  const base = {
    versionId,
    closedReason: null,
    reviewed: null,
    recomputed: false,
  } as const;
  return [
    {
      ...base,
      id: randomUUID(),
      ruleId: 'late-filing',
      severity: 'low',
      title: 'Submitted after the due date',
      indicator: 'This declaration was submitted after it was due.',
      evidence: { dueDate: '2025-12-31', submittedOn: '2026-03-28', daysLate },
      itemRefs: [],
    },
    {
      ...base,
      id: randomUUID(),
      ruleId: 'no-previous-version',
      severity: 'info',
      title: 'First declaration on Adili',
      indicator:
        'There is no earlier declaration on Adili to compare with, so changes since the last one cannot be checked.',
      evidence: {},
      itemRefs: [],
    },
    {
      ...base,
      id: randomUUID(),
      ruleId: 'foreign-holdings',
      severity: 'info',
      title: 'Income or assets outside Kenya',
      indicator:
        'The declaration lists income or assets outside Kenya, which the form asks to be declared (First Schedule, note 13).',
      evidence: { items: 1, countries: ['UG'] },
      itemRefs: [{ personKey: 'officer', itemId: bankId, sectionKey: 'statement:officer' }],
    },
  ];
}

/** A review client answered by this mock, calling as `subject` (tests). */
export function mockReviewClient(subject: string, name: string, roles?: readonly string[]) {
  return createClient<paths>({
    baseUrl: 'http://review.test',
    headers: { authorization: `Bearer ${mockToken(subject, name, roles)}` },
    fetch: mockReviewFetch,
  });
}

/** Seeds the fixtures with "now" at `now` (tests pass a fixed time). */
export function resetReviewMock(
  now: number = Date.now(),
  { copilot = 'ready' }: { copilot?: Env['REVIEW_MOCK_COPILOT'] } = {},
) {
  reviewClock.startAt(now);
  resetActionsMock(now);
  cases.clear();
  clarifications.clear();
  letterReadyAt.clear();
  replays.clear();
  const C = MOCK_CASE_IDS;
  const K = MOCK_CLARIFICATION_IDS;

  // Case `mine`: amended once; Peter held it, released it, and the caller claimed it.
  const mineItem: CaseListItem = {
    ...caseItem(C.mine, 'DCI-TSC-2026-0003418-P', 'John Kennedy Otieno', now, 30),
    late: true,
    band: 'high',
    currentVersion: 2,
  };
  const received = Date.parse(mineItem.receivedAt);
  const mineFlags = mockFlags(C.mine).map((flag) =>
    flag.id === MOCK_FLAG_IDS.late && flag.reviewed
      ? { ...flag, reviewed: { ...flag.reviewed, at: atMinutes(received, 4, -95) } }
      : flag,
  );
  const peterNote = atMinutes(received, 3, 66);
  const callerNote = atMinutes(now, -3, 259);
  cases.set(
    C.mine,
    storedCase(mineItem, {
      holder: CALLER,
      history: [PETER, CALLER],
      flags: mineFlags,
      document: MOCK_DECLARATION,
      versions: [
        {
          versionId: 'fe150000-0000-4000-8000-000000000001',
          version: 1,
          submittedAt: mineItem.receivedAt,
          late: true,
          amendment: false,
          firstOnAdili: false,
        },
        {
          versionId: C.mine,
          version: 2,
          submittedAt: atMinutes(now, -15, 182),
          late: false,
          amendment: true,
          firstOnAdili: false,
        },
      ],
      notes: [
        {
          id: randomUUID(),
          author: PETER,
          at: peterNote,
          text: 'Started review. The late filing is explained by the HR letter (medical leave). He told HR he would file an amended version with a new valuation for the Milimani house.',
        },
        {
          id: randomUUID(),
          author: CALLER,
          at: callerNote,
          text: 'The Manyatta plot and the SACCO deduction need a clarification. Holding the rest until the response comes back.',
        },
      ],
      timeline: [
        entry('case-created', null, mineItem.receivedAt, 'Case created from version 1'),
        entry('assigned', PETER, atMinutes(received, 2, -131), 'Claimed', PETER.subject),
        entry('note-added', PETER, peterNote, 'Internal note added'),
        entry(
          'flag-reviewed',
          PETER,
          atMinutes(received, 4, -95),
          'Flag reviewed: Filed after the due date',
          MOCK_FLAG_IDS.late,
        ),
        entry('assigned', PETER, atMinutes(received, 5, 212), 'Released to the queue'),
        entry('assigned', CALLER, atMinutes(received, 20, -119), 'Claimed', CALLER),
        entry(
          'version-processed',
          null,
          atMinutes(now, -15, 197),
          'Version 2 processed: flags recomputed, reviewed flags kept',
        ),
        entry('note-added', CALLER, callerNote, 'Internal note added'),
      ],
    }),
  );
  cases.set(
    C.windowClosed,
    storedCase(caseItem(C.windowClosed, 'DCB-TSC-2026-0001907-M', 'Grace Atieno', now, -5), {
      holder: CALLER,
      history: [CALLER],
      flags: mockFlags(C.windowClosed),
      document: declarationOf(DECLARANTS.grace),
    }),
  );
  cases.set(
    C.peters,
    storedCase(caseItem(C.peters, 'DCB-TSC-2026-0002210-X', 'Mary Achieng', now, 40), {
      holder: PETER,
      history: [MERCY, PETER],
      flags: mockFlags(C.peters),
      document: declarationOf(DECLARANTS.mary),
    }),
  );

  const firstIds = [randomUUID(), randomUUID(), randomUUID()];
  const unassigned: CaseListItem = {
    ...caseItem(C.unassigned, 'DCB-TSC-2026-0003318-7', 'Kiprono Chebet', now, 2),
    status: 'unassigned',
    late: true,
  };
  cases.set(
    C.unassigned,
    storedCase(unassigned, {
      flags: firstDeclarationFlags(C.unassigned, firstIds[2] ?? '', 87),
      document: officerDeclaration(
        { surname: 'Chebet', firstName: 'Kiprono' },
        'State Department for Public Works',
        'Senior Officer',
        firstIds,
      ),
      timeline: [entry('case-created', null, unassigned.receivedAt, 'Case created from version 1')],
    }),
  );
  const contestedIds = [randomUUID(), randomUUID(), randomUUID()];
  const contested: CaseListItem = {
    ...caseItem(C.contested, 'DCB-TSC-2026-0004390-H', 'Kevin Omondi Owino', now, 60),
    status: 'unassigned',
    band: 'high',
  };
  cases.set(
    C.contested,
    storedCase(contested, {
      flags: firstDeclarationFlags(C.contested, contestedIds[2] ?? '', 12),
      document: officerDeclaration(
        { surname: 'Owino', firstName: 'Kevin', otherNames: 'Omondi' },
        'Kenya Medical Supplies Authority',
        'Procurement Officer',
        contestedIds,
      ),
      claimedFirstBy: MERCY,
      timeline: [entry('case-created', null, contested.receivedAt, 'Case created from version 1')],
    }),
  );
  cases.set(
    C.unavailable,
    storedCase(
      {
        ...caseItem(C.unavailable, 'DCB-TSC-2026-0000988-4', 'Mary Njambi Gitau', now, 90),
        status: 'assigned',
      },
      {
        holder: CALLER,
        history: [CALLER],
        flags: mockFlags(C.unavailable),
        document: declarationOf(DECLARANTS.gitau),
        declarationsDown: true,
      },
    ),
  );

  seedDeterminationCases(now);

  const seed = (value: Clarification) => clarifications.set(value.id, value);
  // Drafted with AI (the plot's item and the opening), then edited and issued (ADR-007 label).
  seed(
    clarification(
      K.issued,
      C.mine,
      42,
      [{ ...PLOT, aiJobId: MOCK_DRAFT_JOB_ID, aiLanguage: 'en' }, SACCO],
      8,
      now,
      {
        opening:
          'Thank you for your biennial declaration. The points below relate to changes since your previous declaration.',
        openingAiJobId: MOCK_DRAFT_JOB_ID,
        openingAiLanguage: 'en',
      },
    ),
  );
  const late = clarification(K.late, C.mine, 17, [PLOT, SACCO], 40, now);
  const lateAt = at(Date.parse(late.dueAt ?? ''), 3);
  seed({
    ...late,
    status: 'responded',
    respondedAt: lateAt,
    responseLate: true,
    response: response([PLOT, SACCO], lateAt, ['bill-of-quantities.pdf', 'loan-statement.pdf']),
  });
  const onTimeAt = at(now, -2);
  seed({
    ...clarification(K.onTime, C.mine, 12, [PLOT, SACCO], 12, now),
    status: 'responded',
    respondedAt: onTimeAt,
    response: response([PLOT, SACCO], onTimeAt),
  });
  seed(clarification(K.overdue, C.mine, 21, [SACCO], 33, now, { status: 'overdue' }));
  seed({
    ...clarification(K.resolved, C.mine, 9, [SACCO], 60, now),
    status: 'resolved',
    respondedAt: at(now, -50),
    response: response([SACCO], at(now, -50)),
    resolvedAt: at(now, -44),
    resolutionNote: 'Loan statement matches the payslip deduction.',
  });
  const withdrawn = clarification(K.withdrawn, C.mine, 30, [PLOT], 15, now);
  seed({
    ...withdrawn,
    status: 'withdrawn',
    letter: withdrawn.letter ? { ...withdrawn.letter, status: 'revoked' } : null,
  });
  seed({
    ...clarification(K.closedWindow, C.windowClosed, 5, [SACCO], 25, now),
    status: 'responded',
    respondedAt: at(now, -3),
    response: response([SACCO], at(now, -3)),
  });
  seed(clarification(K.petersOverdue, C.peters, 3, [PLOT], 35, now, { status: 'overdue' }));
  seed(draftOf(K.draft, C.mine, [PLOT], null));
  for (const stored of cases.values()) {
    const issued = ofCase(stored.item.id).filter((each) => each.issuedAt && each.reference);
    for (const each of issued) {
      stored.timeline.push(
        entry(
          'clarification-issued',
          stored.holder,
          each.issuedAt ?? '',
          `Clarification ${each.reference ?? ''} issued`,
          each.id,
        ),
      );
    }
    stored.timeline.sort((a, b) => a.at.localeCompare(b.at));
    refreshCase(stored);
  }
  resetCopilotMock(
    now,
    [
      { caseId: C.mine, state: 'ready' },
      {
        caseId: C.windowClosed,
        state: 'pending',
        readyAfterMs: 8_000,
        declarant: DECLARANTS.grace,
      },
      { caseId: C.peters, state: 'ready', declarant: DECLARANTS.mary },
      { caseId: C.unassigned, state: 'not-enabled' },
      { caseId: C.contested, state: 'not-enabled' },
      { caseId: C.unavailable, state: 'ready', declarant: DECLARANTS.gitau },
      ...DETERMINATION_CASES.map(({ key, declarant }) => ({
        caseId: C[key],
        state: 'ready' as const,
        declarant,
      })),
    ],
    { notEnabled: copilot === 'not-enabled' },
  );
}

/** The spec 08 cases (see `MOCK_CASE_IDS`), each with its declarant, holder and who held it. */
const DETERMINATION_CASES = [
  {
    key: 'ready',
    reference: 'DCB-TSC-2026-0004127-E',
    declarant: DECLARANTS.wekesa,
    holder: CALLER,
    history: [CALLER],
    receivedDays: -150,
    band: 'low',
    flagsReviewedBy: PETER,
  },
  {
    key: 'returned',
    reference: 'DCB-TSC-2026-0002214-B',
    declarant: DECLARANTS.njeri,
    holder: CALLER,
    history: [CALLER],
    receivedDays: -160,
    band: 'low',
    flagsReviewedBy: PETER,
  },
  {
    key: 'determined',
    reference: 'DCB-TSC-2026-0003104-M',
    declarant: DECLARANTS.mutiso,
    holder: CALLER,
    history: [CALLER],
    receivedDays: -170,
    band: 'low',
    flagsReviewedBy: PETER,
  },
  {
    key: 'awaitingOld',
    reference: 'DCB-TSC-2026-0006612-U',
    declarant: DECLARANTS.wafula,
    holder: MERCY,
    history: [MERCY],
    receivedDays: -175,
    band: 'high',
    flagsReviewedBy: MERCY,
  },
  {
    key: 'awaitingOfRecord',
    reference: 'DCB-TSC-2026-0030559-8',
    declarant: DECLARANTS.onyango,
    holder: MERCY,
    history: [CALLER, MERCY],
    receivedDays: -140,
    band: 'low',
    flagsReviewedBy: MERCY,
  },
  {
    key: 'awaitingFurther',
    reference: 'DCB-TSC-2026-0030696-P',
    declarant: DECLARANTS.rono,
    holder: PETER,
    history: [PETER],
    receivedDays: -130,
    band: 'low',
    flagsReviewedBy: PETER,
  },
  {
    key: 'bulkClosure',
    reference: 'DCB-TSC-2026-0031792-B',
    declarant: DECLARANTS.kamau,
    holder: null,
    history: [],
    receivedDays: -190,
    band: 'low',
    // None: the sweep proposes only cases with no open flags.
    flagsReviewedBy: null,
  },
] as const satisfies readonly {
  key: keyof typeof MOCK_CASE_IDS;
  reference: string;
  declarant: MockDeclarant;
  holder: Officer | null;
  history: readonly Officer[];
  receivedDays: number;
  band: CaseListItem['band'];
  /** Who reviewed the case's flags (a colleague, for the caller's), or null for a case with none. */
  flagsReviewedBy: Assignee | null;
}[];

/** The spec 08 cases and their determinations, with the Commission's staff for reassigning. */
function seedDeterminationCases(now: number) {
  const C = MOCK_CASE_IDS;
  const D = MOCK_DETERMINATION_IDS;
  for (const seed of DETERMINATION_CASES) {
    const name = [
      seed.declarant.firstName,
      'otherNames' in seed.declarant ? seed.declarant.otherNames : null,
      seed.declarant.surname,
    ]
      .filter(Boolean)
      .join(' ');
    const item: CaseListItem = {
      ...caseItem(C[seed.key], seed.reference, name, now, seed.receivedDays + 182),
      status: seed.key === 'determined' ? 'determined' : 'ready-for-determination',
      band: seed.band,
    };
    cases.set(
      item.id,
      storedCase(item, {
        holder: seed.holder,
        history: [...seed.history],
        flags: reviewedFlags(item.id, seed.flagsReviewedBy, now),
        document: declarationOf(seed.declarant),
        timeline: [entry('case-created', null, item.receivedAt, 'Case created from version 1')],
      }),
    );
  }
  // First: the determinations seed their reassignments into it.
  resetApprovalsMock({
    sources: { determination: determinationApprovals, action: actionApprovals },
    staff: [
      { ...PETER, supervisor: false },
      { ...MERCY, supervisor: false },
      { ...LUCY, supervisor: true },
      { ...MOCK_OFFICERS.joseph, supervisor: true },
    ],
  });
  resetDeterminationsMock(
    [
      {
        id: D.peters,
        caseId: C.peters,
        outcome: 'compliant',
        reasons:
          'All flags reviewed. The overdue clarification was answered by phone and the HR letter on file explains the late filing.',
        proposer: PETER,
        proposedAt: at(now, -9),
      },
      {
        id: D.awaitingOld,
        caseId: C.awaitingOld,
        outcome: 'non-compliant',
        reasons:
          'Ardhisasa shows a parcel in Kajiado registered to the declarant in 2024 that is not declared. The response to the clarification did not explain it.',
        proposer: MERCY,
        proposedAt: at(now, -35),
        reassignedTo: MOCK_CALLER,
      },
      {
        id: D.awaitingOfRecord,
        caseId: C.awaitingOfRecord,
        outcome: 'compliant',
        reasons: 'All flags reviewed. Registry checks matched every declared item.',
        proposer: MERCY,
        proposedAt: at(now, -12),
      },
      {
        id: D.awaitingFurther,
        caseId: C.awaitingFurther,
        outcome: 'further-action',
        reasons:
          'The Business Registration Service lists the declarant as a director of a company since 2022, which the declaration leaves out.',
        furtherActionNote: 'Refer to EACC for the undeclared directorship.',
        proposer: PETER,
        proposedAt: at(now, -3),
      },
      {
        id: D.bulkClosure,
        caseId: C.bulkClosure,
        outcome: 'compliant-no-issues',
        reasons: 'Low priority, no open flags or clarifications after the window.',
        proposer: null,
        // The day after its window closed.
        proposedAt: at(now, -7),
      },
      {
        id: D.returned,
        caseId: C.returned,
        outcome: 'compliant',
        reasons: 'All flags reviewed. Registry checks match.',
        proposer: MOCK_CALLER,
        proposedAt: at(now, -8),
        status: 'returned',
        decidedBy: LUCY,
        decidedAt: at(now, -6),
        returnReason:
          'Say how the 41% land value change was explained, and give the valuation report reference.',
      },
      {
        id: D.determined,
        caseId: C.determined,
        outcome: 'compliant',
        reasons:
          'All three flags reviewed and explained. Registry checks match every declared item.',
        proposer: MOCK_CALLER,
        proposedAt: at(now, -14),
        status: 'approved',
        decidedBy: LUCY,
        decidedAt: at(now, -9),
      },
    ],
    { issuer: 'TSC' },
  );
}

/** The mock's flags of a case, each reviewed by `by`; none when `by` is null. */
function reviewedFlags(caseId: string, by: Assignee | null, now: number): Flag[] {
  if (by === null) return [];
  return mockFlags(caseId).map((flag) =>
    flag.reviewed
      ? flag
      : {
          ...flag,
          reviewed: { by, at: at(now, -20), note: 'Explained by the documents on file.' },
        },
  );
}

/** The cases as the determinations mock reads and changes them, for `caller`. */
function mockCases(caller: Assignee): MockCases {
  return {
    find: (caseId) => {
      const stored = cases.get(caseId);
      if (!stored) return null;
      return {
        item: listItem(stored, caller),
        holder: holderOf(stored, caller),
        history: stored.history.map((each) => officer(each, caller)),
        openClarifications: stored.item.clarification.open,
      };
    },
    setStatus: (caseId, status, actor, summary) => {
      const stored = cases.get(caseId);
      if (!stored) return;
      stored.item = { ...stored.item, status };
      stored.timeline.push(
        entry('status-changed', actor, new Date().toISOString(), summary, status),
      );
    },
    record: (caseId, kind, actor, summary, ref) => {
      cases.get(caseId)?.timeline.push(entry(kind, actor, new Date().toISOString(), summary, ref));
    },
  };
}

/** A bearer token the mock reads `sub`, `name` and the realm roles from (tests; unsigned). */
export function mockToken(
  subject: string,
  name: string,
  roles: readonly string[] = [REVIEWER],
): string {
  return unsignedMockToken({ subject, name, roles });
}

/** The caller from the token's claims; the mock does not verify it, the service would. */
function callerOf(request: Request): Assignee {
  const { subject, name } = mockCallerOf(request);
  return { subject: subject ?? 'unknown', name: name ?? 'You' };
}

function officer(value: Officer, caller: Assignee): Assignee {
  return value === CALLER ? caller : value;
}

function holderOf(stored: StoredCase, caller: Assignee): Assignee | null {
  return stored.holder === null ? null : officer(stored.holder, caller);
}

/** A clarification as read now: its letter `issued` once its delay has passed. */
function current(found: Clarification): Clarification {
  const readyAt = letterReadyAt.get(found.id);
  if (readyAt === undefined || reviewClock.now() < readyAt || found.letter?.status !== 'pending') {
    return found;
  }
  letterReadyAt.delete(found.id);
  const ready: Clarification = { ...found, letter: { ...found.letter, status: 'issued' } };
  clarifications.set(ready.id, ready);
  return ready;
}

function draftOf(
  id: string,
  caseId: string,
  items: Item[],
  followUpOf: string | null,
): Clarification {
  return {
    id,
    caseId,
    reference: null,
    status: 'draft',
    items,
    issuedAt: null,
    dueAt: null,
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: null,
    followUpOf,
    opening: null,
    openingAiJobId: null,
    openingAiLanguage: null,
    language: 'en',
    response: null,
  };
}

function ofCase(caseId: string): Clarification[] {
  return [...clarifications.values()]
    .map(current)
    .filter((each) => each.caseId === caseId)
    .sort((a, b) => (b.issuedAt ?? '9').localeCompare(a.issuedAt ?? '9'));
}

/**
 * Case counts and status from its clarifications and flags. When the last outstanding
 * clarification closes, the case goes clarified, then ready for determination (spec 07a S15),
 * each a timeline entry by `actor`. A case that never had a clarification keeps its assignment
 * status.
 */
function refreshCase(stored: StoredCase, actor: Assignee | null = null) {
  const all = ofCase(stored.item.id);
  const open = all.filter((each) => isOutstanding(each.status));
  const latest = open[0] ?? null;
  const status =
    all.length === 0
      ? stored.item.status
      : open.length > 0
        ? 'awaiting-clarification'
        : 'ready-for-determination';
  if (actor && stored.item.status === 'awaiting-clarification' && status !== stored.item.status) {
    const changedAt = new Date(reviewClock.now()).toISOString();
    for (const [to, summary] of [
      ['clarified', 'Case clarified: no clarification open'],
      ['ready-for-determination', 'Case ready for determination'],
    ] as const) {
      stored.timeline.push(entry('status-changed', actor, changedAt, summary, to));
    }
  }
  stored.item = {
    ...stored.item,
    status,
    openFlags: stored.flags.filter((flag) => flag.reviewed === null && !flag.closedReason).length,
    clarification: {
      open: open.length,
      status: latest?.status ?? null,
      dueAt: latest?.dueAt ?? null,
    },
  };
}

async function textField(request: Request, field: string, max: number): Promise<string | null> {
  const body = await readJson(request);
  const value = isRecord(body) ? body[field] : null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) return null;
  return value;
}

function ensureSeeded() {
  if (cases.size > 0) return;
  // Read here, not through env(): the mock seeds itself in tests that set no service URLs.
  const copilot = envSchema.shape.REVIEW_MOCK_COPILOT.parse(process.env.REVIEW_MOCK_COPILOT);
  resetReviewMock(reviewClock.now(), { copilot });
}

export function mockReviewFetch(request: Request): Promise<Response> {
  ensureSeeded();
  return route(request);
}

/** The uploads a declaration document attaches to its items, by upload id. */
function documentAttachments(document: Record<string, unknown> | null): Map<string, string> {
  const files = new Map<string, string>();
  const statements = Array.isArray(document?.statements) ? document.statements : [];
  for (const statement of statements) {
    if (!isRecord(statement)) continue;
    for (const category of ['income', 'assets', 'liabilities']) {
      const items = Array.isArray(statement[category]) ? (statement[category] as unknown[]) : [];
      for (const item of items) {
        const attachments =
          isRecord(item) && Array.isArray(item.attachments) ? item.attachments : [];
        for (const attachment of attachments) {
          if (isRecord(attachment) && typeof attachment.uploadId === 'string') {
            files.set(attachment.uploadId, String(attachment.fileName));
          }
        }
      }
    }
  }
  return files;
}

/** What the placeholder file route names: a letter's clarification, or an attachment. */
export function mockFileTitle(id: string): string | null {
  ensureSeeded();
  const decision = mockDecisionLetterTitle(id);
  if (decision) return decision;
  for (const each of clarifications.values()) {
    if (each.letter?.documentId === id) return `Clarification letter ${each.reference ?? ''}`;
    for (const item of each.response?.items ?? []) {
      const file = item.attachments.find((attachment) => attachment.uploadId === id);
      if (file) return file.fileName;
    }
  }
  for (const stored of cases.values()) {
    const file = documentAttachments(stored.document).get(id);
    if (file) return file.replace(/\.pdf$/i, '');
  }
  return mockActionFileTitle(id);
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const caller = callerOf(request);

  const aiStatus = /^\/v1\/commissions\/([^/]+)\/ai-status$/.exec(pathname);
  if (method === 'GET' && aiStatus?.[1]) {
    // The review service proxies the gateway's tenant status; so does the mock (spec 07c). Only
    // the Commission's admin reads it; anyone else, supervisors included, gets 404.
    if (!mockCallerOf(request).roles.includes(COMMISSION_ADMIN)) return problem(404, 'Not found');
    return json(200, mockTenantAiStatus(aiStatus[1]));
  }

  const actions = await actionsRoute(request, mockCallerOf(request));
  if (actions) return actions;

  const attachment = /^\/v1\/review\/cases\/([^/]+)\/attachments\/([^/]+)\/download$/.exec(
    pathname,
  );
  if (method === 'GET' && attachment?.[1] && attachment[2]) {
    const stored = cases.get(attachment[1]);
    if (!stored) return problem(404, 'Not found');
    if (stored.declarationsDown) return problem(502, 'Declarations unavailable');
    const known =
      documentAttachments(stored.document).has(attachment[2]) ||
      ofCase(stored.item.id).some((each) =>
        each.response?.items.some((item) =>
          item.attachments.some((file) => file.uploadId === attachment[2]),
        ),
      );
    if (!known) return problem(404, 'Not found');
    return json(200, {
      downloadUrl: `/api/mock-files/${attachment[2]}`,
      expiresAt: new Date(reviewClock.now() + 5 * 60_000).toISOString(),
    });
  }

  const letter = /^\/v1\/review\/clarifications\/([^/]+)\/letter\/download$/.exec(pathname);
  if (method === 'GET' && letter?.[1]) {
    const documentId = clarifications.get(letter[1])?.letter?.documentId;
    if (!documentId) return problem(404, 'Not found');
    return json(200, {
      downloadUrl: `/api/mock-files/${documentId}`,
      expiresAt: new Date(reviewClock.now() + 5 * 60_000).toISOString(),
    });
  }

  const { roles } = mockCallerOf(request);
  const approver = { ...caller, roles };
  const decided =
    (await determinationsRoute(request, approver, mockCases(caller))) ??
    (await approvalsRoute(request, approver, mockCases(caller)));
  if (decided) return decided;

  const copilot = await copilotRoute(request, caller, (caseId) => {
    const stored = cases.get(caseId);
    return stored ? holderOf(stored, caller)?.subject === caller.subject : null;
  });
  if (copilot) return copilot;

  const drafts = /^\/v1\/review\/cases\/([^/]+)\/clarifications$/.exec(pathname);
  if (method === 'POST' && drafts?.[1]) {
    const caseId = drafts[1];
    return once(request, () => createDraft(request, caseId, caller));
  }

  const issue = /^\/v1\/review\/clarifications\/([^/]+)\/issue$/.exec(pathname);
  if (method === 'POST' && issue?.[1]) {
    const id = issue[1];
    if (!request.headers.get('idempotency-key')) {
      return problem(400, 'Idempotency-Key is required');
    }
    return once(request, () => issueDraft(id, caller));
  }

  const compare = /^\/v1\/review\/cases\/([^/]+)\/compare$/.exec(pathname);
  if (method === 'GET' && compare?.[1]) return compareCase(compare[1]);

  const oneCase = /^\/v1\/review\/cases\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && oneCase?.[1]) {
    const stored = cases.get(oneCase[1]);
    if (!stored) return problem(404, 'Not found');
    if (stored.declarationsDown) {
      return json(502, {
        type: 'declarations-unavailable',
        title: 'Declarations unavailable',
        status: 502,
        detail: 'The declarations service could not give the declaration.',
        ...detail(stored, caller),
        document: null,
      });
    }
    return json(200, detail(stored, caller));
  }

  const caseAction = /^\/v1\/review\/cases\/([^/]+)\/(claim|release|assignment|notes)$/.exec(
    pathname,
  );
  if (caseAction?.[1] && caseAction[2]) {
    const stored = cases.get(caseAction[1]);
    if (!stored) return problem(404, 'Not found');
    return assignmentOrNote(request, stored, caseAction[2], caller);
  }

  const reviewed = /^\/v1\/review\/cases\/([^/]+)\/flags\/([^/]+)\/reviewed$/.exec(pathname);
  if (method === 'POST' && reviewed?.[1] && reviewed[2]) {
    const stored = cases.get(reviewed[1]);
    if (!stored) return problem(404, 'Not found');
    return markReviewed(request, stored, reviewed[2], caller);
  }

  const action = /^\/v1\/review\/clarifications\/([^/]+)\/(resolve|follow-up|withdraw)$/.exec(
    pathname,
  );
  if (method === 'POST' && action?.[1] && action[2]) {
    return act(request, action[1], action[2], caller);
  }

  const one = /^\/v1\/review\/clarifications\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const found = clarifications.get(one[1]);
    return found ? json(200, current(found)) : problem(404, 'Not found');
  }
  if (method === 'PUT' && one?.[1]) {
    return updateDraft(request, one[1], caller);
  }

  return problem(404, 'Not found');
}

/**
 * The comparison with the person's previous submitted version: 409 for a first declaration on
 * Adili, 502 while declarations is down. A single-version case compares with the previous
 * cycle's declaration (version 1 of its own declaration).
 */
function compareCase(caseId: string): Response {
  const stored = cases.get(caseId);
  if (!stored) return problem(404, 'Not found');
  if (stored.declarationsDown) return problem(502, 'Declarations unavailable');
  const { currentVersion } = stored.item;
  const current = stored.versions.find((each) => each.version === currentVersion);
  if (!stored.document || current?.firstOnAdili) {
    return json(409, {
      type: 'no-previous-version',
      title: 'No previous version',
      status: 409,
      detail: "This is the declarant's first declaration on Adili; there is nothing to compare.",
    });
  }
  return json(
    200,
    mockComparison(stored.document, Math.max(currentVersion - 1, 1), currentVersion),
  );
}

function listItem(stored: StoredCase, caller: Assignee): CaseListItem {
  return { ...stored.item, assignee: holderOf(stored, caller) };
}

function detail(stored: StoredCase, caller: Assignee): CaseDetail {
  const history: Assignee[] = [];
  for (const each of stored.history.map((value) => officer(value, caller))) {
    if (!history.some((known) => known.subject === each.subject)) history.push(each);
  }
  return {
    case: listItem(stored, caller),
    flags: stored.flags,
    document: stored.document,
    clarifications: ofCase(stored.item.id),
    notes: stored.notes.map((note): Note => ({ ...note, author: officer(note.author, caller) })),
    timeline: stored.timeline.map((each) => ({
      ...each,
      actor: each.actor === null ? null : officer(each.actor, caller),
      ref: each.ref === CALLER ? caller.subject : each.ref,
    })),
    versions: stored.versions,
    reviewerHistory: history,
    determinations: determinationsOf(stored.item.id, caller),
    registry: { checkedAt: null, checks: [], recheckAvailableAt: null },
  };
}

/** Claim, release, reassign or unassign (`assignment`), or add a note. */
async function assignmentOrNote(
  request: Request,
  stored: StoredCase,
  action: string,
  caller: Assignee,
): Promise<Response> {
  const now = new Date(reviewClock.now()).toISOString();
  const holder = holderOf(stored, caller);
  const hand = (to: Assignee | null, summary: string) => {
    stored.holder = to;
    if (to && !stored.history.some((each) => officer(each, caller).subject === to.subject)) {
      stored.history.push(to);
    }
    if (stored.item.status === 'unassigned' && to) stored.item.status = 'assigned';
    if (stored.item.status === 'assigned' && !to) stored.item.status = 'unassigned';
    stored.timeline.push(entry('assigned', caller, now, summary, to?.subject ?? null));
    return json(200, listItem(stored, caller));
  };

  if (action === 'claim' && request.method === 'POST') {
    if (stored.claimedFirstBy) {
      const first = stored.claimedFirstBy;
      stored.claimedFirstBy = null;
      stored.holder = first;
      stored.history.push(first);
      stored.item.status = 'assigned';
      stored.timeline.push(entry('assigned', first, now, 'Claimed', first.subject));
    }
    if (stored.holder !== null) {
      return json(409, {
        type: 'case-already-assigned',
        title: 'Case already assigned',
        status: 409,
        detail: 'Another reviewer holds this case. Ask a supervisor to reassign it.',
      });
    }
    return hand(caller, 'Claimed');
  }
  if (action === 'release' && request.method === 'POST') {
    if (holder?.subject !== caller.subject) {
      return problem(403, 'Only the reviewer who holds a case can release it.');
    }
    return hand(null, 'Released to the queue');
  }
  if (action === 'assignment' && request.method === 'PUT') {
    const body = await readJson(request);
    if (!isRecord(body) || !('assignee' in body)) return problem(400, 'assignee is required');
    const subject = body.assignee;
    if (subject === null) return hand(null, 'Unassigned by a supervisor');
    if (typeof subject !== 'string' || !subject) return problem(400, 'assignee is required');
    if (subject === holder?.subject) return json(200, listItem(stored, caller));
    const known = [...stored.history.map((each) => officer(each, caller)), caller].find(
      (each) => each.subject === subject,
    );
    const to = known ?? { subject, name: subject };
    return hand(to, `Reassigned to ${to.name}`);
  }
  if (action === 'notes' && request.method === 'POST') {
    const text = await textField(request, 'text', 2000);
    if (text === null) return problem(400, 'A note of 1 to 2,000 characters is required');
    const note: StoredNote = { id: randomUUID(), author: caller, text, at: now };
    stored.notes.push(note);
    stored.timeline.push(entry('note-added', caller, now, 'Internal note added', note.id));
    return json(201, { ...note, author: caller });
  }
  return problem(404, 'Not found');
}

async function markReviewed(
  request: Request,
  stored: StoredCase,
  flagId: string,
  caller: Assignee,
): Promise<Response> {
  const index = stored.flags.findIndex((flag) => flag.id === flagId);
  const flag = stored.flags[index];
  if (!flag) return problem(404, 'Not found');
  if (flag.reviewed) {
    return json(409, {
      type: 'flag-already-reviewed',
      title: 'Flag already reviewed',
      status: 409,
      detail: 'This flag was already marked reviewed; add a note to the case instead.',
    });
  }
  const note = await textField(request, 'note', 1000);
  if (note === null) return problem(400, 'A note of 1 to 1,000 characters is required');
  const now = new Date(reviewClock.now()).toISOString();
  const updated: Flag = { ...flag, reviewed: { at: now, by: caller, note } };
  stored.flags[index] = updated;
  stored.timeline.push(
    entry('flag-reviewed', caller, now, `Flag reviewed: ${flag.title}`, flag.id),
  );
  refreshCase(stored);
  return json(200, updated);
}

async function act(
  request: Request,
  id: string,
  action: string,
  caller: Assignee,
): Promise<Response> {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return problem(404, 'Not found');
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return problem(403, 'Only the reviewer holding the case can act on its clarifications');
  }

  if (action === 'resolve') {
    if (found.status !== 'issued' && found.status !== 'responded') {
      return problem(409, 'Not issued or responded');
    }
    const note = await textField(request, 'note', 2000);
    if (note === null) return problem(400, 'A note of 1 to 2,000 characters is required');
    return save(
      stored,
      {
        ...found,
        status: 'resolved',
        resolvedAt: new Date(reviewClock.now()).toISOString(),
        resolutionNote: note,
      },
      caller,
    );
  }

  if (action === 'withdraw') {
    if (found.status !== 'issued' && found.status !== 'overdue') {
      return problem(409, 'Not issued');
    }
    const reason = await textField(request, 'reason', 1000);
    if (reason === null) return problem(400, 'A reason of 1 to 1,000 characters is required');
    return save(
      stored,
      {
        ...found,
        status: 'withdrawn',
        letter: found.letter ? { ...found.letter, status: 'revoked' } : null,
      },
      caller,
    );
  }

  // follow-up
  const draft = {
    ...draftOf(randomUUID(), found.caseId, found.items, found.id),
    opening: found.opening,
    openingAiJobId: found.openingAiJobId,
    openingAiLanguage: found.openingAiLanguage,
    language: found.language,
  };
  clarifications.set(draft.id, draft);
  return json(201, draft);
}

function save(stored: StoredCase, updated: Clarification, actor: Assignee): Response {
  clarifications.set(updated.id, updated);
  refreshCase(stored, actor);
  return json(200, updated);
}

/**
 * Runs `work` once per method, path and Idempotency-Key; a repeat gets the first answer back.
 * Without a key it runs every time, as review.yaml's optional keys have it.
 */
async function once(request: Request, work: () => Promise<Response>): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return work();
  const slot = `${request.method} ${new URL(request.url).pathname} ${key}`;
  const seen = replays.get(slot);
  if (seen) return json(seen.status, seen.body);
  const response = await work();
  replays.set(slot, { status: response.status, body: await response.clone().json() });
  return response;
}

/** review.yaml `ClarificationInput`, checked as the service does; null when invalid. */
async function contentOf(
  request: Request,
): Promise<Pick<
  Clarification,
  'items' | 'opening' | 'openingAiJobId' | 'openingAiLanguage' | 'language'
> | null> {
  const body = await readJson(request);
  const items = isRecord(body) ? body.items : null;
  if (!Array.isArray(items) || items.length > 50) return null;
  const opening = isRecord(body) ? (body.opening ?? null) : null;
  if (opening !== null && (typeof opening !== 'string' || opening.trim().length > 800)) {
    return null;
  }
  const openingAiJobId = isRecord(body) ? (body.openingAiJobId ?? null) : null;
  if (openingAiJobId !== null && typeof openingAiJobId !== 'string') return null;
  // Left out: English, as the service has it.
  const language = isRecord(body) ? (body.language ?? 'en') : 'en';
  if (language !== 'en' && language !== 'sw') return null;
  const valid: Item[] = [];
  const optional = (value: unknown) => (typeof value === 'string' ? value : null);
  for (const item of items) {
    if (!isRecord(item)) return null;
    const { requirement, text } = item;
    if (!REQUIREMENTS.includes(requirement as Item['requirement'])) return null;
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) return null;
    valid.push({
      sectionKey: optional(item.sectionKey),
      personKey: optional(item.personKey),
      itemId: optional(item.itemId),
      requirement: requirement as Item['requirement'],
      text: text.trim(),
      aiJobId: optional(item.aiJobId),
      // The service records the language the job drafted in (a seeded job's is English).
      aiLanguage: draftedLanguage(optional(item.aiJobId)),
    });
  }
  const trimmed = opening?.trim() ?? '';
  return {
    items: valid,
    opening: trimmed === '' ? null : trimmed,
    openingAiJobId: trimmed === '' ? null : openingAiJobId,
    openingAiLanguage: trimmed === '' ? null : draftedLanguage(openingAiJobId),
    language,
  };
}

const draftedLanguage = (jobId: string | null): 'en' | 'sw' | null =>
  jobId === MOCK_DRAFT_JOB_ID ? 'en' : mockDraftLanguage(jobId);

async function createDraft(request: Request, caseId: string, caller: Assignee) {
  const stored = cases.get(caseId);
  if (!stored) return problem(404, 'Not found');
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return problem(403, 'Only the reviewer holding the case can write its clarifications');
  }
  const content = await contentOf(request);
  if (content === null) return problem(400, 'Items are not valid');
  const draft = { ...draftOf(randomUUID(), caseId, content.items, null), ...content };
  clarifications.set(draft.id, draft);
  return json(201, draft);
}

async function updateDraft(request: Request, id: string, caller: Assignee) {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return problem(404, 'Not found');
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return problem(403, 'Only the reviewer holding the case can write its clarifications');
  }
  if (found.status !== 'draft') return problem(409, 'Not a draft', 'not-a-draft');
  const content = await contentOf(request);
  if (content === null) return problem(400, 'Items are not valid');
  const updated = { ...found, ...content };
  clarifications.set(id, updated);
  return json(200, updated);
}

function issueDraft(id: string, caller: Assignee): Promise<Response> {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return Promise.resolve(problem(404, 'Not found'));
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return Promise.resolve(problem(403, 'Only the reviewer holding the case can issue'));
  }
  if (found.status !== 'draft') return Promise.resolve(problem(409, 'Not a draft', 'not-a-draft'));
  if (found.items.length === 0) {
    return Promise.resolve(
      json(400, {
        type: 'clarification-has-no-items',
        title: 'Bad Request',
        status: 400,
        detail: 'A clarification needs at least one item to be issued.',
        code: 'clarification-has-no-items',
      }),
    );
  }
  const { windowEndsAt } = stored.item;
  const now = reviewClock.now();
  if (now > Date.parse(windowEndsAt)) {
    return Promise.resolve(
      json(409, {
        type: 'clarification-window-closed',
        title: 'Conflict',
        status: 409,
        detail: 'The Commission could no longer request clarification.',
        code: 'clarification-window-closed',
        windowEndsAt,
      }),
    );
  }
  const numbers = [...clarifications.values()].map((each) =>
    Number(/-(\d{7})-/.exec(each.reference ?? '')?.[1] ?? 0),
  );
  const n = Math.max(0, ...numbers) + 1;
  const issuedAt = new Date(now).toISOString();
  const issued: Clarification = {
    ...found,
    reference: reference(n),
    status: 'issued',
    issuedAt,
    dueAt: at(now, 30),
    letter: {
      documentId: randomUUID(),
      verificationId: `V-${String(n).padStart(4, '0')}-7K2Q`,
      status: 'pending',
    },
  };
  letterReadyAt.set(id, now + MOCK_LETTER_DELAY_MS);
  stored.timeline.push({
    id: randomUUID(),
    kind: 'clarification-issued',
    actor: caller,
    at: issuedAt,
    summary: `Clarification ${issued.reference ?? ''} issued`,
    ref: id,
  });
  return Promise.resolve(save(stored, issued, caller));
}

/**
 * The documents service's download of a decision letter the mock issued (spec 08), for the
 * console's letter link under REVIEW_MOCK: a link to the placeholder file route.
 */
export function mockLetterFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(request.url).pathname);
  const documentId = match?.[1];
  if (request.method !== 'GET' || !documentId || !mockDecisionLetterTitle(documentId)) {
    return Promise.resolve(problem(404, 'Not found'));
  }
  return Promise.resolve(
    json(200, {
      downloadUrl: `/api/mock-files/${documentId}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }),
  );
}
