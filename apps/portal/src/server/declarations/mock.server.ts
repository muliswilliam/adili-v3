/**
 * In-memory stand-in for the declarations service (declarations.yaml), in two parts with a flag
 * each: the declarant's obligations (OBLIGATIONS_MOCK, spec 04), and declaration drafts
 * (DECLARATIONS_MOCK), to work on the portal without the service and for spec 05's
 * endpoints until the service implements them (#115). Requests of a part that is off go to the
 * real service, so real obligations work with mocked drafts. Every signed-in caller shares one
 * draft store; the service scopes drafts to their owner.
 *
 * The declarant's obligations and their detail come from `./mock/obligations.ts`, by the token's
 * person. A declaration can be started for any of those (or, with the obligations mock off, for
 * any obligation the real service shows the caller), or for one of these (`MOCK_OBLIGATIONS`,
 * for tests, not listed):
 * - Teachers Service Commission, biennial 2027: upcoming, statement date 1 Nov 2027, income
 *   period assumed (S1). A draft can be prepared; submission waits for the statement date.
 * - Public Service Commission, initial: due, statement date 10 Sep 2026.
 * - National Police Service Commission, final: filed, so starting answers 409.
 * - Parliamentary Service Commission, biennial 2025: cancelled, so starting answers 409.
 *
 * Starting a declaration creates the bio (pre-filled from the Commission's roster), household,
 * the officer's statement and other information; a second start returns the same draft (200).
 * The TSC roster has HR values (marital status, job group, date of appointment, work station)
 * that pre-fill the bio; the PSC roster has none, so those stay empty (spec 05b S8). The PSC
 * draft's officer statement starts with two assets accepted from registries (NTSA, ArdhiSasa),
 * so source badges show (S11).
 * Every save needs `If-Match` with the current draft version (412 when stale, 428 when missing)
 * and bumps the version; the roster fields answer 400 `identity-locked-field` and a nil flag
 * with items answers 400 `nil-conflicts-with-items` (S4, S8). Household saves create, archive
 * and restore statements (S5). Completeness rules per section live in `./mock/*.ts`.
 *
 * Registry lookups, document extraction, suggestions, accept and dismiss (spec 05b) live in
 * `./mock/suggestions.ts`.
 *
 * Submission (spec 06) follows the service's preconditions in order: the declaration is a draft
 * (409 `not-a-draft`), `Idempotency-Key` is present (400) and a replay answers the stored 201,
 * the token has a step-up at most five minutes old (403 `step-up-required` with `stepUpUrl`,
 * see `./mock/submission.ts`), nothing blocks (400 `incomplete` with the blocking issues), and
 * the obligation is open: before its statement date 409 `before-statement-date`, cancelled 409
 * `obligation-cancelled`, an amendment after the due date 409 `amendment-window-closed`. Then
 * the declaration is `submitted` with a new version: the reference is allocated on version 1
 * (`DCB-TSC-2027-0000001-B`), `late` when after the due date, the acknowledgement `pending`,
 * and the obligations mock reads its obligation `filed` from then on.
 * Summaries answer `cannotSubmitReason` as the service does (the refusal first, then
 * `incomplete`), `canSubmit` when there is none, and `late` after the due date. The slip is
 * issued a few seconds later, or reads failed a minute on, when it can be asked for again
 * (`./mock/acknowledgement.ts`).
 *
 * Amendments follow the service too: amend reopens a submitted declaration until its due date
 * (after it 409 `amendment-window-closed`, a draft 409 `not-submitted`, an amendment in progress
 * answered as it is) with the sections as the version in force filed them; discarding the
 * amendment puts them back and the declaration is `submitted` again. Each version keeps its
 * document (`GET /v1/declarations/{id}/versions/{n}`). "My declarations" rows carry the
 * reference, the version in force (submitted at, late, slip), and `amendable`.
 *
 * Tests can make the next saves fail (`failNextSaves`) or submits fail (`failNextSubmits`), make
 * slips never come (`setSlipIssuance`),
 * simulate an edit on another device (`editElsewhere`), make registries answer at once
 * (`setLookupDelay(0)`) or play a Commission without AI (`setExtractionEnabled(false)`).
 */
import { createHash, randomUUID } from 'node:crypto';

import type {
  AssetItem,
  Attachment,
  Draft,
  Household,
  MaritalStatus,
  Officer,
  PersonName,
  Statement,
} from '../../declaration/contents';
import { ATTESTATION_TEXT } from '../../declaration/contents';
import { isSectionKey, sectionKind } from '../../declaration/section-key';
import { mockUpload } from '../documents/mock.server';
import { bioCompleteness, lockedFieldsChanged } from './mock/bio';
import type { RuleContext } from './mock/context';
import {
  deriveHousehold,
  fullName,
  householdCompleteness,
  householdPersons,
} from './mock/household';
import { isRecord, json, noContent, problem, readJson } from '../mock-http';
import {
  readAcknowledgement,
  reissueAcknowledgement,
  resetAcknowledgementMock,
  slipRequested,
} from './mock/acknowledgement';
import {
  anyMockObligation,
  fileMockObligation,
  isObligationRead,
  obligationReads,
  resetObligationsMock,
} from './mock/obligations';
import { composeMaterialChanges, otherCompleteness } from './mock/other';
import { nilConflictsWithItems, statementCompleteness } from './mock/statement';
import {
  allocateReference,
  filingWindow,
  hasStepUp,
  type MockFiling,
  pendingAcknowledgement,
  resetSubmissionMock,
} from './mock/submission';
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  newSuggestionState,
  requestExtraction,
  requestLookups,
  resetSuggestionsMock,
  type SuggestionState,
} from './mock/suggestions';
import type {
  CommissionRef,
  CompletenessIssue,
  Declaration,
  DeclarationAttachment,
  DeclarationListItem,
  DeclarationSection,
  DeclarationSummary,
  DeclarationVersion,
  Obligation,
  SectionSaveResult,
  SubmissionResult,
} from './types';

