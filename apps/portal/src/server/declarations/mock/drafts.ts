/**
 * The mock's drafts (spec 05): the declarant's list, start, sections and saves, attachments and
 * discard.
 */
import { randomUUID } from 'node:crypto';

import type {
  AssetItem,
  Attachment,
  Draft,
  Household,
  Officer,
  PersonName,
} from '../../../declaration/contents';
import { isSectionKey, sectionKind } from '../../../declaration/section-key';
import { mockUpload } from '../../documents/mock.server';
import { isRecord, json, noContent, problem, readJson } from '../../mock-http';
import type {
  DeclarationAttachment,
  DeclarationListItem,
  Obligation,
  SectionSaveResult,
} from '../types';
import { readAcknowledgement } from './acknowledgement';
import { lockedFieldsChanged } from './bio';
import { OBLIGATIONS, type RosterEntry, ROSTERS } from './fixtures';
import { deriveHousehold, householdPersons } from './household';
import { anyMockObligation, mockPerson, type TokenClaims } from './obligations';
import { nilConflictsWithItems } from './statement';
import {
  completeness,
  draft,
  etag,
  type Header,
  issuesFor,
  percentComplete,
  sectionContents,
  store,
  type Stored,
  view,
} from './store';
import { newSuggestionState } from './suggestions';
import { amendRefusal } from './versions';

let failingSaves = 0;

/** Clears the failing saves (tests). */
export function resetDraftsMock() {
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

/** The caller's declarations, by the token's `person_id`, as the service scopes them. */
export function myDeclarations(owner: string | null) {
  const now = Date.now();
  const items: DeclarationListItem[] = [...store.values()]
    .filter((stored) => stored.owner === owner && stored.status !== 'discarded')
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

export function minusYears(iso: string, years: number) {
  return `${String(Number(iso.slice(0, 4)) - years)}${iso.slice(4)}`;
}

export function emptyStatement(
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
export function sourcedAssets(at: string): Draft<AssetItem>[] {
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

export function mockObligation(obligationId: string): Obligation | undefined {
  return (
    OBLIGATIONS.find((candidate) => candidate.id === obligationId) ??
    anyMockObligation(obligationId)
  );
}

/** The real declarations service, for the parts the mock does not answer. */
export type RealService = (request: Request) => Promise<Response>;

/** The obligation as the real service shows it to the caller; undefined when it answers 404. */
export async function realObligation(
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

/**
 * The caller's entry in the obligation's Commission roster. A Commission without one (an
 * obligation from the real service) pre-fills only the name, from another of their entries.
 */
function rosterEntry(claims: TokenClaims | null, slug: string): Partial<RosterEntry> {
  const rosters = ROSTERS[mockPerson(claims)];
  const entry = rosters[slug];
  if (entry) return entry;
  const name = Object.values(rosters)[0]?.name;
  return name ? { name } : {};
}

export function startDeclaration(
  claims: TokenClaims | null,
  obligationId: string,
  obligation: Obligation | undefined,
) {
  if (!obligation) return problem(404, 'Not found');
  if (obligation.status === 'filed' || obligation.status === 'cancelled') {
    return problem(409, `The obligation is ${obligation.status}`);
  }
  const owner = claims?.person_id ?? null;
  const own = [...store.values()].filter(
    (stored) => stored.owner === owner && stored.header.obligationId === obligationId,
  );
  // Filed here, though a real obligation (the obligations mock off) does not know it.
  const filed = own.some((stored) => stored.status === 'submitted' || stored.status === 'amending');
  if (filed) return problem(409, 'The obligation is filed');
  const existing = own.find((stored) => stored.status === 'draft');
  if (existing) return json(200, view(existing), { ETag: etag(existing) });

  const now = new Date().toISOString();
  const roster = rosterEntry(claims, obligation.commission.slug);
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
  const { maritalStatus, ...hr } = roster.hr ?? {};
  const officer: Draft<Officer> = {
    name: roster.name,
    ...(maritalStatus ? { maritalStatus } : {}),
    employment: {
      designation: roster.designation,
      employer: roster.employer,
      responsibleCommission: obligation.commission.slug,
      personnelFileNumber: roster.file,
      ...hr,
    },
  };
  const officerStatement = emptyStatement('officer', roster.name, header);
  const sourced = obligation.commission.slug === 'psc';
  if (sourced) officerStatement.assets = sourcedAssets(now);
  const stored: Stored = {
    owner,
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

export function getDeclaration(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  return json(200, view(stored), { ETag: etag(stored) });
}

export function discard(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (stored.status !== 'draft') return problem(409, 'Only a draft can be discarded');
  store.delete(id);
  return noContent();
}

export function getSection(id: string, key: string) {
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

export function sameVersion(ifMatch: string, stored: Stored) {
  return ifMatch.replace(/^W\//, '').replaceAll('"', '') === String(stored.draftVersion);
}

export async function saveSection(request: Request, id: string, key: string) {
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
export function commit(stored: Stored, key: string) {
  const now = new Date().toISOString();
  stored.savedAt.set(key, now);
  stored.draftVersion += 1;
  stored.updatedAt = now;
  stored.lastSection = key;
  return etag(stored);
}

/** Creates, archives and restores statements to match the household (S5). */
export function syncStatements(stored: Stored, household: Draft<Household>) {
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

export interface ItemWithAttachments {
  id?: string;
  attachments?: Attachment[];
}

export function findItem(stored: Stored, key: string, itemId: string) {
  const statement = stored.contents.get(key) as Record<string, ItemWithAttachments[] | undefined>;
  for (const category of ['income', 'assets', 'liabilities']) {
    const item = statement[category]?.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return undefined;
}

export async function linkAttachment(request: Request, id: string) {
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

export function unlinkAttachment(id: string, attachmentId: string) {
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
