/**
 * In-memory stand-in for the review service's case and clarification endpoints (review.yaml)
 * and the documents service's letter download, used when REVIEW_MOCK is set until the review
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
 * ai-gateway mock's store, as the service proxies the gateway; the mock does not check roles.
 */
import { randomUUID } from 'node:crypto';

import { addDays } from '@adili/ui';

import createClient from 'openapi-fetch';

import { isOutstanding } from '../../clarification/labels';
import { mockTenantAiStatus } from '../ai-gateway/mock.server';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { paths } from './api.gen';
import {
  copilotRoute,
  declarationOf,
  type MockDeclarant,
  MOCK_DECLARATION,
  MOCK_FLAG_IDS,
  mockFlags,
  resetCopilotMock,
} from './copilot-mock.server';
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
} as const;

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
} as const satisfies Record<string, Assignee>;
const PETER: Assignee = MOCK_OFFICERS.peter;
const MERCY: Assignee = MOCK_OFFICERS.mercy;

type Item = Clarification['items'][number];

/** The declarants of the cases that reuse the mock declaration with their own name. */
const DECLARANTS = {
  grace: { firstName: 'Grace', surname: 'Atieno' },
  mary: { firstName: 'Mary', surname: 'Achieng' },
  gitau: { firstName: 'Mary', otherNames: 'Njambi', surname: 'Gitau' },
} as const satisfies Record<string, MockDeclarant>;

const PLOT: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: '1e2d3c4b-0000-4000-8000-000000000001',
  requirement: 'explain-discrepancy',
  text: 'The value of this plot is 150% higher than in your 2024 declaration, but no acquisition or improvement is recorded. Explain the change.',
  label: 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy',
};
const SACCO: Item = {
  sectionKey: 'statement:officer',
  personKey: 'officer',
  itemId: null,
  requirement: 'provide-omitted',
  text: 'Your payslip shows a monthly deduction to Mwalimu National SACCO, but no SACCO loan is declared. Provide the loan details.',
  label: 'Liabilities · John Kennedy',
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
  /** CALLER, a fixed officer, or nobody. */
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
            location: { inKenya: true, county: 'Nairobi' },
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
            location: { inKenya: true, county: 'Nyeri', detail: 'Mukurwe-ini' },
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
export function mockReviewClient(subject: string, name: string) {
  return createClient<paths>({
    baseUrl: 'http://review.test',
    headers: { authorization: `Bearer ${mockToken(subject, name)}` },
    fetch: mockReviewFetch,
  });
}

/** Seeds the fixtures with "now" at `now` (tests pass a fixed time). */
export function resetReviewMock(now: number = Date.now()) {
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
        },
        {
          versionId: C.mine,
          version: 2,
          submittedAt: atMinutes(now, -15, 182),
          late: false,
          amendment: true,
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

  const seed = (value: Clarification) => clarifications.set(value.id, value);
  seed(clarification(K.issued, C.mine, 42, [PLOT, SACCO], 8, now));
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
  resetCopilotMock(now, [
    { caseId: C.mine, state: 'ready' },
    { caseId: C.windowClosed, state: 'pending', readyAfterMs: 8_000, declarant: DECLARANTS.grace },
    { caseId: C.peters, state: 'ready', declarant: DECLARANTS.mary },
    { caseId: C.unassigned, state: 'not-enabled' },
    { caseId: C.contested, state: 'not-enabled' },
    { caseId: C.unavailable, state: 'ready', declarant: DECLARANTS.gitau },
  ]);
}

/** A bearer token the mock reads `sub` and `name` from (tests; unsigned). */
export function mockToken(subject: string, name: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: subject, name })}.`;
}

/** The caller from the token's claims; the mock does not verify it, the service would. */
function callerOf(request: Request): Assignee {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: unknown; name?: unknown };
    return {
      subject: typeof claims.sub === 'string' ? claims.sub : 'unknown',
      name: typeof claims.name === 'string' ? claims.name : 'You',
    };
  } catch {
    return { subject: 'unknown', name: 'You' };
  }
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
  if (readyAt === undefined || Date.now() < readyAt || found.letter?.status !== 'pending') {
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
    const changedAt = new Date().toISOString();
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
  if (cases.size === 0) resetReviewMock();
}

export function mockReviewFetch(request: Request): Promise<Response> {
  ensureSeeded();
  return route(request);
}

/** The documents service's `GET /v1/documents/{id}/download`, for clarification letters. */
export function mockDocumentsFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const { pathname } = new URL(request.url);
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(pathname);
  const known = [...clarifications.values()].some((each) => each.letter?.documentId === match?.[1]);
  if (request.method !== 'GET' || !match?.[1] || !known) {
    return Promise.resolve(problem(404, 'Not found'));
  }
  return Promise.resolve(
    json(200, {
      downloadUrl: `/api/mock-files/${match[1]}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
    }),
  );
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
  return null;
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const caller = callerOf(request);

  const aiStatus = /^\/v1\/commissions\/([^/]+)\/ai-status$/.exec(pathname);
  if (method === 'GET' && aiStatus?.[1]) {
    // The review service proxies the gateway's tenant status; so does the mock (spec 07c).
    return json(200, mockTenantAiStatus(aiStatus[1]));
  }

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
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }

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
  };
}

