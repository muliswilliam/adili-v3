/**
 * In-memory stand-in for the review service's copilot endpoints (review.yaml, spec 07c), part of
 * the review mock (`mock.server.ts`, REVIEW_MOCK) until the review service implements them
 * (#283, #284). Also the declaration document and flags the mock's case `mine` carries, so the
 * summary's source refs and flag explanations resolve against them.
 *
 * Each case's starting state comes from the review mock's seeds (`resetCopilotMock`): e.g. case
 * `mine` ready, generated 3 hours before the store was seeded, and case `windowClosed` pending,
 * ready 8 seconds after its first read.
 *
 * Refresh (the holder only, else 403; 409 while pending or stale, or when AI is not enabled)
 * starts new jobs that are ready 6 seconds later. Ratings (the holder only, else 403) are kept
 * per caller and job, and the view lists the caller's own. Tests put a case in any state with `setMockCopilot`.
 * With `notEnabled` seeded (REVIEW_MOCK_COPILOT=not-enabled in dev), every case's is not enabled.
 *
 * Draft with AI (`POST .../copilot/drafts`, the holder only, else 403; 409 `ai-not-enabled` when
 * the case's copilot is not enabled; 400 `selection-not-on-case` for a flag or item the case
 * lacks or no selection): the answer comes after `MOCK_DRAFT_WAIT_MS`, ready for up to two picks,
 * pending for three or more (ready `MOCK_DRAFT_DELAY_MS` after the request, polled with
 * `GET /v1/review/copilot/drafts/{id}`, which only the requester reads), and failed
 * (`provider-unavailable`) when the picks include the Holdings outside Kenya flag.
 */
import { isRecord, json, problem, readJson } from '../mock-http';
import type { Assignee, CopilotView, Flag } from './types';

export const MOCK_COPILOT_DELAY_MS = 6_000;
/** How long the drafts endpoint takes to answer (the service waits up to 10 s for the job). */
export const MOCK_DRAFT_WAIT_MS = 1_500;
/** When a pending draft is ready, after the request. */
export const MOCK_DRAFT_DELAY_MS = 5_000;

const OFFICER = 'officer';
const SPOUSE = 'spouse:5b0e0000-0000-4000-8000-000000000201';
const CHILD = 'child:5b0e0000-0000-4000-8000-000000000301';

/** Item ids in the mock declaration; `plot` is the item the mock clarifications ask about. */
export const MOCK_ITEM_IDS = {
  salary: '1e2d3c4b-0000-4000-8000-000000000011',
  rent: '1e2d3c4b-0000-4000-8000-000000000012',
  plot: '1e2d3c4b-0000-4000-8000-000000000001',
  house: '1e2d3c4b-0000-4000-8000-000000000002',
  fund: '1e2d3c4b-0000-4000-8000-000000000003',
  saccoShares: '1e2d3c4b-0000-4000-8000-000000000004',
  mortgage: '1e2d3c4b-0000-4000-8000-000000000021',
  shop: '1e2d3c4b-0000-4000-8000-000000000031',
  stock: '1e2d3c4b-0000-4000-8000-000000000032',
  childFund: '1e2d3c4b-0000-4000-8000-000000000041',
} as const;

export const MOCK_FLAG_IDS = {
  valueChange: 'f1a90000-0000-4000-8000-000000000001',
  acquisition: 'f1a90000-0000-4000-8000-000000000002',
  growth: 'f1a90000-0000-4000-8000-000000000003',
  foreign: 'f1a90000-0000-4000-8000-000000000004',
  late: 'f1a90000-0000-4000-8000-000000000005',
} as const;

const I = MOCK_ITEM_IDS;
const STATEMENT = `statement:${OFFICER}`;
const F = MOCK_FLAG_IDS;
const kes = (shillings: number) => ({ kesCents: shillings * 100 });
const unchanged = { changed: false };
const kenya = (county: string, detail?: string) => ({
  inKenya: true,
  county,
  ...(detail ? { detail } : {}),
});
const sole = { isJoint: false };
const period = { from: '2024-01-01', to: '2025-12-31' };
const statementDates = { statementDate: '2025-12-31', incomePeriod: period };
const attachment = (n: number, fileName: string) => ({
  attachmentId: `a77a0000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  uploadId: `0b10ad00-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  fileName,
  sha256: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
});