const COMMISSIONS = {
  tsc: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
  psc: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
  npsc: { slug: 'npsc', issuerCode: 'NPSC', name: 'National Police Service Commission' },
  parlsc: { slug: 'parlsc', issuerCode: 'PSCK', name: 'Parliamentary Service Commission' },
} satisfies Record<string, CommissionRef>;

/** HR values a roster may hold; each pre-fills the bio and stays editable (spec 05b S8). */
interface RosterHr {
  maritalStatus?: MaritalStatus;
  jobGroup?: string;
  appointmentDate?: string;
  workStation?: string;
}

/** What each Commission's roster says about the demo declarant. */
const ROSTER: Record<
  string,
  { name: PersonName; designation: string; employer: string; file: string; hr?: RosterHr }
> = {
  tsc: {
    name: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' },
    designation: 'Deputy Principal',
    employer: 'Nyeri High School',
    file: 'TSC/999999',
    hr: {
      maritalStatus: 'married',
      jobGroup: 'D3 (T-Scale 13)',
      appointmentDate: '2026-09-02',
      workStation: 'Eldoret, Uasin Gishu',
    },
  },
  psc: {
    name: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' },
    designation: 'Principal Accountant',
    employer: 'State Department for Devolution',
    file: 'PSC/300400',
  },
};

export const MOCK_OBLIGATIONS = {
  biennial: '0b1e5a1d-5c0a-4d3e-9f10-000000000001',
  initial: '0b1e5a1d-5c0a-4d3e-9f10-000000000002',
  filed: '0b1e5a1d-5c0a-4d3e-9f10-000000000003',
  cancelled: '0b1e5a1d-5c0a-4d3e-9f10-000000000004',
} as const;

const OBLIGATIONS: Obligation[] = [
  {
    id: MOCK_OBLIGATIONS.biennial,
    commission: COMMISSIONS.tsc,
    type: 'biennial',
    cycleKey: 'biennial:2027',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    status: 'upcoming',
    cancelReason: null,
    remindersSent: 0,
    policyVersion: 1,
    createdAt: '2026-09-01T06:00:00Z',
  },
  {
    id: MOCK_OBLIGATIONS.initial,
    commission: COMMISSIONS.psc,
    type: 'initial',
    cycleKey: 'initial:2026-09-10',
    statementDate: '2026-09-10',
    dueDate: '2026-10-10',
    status: 'due',
    cancelReason: null,
    remindersSent: 1,
    policyVersion: 1,
    createdAt: '2026-09-10T06:00:00Z',
  },
  {
    id: MOCK_OBLIGATIONS.filed,
    commission: COMMISSIONS.npsc,
    type: 'final',
    cycleKey: 'final:2026-03-31',
    statementDate: '2026-03-31',
    dueDate: '2026-04-30',
    status: 'filed',
    cancelReason: null,
    remindersSent: 2,
    policyVersion: 1,
    createdAt: '2026-03-31T06:00:00Z',
  },
  {
    id: MOCK_OBLIGATIONS.cancelled,
    commission: COMMISSIONS.parlsc,
    type: 'biennial',
    cycleKey: 'biennial:2025',
    statementDate: '2025-11-01',
    dueDate: '2025-12-31',
    status: 'cancelled',
    cancelReason: 'exited-before-statement-date',
    remindersSent: 0,
    policyVersion: 1,
    createdAt: '2025-09-01T06:00:00Z',
  },
] as Obligation[];

type Header = Omit<
  Declaration,
  'sections' | 'draftVersion' | 'lastSection' | 'updatedAt' | 'status'
>;

interface Stored {
  header: Header;
  status: Declaration['status'];
  draftVersion: number;
  updatedAt: string;
  lastSection: string | null;
  contents: Map<string, Record<string, unknown>>;
  savedAt: Map<string, string | null>;
  /** Statement keys other than the officer's, in schedule order, live and archived. */
  persons: string[];
  archived: Set<string>;
  attachments: Map<string, DeclarationAttachment>;
  suggestions: SuggestionState;
  /** The obligation's dates, kept from when the draft was started. */
  filing: MockFiling;
  /** Submitted versions, oldest first. */
  versions: DeclarationVersion[];
  /** What each version filed, by number: its document, and the sections to reopen it from. */
  filed: Map<number, Filed>;
}

/** A submitted version's content, kept as the service keeps its immutable snapshot. */
interface Filed {
  document: Record<string, unknown>;
  sections: Pick<Stored, 'contents' | 'savedAt' | 'persons' | 'archived' | 'attachments'>;
}

