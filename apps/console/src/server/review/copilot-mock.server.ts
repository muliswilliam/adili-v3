/**
 * In-memory stand-in for the review service's copilot endpoints (review.yaml, spec 07c), part of
 * the review mock (`mock.server.ts`, REVIEW_MOCK) until the review service implements them
 * (#283, #284). Also the declaration document and flags the mock's case `mine` carries, so the
 * summary's source refs and flag explanations resolve against them.
 *
 * - Case `mine`: ready, generated 3 hours before the store was seeded.
 * - Case `windowClosed`: pending; ready 8 seconds after its first read.
 * - Case `peters`: ready, held by Peter Mwangi (view only for everyone else).
 *
 * Refresh (the holder only, else 403; 409 while pending or stale, or when AI is not enabled)
 * starts new jobs that are ready 6 seconds later. Ratings are kept per caller and job, and the
 * view lists the caller's own. Tests put a case in any state with `setMockCopilot`.
 */
import { isRecord, json, problem, readJson } from '../mock-http';
import type { Assignee, CaseDetail, CopilotView, Flag } from './types';

export const MOCK_COPILOT_DELAY_MS = 6_000;

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
const F = MOCK_FLAG_IDS;
const kes = (shillings: number) => ({ kesCents: shillings * 100 });
const unchanged = { changed: false };

/** A trimmed `declaration.v1` document: the parts the review screens read. */
export const MOCK_DECLARATION: Record<string, unknown> = {
  schemaVersion: 'declaration.v1',
  type: 'biennial',
  statementDate: '2025-12-31',
  incomePeriod: { from: '2024-01-01', to: '2025-12-31', fromSource: 'declared' },
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
      incomeNil: false,
      income: [
        {
          id: I.salary,
          type: 'salary-emoluments',
          description: 'Salary from the Teachers Service Commission',
          amount: kes(3_120_000),
          change: unchanged,
        },
        {
          id: I.rent,
          type: 'rent',
          description: 'Rent from a bedsitter block in Kondele',
          amount: kes(480_000),
          change: { changed: true, kind: 'new-source' },
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: I.plot,
          type: 'land',
          description: 'Plot Kisumu/Manyatta/1234',
          value: kes(4_500_000),
          change: unchanged,
        },
        {
          id: I.house,
          type: 'building',
          description: 'Three-bedroom house in Milimani',
          value: kes(9_800_000),
          change: unchanged,
        },
        {
          id: I.fund,
          type: 'securities',
          description: 'CIC Money Market Fund units',
          value: kes(850_000),
          change: unchanged,
        },
        {
          id: I.saccoShares,
          type: 'shares',
          description: 'Shares in Mwalimu National SACCO',
          value: kes(1_200_000),
          location: { inKenya: false, country: 'UG' },
          change: unchanged,
        },
      ],
      liabilitiesNil: false,
      liabilities: [
        {
          id: I.mortgage,
          type: 'loan',
          description: 'Mortgage from KCB Bank',
          amount: kes(3_400_000),
          change: unchanged,
        },
      ],
    },
    {
      personKey: SPOUSE,
      personName: { surname: 'Otieno', firstName: 'Lilian', otherNames: 'Akoth' },
      incomeNil: false,
      income: [
        {
          id: I.shop,
          type: 'business',
          description: 'Profit from a cereals shop in Kibuye market',
          amount: kes(960_000),
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
          change: unchanged,
        },
      ],
      liabilitiesNil: true,
      liabilities: [],
    },
    {
      personKey: CHILD,
      personName: { surname: 'Otieno', firstName: 'Brenda' },
      incomeNil: true,
      income: [],
      assetsNil: false,
      assets: [
        {
          id: I.childFund,
          type: 'securities',
          description: 'Unit trust savings for school fees',
          value: kes(120_000),
          change: unchanged,
        },
      ],
      liabilitiesNil: true,
      liabilities: [],
    },
  ],
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
      [{ personKey: OFFICER, itemId: I.plot, sectionKey: 'assets' }],
      { percent: 150 },
    ),
    flag(
      F.acquisition,
      'acquisition-unflagged',
      'medium',
      'New item not marked as acquired',
      'The money market fund units appear for the first time, without an acquisition mark.',
      [{ personKey: OFFICER, itemId: I.fund, sectionKey: 'assets' }],
    ),
    flag(
      F.growth,
      'income-vs-asset-growth',
      'medium',
      'Assets grew faster than income',
      'Declared assets grew by more than the income declared for the period.',
      [{ personKey: OFFICER, itemId: null, sectionKey: 'assets' }],
      { percent: 38 },
    ),
    flag(
      F.foreign,
      'foreign-holdings',
      'info',
      'Holdings outside Kenya',
      'One asset is held outside Kenya.',
      [{ personKey: OFFICER, itemId: I.saccoShares, sectionKey: 'assets' }],
    ),
    {
      ...flag(
        F.late,
        'late-filing',
        'low',
        'Filed after the due date',
        'The declaration was submitted 4 days after the due date.',
        [],
        { days: 4 },
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
  /** Ratings by caller subject, then job id. */
  ratings: Map<string, Map<string, CopilotView['feedback'][number]>>;
}

const store = new Map<string, StoredCopilot>();
let delayOnFirstRead: { caseId: string; ms: number } | null = null;

function readyView(versionId: string, generatedAt: string): CopilotView {
  return {
    status: 'ready',
    forVersionId: versionId,
    generatedAt,
    failureReason: null,
    summary: mockSummary(generatedAt),
    explanations: mockExplanations(generatedAt),
    jobs: { summarize: crypto.randomUUID(), explain: crypto.randomUUID() },
    feedback: [],
  };
}

/**
 * Seeds the copilot of each mock case (`caseIds`: `mine`, `windowClosed`, `peters`); the case id
 * stands in for its version id, as in the review mock.
 */
export function resetCopilotMock(
  now: number,
  caseIds: { mine: string; windowClosed: string; peters: string },
) {
  store.clear();
  const generatedAt = new Date(now - 3 * 3_600_000).toISOString();
  store.set(caseIds.mine, {
    view: readyView(caseIds.mine, generatedAt),
    readyAt: null,
    ratings: new Map(),
  });
  store.set(caseIds.windowClosed, {
    view: {
      ...readyView(caseIds.windowClosed, generatedAt),
      status: 'pending',
      generatedAt: null,
      summary: null,
      explanations: null,
    },
    readyAt: null,
    ratings: new Map(),
  });
  delayOnFirstRead = { caseId: caseIds.windowClosed, ms: 8_000 };
  store.set(caseIds.peters, {
    view: readyView(caseIds.peters, generatedAt),
    readyAt: null,
    ratings: new Map(),
  });
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

/** The mock case's flags and document for the case detail, when it has a copilot. */
export function mockCaseContent(caseId: string): Pick<CaseDetail, 'flags' | 'document'> {
  return store.has(caseId)
    ? { flags: mockFlags(caseId), document: MOCK_DECLARATION }
    : { flags: [], document: null };
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
      summary: mockSummary(generatedAt),
      explanations: mockExplanations(generatedAt),
    };
    stored.readyAt = null;
  }
  return stored.view;
}

