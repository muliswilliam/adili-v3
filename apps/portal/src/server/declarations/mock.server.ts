/**
 * In-memory stand-in for the declarations service's spec 05 endpoints (declarations.yaml), used
 * when DECLARATIONS_MOCK is set until the service implements them (#115). Every signed-in caller
 * shares one store; the service scopes drafts to their owner.
 *
 * Demo obligations (from `GET /v1/me/obligations`):
 * - Teachers Service Commission, biennial 2027: upcoming, statement date 1 Nov 2027, income
 *   period assumed (S1). A draft can be prepared; submission waits for the statement date.
 * - Public Service Commission, initial: due, statement date 10 Sep 2026.
 * - National Police Service Commission, final: filed, so starting answers 409.
 * - Parliamentary Service Commission, biennial 2025: cancelled, so starting answers 409.
 *
 * Starting a declaration creates the bio (pre-filled from the Commission's roster), household,
 * the officer's statement and other information; a second start returns the same draft (200).
 * Every save needs `If-Match` with the current draft version (412 when stale, 428 when missing)
 * and bumps the version; the roster fields answer 400 `identity-locked-field` and a nil flag
 * with items answers 400 `nil-conflicts-with-items` (S4, S8). Household saves create, archive
 * and restore statements (S5). Completeness rules per section live in `./mock/*.ts`.
 *
 * Tests can make the next saves fail (`failNextSaves`) or simulate an edit on another device
 * (`editElsewhere`).
 */
import { randomUUID } from 'node:crypto';

import type {
  Draft,
  Household,
  Officer,
  PersonName,
  Statement,
} from '../../components/declaration/contents';
import { ATTESTATION_TEXT } from '../../components/declaration/contents';
import { mockUpload } from '../documents/mock.server';
import { bioCompleteness, lockedFieldsChanged } from './mock/bio';
import type { RuleContext } from './mock/context';
import {
  deriveHousehold,
  fullName,
  householdCompleteness,
  householdPersons,
} from './mock/household';
import { isRecord, json, noContent, problem, readJson } from './mock/http';
import { composeMaterialChanges, otherCompleteness } from './mock/other';
import { nilConflictsWithItems, statementCompleteness } from './mock/statement';
import type {
  CommissionRef,
  CompletenessIssue,
  Declaration,
  DeclarationAttachment,
  DeclarationListItem,
  DeclarationSection,
  DeclarationSummary,
  Obligation,
  SectionSaveResult,
} from './types';

const COMMISSIONS = {
  tsc: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
  psc: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
  npsc: { slug: 'npsc', issuerCode: 'NPSC', name: 'National Police Service Commission' },
  parlsc: { slug: 'parlsc', issuerCode: 'PSCK', name: 'Parliamentary Service Commission' },
} satisfies Record<string, CommissionRef>;

/** What each Commission's roster says about the demo declarant. */
const ROSTER: Record<
  string,
  { name: PersonName; designation: string; employer: string; file: string }
> = {
  tsc: {
    name: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
    designation: 'Deputy Principal',
    employer: 'Nyeri High School',
    file: 'TSC/999999',
  },
  psc: {
    name: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
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
}

const store = new Map<string, Stored>();
let failingSaves = 0;

/** Clears every draft (tests). */
export function resetDeclarationsMock() {
  store.clear();
  failingSaves = 0;
}

/** The next `count` section saves answer 503 (tests). */
export function failNextSaves(count: number) {
  failingSaves = count;
}

/** Bumps a draft's version as if another device saved it, so the next save gets 412 (tests). */
export function editElsewhere(declarationId: string) {
  const stored = store.get(declarationId);
  if (stored) stored.draftVersion += 1;
}

export function mockDeclarationsFetch(request: Request): Promise<Response> {
  return route(request);
}

const UUID = '[0-9a-f-]{36}';
const SECTION_KEY = new RegExp(
  `^(bio|household|other|statement:(officer|spouse:${UUID}|child:${UUID}))$`,
);

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const path = decodeURIComponent(pathname);
  const method = request.method;

  if (method === 'GET' && path === '/v1/me/obligations') return myObligations();
  if (method === 'GET' && path === '/v1/me/declarations') return myDeclarations();

  const start = /^\/v1\/obligations\/([^/]+)\/declaration$/.exec(path);
  if (method === 'POST' && start?.[1]) return startDeclaration(start[1]);

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

function today() {
  return new Date().toISOString().slice(0, 10);
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
  if (!key.startsWith('statement:')) return null;
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

function myObligations() {
  const groups = new Map<string, { commission: CommissionRef; obligations: Obligation[] }>();
  for (const obligation of OBLIGATIONS) {
    const group = groups.get(obligation.commission.slug) ?? {
      commission: obligation.commission,
      obligations: [],
    };
    group.obligations.push(obligation);
    groups.set(obligation.commission.slug, group);
  }
  return json(200, { groups: [...groups.values()] });
}

function myDeclarations() {
  const items: DeclarationListItem[] = [...store.values()]
    .filter((stored) => stored.status !== 'discarded')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((stored) => ({
      id: stored.header.id,
      obligationId: stored.header.obligationId,
      commission: stored.header.commission,
      type: stored.header.type,
      statementDate: stored.header.statementDate,
      status: stored.status,
      completenessPercent: percentComplete(stored),
      updatedAt: stored.updatedAt,
    }));
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

function startDeclaration(obligationId: string) {
  const obligation = OBLIGATIONS.find((candidate) => candidate.id === obligationId);
  if (!obligation) return problem(404, 'Not found');
  if (obligation.status === 'filed' || obligation.status === 'cancelled') {
    return problem(409, `The obligation is ${obligation.status}`);
  }
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
  const officer: Draft<Officer> = {
    name: roster?.name,
    employment: {
      designation: roster?.designation,
      employer: roster?.employer,
      responsibleCommission: obligation.commission.slug,
      personnelFileNumber: roster?.file,
    },
  };
  const stored: Stored = {
    header,
    status: 'draft',
    draftVersion: 1,
    updatedAt: now,
    lastSection: null,
    contents: new Map([
      ['bio', officer],
      ['household', {}],
      ['statement:officer', emptyStatement('officer', roster?.name, header)],
      ['other', {}],
    ]),
    savedAt: new Map(),
    persons: [],
    archived: new Set(),
    attachments: new Map(),
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
  if (!stored || !SECTION_KEY.test(key) || !stored.contents.has(key)) {
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
  if (!stored || !SECTION_KEY.test(key) || !stored.contents.has(key) || stored.archived.has(key)) {
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
  attachments?: { uploadId: string; fileName: string; sha256: string }[];
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
  if (!sectionKey.startsWith('statement:') || !stored.contents.has(sectionKey)) {
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
    { uploadId, fileName: attachment.fileName, sha256: attachment.sha256 },
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
  const household = (stored.contents.get('household') ?? {}) as Draft<Household>;
  const summary: DeclarationSummary = {
    declaration: view(stored),
    document: {
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
    },
    valid: blocking.length === 0,
    blocking,
    canSubmit: false,
    cannotSubmitReason:
      today() < stored.header.statementDate
        ? 'before-statement-date'
        : blocking.length > 0
          ? 'incomplete'
          : 'submission-not-available',
    attestationText: ATTESTATION_TEXT,
  };
  return json(200, summary);
}