export { setSlipIssuance } from './mock/acknowledgement';
export { setExtractionEnabled, setLookupDelay } from './mock/suggestions';

const store = new Map<string, Stored>();
/** Submissions by Idempotency-Key: the declaration they filed and the 201 to replay. */
const submissions = new Map<string, { declarationId: string; result: SubmissionResult }>();
let failingSaves = 0;
let failingSubmits = 0;

/** Clears every draft (tests). */
export function resetDeclarationsMock() {
  store.clear();
  submissions.clear();
  failingSaves = 0;
  failingSubmits = 0;
  resetSuggestionsMock();
  resetSubmissionMock();
  resetAcknowledgementMock();
  resetObligationsMock();
}

/** The next `count` section saves answer 503 (tests). */
export function failNextSaves(count: number) {
  failingSaves = count;
}

/** The next `count` submits answer 503 before doing anything (tests). */
export function failNextSubmits(count: number) {
  failingSubmits = count;
}

/** Bumps a draft's version as if another device saved it, so the next save gets 412 (tests). */
export function editElsewhere(declarationId: string) {
  const stored = store.get(declarationId);
  if (stored) stored.draftVersion += 1;
}

/** The parts of the service the mock answers; the others go to the real service. */
export interface DeclarationsMockParts {
  /** The declarant's obligations and one obligation's detail (OBLIGATIONS_MOCK). */
  obligations: boolean;
  /**
   * Everything else: drafts, submission, versions, amendments and acknowledgements
   * (DECLARATIONS_MOCK).
   */
  declarations: boolean;
}

/** A client fetch answering `parts` in memory and passing the rest to the real service. */
export function declarationsMock(
  parts: DeclarationsMockParts,
  realFetch: typeof fetch = fetch,
): (request: Request, init?: RequestInit) => Promise<Response> {
  return (request, init) => route(request, parts, (real) => realFetch(real, init));
}

/** The whole service in memory (tests). */
export function mockDeclarationsFetch(request: Request): Promise<Response> {
  return route(request, { obligations: true, declarations: true }, () =>
    Promise.reject(new Error('every part is mocked')),
  );
}

type RealService = (request: Request) => Promise<Response>;

async function route(
  request: Request,
  parts: DeclarationsMockParts,
  real: RealService,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const path = decodeURIComponent(pathname);
  const method = request.method;

  if (isObligationRead(request, path)) {
    return parts.obligations ? (obligationReads(request, path) ?? real(request)) : real(request);
  }
  if (!parts.declarations) return real(request);
  if (method === 'GET' && path === '/v1/me/declarations') return myDeclarations();

  const start = /^\/v1\/obligations\/([^/]+)\/declaration$/.exec(path);
  if (method === 'POST' && start?.[1]) {
    const obligationId = start[1];
    const obligation = parts.obligations
      ? mockObligation(obligationId)
      : await realObligation(request, obligationId, real);
    return startDeclaration(obligationId, obligation);
  }

  const section = /^\/v1\/declarations\/([^/]+)\/sections\/([^/]+)$/.exec(path);
  if (section?.[1] && section[2]) {
    if (method === 'GET') return getSection(section[1], section[2]);
    if (method === 'PUT') return saveSection(request, section[1], section[2]);
  }

  const attachments = /^\/v1\/declarations\/([^/]+)\/attachments$/.exec(path);
  if (method === 'POST' && attachments?.[1]) return linkAttachment(request, attachments[1]);

  const attachment = /^\/v1\/declarations\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && attachment?.[1] && attachment[2]) {
    return unlinkAttachment(attachment[1], attachment[2]);
  }

  const extract = /^\/v1\/declarations\/([^/]+)\/attachments\/([^/]+)\/extract$/.exec(path);
  if (method === 'POST' && extract?.[1] && extract[2]) {
    const stored = draft(extract[1]);
    if (!stored) return problem(404, 'Not found');
    return requestExtraction(request, stored, stored.attachments.get(extract[2]));
  }

  const lookups = /^\/v1\/declarations\/([^/]+)\/suggestions\/lookups$/.exec(path);
  if (method === 'POST' && lookups?.[1]) {
    const stored = draft(lookups[1]);
    return stored ? requestLookups(request, stored) : problem(404, 'Not found');
  }

  const suggestions = /^\/v1\/declarations\/([^/]+)\/suggestions$/.exec(path);
  if (method === 'GET' && suggestions?.[1]) {
    const stored = draft(suggestions[1]);
    return stored ? listSuggestions(url, stored) : problem(404, 'Not found');
  }

  const decide = /^\/v1\/declarations\/([^/]+)\/suggestions\/([^/]+)\/(accept|dismiss)$/.exec(path);
  if (method === 'POST' && decide?.[1] && decide[2]) {
    const stored = draft(decide[1]);
    if (!stored) return problem(404, 'Not found');
    return decide[3] === 'accept'
      ? acceptSuggestion(request, stored, decide[2], (key) => commit(stored, key))
      : dismissSuggestion(request, stored, decide[2]);
  }

  const submit = /^\/v1\/declarations\/([^/]+)\/submit$/.exec(path);
  if (method === 'POST' && submit?.[1]) return submitDeclaration(request, submit[1]);

  const amend = /^\/v1\/declarations\/([^/]+)\/amend(\/discard)?$/.exec(path);
  if (method === 'POST' && amend?.[1]) {
    return amend[2] ? discardAmendment(amend[1]) : amendDeclaration(amend[1]);
  }

  const versions = /^\/v1\/declarations\/([^/]+)\/versions$/.exec(path);
  if (method === 'GET' && versions?.[1]) return listVersions(versions[1]);

  const oneVersion = /^\/v1\/declarations\/([^/]+)\/versions\/(\d+)$/.exec(path);
  if (method === 'GET' && oneVersion?.[1] && oneVersion[2]) {
    return getVersion(oneVersion[1], Number(oneVersion[2]));
  }

  const slip = /^\/v1\/declarations\/([^/]+)\/versions\/(\d+)\/acknowledgement(\/reissue)?$/.exec(
    path,
  );
  if (slip?.[1] && slip[2]) {
    if (method === 'GET' && !slip[3]) return getAcknowledgement(slip[1], Number(slip[2]));
    if (method === 'POST' && slip[3]) return reissue(slip[1], Number(slip[2]));
  }

  const summary = /^\/v1\/declarations\/([^/]+)\/summary$/.exec(path);
  if (method === 'GET' && summary?.[1]) return getSummary(summary[1]);

  const one = /^\/v1\/declarations\/([^/]+)$/.exec(path);
  if (one?.[1]) {
    if (method === 'GET') return getDeclaration(one[1]);
    if (method === 'DELETE') return discard(one[1]);
  }

  return problem(404, 'Not found');
}