/** Uploads of the mock declaration's attachments, for the download links. */
export const MOCK_ATTACHMENTS = {
  titleDeed: attachment(1, 'Title deed Kisumu-Manyatta-1234.pdf'),
  valuation: attachment(2, 'Valuation report Milimani 2025.pdf'),
  saccoStatement: attachment(3, 'Mwalimu SACCO share statement Dec 2025.pdf'),
} as const;

/**
 * The mock declaration filed by another declarant: their name on the declaration and their
 * statement, the household as it is.
 */
export function declarationOf(declarant: MockDeclarant): Record<string, unknown> {
  const name = { ...declarant };
  const document = structuredClone(MOCK_DECLARATION) as {
    officer: { name: unknown };
    statements: { personKey: string; personName: unknown }[];
  };
  document.officer.name = name;
  for (const statement of document.statements) {
    if (statement.personKey === OFFICER) statement.personName = name;
  }
  return document;
}

/** A `declaration.v1` document, as the declarations service gives it to the review service. */
export const MOCK_DECLARATION: Record<string, unknown> = {
  schemaVersion: 'declaration.v1',
  type: 'biennial',
  statementDate: '2025-12-31',
  incomePeriod: { ...period, fromSource: 'declared' },
  officer: {
    name: { surname: 'Otieno', firstName: 'John', otherNames: 'Kennedy' },
    birth: { date: '1979-05-04', place: 'Kisumu' },
    maritalStatus: 'married',
    address: { postal: 'P.O. Box 1230-40100, Kisumu', physical: 'Milimani, Kisumu' },
    employment: {
      designation: 'Senior Teacher',
      employer: 'Kisumu Girls High School',
      nature: 'permanent',
      responsibleCommission: 'tsc',
      personnelFileNumber: 'TSC/0003418',
    },
  },
  spouses: {
    none: false,
    items: [
      {
        id: SPOUSE.slice('spouse:'.length),
        name: { surname: 'Otieno', firstName: 'Lilian', otherNames: 'Akoth' },
        nationalId: '23456789',
        occupationSector: 'private',
        separated: false,
      },
    ],
  },
  children: {
    none: false,
    items: [
      {
        id: CHILD.slice('child:'.length),
        name: { surname: 'Otieno', firstName: 'Brenda' },
        dateOfBirth: '2012-02-14',
        includedAtStatementDate: true,
      },
    ],
  },
  statements: [
    {
      personKey: OFFICER,
      personName: { surname: 'Otieno', firstName: 'John', otherNames: 'Kennedy' },
      ...statementDates,
      incomeNil: false,
      income: [
        {
          id: I.salary,
          type: 'salary-emoluments',
          description: 'Salary from the Teachers Service Commission',
          amount: kes(3_120_000),
          location: kenya('Kisumu'),
          change: unchanged,
        },
        {
          id: I.rent,
          type: 'rent',
          description: 'Rent from a bedsitter block in Kondele',
          amount: kes(480_000),
          location: kenya('Kisumu', 'Kondele'),
          change: { changed: true, kind: 'new-source' },
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: I.plot,
          type: 'land',
          description: 'Plot Kisumu/Manyatta/1234',
          details: { parcelNumber: 'KISUMU/MANYATTA/1234', size: '0.25 acres' },
          value: kes(4_500_000),
          location: kenya('Kisumu', 'Manyatta'),
          joint: sole,
          change: unchanged,
          attachments: [MOCK_ATTACHMENTS.titleDeed],
        },
        {
          id: I.house,
          type: 'building',
          description: 'Three-bedroom house in Milimani',
          value: kes(9_800_000),
          location: kenya('Kisumu', 'Milimani'),
          joint: { isJoint: true, sharePercent: 50, coOwner: 'Lilian Akoth Otieno' },
          change: unchanged,
          attachments: [MOCK_ATTACHMENTS.valuation],
        },
        {
          id: I.fund,
          type: 'securities',
          description: 'CIC Money Market Fund units',
          value: kes(850_000),
          location: kenya('Nairobi'),
          joint: sole,
          change: unchanged,
        },
        {
          id: I.saccoShares,
          type: 'shareholding',
          description: 'Shares in Mwalimu National SACCO',
          value: kes(1_200_000),
          location: { inKenya: false, country: 'UG', detail: 'Kampala' },
          joint: sole,
          change: unchanged,
          attachments: [MOCK_ATTACHMENTS.saccoStatement],
        },
      ],
      liabilitiesNil: false,
      liabilities: [
        {
          id: I.mortgage,
          type: 'mortgage',
          description: 'Mortgage from KCB Bank',
          creditor: 'KCB Bank',
          outstanding: kes(3_400_000),
          location: kenya('Kisumu'),
          change: unchanged,
        },
      ],
    },
    {
      personKey: SPOUSE,
      personName: { surname: 'Otieno', firstName: 'Lilian', otherNames: 'Akoth' },
      ...statementDates,
      incomeNil: false,
      income: [
        {
          id: I.shop,
          type: 'business',
          description: 'Profit from a cereals shop in Kibuye market',
          amount: kes(960_000),
          location: kenya('Kisumu', 'Kibuye market'),
          change: unchanged,
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: I.stock,
          type: 'other',
          description: 'Shop stock',
          value: kes(350_000),
          location: kenya('Kisumu', 'Kibuye market'),
          joint: sole,
          change: unchanged,
        },
      ],
      liabilitiesNil: true,
      liabilities: [],
    },
    {
      personKey: CHILD,
      personName: { surname: 'Otieno', firstName: 'Brenda' },
      ...statementDates,
      incomeNil: true,
      income: [],
      assetsNil: false,
      assets: [
        {
          id: I.childFund,
          type: 'securities',
          description: 'Unit trust savings for school fees',
          value: kes(120_000),
          location: kenya('Kisumu'),
          joint: sole,
          change: unchanged,
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
    freeText:
      'The Milimani house is held jointly with my wife. The rent is from a bedsitter block built in 2025 on family land in Kondele.',
  },
  attestation: {
    text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
    declaredAt: '2026-03-28T07:42:00.000Z',
    reference: 'DCI-TSC-2026-0003418-P',
  },
};
/** The flags on case `mine`, as review.yaml's `Flag`, for the version `versionId`. */
export function mockFlags(versionId: string): Flag[] {
  const flag = (
    id: string,
    ruleId: Flag['ruleId'],
    severity: Flag['severity'],
    title: string,
    indicator: string,
    itemRefs: Flag['itemRefs'],
    evidence: Flag['evidence'] = {},
  ): Flag => ({
    id,
    versionId,
    ruleId,
    severity,
    title,
    indicator,
    evidence,
    itemRefs,
    closedReason: null,
    reviewed: null,
    recomputed: false,
  });
  return [
    flag(
      F.valueChange,
      'value-change-25',
      'high',
      'Value changed by 150% since the previous declaration',
      'The plot is valued 150% higher than in the 2024 declaration.',
      [{ personKey: OFFICER, itemId: I.plot, sectionKey: STATEMENT }],
      { changePercent: 150, direction: 'up' },
    ),
    flag(
      F.acquisition,
      'acquisition-unflagged',
      'medium',
      'New item not marked as acquired',
      'The money market fund units appear for the first time, without an acquisition mark.',
      [{ personKey: OFFICER, itemId: I.fund, sectionKey: STATEMENT }],
      { category: 'assets' },
    ),
    flag(
      F.growth,
      'income-vs-asset-growth',
      'medium',
      'Assets grew faster than income',
      'Declared assets grew by more than the income declared for the period.',
      [],
      { growthToIncome: 1.4 },
    ),
    flag(
      F.foreign,
      'foreign-holdings',
      'info',
      'Holdings outside Kenya',
      'One asset is held outside Kenya.',
      [{ personKey: OFFICER, itemId: I.saccoShares, sectionKey: STATEMENT }],
      { items: 1, countries: ['UG'] },
    ),
    {
      ...flag(
        F.late,
        'late-filing',
        'low',
        'Filed after the due date',
        'The declaration was submitted 4 days after the due date.',
        [],
        { dueDate: '2026-03-31', submittedOn: '2026-04-04', daysLate: 4 },
      ),
      reviewed: {
        at: '2026-09-20T09:12:00.000Z',
        by: { subject: 'f7a0c1de-0000-4000-8000-000000000009', name: 'Peter Mwangi' },
        note: 'Leave records confirm he was on medical leave.',
      },
    },
  ];
}

const DISCLAIMER = 'Indicators, not findings. A named officer decides.';

function label(task: string, promptVersion: number, generatedAt: string) {
  return {
    aiAssisted: true,
    task,
    promptVersion,
    provider: 'anthropic',
    model: 'claude-opus-5',
    generatedAt,
    disclaimer: DISCLAIMER,
  };
}

const ref = (
  personKey: string | null,
  itemId: string | null,
  sectionKey: string | null = null,
) => ({
  sectionKey,
  personKey,
  itemId,
  fieldPath: null,
});

/** The `SummarizeDeclarationOutput` for case `mine`. */
export function mockSummary(generatedAt: string): Record<string, unknown> {
  return {
    label: label('summarize-declaration', 3, generatedAt),
    overview:
      'Biennial declaration by John Kennedy Otieno, Senior Teacher at Kisumu Girls High School, as at 31 Dec 2025. It covers 1 spouse and 1 child. Household totals: income KES 4,560,000 for the period, assets KES 16,820,000 and liabilities KES 3,400,000.',
    changesSincePrevious: [
      {
        text: 'Plot Kisumu/Manyatta/1234 (John Otieno) rose 150%, from KES 1,800,000 to KES 4,500,000. Not marked as changed.',
        refs: [ref(OFFICER, I.plot)],
      },
      {
        text: 'CIC Money Market Fund units (John Otieno) is new in this version, KES 850,000. Not marked as acquired.',
        refs: [ref(OFFICER, I.fund)],
      },
      {
        text: 'Rent from a bedsitter block in Kondele (John Otieno) is a new income source, KES 480,000. Marked as a new source.',
        refs: [ref(OFFICER, I.rent)],
      },
    ],
    sections: [
      {
        sectionKey: `statement:${OFFICER}`,
        text: 'Income KES 3,600,000 from 2 sources, mainly salary (KES 3,120,000). 4 assets worth KES 16,350,000, largest: Three-bedroom house in Milimani (KES 9,800,000). Liabilities KES 3,400,000. 1 asset outside Kenya.',
        refs: [ref(OFFICER, I.salary), ref(OFFICER, I.house), ref(OFFICER, I.mortgage)],
      },
      {
        sectionKey: `statement:${SPOUSE}`,
        text: 'Income KES 960,000 from a cereals shop. One asset worth KES 350,000 (Shop stock).',
        refs: [ref(SPOUSE, I.shop), ref(SPOUSE, I.stock)],
      },
      {
        sectionKey: `statement:${CHILD}`,
        text: 'One asset worth KES 120,000 (Unit trust savings for school fees).',
        refs: [ref(CHILD, I.childFund)],
      },
    ],
    worthAttention: [
      {
        text: 'The Manyatta plot rose 150% in value without a change mark or a recorded improvement.',
        flagIds: [F.valueChange, F.growth],
      },
      {
        text: 'The money market fund units are new but not marked as acquired.',
        flagIds: [F.acquisition],
      },
    ],
  };
}

/** The `ExplainFlagsOutput` for case `mine`: every flag but the late filing. */
export function mockExplanations(generatedAt: string): Record<string, unknown> {
  return {
    label: label('explain-flags', 2, generatedAt),
    explanations: [
      {
        flagId: F.valueChange,
        meaning:
          'The value of an item changed by 25% or more since the previous version. Revaluations are common, but the change should be explained.',
        whatToCheck: [
          'Compare both values in the version comparison.',
          'Look for a valuation report attached to the item.',
          'Check whether the declarant marked the change.',
        ],
        typicalResolution:
          'A valuation, improvement or market reason that fits the size of the change.',
        refs: [ref(OFFICER, I.plot)],
      },
      {
        flagId: F.acquisition,
        meaning:
          'An item appears for the first time in this version, but the declarant did not mark it as acquired.',
        whatToCheck: [
          'Confirm the item is new and not a renamed older item.',
          'Check whether income for the period can fund it.',
          'Read "Other information" for an explanation.',
        ],
        typicalResolution: 'The declarant confirms when and how it was acquired.',
        refs: [ref(OFFICER, I.fund)],
      },
      {
        flagId: F.growth,
        meaning:
          'Total declared assets grew by more than the total income declared for the period.',
        whatToCheck: [
          'Look for revaluations, gifts, inheritance or loans that explain the growth.',
          'Compare totals in the version comparison.',
        ],
        typicalResolution: 'A source of funds that explains the growth.',
        refs: [ref(OFFICER, null, 'assets')],
      },
      {
        flagId: F.foreign,
        meaning:
          'The declaration includes assets or income held outside Kenya. This is context, not a concern in itself.',
        whatToCheck: [
          'Check that values are in Kenya shillings as at the statement date.',
          'Look for a supporting statement.',
        ],
        typicalResolution: 'Usually nothing beyond checking the conversion.',
        refs: [ref(OFFICER, I.saccoShares)],
      },
    ],
  };
}

interface StoredCopilot {
  view: CopilotView;
  /** When a pending or stale copilot turns ready on its next read; null keeps it as it is. */
  readyAt: number | null;
  /**
   * The ratings of the reviewer holding the case (the only one who rates), by job and block:
   * everyone reading the panel sees them, as review.yaml `CopilotView.feedback` has it.
   */
  ratings: Map<string, CopilotView['feedback'][number]>;
  /** Whose declaration the outputs are about. */
  declarant: MockDeclarant | null;
}

/** A mock case's declarant, when it is not the mock declaration's John Kennedy Otieno. */
export interface MockDeclarant {
  firstName: string;
  otherNames?: string;
  surname: string;
}

/** An output of the mock declaration, about another declarant. */
function about<T extends Record<string, unknown>>(output: T, declarant: MockDeclarant | null): T {
  if (!declarant) return output;
  const full = [declarant.firstName, declarant.otherNames, declarant.surname]
    .filter(Boolean)
    .join(' ');
  const short = `${declarant.firstName} ${declarant.surname}`;
  return JSON.parse(
    JSON.stringify(output).replaceAll('John Kennedy Otieno', full).replaceAll('John Otieno', short),
  ) as T;
}

const store = new Map<string, StoredCopilot>();

interface StoredDraft {
  caseId: string;
  requester: string;
  readyAt: number;
  draft: Record<string, unknown> & { status: 'pending' | 'ready' | 'failed' };
  ready: Record<string, unknown>;
}

const drafts = new Map<string, StoredDraft>();
/** Drafts by `subject|case|Idempotency-Key`, so a retry answers the same draft. */
const draftKeys = new Map<string, string>();
let delayOnFirstRead: { caseId: string; ms: number } | null = null;

function readyView(
  versionId: string,
  generatedAt: string,
  declarant: MockDeclarant | null,
): CopilotView {
  return {
    status: 'ready',
    forVersionId: versionId,
    generatedAt,
    failureReason: null,
    summary: about(mockSummary(generatedAt), declarant),
    explanations: about(mockExplanations(generatedAt), declarant),
    jobs: { summarize: crypto.randomUUID(), explain: crypto.randomUUID() },
    feedback: [],
  };
}

/** The ai-gateway's gate refuses every case (REVIEW_MOCK_COPILOT=not-enabled). */
let aiOff = false;

/** Turns the gateway's gate off for every case, or back on (tests). */
export function setMockAiOff(off: boolean) {
  aiOff = off;
}

/** How a mock case's copilot starts: ready, pending (ready `readyAfterMs` after its first read), or AI off. */
export interface CopilotSeed {
  caseId: string;
  state: 'ready' | 'pending' | 'not-enabled';
  readyAfterMs?: number;
  /** Whose declaration it is, when not the mock declaration's own declarant. */
  declarant?: MockDeclarant;
}

/**
 * Seeds the copilot of each mock case; the case's current version id is the case id, as in the
 * review mock. Ready outputs were generated 3 hours before `now`.
 */
export function resetCopilotMock(
  now: number,
  seeds: CopilotSeed[],
  { notEnabled = false }: { notEnabled?: boolean } = {},
) {
  aiOff = notEnabled;
  store.clear();
  drafts.clear();
  draftKeys.clear();
  delayOnFirstRead = null;
  const generatedAt = new Date(now - 3 * 3_600_000).toISOString();
  for (const seed of seeds) {
    const { caseId, readyAfterMs, declarant = null } = seed;
    // REVIEW_MOCK_COPILOT=not-enabled: no case's copilot is enabled.
    const state = notEnabled ? 'not-enabled' : seed.state;
    const ready = readyView(caseId, generatedAt, declarant);
    const view: CopilotView =
      state === 'ready'
        ? ready
        : {
            ...ready,
            status: state,
            generatedAt: null,
            summary: null,
            explanations: null,
          };
    store.set(caseId, { view, readyAt: null, ratings: new Map(), declarant });
    if (state === 'pending' && readyAfterMs !== undefined) {
      delayOnFirstRead = { caseId, ms: readyAfterMs };
    }
  }
}

/**
 * Puts a case's copilot in a state (tests): `readyAt` makes a pending or stale copilot ready on
 * the first read at or after that time.
 */
export function setMockCopilot(
  caseId: string,
  view: Partial<CopilotView>,
  readyAt: number | null = null,
) {
  const stored = store.get(caseId);
  if (!stored) throw new Error(`No mock copilot for case ${caseId}`);
  stored.view = { ...stored.view, ...view };
  stored.readyAt = readyAt;
}

function current(caseId: string, stored: StoredCopilot, now: number): CopilotView {
  if (delayOnFirstRead?.caseId === caseId) {
    stored.readyAt = now + delayOnFirstRead.ms;
    delayOnFirstRead = null;
  }
  const { view, readyAt } = stored;
  if (
    (view.status === 'pending' || view.status === 'stale') &&
    readyAt !== null &&
    now >= readyAt
  ) {
    const generatedAt = new Date(now).toISOString();
    stored.view = {
      ...view,
      status: 'ready',
      generatedAt,
      failureReason: null,
      summary: about(mockSummary(generatedAt), stored.declarant),
      explanations: about(mockExplanations(generatedAt), stored.declarant),
    };
    stored.readyAt = null;
  }
  return stored.view;
}

function forCaller(stored: StoredCopilot, view: CopilotView): CopilotView {
  return { ...view, feedback: [...stored.ratings.values()] };
}

/** What a flag usually asks of the declarant, by rule (the gateway's draft picks its own). */
const DRAFT_REQUIREMENT: Partial<Record<Flag['ruleId'], 'provide-omitted' | 'correct'>> = {
  'acquisition-unflagged': 'provide-omitted',
  'foreign-holdings': 'correct',
};

const DRAFT_TEXT = {
  en: {
    flag: (flag: Flag) =>
      `${flag.indicator} Please explain this and attach any documents that support your explanation.`,
    item: (description: string) =>
      `Please explain the value declared for ${description} and attach supporting documents.`,
    opening:
      'Thank you for your biennial declaration. The points below relate to changes since your previous declaration.',
  },
  sw: {
    flag: (flag: Flag) =>
      `Tafadhali eleza jambo hili kuhusu ${flag.title.toLowerCase()} na uambatishe nyaraka zinazounga mkono maelezo yako.`,
    item: (description: string) =>
      `Tafadhali eleza thamani iliyotangazwa ya ${description} na uambatishe nyaraka zinazounga mkono.`,
    opening:
      'Asante kwa tamko lako. Mambo yaliyo hapa chini yanahusu mabadiliko tangu tamko lako lililopita.',
  },
} as const;

interface DeclaredItem {
  personKey: string;
  description: string;
}

/** The mock declaration's items by id, with whose statement they are in. */
function declaredItems(): Map<string, DeclaredItem> {
  const found = new Map<string, DeclaredItem>();
  const statements = MOCK_DECLARATION.statements as Record<string, unknown>[];
  for (const statement of statements) {
    for (const category of ['income', 'assets', 'liabilities']) {
      for (const item of statement[category] as Record<string, unknown>[]) {
        found.set(item.id as string, {
          personKey: statement.personKey as string,
          description: item.description as string,
        });
      }
    }
  }
  return found;
}

const selectionNotOnCase = () =>
  json(400, {
    type: 'selection-not-on-case',
    title: 'Bad Request',
    status: 400,
    detail: 'A selected flag or item is not on this case.',
    code: 'selection-not-on-case',
  });

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The ready answer to a draft request: an item per flag, then per item, and an opening. */
function draftFor(
  caseId: string,
  flagIds: string[],
  itemIds: string[],
  language: 'en' | 'sw',
  now: number,
): Record<string, unknown> | null {
  const flags = mockFlags(caseId);
  const items = declaredItems();
  const text = DRAFT_TEXT[language];
  const drafted: Record<string, unknown>[] = [];
  for (const flagId of flagIds) {
    const flag = flags.find((each) => each.id === flagId);
    if (!flag) return null;
    const ref = flag.itemRefs[0];
    const personKey = ref?.personKey ?? OFFICER;
    drafted.push({
      sectionKey: `statement:${personKey}`,
      personKey,
      itemId: ref?.itemId ?? null,
      requirement: DRAFT_REQUIREMENT[flag.ruleId] ?? 'explain-discrepancy',
      text: text.flag(flag),
    });
  }
  for (const itemId of itemIds) {
    const item = items.get(itemId);
    if (!item) return null;
    drafted.push({
      sectionKey: `statement:${item.personKey}`,
      personKey: item.personKey,
      itemId,
      requirement: 'explain-discrepancy',
      text: text.item(item.description),
    });
  }
  return {
    jobId: crypto.randomUUID(),
    label: label('draft-clarification', 2, new Date(now).toISOString()),
    opening: text.opening,
    items: drafted,
    failureReason: null,
  };
}

function draftAnswer(stored: StoredDraft, now: number): Response {
  if (stored.draft.status === 'pending' && now >= stored.readyAt) {
    stored.draft = { ...stored.draft, ...stored.ready, status: 'ready' };
  }
  return json(stored.draft.status === 'pending' ? 202 : 200, stored.draft);
}

async function requestDraft(
  request: Request,
  caseId: string,
  caller: Assignee,
  held: boolean,
): Promise<Response> {
  if (!held) return problem(403, 'Only the reviewer holding the case drafts with AI');
  const stored = store.get(caseId);
  if (stored?.view.status === 'not-enabled') {
    return json(409, {
      type: 'ai-not-enabled',
      title: 'Conflict',
      status: 409,
      detail: 'AI assistance is not enabled for this Commission.',
      code: 'ai-not-enabled',
    });
  }
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key required');
  const replay = draftKeys.get(`${caller.subject}|${caseId}|${key}`);
  const replayed = replay ? drafts.get(replay) : undefined;
  if (replayed) return draftAnswer(replayed, Date.now());

  const body = await readJson(request);
  const flagIds = isRecord(body) && Array.isArray(body.flagIds) ? body.flagIds : null;
  const itemRefs = isRecord(body) && Array.isArray(body.itemRefs) ? body.itemRefs : null;
  const language = isRecord(body) ? body.language : null;
  if (!flagIds || !itemRefs || (language !== 'en' && language !== 'sw')) {
    return problem(400, 'Invalid draft request');
  }
  const itemIds = itemRefs.map((ref) => (isRecord(ref) ? ref.itemId : null));
  if (
    flagIds.length + itemIds.length === 0 ||
    flagIds.length + itemIds.length > 50 ||
    !flagIds.every((id) => typeof id === 'string') ||
    !itemIds.every((id) => typeof id === 'string')
  ) {
    return selectionNotOnCase();
  }
  const ready = draftFor(caseId, flagIds, itemIds, language, Date.now());
  if (!ready) return selectionNotOnCase();

  await wait(MOCK_DRAFT_WAIT_MS);
  const now = Date.now();
  const id = crypto.randomUUID();
  const picks = flagIds.length + itemIds.length;
  const draft: StoredDraft['draft'] = flagIds.includes(F.foreign)
    ? {
        id,
        status: 'failed',
        jobId: ready.jobId,
        label: null,
        opening: null,
        items: [],
        failureReason: 'provider-unavailable',
      }
    : picks >= 3
      ? {
          id,
          status: 'pending',
          jobId: ready.jobId,
          label: null,
          opening: null,
          items: [],
          failureReason: null,
        }
      : { id, status: 'ready', ...ready };
  const kept: StoredDraft = {
    caseId,
    requester: caller.subject,
    readyAt: now + MOCK_DRAFT_DELAY_MS - MOCK_DRAFT_WAIT_MS,
    draft,
    ready,
  };
  drafts.set(id, kept);
  draftKeys.set(`${caller.subject}|${caseId}|${key}`, id);
  return draftAnswer(kept, now);
}

const SUMMARY_BLOCKS = new Set(['overview', 'changes', 'sections', 'worth-attention']);
const RATINGS = new Set(['helpful', 'not-helpful']);
const REASONS = new Set(['inaccurate', 'missed-something', 'unclear', 'too-long', 'other']);

/**
 * Answers a copilot request, or returns null when the path is not a copilot one. `holds` says
 * whether the caller holds the case (null: no such case).
 */
export async function copilotRoute(
  request: Request,
  caller: Assignee,
  holds: (caseId: string) => boolean | null,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const now = Date.now();

  const draftRequest = /^\/v1\/review\/cases\/([^/]+)\/copilot\/drafts$/.exec(pathname);
  if (draftRequest?.[1] && method === 'POST') {
    const held = holds(draftRequest[1]);
    if (held === null || !store.has(draftRequest[1])) return problem(404, 'Not found');
    return requestDraft(request, draftRequest[1], caller, held);
  }

  const draftPoll = /^\/v1\/review\/copilot\/drafts\/([^/]+)$/.exec(pathname);
  if (draftPoll?.[1] && method === 'GET') {
    const stored = drafts.get(draftPoll[1]);
    if (stored?.requester !== caller.subject) return problem(404, 'Not found');
    return draftAnswer(stored, now);
  }

  const view = /^\/v1\/review\/cases\/([^/]+)\/copilot(\/refresh)?$/.exec(pathname);
  if (view?.[1]) {
    const caseId = view[1];
    const stored = store.get(caseId);
    const held = holds(caseId);
    if (!stored || held === null) return problem(404, 'Not found');
    if (method === 'GET' && !view[2]) {
      return json(200, forCaller(stored, current(caseId, stored, now)));
    }
    if (method === 'POST' && view[2]) {
      if (!held) return problem(403, 'Only the reviewer holding the case or a supervisor');
      const { status } = current(caseId, stored, now);
      if (status === 'pending' || status === 'stale') return problem(409, 'Already pending');
      // Not enabled is asked again: the gateway decides. While AI is still off for the
      // Commission, the new jobs are blocked at once and the view stays not enabled.
      if (status === 'not-enabled' && aiOff) return json(202, forCaller(stored, stored.view));
      stored.view = {
        ...stored.view,
        status: 'pending',
        failureReason: null,
        summary: null,
        explanations: null,
        jobs: { summarize: crypto.randomUUID(), explain: crypto.randomUUID() },
      };
      stored.readyAt = now + MOCK_COPILOT_DELAY_MS;
      return json(202, forCaller(stored, stored.view));
    }
    return null;
  }

  const rate = /^\/v1\/review\/copilot\/outputs\/([^/]+)\/feedback$/.exec(pathname);
  if (rate?.[1] && method === 'PUT') {
    const jobId = rate[1];
    const [caseId, stored] =
      [...store.entries()].find(
        ([
          ,
          {
            view: { jobs },
          },
        ]) => jobs.summarize === jobId || jobs.explain === jobId,
      ) ?? [];
    if (!caseId || !stored || holds(caseId) === null) return problem(404, 'Not found');
    if (!holds(caseId)) return problem(403, 'Only the reviewer holding the case rates its copilot');
    const body = await readJson(request);
    const valid =
      isRecord(body) &&
      RATINGS.has(body.rating as string) &&
      (body.reason === null || REASONS.has(body.reason as string)) &&
      (body.note === null || (typeof body.note === 'string' && body.note.length <= 1000));
    if (!valid) return problem(400, 'Invalid rating');
    // The block must be one the output has: a summary block, or a flag the explanations cover.
    const block = typeof body.block === 'string' ? body.block : null;
    const explained = new Set(
      (isRecord(stored.view.explanations) && Array.isArray(stored.view.explanations.explanations)
        ? stored.view.explanations.explanations
        : []
      ).map((each: unknown) => (isRecord(each) ? `flag:${String(each.flagId)}` : '')),
    );
    const known =
      stored.view.jobs.summarize === jobId
        ? block !== null && SUMMARY_BLOCKS.has(block)
        : block !== null && explained.has(block);
    if (!known) return problem(400, 'The output has no such block', 'unknown-block');
    stored.ratings.set(`${jobId} ${block}`, {
      jobId,
      block,
      rating: body.rating as 'helpful' | 'not-helpful',
    });
    return new Response(null, { status: 200 });
  }
  return null;
}
