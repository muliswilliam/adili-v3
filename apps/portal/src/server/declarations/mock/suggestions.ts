import { randomUUID } from 'node:crypto';

import type { Draft, Household, ItemSource, PersonKey } from '../../../declaration/contents';
import { DOCUMENT_KINDS } from '../../../declaration/extraction';
import { householdMember } from '../../../declaration/household';
import {
  ownerOf,
  parsePersonKey,
  relationOfPerson,
  statementSectionKey,
} from '../../../declaration/section-key';
import { type Item, NIL_KEY } from '../../../declaration/statement';
import {
  categoryOf,
  declaredType,
  findMatch,
  type PatchEntry,
  REGISTRIES,
  type SuggestionKind,
  suggestionKind,
  suggestionPatch,
  suggestionTitle,
} from '../../../declaration/suggestions';
import type {
  DeclarationAttachment,
  DocumentKind,
  RegistrySystem,
  Suggestion,
  SuggestionSet,
} from '../types';
import { isRecord, json, problem, readJson } from '../../mock-http';

/**
 * Registry lookups and suggestions for the declarations mock (spec 05b S1, S2, S4, S5): what
 * each registry "holds" about the demo household, and how lookups, accept and dismiss behave.
 *
 * - A lookup needs `consent.requested` and, for a spouse or child, a national ID in Household
 *   (400 `no-id`). It answers one `pending` set per registry; each resolves a moment later (the
 *   next list after `lookupDelay`), so the portal polls as it would the service.
 * - The officer: KRA PIN and compliance, two vehicles, a shareholding and two parcels. A spouse:
 *   a KRA PIN, nothing at NTSA or BRS, and ArdhiSasa unavailable on the first try (the Eldoret
 *   parcel on a retry). A child: nothing anywhere.
 * - A suggestion whose identifier equals an item's in the statement gets `matchItemId` (S4).
 * - A re-run supersedes the person's `new` suggestions from the registries asked, and does not
 *   suggest again what was accepted or dismissed (S5).
 * - Extraction (S6): reading a linked attachment answers a `pending` `document` set that is
 *   `ready` on a later list call, with one suggestion in the portal's convention (contract gap
 *   3): `fields` = {name: value}, `sourceRef` = {documentKind, fields: [{name, confidence,
 *   page}], warnings}. Every reading has a Low field and an unreadable page. A file name with
 *   "blurred" fails; `setExtractionEnabled(false)` (or `DECLARATIONS_MOCK_AI=off`) is a
 *   Commission without an AI policy, answering 409 `not-enabled`.
 * - Accept follows the section save path: `If-Match` (428, 412), then writes the fields (new
 *   item, or the matching item's empty fields unless `overwrite`) with `source` on the item and
 *   bumps the draft version. A spouse's KRA PIN goes to Household; the officer has no KRA
 *   fields in declaration.v1, so theirs answers 400 `no-target`.
 */