function etag(stored: Stored) {
  return `"${String(stored.draftVersion)}"`;
}

function minusYears(iso: string, years: number) {
  return `${String(Number(iso.slice(0, 4)) - years)}${iso.slice(4)}`;
}

function draft(id: string): Stored | undefined {
  const stored = store.get(id);
  return stored && (stored.status === 'draft' || stored.status === 'amending') ? stored : undefined;
}

function context(stored: Stored, key: string): RuleContext {
  const statements = new Map<string, Draft<Statement>>();
  for (const statementKey of liveStatementKeys(stored)) {
    statements.set(statementKey, stored.contents.get(statementKey) ?? {});
  }
  return {
    key,
    statementDate: stored.header.statementDate,
    officer: stored.contents.get('bio') ?? {},
    household: stored.contents.get('household') ?? {},
    statements,
  };
}

function liveStatementKeys(stored: Stored) {
  return ['statement:officer', ...stored.persons.filter((key) => !stored.archived.has(key))];
}

function issuesFor(stored: Stored, key: string): CompletenessIssue[] {
  const contents = stored.contents.get(key) ?? {};
  const rules = context(stored, key);
  if (key === 'bio') return bioCompleteness(contents, rules);
  if (key === 'household') return householdCompleteness(contents, rules);
  if (key === 'other') return otherCompleteness(contents, rules);
  return statementCompleteness(contents, rules);
}

function completeness(stored: Stored, key: string): DeclarationSection['completeness'] {
  if (stored.archived.has(key)) return 'archived';
  if (!stored.savedAt.get(key)) return 'not-started';
  return issuesFor(stored, key).length === 0 ? 'complete' : 'incomplete';
}

function personName(stored: Stored, key: string): string | null {
  if (sectionKind(key) !== 'statement') return null;
  const statement = stored.contents.get(key) as Draft<Statement> | undefined;
  return fullName(statement?.personName) || null;
}

function sectionKeys(stored: Stored) {
  return [
    'bio',
    'household',
    ...liveStatementKeys(stored),
    ...stored.persons.filter((key) => stored.archived.has(key)),
    'other',
  ];
}

function view(stored: Stored): Declaration {
  return {
    ...stored.header,
    status: stored.status,
    draftVersion: stored.draftVersion,
    lastSection: stored.lastSection,
    updatedAt: stored.updatedAt,
    sections: sectionKeys(stored).map((key) => ({
      key,
      completeness: completeness(stored, key),
      updatedAt: stored.savedAt.get(key) ?? null,
      personName: personName(stored, key),
    })),
  };
}

function percentComplete(stored: Stored) {
  const live = sectionKeys(stored).filter((key) => !stored.archived.has(key));
  const done = live.filter((key) => completeness(stored, key) === 'complete').length;
  return Math.round((done / live.length) * 100);
}

function myDeclarations() {
  const now = Date.now();
  const items: DeclarationListItem[] = [...store.values()]
    .filter((stored) => stored.status !== 'discarded')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((stored) => {
      const inForce = stored.versions.at(-1);
      const acknowledgement = inForce ? readAcknowledgement(inForce, now) : null;
      return {
        id: stored.header.id,
        obligationId: stored.header.obligationId,
        commission: stored.header.commission,
        type: stored.header.type,
        statementDate: stored.header.statementDate,
        status: stored.status,
        completenessPercent: percentComplete(stored),
        dueDate: stored.header.dueDate,
        reference: stored.header.reference,
        currentVersion: stored.header.currentVersion,
        amendingFromVersion: stored.header.amendingFromVersion,
        submittedAt: inForce?.submittedAt ?? null,
        late: inForce?.late ?? null,
        amendable: amendRefusal(stored) === null,
        acknowledgement: acknowledgement && {
          status: acknowledgement.status,
          documentId: acknowledgement.documentId,
          verifiedCount: acknowledgement.verifiedCount,
        },
        updatedAt: stored.updatedAt,
      };
    });
  return json(200, items);
}