/** Claim, release, reassign or unassign (`assignment`), or add a note. */
async function assignmentOrNote(
  request: Request,
  stored: StoredCase,
  action: string,
  caller: Assignee,
): Promise<Response> {
  const now = new Date().toISOString();
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
        detail: 'Another officer holds this case. Ask a supervisor to reassign it.',
      });
    }
    return hand(caller, 'Claimed');
  }
  if (action === 'release' && request.method === 'POST') {
    if (holder?.subject !== caller.subject) {
      return problem(403, 'Only the officer who holds a case can release it.');
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
  const now = new Date().toISOString();
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
    return problem(403, 'Only the officer holding the case can act on its clarifications');
  }

  if (action === 'resolve') {
    if (found.status !== 'issued' && found.status !== 'responded') {
      return problem(409, 'Not issued or responded');
    }
    const note = await textField(request, 'note', 2000);
    if (note === null) return problem(400, 'A note of 1 to 2,000 characters is required');
    return save(
      stored,
      { ...found, status: 'resolved', resolvedAt: new Date().toISOString(), resolutionNote: note },
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
  const draft = draftOf(randomUUID(), found.caseId, found.items, found.id);
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
async function itemsOf(request: Request): Promise<Item[] | null> {
  const body = await readJson(request);
  const items = isRecord(body) ? body.items : null;
  if (!Array.isArray(items) || items.length > 50) return null;
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
    });
  }
  return valid;
}

async function createDraft(request: Request, caseId: string, caller: Assignee) {
  const stored = cases.get(caseId);
  if (!stored) return problem(404, 'Not found');
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return problem(403, 'Only the officer holding the case can write its clarifications');
  }
  const items = await itemsOf(request);
  if (items === null) return problem(400, 'Items are not valid');
  const draft = draftOf(randomUUID(), caseId, items, null);
  clarifications.set(draft.id, draft);
  return json(201, draft);
}

async function updateDraft(request: Request, id: string, caller: Assignee) {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return problem(404, 'Not found');
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return problem(403, 'Only the officer holding the case can write its clarifications');
  }
  if (found.status !== 'draft') return problem(409, 'Not a draft', 'not-a-draft');
  const items = await itemsOf(request);
  if (items === null) return problem(400, 'Items are not valid');
  const updated = { ...found, items };
  clarifications.set(id, updated);
  return json(200, updated);
}

function issueDraft(id: string, caller: Assignee): Promise<Response> {
  const found = clarifications.get(id);
  const stored = found ? cases.get(found.caseId) : undefined;
  if (!found || !stored) return Promise.resolve(problem(404, 'Not found'));
  if (holderOf(stored, caller)?.subject !== caller.subject) {
    return Promise.resolve(problem(403, 'Only the officer holding the case can issue'));
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
  const now = Date.now();
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