function forCaller(stored: StoredCopilot, view: CopilotView, caller: Assignee): CopilotView {
  return { ...view, feedback: [...(stored.ratings.get(caller.subject)?.values() ?? [])] };
}

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

  const view = /^\/v1\/review\/cases\/([^/]+)\/copilot(\/refresh)?$/.exec(pathname);
  if (view?.[1]) {
    const caseId = view[1];
    const stored = store.get(caseId);
    const held = holds(caseId);
    if (!stored || held === null) return problem(404, 'Not found');
    if (method === 'GET' && !view[2]) {
      return json(200, forCaller(stored, current(caseId, stored, now), caller));
    }
    if (method === 'POST' && view[2]) {
      if (!held) return problem(403, 'Only the officer holding the case or a supervisor');
      const { status } = current(caseId, stored, now);
      if (status === 'pending' || status === 'stale') return problem(409, 'Already pending');
      if (status === 'not-enabled') return problem(409, 'AI assistance is not enabled');
      stored.view = {
        ...stored.view,
        status: 'pending',
        failureReason: null,
        summary: null,
        explanations: null,
        jobs: { summarize: crypto.randomUUID(), explain: crypto.randomUUID() },
      };
      stored.readyAt = now + MOCK_COPILOT_DELAY_MS;
      return json(202, forCaller(stored, stored.view, caller));
    }
    return null;
  }

  const rate = /^\/v1\/review\/copilot\/outputs\/([^/]+)\/feedback$/.exec(pathname);
  if (rate?.[1] && method === 'PUT') {
    const jobId = rate[1];
    const stored = [...store.values()].find(
      ({ view: { jobs } }) => jobs.summarize === jobId || jobs.explain === jobId,
    );
    if (!stored) return problem(404, 'Not found');
    const body = await readJson(request);
    const valid =
      isRecord(body) &&
      RATINGS.has(body.rating as string) &&
      (body.reason === null || REASONS.has(body.reason as string)) &&
      (body.note === null || (typeof body.note === 'string' && body.note.length <= 1000));
    if (!valid) return problem(400, 'Invalid rating');
    const mine =
      stored.ratings.get(caller.subject) ?? new Map<string, CopilotView['feedback'][number]>();
    mine.set(jobId, { jobId, rating: body.rating as 'helpful' | 'not-helpful' });
    stored.ratings.set(caller.subject, mine);
    return new Response(null, { status: 200 });
  }
  return null;
}