function emptyStatement(
  personKey: string,
  name: Draft<PersonName> | undefined,
  header: Header,
): Record<string, unknown> {
  return {
    personKey,
    personName: name ?? {},
    statementDate: header.statementDate,
    incomePeriod: { from: header.incomePeriod.from, to: header.incomePeriod.to },
    incomeNil: false,
    income: [],
    assetsNil: false,
    assets: [],
    liabilitiesNil: false,
    liabilities: [],
  };
}

/**
 * Assets as if accepted from registry suggestions, so the portal shows source badges. The
 * suggestion ids stand in for suggestions this mock never created.
 */
function sourcedAssets(at: string): Draft<AssetItem>[] {
  return [
    {
      id: randomUUID(),
      type: 'vehicle',
      description: 'Toyota Probox, 2016',
      details: { registration: 'KCA 123A', makeModel: 'Toyota Probox, 2016' },
      value: { kesCents: 85_000_000 },
      location: { inKenya: true, county: '047' },
      joint: { isJoint: false },
      change: { changed: false },
      source: { kind: 'ntsa', suggestionId: randomUUID(), verificationResultId: randomUUID(), at },
    },
    {
      id: randomUUID(),
      type: 'land',
      description: 'Residential plot, Kitengela',
      details: { parcelNumber: 'Kajiado/Kitengela/12345', size: '0.125 acres' },
      location: { inKenya: true, county: '034' },
      joint: { isJoint: false },
      change: { changed: false },
      source: {
        kind: 'ardhisasa',
        suggestionId: randomUUID(),
        verificationResultId: randomUUID(),
        at,
      },
    },
  ];
}

function mockObligation(obligationId: string): Obligation | undefined {
  return (
    OBLIGATIONS.find((candidate) => candidate.id === obligationId) ??
    anyMockObligation(obligationId)
  );
}

/** The obligation as the real service shows it to the caller; undefined when it answers 404. */
async function realObligation(
  request: Request,
  obligationId: string,
  real: RealService,
): Promise<Obligation | undefined> {
  const url = new URL(`/v1/obligations/${encodeURIComponent(obligationId)}`, request.url);
  const response = await real(
    new Request(url, {
      headers: {
        accept: 'application/json',
        authorization: request.headers.get('authorization') ?? '',
      },
    }),
  );
  if (response.ok) return (await response.json()) as Obligation;
  await response.body?.cancel();
  if (response.status === 404) return undefined;
  throw new Error(`The declarations service answered ${String(response.status)}`);
}

function startDeclaration(obligationId: string, obligation: Obligation | undefined) {
  if (!obligation) return problem(404, 'Not found');
  if (obligation.status === 'filed' || obligation.status === 'cancelled') {
    return problem(409, `The obligation is ${obligation.status}`);
  }
  // Filed here, though a real obligation (the obligations mock off) does not know it.
  const filed = [...store.values()].some(
    (stored) =>
      stored.header.obligationId === obligationId &&
      (stored.status === 'submitted' || stored.status === 'amending'),
  );
  if (filed) return problem(409, 'The obligation is filed');
  const existing = [...store.values()].find(
    (stored) => stored.header.obligationId === obligationId && stored.status === 'draft',
  );
  if (existing) return json(200, view(existing), { ETag: etag(existing) });

  const now = new Date().toISOString();
  const roster = ROSTER[obligation.commission.slug] ?? ROSTER.tsc;
  const years = obligation.type === 'initial' ? 1 : 2;
  const header: Header = {
    id: randomUUID(),
    obligationId,
    commission: obligation.commission,
    type: obligation.type,
    statementDate: obligation.statementDate,
    dueDate: obligation.dueDate,
    incomePeriod: {
      from: minusYears(obligation.statementDate, years),
      to: obligation.statementDate,
      fromSource: 'assumed',
    },
    schemaVersion: 'declaration.v1',
    reference: null,
    currentVersion: null,
    amendingFromVersion: null,
    createdAt: now,
  };
  const { maritalStatus, ...hr } = roster?.hr ?? {};
  const officer: Draft<Officer> = {
    name: roster?.name,
    ...(maritalStatus ? { maritalStatus } : {}),
    employment: {
      designation: roster?.designation,
      employer: roster?.employer,
      responsibleCommission: obligation.commission.slug,
      personnelFileNumber: roster?.file,
      ...hr,
    },
  };
  const officerStatement = emptyStatement('officer', roster?.name, header);
  const sourced = obligation.commission.slug === 'psc';
  if (sourced) officerStatement.assets = sourcedAssets(now);
  const stored: Stored = {
    header,
    status: 'draft',
    draftVersion: 1,
    updatedAt: now,
    lastSection: null,
    contents: new Map([
      ['bio', officer],
      ['household', {}],
      ['statement:officer', officerStatement],
      ['other', {}],
    ]),
    savedAt: new Map(sourced ? [['statement:officer', now]] : []),
    persons: [],
    archived: new Set(),
    attachments: new Map(),
    suggestions: newSuggestionState(),
    filing: {
      statementDate: obligation.statementDate,
      dueDate: obligation.dueDate,
      cancelled: false,
    },
    versions: [],
    filed: new Map(),
  };
  store.set(header.id, stored);
  return json(201, view(stored), { ETag: etag(stored) });
}

