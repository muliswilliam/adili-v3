import { randomUUID } from 'node:crypto';

import type { Draft, Household, ItemSource } from '../../../components/declaration/contents';
import { type Item, NIL_KEY } from '../../../components/declaration/statement';
import {
  applyPatch,
  categoryOf,
  declaredType,
  findMatch,
  REGISTRIES,
  suggestionPatch,
  suggestionTitle,
} from '../../../components/declaration/suggestions';
import type { Suggestion, SuggestionSet, SuggestionSource } from '../types';
import { isRecord, json, problem, readJson } from './http';

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
 * - Accept follows the section save path: `If-Match` (428, 412), then writes the fields (new
 *   item, or the matching item's empty fields unless `overwrite`) with `source` on the item and
 *   bumps the draft version. A spouse's KRA PIN goes to Household; the officer has no KRA
 *   fields in declaration.v1, so theirs answers 400 `no-target`.
 */

interface StoredSet extends SuggestionSet {
  /** When the registry "answers", in ms since the epoch. */
  resolveAt: number;
  /** Earlier sets for the same person and registry: a retry can answer differently. */
  attempt: number;
}

export interface SuggestionState {
  sets: StoredSet[];
  /** Idempotency-Key → the sets that request created. */
  requests: Map<string, string[]>;
  consents: { personKey: string; at: string; textVersion: string }[];
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

/** How long registries take to answer; 0 answers at once (tests). */
export function setLookupDelay(ms: number) {
  lookupDelay = ms;
}

export function resetSuggestionsMock() {
  lookupDelay = 1_200;
}

interface Fixture {
  itemType: string;
  fields: Record<string, unknown>;
  sourceRef: Record<string, unknown>;
}

const OFFICER: Record<Exclude<SuggestionSource, 'document'>, Fixture[]> = {
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
  personKey: string,
  source: Exclude<SuggestionSource, 'document'>,
  attempt: number,
): Fixture[] | 'unavailable' {
  if (personKey === 'officer') return OFFICER[source];
  if (!personKey.startsWith('spouse:')) return [];
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

function person(stored: SuggestionDraft, personKey: string) {
  const [kind, id] = personKey.split(':');
  const people =
    kind === 'spouse' ? household(stored).spouses?.items : household(stored).children?.items;
  return people?.find((each) => each.id === id);
}

function statementItems(stored: SuggestionDraft, sectionKey: string, itemType: string): Item[] {
  const category = categoryOf(itemType);
  const statement = stored.contents.get(sectionKey);
  const items = category ? statement?.[category] : undefined;
  return Array.isArray(items) ? (items as Item[]) : [];
}

function suggestionSection(personKey: string, itemType: string) {
  if (itemType !== 'bio-tax') return `statement:${personKey}`;
  return personKey === 'officer' ? 'bio' : 'household';
}

/** Answers the sets whose time has come (S1, S2, S5). */
function resolveDue(stored: SuggestionDraft, now = Date.now()) {
  const state = stored.suggestions;
  for (const set of state.sets) {
    if (set.status !== 'pending' || set.resolveAt > now || set.source === 'document') continue;
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
  if (!isRecord(body) || typeof body.personKey !== 'string') {
    return problem(400, 'personKey is required');
  }
  const { personKey } = body;
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
  const statementKey = `statement:${personKey}`;
  if (!stored.contents.has(statementKey) || stored.archived.has(statementKey)) {
    return problem(404, 'Not found');
  }
  if (personKey !== 'officer' && !person(stored, personKey)?.nationalId?.trim()) {
    return problem(400, 'The person has no national ID', 'no-id');
  }

  const now = Date.now();
  const at = new Date(now).toISOString();
  state.consents.push({ personKey, at, textVersion: consent.textVersion });
  const created = (systems as Exclude<SuggestionSource, 'document'>[]).map((source, index) => {
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
    at: new Date().toISOString(),
  };

  let itemId: string;
  if (suggestion.itemType === 'bio-tax') {
    const spouse = suggestion.personKey.startsWith('spouse:')
      ? person(stored, suggestion.personKey)
      : undefined;
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
  const etag = commit(suggestion.itemType === 'bio-tax' ? 'household' : suggestion.sectionKey);
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