function isEmpty(value: unknown) {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** The existing item with each patch entry written where it is empty, or everywhere if `overwrite`. */
export function applyPatch<T extends object>(target: T, patch: PatchEntry[], overwrite = false): T {
  const next = structuredClone(target) as Record<string, unknown>;
  for (const { path, value } of patch) {
    const keys = path.split('.');
    const last = keys.pop() ?? path;
    let node = next;
    for (const key of keys) {
      const child = node[key];
      if (typeof child !== 'object' || child === null) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    if (overwrite || isEmpty(node[last])) node[last] = value;
  }
  return next as T;
}

interface StoredSet extends Omit<SuggestionSet, 'personKey'> {
  personKey: PersonKey;
  /** When the registry "answers", in ms since the epoch. */
  resolveAt: number;
  /** Earlier sets for the same person and registry: a retry can answer differently. */
  attempt: number;
  /** For a `document` set: what was asked to be read. */
  extraction?: Extraction;
}

interface Extraction {
  attachment: DeclarationAttachment;
  documentKind: DocumentKind;
  targetItemType: string;
}

export interface SuggestionState {
  sets: StoredSet[];
  /** Idempotency-Key → the sets that request created. */
  requests: Map<string, string[]>;
  consents: { personKey: PersonKey; at: string; textVersion: string }[];
  reasons: Map<string, string>;
}

export function newSuggestionState(): SuggestionState {
  return { sets: [], requests: new Map(), consents: [], reasons: new Map() };
}

/** What the mock needs from a stored draft. */
export interface SuggestionDraft {
  draftVersion: number;
  contents: Map<string, Record<string, unknown>>;
  archived: Set<string>;
  suggestions: SuggestionState;
}

let lookupDelay = 1_200;

const aiByDefault = () => process.env.DECLARATIONS_MOCK_AI !== 'off';
let extractionEnabled = aiByDefault();

/** A Commission with (true) or without (false) an AI policy for documents (S6). */
export function setExtractionEnabled(enabled: boolean) {
  extractionEnabled = enabled;
}

/** How long registries take to answer; 0 answers at once (tests). */
export function setLookupDelay(ms: number) {
  lookupDelay = ms;
}

export function resetSuggestionsMock() {
  lookupDelay = 1_200;
  extractionEnabled = aiByDefault();
}

interface Fixture {
  itemType: string;
  fields: Record<string, unknown>;
  sourceRef: Record<string, unknown>;
}

const OFFICER: Record<RegistrySystem, Fixture[]> = {
  kra: [
    {
      itemType: 'bio-tax',
      fields: { kraPin: 'A005231876K', complianceStatus: 'compliant' },
      sourceRef: { kraPin: 'A005231876K' },
    },
  ],
  ntsa: [
    {
      itemType: 'vehicle',
      fields: { registration: 'KCA 123A', make: 'Toyota', model: 'Probox', year: 2016 },
      sourceRef: { registration: 'KCA 123A' },
    },
    {
      itemType: 'vehicle',
      fields: { registration: 'KDA 123X', make: 'Toyota', model: 'Fielder', year: 2014 },
      sourceRef: { registration: 'KDA 123X' },
    },
  ],
  brs: [
    {
      itemType: 'shareholding',
      fields: {
        companyName: 'Rift Valley Agrovet Ltd',
        registrationNumber: 'PVT-AB12CD3E',
        role: 'Shareholder',
        shares: 500,
      },
      sourceRef: { registrationNumber: 'PVT-AB12CD3E' },
    },
  ],
  ardhisasa: [
    {
      itemType: 'land',
      fields: {
        parcelNumber: 'Uasin Gishu/Kimumu/2231',
        size: '0.5 acres',
        location: 'Kimumu',
        county: '027',
      },
      sourceRef: { parcelNumber: 'Uasin Gishu/Kimumu/2231' },
    },
    {
      itemType: 'land',
      fields: {
        parcelNumber: 'Eldoret Municipality Block 7/1234',
        size: '0.25 acres',
        location: 'Kapsoya',
        county: '027',
      },
      sourceRef: { parcelNumber: 'Eldoret Municipality Block 7/1234' },
    },
  ],
};

/** What a registry answers for a person: suggestions, or `unavailable` (S2). */
export function registryAnswer(
  personKey: PersonKey,
  source: RegistrySystem,
  attempt: number,
): Fixture[] | 'unavailable' {
  const relation = relationOfPerson(personKey);
  if (relation === 'officer') return OFFICER[source];
  if (relation !== 'spouse') return [];
  if (source === 'kra') {
    return [
      {
        itemType: 'bio-tax',
        fields: { kraPin: 'A006612874M', complianceStatus: 'compliant' },
        sourceRef: { kraPin: 'A006612874M' },
      },
    ];
  }
  if (source === 'ardhisasa') return attempt === 0 ? 'unavailable' : OFFICER.ardhisasa.slice(1);
  return [];
}

function view(set: StoredSet): SuggestionSet {
  return {
    id: set.id,
    personKey: set.personKey,
    source: set.source,
    status: set.status,
    requestedAt: set.requestedAt,
    readyAt: set.readyAt,
    verificationResultId: set.verificationResultId,
    aiJobId: set.aiJobId,
    suggestions: set.suggestions.map((each) => ({ ...each })),
  };
}

function household(stored: SuggestionDraft): Draft<Household> {
  return stored.contents.get('household') ?? {};
}

function statementItems(stored: SuggestionDraft, sectionKey: string, itemType: string): Item[] {
  const category = categoryOf(itemType);
  const statement = stored.contents.get(sectionKey);
  const items = category ? statement?.[category] : undefined;
  return Array.isArray(items) ? (items as Item[]) : [];
}

function suggestionSection(personKey: PersonKey, itemType: string) {
  if (suggestionKind(itemType).target !== 'tax') return statementSectionKey(personKey);
  return relationOfPerson(personKey) === 'officer' ? 'bio' : 'household';
}

interface ReadField {
  name: string;
  value: string | number;
  confidence: number;
  page: number;
}

/** What "reading" a document finds, per family of target item type (S6). */
const READINGS: Partial<Record<SuggestionKind['key'], ReadField[]>> = {
  vehicle: [
    { name: 'registration', value: 'KCB 782M', confidence: 0.97, page: 1 },
    { name: 'make', value: 'Toyota', confidence: 0.93, page: 1 },
    { name: 'model', value: 'Premio', confidence: 0.72, page: 1 },
    { name: 'year', value: 2015, confidence: 0.41, page: 2 },
  ],
  land: [
    { name: 'parcelNumber', value: 'Nakuru/Njoro/1187', confidence: 0.95, page: 1 },
    { name: 'size', value: '1.2 acres', confidence: 0.52, page: 1 },
    { name: 'location', value: 'Njoro', confidence: 0.8, page: 2 },
    { name: 'county', value: '032', confidence: 0.9, page: 1 },
  ],
  shares: [
    { name: 'companyName', value: 'Kerio Valley Dairies Ltd', confidence: 0.91, page: 1 },
    { name: 'shares', value: 1200, confidence: 0.48, page: 1 },
  ],
};

const OTHER_READING: ReadField[] = [
  { name: 'description', value: 'Loan from Kenya Commercial Bank', confidence: 0.55, page: 1 },
];

function reading(targetItemType: string): ReadField[] {
  return READINGS[suggestionKind(targetItemType).key] ?? OTHER_READING;
}

/** A `document` set, read (or not) once its time has come (S6). */
function resolveExtraction(stored: SuggestionDraft, set: StoredSet, now: number) {
  const { extraction } = set;
  if (!extraction) return;
  set.readyAt = new Date(now).toISOString();
  if (/blurred/i.test(extraction.attachment.fileName)) {
    set.status = 'failed';
    return;
  }
  const found = reading(extraction.targetItemType);
  const sectionKey = extraction.attachment.sectionKey;
  const suggestion = {
    itemType: declaredType(extraction.targetItemType),
    fields: Object.fromEntries(found.map((field) => [field.name, field.value])),
  };
  set.status = 'ready';
  set.suggestions.push({
    id: randomUUID(),
    setId: set.id,
    personKey: set.personKey,
    sectionKey,
    ...suggestion,
    sourceRef: {
      documentKind: extraction.documentKind,
      fields: found.map(({ name, confidence, page }) => ({ name, confidence, page })),
      warnings: ['Page 3 could not be read.'],
    },
    confidence: Math.min(...found.map((field) => field.confidence)),
    matchItemId: findMatch(suggestion, statementItems(stored, sectionKey, suggestion.itemType)),
    status: 'new',
    acceptedItemId: null,
  });
}

/** Answers the sets whose time has come (S1, S2, S5, S6). */
function resolveDue(stored: SuggestionDraft, now = Date.now()) {
  const state = stored.suggestions;
  for (const set of state.sets) {
    if (set.status !== 'pending' || set.resolveAt > now) continue;
    if (set.source === 'document') {
      resolveExtraction(stored, set, now);
      continue;
    }
    const answer = registryAnswer(set.personKey, set.source, set.attempt);
    set.readyAt = new Date(now).toISOString();
    if (answer === 'unavailable') {
      set.status = 'unavailable';
      continue;
    }
    set.status = 'ready';
    set.verificationResultId = randomUUID();
    const kept = state.sets
      .filter((other) => other.personKey === set.personKey && other.source === set.source)
      .flatMap((other) => other.suggestions)
      .filter((each) => each.status === 'accepted' || each.status === 'dismissed')
      .map(suggestionTitle);
    for (const found of answer) {
      if (kept.includes(suggestionTitle(found))) continue;
      const sectionKey = suggestionSection(set.personKey, found.itemType);
      set.suggestions.push({
        id: randomUUID(),
        setId: set.id,
        personKey: set.personKey,
        sectionKey,
        itemType: found.itemType,
        fields: found.fields,
        sourceRef: found.sourceRef,
        confidence: null,
        matchItemId: findMatch(found, statementItems(stored, sectionKey, found.itemType)),
        status: 'new',
        acceptedItemId: null,
      });
    }
  }
}

const SYSTEMS = new Set<string>(REGISTRIES);

/** `POST /v1/declarations/{id}/suggestions/lookups` (S1, S2). */
export async function requestLookups(request: Request, stored: SuggestionDraft) {
  const state = stored.suggestions;
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = state.requests.get(key);
  if (replay) {
    resolveDue(stored);
    return json(202, state.sets.filter((set) => replay.includes(set.id)).map(view));
  }

  const body = await readJson(request);
  if (!isRecord(body)) return problem(400, 'personKey is required');
  const personKey = typeof body.personKey === 'string' ? parsePersonKey(body.personKey) : null;
  if (!personKey) return problem(400, 'personKey is required');
  const consent = body.consent;
  if (!isRecord(consent) || consent.requested !== true || typeof consent.textVersion !== 'string') {
    return problem(400, 'The declarant must request the check', 'consent-required');
  }
  const systems = body.systems;
  if (
    !Array.isArray(systems) ||
    systems.length === 0 ||
    !systems.every((system) => typeof system === 'string' && SYSTEMS.has(system))
  ) {
    return problem(400, 'systems must name at least one registry');
  }
  const statementKey = statementSectionKey(personKey);
  if (!stored.contents.has(statementKey) || stored.archived.has(statementKey)) {
    return problem(404, 'Not found');
  }
  if (
    relationOfPerson(personKey) !== 'officer' &&
    !householdMember(household(stored), personKey)?.person.nationalId?.trim()
  ) {
    return problem(400, 'The person has no national ID', 'no-id');
  }

  const now = Date.now();
  const at = new Date(now).toISOString();
  state.consents.push({ personKey, at, textVersion: consent.textVersion });
  const created = (systems as RegistrySystem[]).map((source, index) => {
    const earlier = state.sets.filter(
      (set) => set.personKey === personKey && set.source === source,
    );
    for (const suggestion of earlier.flatMap((set) => set.suggestions)) {
      if (suggestion.status === 'new') suggestion.status = 'superseded';
    }
    const set: StoredSet = {
      id: randomUUID(),
      personKey,
      source,
      status: 'pending',
      requestedAt: at,
      readyAt: null,
      verificationResultId: null,
      aiJobId: null,
      suggestions: [],
      resolveAt: now + (lookupDelay === 0 ? 0 : lookupDelay + index * 400),
      attempt: earlier.length,
    };
    state.sets.push(set);
    return set;
  });
  state.requests.set(
    key,
    created.map((set) => set.id),
  );
  resolveDue(stored, now);
  return json(202, created.map(view));
}

/** `GET /v1/declarations/{id}/suggestions?personKey=&sectionKey=`, also the polling read. */
export function listSuggestions(url: URL, stored: SuggestionDraft) {
  resolveDue(stored);
  const personKey = url.searchParams.get('personKey');
  const sectionKey = url.searchParams.get('sectionKey');
  const sets = stored.suggestions.sets
    .filter((set) => !personKey || set.personKey === personKey)
    .map(view)
    .flatMap((set) => {
      if (!sectionKey) return [set];
      const inSection = set.suggestions.filter((each) => each.sectionKey === sectionKey);
      return set.suggestions.length > 0 && inSection.length === 0
        ? []
        : [{ ...set, suggestions: inSection }];
    });
  return json(200, sets);
}

function findSuggestion(stored: SuggestionDraft, suggestionId: string) {
  for (const set of stored.suggestions.sets) {
    const suggestion = set.suggestions.find((each) => each.id === suggestionId);
    if (suggestion) return { set, suggestion };
  }
  return undefined;
}

function sameVersion(ifMatch: string, stored: SuggestionDraft) {
  return ifMatch.replace(/^W\//, '').replaceAll('"', '') === String(stored.draftVersion);
}

type Stamped = Record<string, unknown> & { id?: string; source?: unknown };

/**
 * `POST .../suggestions/{id}/accept` (S4). `commit` records the section save (version, time) and
 * answers the new ETag.
 */
export async function acceptSuggestion(
  request: Request,
  stored: SuggestionDraft,
  suggestionId: string,
  commit: (sectionKey: string) => string,
) {
  const found = findSuggestion(stored, suggestionId);
  if (!found) return problem(404, 'Not found');
  const { set, suggestion } = found;
  const ifMatch = request.headers.get('if-match');
  if (!ifMatch) return problem(428, 'If-Match is required');
  if (!sameVersion(ifMatch, stored)) {
    return problem(412, 'The declaration was changed elsewhere; reload');
  }
  if (suggestion.status !== 'new') return problem(409, 'The suggestion is not new', 'not-new');
  const body = await readJson(request);
  if (!isRecord(body) || !isRecord(body.fields)) return problem(400, 'fields are required');
  const applyTo = typeof body.applyToItemId === 'string' ? body.applyToItemId : null;
  const overwrite = body.overwrite === true;
  const patch = suggestionPatch({ itemType: suggestion.itemType, fields: body.fields });
  const source: ItemSource = {
    kind: set.source,
    suggestionId: suggestion.id,
    ...(set.verificationResultId ? { verificationResultId: set.verificationResultId } : {}),
    ...(set.aiJobId ? { aiJobId: set.aiJobId } : {}),
    at: new Date().toISOString(),
  };

  let itemId: string;
  const fillsTax = suggestionKind(suggestion.itemType).target === 'tax';
  if (fillsTax) {
    const member = householdMember(household(stored), set.personKey);
    const spouse = member?.relation === 'spouse' ? member.person : undefined;
    if (!spouse?.id) return problem(400, 'There are no tax fields to apply to', 'no-target');
    const contents = household(stored);
    const items = (contents.spouses?.items ?? []).map((each) =>
      each.id === spouse.id ? applyPatch(each, patch, overwrite) : each,
    );
    stored.contents.set('household', {
      ...contents,
      spouses: { none: false, ...contents.spouses, items },
    });
    itemId = spouse.id;
  } else {
    const category = categoryOf(suggestion.itemType);
    const statement = stored.contents.get(suggestion.sectionKey);
    if (!category || !statement || stored.archived.has(suggestion.sectionKey)) {
      return problem(404, 'Not found');
    }
    const items = (Array.isArray(statement[category]) ? statement[category] : []) as Stamped[];
    let next: Stamped[];
    if (applyTo) {
      if (!items.some((item) => item.id === applyTo)) return problem(404, 'Not found');
      next = items.map((item) =>
        item.id === applyTo
          ? { ...applyPatch(item, patch, overwrite), source: item.source ?? source }
          : item,
      );
      itemId = applyTo;
    } else {
      itemId = randomUUID();
      const base: Stamped = {
        id: itemId,
        type: declaredType(suggestion.itemType),
        description: '',
        location: { inKenya: true },
        change: { changed: false },
        ...(category === 'assets' ? { joint: { isJoint: false } } : {}),
      };
      next = [...items, { ...applyPatch(base, patch, true), source }];
    }
    stored.contents.set(suggestion.sectionKey, {
      ...statement,
      [NIL_KEY[category]]: false,
      [category]: next,
    });
  }

  suggestion.status = 'accepted';
  suggestion.acceptedItemId = itemId;
  const etag = commit(fillsTax ? 'household' : suggestion.sectionKey);
  const accepted: Suggestion = { ...suggestion };
  return json(200, { suggestion: accepted, itemId, etag }, { ETag: etag });
}

/** `POST .../suggestions/{id}/dismiss` (S5). */
export async function dismissSuggestion(
  request: Request,
  stored: SuggestionDraft,
  suggestionId: string,
) {
  const found = findSuggestion(stored, suggestionId);
  if (!found) return problem(404, 'Not found');
  const { suggestion } = found;
  if (suggestion.status === 'accepted') {
    return problem(409, 'The suggestion was accepted', 'already-accepted');
  }
  const body = await readJson(request);
  if (isRecord(body) && typeof body.reason === 'string') {
    stored.suggestions.reasons.set(suggestion.id, body.reason.slice(0, 200));
  }
  if (suggestion.status === 'new') suggestion.status = 'dismissed';
  return json(200, { ...suggestion });
}

/**
 * `POST /v1/declarations/{id}/attachments/{attachmentId}/extract` (S6). Answers a `pending`
 * `document` set that a later list call finds read; it is never read in the same request.
 */
export async function requestExtraction(
  request: Request,
  stored: SuggestionDraft,
  attachment: DeclarationAttachment | undefined,
) {
  const state = stored.suggestions;
  if (!attachment) return problem(404, 'Not found');
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = state.requests.get(key);
  const earlier = replay && state.sets.find((set) => set.id === replay[0]);
  if (earlier) return json(202, view(earlier));

  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.documentKindHint !== 'string' ||
    !(DOCUMENT_KINDS as readonly string[]).includes(body.documentKindHint) ||
    typeof body.targetItemType !== 'string' ||
    body.targetItemType === ''
  ) {
    return problem(400, 'documentKindHint and targetItemType are required');
  }
  if (!extractionEnabled) {
    return problem(409, 'Reading documents is not enabled for this Commission', 'not-enabled');
  }

  const now = Date.now();
  const set: StoredSet = {
    id: randomUUID(),
    personKey: ownerOf(attachment.sectionKey),
    source: 'document',
    status: 'pending',
    requestedAt: new Date(now).toISOString(),
    readyAt: null,
    verificationResultId: null,
    aiJobId: randomUUID(),
    suggestions: [],
    resolveAt: now + lookupDelay,
    attempt: 0,
    extraction: {
      attachment,
      documentKind: body.documentKindHint as DocumentKind,
      targetItemType: body.targetItemType,
    },
  };
  state.sets.push(set);
  state.requests.set(key, [set.id]);
  return json(202, view(set));
}