function getDeclaration(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  return json(200, view(stored), { ETag: etag(stored) });
}

function discard(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (stored.status !== 'draft') return problem(409, 'Only a draft can be discarded');
  store.delete(id);
  return noContent();
}

function sectionContents(stored: Stored, key: string) {
  const contents = stored.contents.get(key) ?? {};
  if (key !== 'other') return contents;
  return { ...contents, materialChanges: composeMaterialChanges(context(stored, key)) };
}

function getSection(id: string, key: string) {
  const stored = draft(id);
  if (!stored || !isSectionKey(key) || !stored.contents.has(key)) {
    return problem(404, 'Not found');
  }
  return json(
    200,
    {
      key,
      completeness: completeness(stored, key),
      contents: sectionContents(stored, key),
      issues: issuesFor(stored, key),
      draftVersion: stored.draftVersion,
    },
    { ETag: etag(stored) },
  );
}

function sameVersion(ifMatch: string, stored: Stored) {
  return ifMatch.replace(/^W\//, '').replaceAll('"', '') === String(stored.draftVersion);
}

async function saveSection(request: Request, id: string, key: string) {
  const stored = draft(id);
  if (!stored || !isSectionKey(key) || !stored.contents.has(key) || stored.archived.has(key)) {
    return problem(404, 'Not found');
  }
  const ifMatch = request.headers.get('if-match');
  if (!ifMatch) return problem(428, 'If-Match is required');
  if (failingSaves > 0) {
    failingSaves -= 1;
    return problem(503, 'Service unavailable');
  }
  if (!sameVersion(ifMatch, stored)) {
    return problem(412, 'The declaration was changed elsewhere; reload');
  }
  const body = await readJson(request);
  if (!isRecord(body)) return problem(400, 'Section contents must be an object');

  let contents: Record<string, unknown> = body;
  const sectionsChanged: SectionSaveResult['sectionsChanged'] = [];
  if (key === 'bio') {
    if (lockedFieldsChanged(stored.contents.get('bio') ?? {}, body)) {
      return problem(400, 'Roster fields cannot be changed', 'identity-locked-field');
    }
  } else if (key === 'household') {
    contents = deriveHousehold(body, stored.header.statementDate);
  } else if (key === 'other') {
    // Material changes are composed by the service, never saved.
    contents = { ...body };
    delete contents.materialChanges;
  } else if (nilConflictsWithItems(body)) {
    return problem(400, 'Nothing to declare conflicts with items', 'nil-conflicts-with-items');
  }

  const now = new Date().toISOString();
  stored.contents.set(key, contents);
  stored.savedAt.set(key, now);
  if (key === 'household') sectionsChanged.push(...syncStatements(stored, contents));
  stored.draftVersion += 1;
  stored.updatedAt = now;
  stored.lastSection = key;

  const result: SectionSaveResult = {
    key,
    completeness: completeness(stored, key),
    draftVersion: stored.draftVersion,
    issues: issuesFor(stored, key),
    sectionsChanged,
  };
  return json(200, result, { ETag: etag(stored) });
}

/** A write the service makes to a section outside a save (accepting a suggestion). */
function commit(stored: Stored, key: string) {
  const now = new Date().toISOString();
  stored.savedAt.set(key, now);
  stored.draftVersion += 1;
  stored.updatedAt = now;
  stored.lastSection = key;
  return etag(stored);
}

/** Creates, archives and restores statements to match the household (S5). */
function syncStatements(stored: Stored, household: Draft<Household>) {
  const changed: SectionSaveResult['sectionsChanged'] = [];
  const persons = householdPersons(household, stored.header.statementDate);
  const wanted = new Set(persons.map((person) => person.key));
  for (const person of persons) {
    const existing = stored.contents.get(person.key);
    if (!existing) {
      stored.contents.set(
        person.key,
        emptyStatement(person.key.slice(10), person.name, stored.header),
      );
      changed.push({ key: person.key, action: 'created' });
    } else {
      stored.contents.set(person.key, { ...existing, personName: person.name ?? {} });
      if (stored.archived.delete(person.key)) changed.push({ key: person.key, action: 'restored' });
    }
  }
  for (const key of stored.persons) {
    if (!wanted.has(key) && !stored.archived.has(key)) {
      stored.archived.add(key);
      changed.push({ key, action: 'archived' });
    }
  }
  stored.persons = [
    ...persons.map((person) => person.key),
    ...stored.persons.filter((key) => !wanted.has(key)),
  ];
  return changed;
}

interface ItemWithAttachments {
  id?: string;
  attachments?: Attachment[];
}

function findItem(stored: Stored, key: string, itemId: string) {
  const statement = stored.contents.get(key) as Record<string, ItemWithAttachments[] | undefined>;
  for (const category of ['income', 'assets', 'liabilities']) {
    const item = statement[category]?.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return undefined;
}

async function linkAttachment(request: Request, id: string) {
  const stored = draft(id);
  if (!stored) return problem(404, 'Not found');
  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.sectionKey !== 'string' ||
    typeof body.itemId !== 'string' ||
    typeof body.uploadId !== 'string'
  ) {
    return problem(400, 'sectionKey, itemId and uploadId are required');
  }
  const { sectionKey, itemId, uploadId } = body;
  if (sectionKind(sectionKey) !== 'statement' || !stored.contents.has(sectionKey)) {
    return problem(404, 'Not found');
  }
  const item = findItem(stored, sectionKey, itemId);
  if (!item) return problem(404, 'Not found');
  const upload = mockUpload(uploadId);
  if (upload?.state !== 'clean' || upload.purpose !== 'declaration-attachment' || !upload.sha256) {
    return problem(409, 'The upload is not a clean declaration attachment');
  }
  const attachment: DeclarationAttachment = {
    id: randomUUID(),
    sectionKey,
    itemId,
    uploadId,
    fileName: upload.fileName ?? 'document',
    sha256: upload.sha256,
    size: upload.size ?? upload.declaredSize,
    linkedAt: new Date().toISOString(),
  };
  item.attachments = [
    ...(item.attachments ?? []),
    {
      attachmentId: attachment.id,
      uploadId,
      fileName: attachment.fileName,
      sha256: attachment.sha256,
    },
  ];
  stored.attachments.set(attachment.id, attachment);
  stored.draftVersion += 1;
  return json(201, attachment);
}

function unlinkAttachment(id: string, attachmentId: string) {
  const stored = draft(id);
  const attachment = stored?.attachments.get(attachmentId);
  if (!stored || !attachment) return problem(404, 'Not found');
  const item = findItem(stored, attachment.sectionKey, attachment.itemId);
  if (item) {
    item.attachments = (item.attachments ?? []).filter(
      (candidate) => candidate.uploadId !== attachment.uploadId,
    );
  }
  stored.attachments.delete(attachmentId);
  stored.draftVersion += 1;
  return noContent();
}

function getSummary(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  const live = sectionKeys(stored).filter((key) => !stored.archived.has(key));
  const blocking = live.flatMap((key) => issuesFor(stored, key));
  const window = filingWindow(stored.filing);
  // In the service's order: why the obligation refuses it, then whether anything blocks.
  const cannotSubmitReason =
    stored.status !== 'draft' && stored.status !== 'amending'
      ? 'not-a-draft'
      : window === 'cancelled'
        ? 'obligation-cancelled'
        : window === 'upcoming'
          ? 'before-statement-date'
          : stored.status === 'amending' && window === 'overdue'
            ? 'amendment-window-closed'
            : blocking.length > 0
              ? 'incomplete'
              : null;
  const summary: DeclarationSummary = {
    declaration: view(stored),
    document: documentOf(stored),
    valid: blocking.length === 0,
    blocking,
    canSubmit: cannotSubmitReason === null,
    cannotSubmitReason,
    late: window === 'overdue',
    attestationText: ATTESTATION_TEXT,
  };
  return json(200, summary);
}

/** The declaration.v1 document assembled from the live sections, as the summary shows it. */
function documentOf(stored: Stored): Record<string, unknown> {
  const household = (stored.contents.get('household') ?? {}) as Draft<Household>;
  return {
    schemaVersion: 'declaration.v1',
    type: stored.header.type,
    statementDate: stored.header.statementDate,
    incomePeriod: stored.header.incomePeriod,
    officer: stored.contents.get('bio'),
    spouses: household.spouses ?? { none: false, items: [] },
    children: household.children ?? { none: false, items: [] },
    statements: liveStatementKeys(stored).map((key) => stored.contents.get(key)),
    otherInformation: sectionContents(stored, 'other'),
    attestation: { text: ATTESTATION_TEXT },
  };
}

function submitProblem(status: number, title: string, code: string, extra: object = {}) {
  return json(status, { type: 'about:blank', title, status, code, ...extra });
}

/** `POST /v1/declarations/{id}/submit`, preconditions in the service's order. */
function submitDeclaration(request: Request, id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (failingSubmits > 0) {
    failingSubmits -= 1;
    return problem(503, 'Service unavailable');
  }
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = submissions.get(key);
  if (replay) {
    return replay.declarationId === id
      ? json(201, replay.result)
      : problem(422, 'Idempotency-Key reused with a different request');
  }
  if (stored.status !== 'draft' && stored.status !== 'amending') {
    return submitProblem(409, 'The declaration is not a draft', 'not-a-draft');
  }
  if (!hasStepUp(request)) {
    const stepUpUrl = new URL(
      `/auth/step-up?returnTo=${encodeURIComponent(`/declarations/${id}/summary`)}`,
      'http://portal.invalid',
    ).toString();
    return submitProblem(403, 'Confirm your identity to submit', 'step-up-required', {
      stepUpUrl,
    });
  }
  const live = sectionKeys(stored).filter((section) => !stored.archived.has(section));
  const blocking = live.flatMap((section) => issuesFor(stored, section));
  if (blocking.length > 0) {
    return submitProblem(400, 'The declaration is incomplete', 'incomplete', { blocking });
  }
  const window = filingWindow(stored.filing);
  if (window === 'upcoming') {
    return submitProblem(409, 'The statement date has not come', 'before-statement-date');
  }
  if (window === 'cancelled') {
    return submitProblem(409, 'The obligation is cancelled', 'obligation-cancelled');
  }
  if (stored.status === 'amending' && window === 'overdue') {
    return submitProblem(409, 'Amendments closed on the due date', 'amendment-window-closed');
  }

  const now = new Date().toISOString();
  const previous = stored.versions.at(-1);
  if (previous) previous.supersededAt = now;
  const version: DeclarationVersion = {
    version: stored.versions.length + 1,
    reference:
      previous?.reference ??
      allocateReference(stored.header.type, stored.header.commission, stored.header.statementDate),
    submittedAt: now,
    late: window === 'overdue',
    canonicalSha256: createHash('sha256')
      .update(JSON.stringify([...stored.contents]))
      .digest('hex'),
    supersededAt: null,
    acknowledgement: pendingAcknowledgement(),
  };
  stored.versions.push(version);
  const document = documentOf(stored);
  stored.filed.set(version.version, {
    document: {
      ...document,
      attestation: {
        ...(document.attestation as object),
        declaredAt: now,
        reference: version.reference,
      },
    },
    sections: structuredClone({
      contents: stored.contents,
      savedAt: stored.savedAt,
      persons: stored.persons,
      archived: stored.archived,
      attachments: stored.attachments,
    }),
  });
  slipRequested(version);
  stored.status = 'submitted';
  stored.header.reference = version.reference;
  stored.header.currentVersion = version.version;
  stored.header.amendingFromVersion = null;
  stored.updatedAt = now;
  fileMockObligation(stored.header.obligationId);
  const result: SubmissionResult = {
    declaration: view(stored),
    version,
    obligationStatus: 'filed',
  };
  submissions.set(key, { declarationId: id, result });
  return json(201, result);
}

/** `GET /v1/declarations/{id}/versions`, newest first. */
function listVersions(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  const now = Date.now();
  return json(
    200,
    [...stored.versions]
      .reverse()
      .map((version) => ({ ...version, acknowledgement: readAcknowledgement(version, now) })),
  );
}

/** `GET /v1/declarations/{id}/versions/{n}`, with the document as filed. */
function getVersion(id: string, number: number) {
  const version = submittedVersion(id, number);
  const filed = store.get(id)?.filed.get(number);
  if (!version || !filed) return problem(404, 'Not found');
  return json(200, {
    ...version,
    acknowledgement: readAcknowledgement(version),
    document: filed.document,
  });
}

/** Why Amend is refused today, in the service's order, or null when it is open. */
function amendRefusal(stored: Stored) {
  if (stored.status !== 'submitted') return 'not-submitted';
  const window = filingWindow(stored.filing);
  if (window === 'cancelled') return 'obligation-cancelled';
  if (window === 'overdue') return 'amendment-window-closed';
  return null;
}

/** The sections back as the version in force filed them, at a new draft version. */
function reopen(stored: Stored) {
  const filed = stored.header.currentVersion && stored.filed.get(stored.header.currentVersion);
  if (!filed) return;
  Object.assign(stored, structuredClone(filed.sections));
  stored.draftVersion += 1;
  stored.updatedAt = new Date().toISOString();
}

/** `POST /v1/declarations/{id}/amend`: until the due date; an amendment in progress as it is. */
function amendDeclaration(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (stored.status !== 'amending') {
    const refusal = amendRefusal(stored);
    if (refusal) return submitProblem(409, 'The declaration cannot be amended', refusal);
    reopen(stored);
    stored.status = 'amending';
    stored.header.amendingFromVersion = stored.header.currentVersion;
  }
  return json(200, view(stored), { ETag: etag(stored) });
}

/** `POST /v1/declarations/{id}/amend/discard`: back to the version in force. */
function discardAmendment(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (stored.status === 'draft') {
    return submitProblem(409, 'The declaration was never submitted', 'not-submitted');
  }
  if (stored.status === 'amending') {
    reopen(stored);
    stored.status = 'submitted';
    stored.header.amendingFromVersion = null;
  }
  return json(200, view(stored), { ETag: etag(stored) });
}

function submittedVersion(id: string, number: number) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return undefined;
  return stored.versions.find((version) => version.version === number);
}

/** `GET /v1/declarations/{id}/versions/{n}/acknowledgement`. */
function getAcknowledgement(id: string, number: number) {
  const version = submittedVersion(id, number);
  return version ? json(200, readAcknowledgement(version)) : problem(404, 'Not found');
}

/** `POST /v1/declarations/{id}/versions/{n}/acknowledgement/reissue`. */
function reissue(id: string, number: number) {
  const version = submittedVersion(id, number);
  if (!version) return problem(404, 'Not found');
  const answer = reissueAcknowledgement(version);
  if (answer.status === 202) return new Response(null, { status: 202 });
  if (answer.status === 409) {
    return problem(
      409,
      answer.code === 'acknowledgement-issued'
        ? 'The acknowledgement slip is issued'
        : 'The acknowledgement slip is still being prepared',
      answer.code,
    );
  }
  return json(429, {
    type: 'about:blank',
    title: 'The acknowledgement slip was asked for again a moment ago',
    status: 429,
    code: 'resend-cooldown',
    retryAfterSeconds: answer.retryAfterSeconds,
  });
}
