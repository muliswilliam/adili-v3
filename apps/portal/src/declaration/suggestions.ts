import type { RegistryStatus, RegistryStatusEntry } from '@adili/ui';
import { SOURCE_NAMES } from '@adili/ui';

import type {
  DocumentKind,
  JsonObject,
  LoadedSuggestion,
  LoadedSuggestionSet,
  RegistrySystem,
} from '../server/declarations.server';
import { ASSET_TYPES, type Draft, INCOME_TYPES, LIABILITY_TYPES, type Statement } from './contents';
import { countyName } from './format';
import { TYPE_LABELS } from './labels';
import { CATEGORIES, type Category, type Item, NIL_KEY } from './statement';

/**
 * Pure rules for registry suggestions (spec 05b), shared by the Check registries panel and the
 * declarations mock so both read a suggestion the same way.
 *
 * The contract leaves a suggestion's `fields` free-form and gives it no title (contract gaps 4
 * and 10), so this module fixes the field names per item type, as the mock emits them:
 * - `vehicle`: registration, make, model, year
 * - `land`: parcelNumber, size, location, county (a county code)
 * - `shareholding` (BRS, shares held; the spec's `investment`, which declaration.v1 does not
 *   have): companyName, registrationNumber, role, shares
 * - `directorship` (BRS, the officer's director roles): companyName, role. It adds a paragraph 9
 *   registrable interest in Other information, not a statement item.
 * - `bio-tax` (KRA): kraPin, complianceStatus
 * Any statement item type may also carry `description`, which the declarant can edit before
 * adding.
 *
 * From those it composes the card's title, the item fields a suggestion fills (the same paths
 * the mock writes on accept), and each registry's status in a person's check.
 */

export const REGISTRIES: readonly RegistrySystem[] = ['kra', 'ntsa', 'brs', 'ardhisasa'];

/** The version of the consent text the declarant ticks, sent with every lookup. */
export const CONSENT_TEXT_VERSION = 'registry-consent.v1';

/** A suggestion as the rules need it; the mock passes its stored ones. */
export interface SuggestionLike {
  itemType: string;
  fields: Record<string, unknown>;
}

/** A field's value as text: trimmed strings and numbers; anything else is empty. */
export function fieldText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function joined(parts: string[], separator: string) {
  return parts.filter((part) => part !== '').join(separator);
}

/** "A005231876K" → "A00•••••76K": the first and last three characters. */
export function maskKraPin(pin: string): string {
  const trimmed = pin.trim();
  if (trimmed.length <= 6) return trimmed;
  return `${trimmed.slice(0, 3)}•••••${trimmed.slice(-3)}`;
}

const COMPLIANCE_WORDS: Record<string, string> = {
  compliant: 'Compliant',
  'non-compliant': 'Not compliant',
  'not-compliant': 'Not compliant',
};

/** A KRA compliance status in words; unknown values are shown as sent. */
export function complianceText(value: unknown): string {
  const status = fieldText(value);
  return COMPLIANCE_WORDS[status.toLowerCase()] ?? status;
}

/** 500 → "500 shares"; "12.5%" or "500 shares" as sent. */
export function sharesText(value: unknown): string {
  const shares = fieldText(value);
  return /^\d[\d,]*$/.test(shares) ? `${shares} shares` : shares;
}

/** One item field a suggestion fills: its path in the item, label, value and how it reads. */
export interface PatchEntry {
  /** Dotted path in the item, e.g. `details.registration`; `kraPin` on a spouse. */
  path: string;
  label: string;
  value: string;
  display: string;
}

function entry(path: string, label: string, value: string, display = value): PatchEntry[] {
  return value === '' ? [] : [{ path, label, value, display }];
}

/** A field "Edit and add" offers, in suggestion field names. */
export interface EditField {
  key: string;
  label: string;
}

type Fields = Record<string, unknown>;

/**
 * How the portal reads one family of suggestions: the card's title, the item fields accepting
 * fills, the field that identifies a matching item, what "Edit and add" offers and which
 * document kind "Read into the form" offers first.
 */
export interface SuggestionKind {
  key: 'vehicle' | 'land' | 'shares' | 'directorship' | 'bank' | 'tax' | 'other';
  /**
   * `tax` fills a person's tax fields (`bio-tax`) and `interest` adds a paragraph 9 registrable
   * interest (`directorship`), rather than adding a statement item.
   */
  target: 'item' | 'tax' | 'interest';
  /** The title from the fields, or '' when they say nothing usable. */
  title: (fields: Fields) => string;
  /** The item fields it fills, before the description. */
  patch: (fields: Fields) => PatchEntry[];
  /** The description it adds when the declarant gives none; absent when it adds none. */
  description?: (fields: Fields) => string;
  /** The item field that identifies a matching item, or null when items are not matched. */
  identifier: string | null;
  editFields: EditField[];
  documentKind: DocumentKind;
}

const none = () => '';

const KINDS: Record<SuggestionKind['key'], SuggestionKind> = {
  vehicle: {
    key: 'vehicle',
    target: 'item',
    title: (fields) =>
      joined(
        [
          fieldText(fields.registration),
          joined([fieldText(fields.make), fieldText(fields.model), fieldText(fields.year)], ' '),
        ],
        ' · ',
      ),
    patch: (fields) => [
      ...entry('details.registration', 'Registration', fieldText(fields.registration)),
      ...entry(
        'details.makeModel',
        'Make and model',
        joined(
          [joined([fieldText(fields.make), fieldText(fields.model)], ' '), fieldText(fields.year)],
          ', ',
        ),
      ),
    ],
    description: (fields) => joined([fieldText(fields.make), fieldText(fields.model)], ' '),
    identifier: 'details.registration',
    editFields: [
      { key: 'registration', label: 'Registration' },
      { key: 'make', label: 'Make' },
      { key: 'model', label: 'Model' },
      { key: 'year', label: 'Year' },
    ],
    documentKind: 'logbook',
  },
  land: {
    key: 'land',
    target: 'item',
    title: (fields) => joined([fieldText(fields.parcelNumber), fieldText(fields.size)], ' · '),
    patch: (fields) => {
      const county = fieldText(fields.county);
      return [
        ...entry('details.parcelNumber', 'Parcel or plot number', fieldText(fields.parcelNumber)),
        ...entry('details.size', 'Size', fieldText(fields.size)),
        ...entry('location.detail', 'Location', fieldText(fields.location)),
        ...entry('location.county', 'County', county, countyName(county) ?? county),
      ];
    },
    description: (fields) => {
      const location = fieldText(fields.location);
      return location ? `Land in ${location}` : '';
    },
    identifier: 'details.parcelNumber',
    editFields: [
      { key: 'parcelNumber', label: 'Parcel or plot number' },
      { key: 'size', label: 'Size' },
      { key: 'location', label: 'Location' },
    ],
    documentKind: 'title-deed',
  },
  shares: {
    key: 'shares',
    target: 'item',
    title: (fields) =>
      joined(
        [fieldText(fields.companyName), sharesText(fields.shares) || fieldText(fields.role)],
        ' · ',
      ),
    patch: (fields) => [
      ...entry('details.issuer', 'Company or issuer', fieldText(fields.companyName)),
      ...entry('details.quantityOrPercent', 'Number or percentage', sharesText(fields.shares)),
    ],
    description: (fields) => {
      const company = fieldText(fields.companyName);
      return company ? `Shares in ${company}` : '';
    },
    identifier: 'details.issuer',
    editFields: [
      { key: 'companyName', label: 'Company' },
      { key: 'shares', label: 'Number or percentage' },
    ],
    documentKind: 'share-certificate',
  },
  directorship: {
    key: 'directorship',
    target: 'interest',
    title: (fields) => joined([fieldText(fields.companyName), fieldText(fields.role)], ' · '),
    patch: (fields) => [
      ...entry('company', 'Company', fieldText(fields.companyName)),
      ...entry('role', 'Role', fieldText(fields.role)),
    ],
    // Paragraph 9 entries have no id, so they are matched by company (`listedDirectorship`).
    identifier: null,
    editFields: [
      { key: 'companyName', label: 'Company' },
      { key: 'role', label: 'Role' },
    ],
    documentKind: 'other',
  },
  bank: {
    key: 'bank',
    target: 'item',
    title: none,
    patch: () => [],
    description: none,
    identifier: null,
    editFields: [],
    documentKind: 'bank-letter',
  },
  tax: {
    key: 'tax',
    target: 'tax',
    title: (fields) => {
      const pin = fieldText(fields.kraPin);
      const compliance = complianceText(fields.complianceStatus);
      return joined(
        [pin ? `KRA PIN ${maskKraPin(pin)}` : '', compliance ? `Compliance: ${compliance}` : ''],
        ' · ',
      );
    },
    patch: (fields) => {
      const pin = fieldText(fields.kraPin);
      return entry('kraPin', 'KRA PIN', pin, maskKraPin(pin));
    },
    identifier: null,
    editFields: [],
    documentKind: 'other',
  },
  other: {
    key: 'other',
    target: 'item',
    title: none,
    patch: () => [],
    description: none,
    identifier: null,
    editFields: [],
    documentKind: 'other',
  },
};

/**
 * Each suggestion item type the portal knows: its family and, where it differs, the
 * declaration.v1 item type it adds (BRS's `investment` is a `shareholding`, which declaration.v1
 * has). Any other type is read as `other` and added as itself.
 */
const ITEM_TYPES: Record<string, { kind: SuggestionKind['key']; declared?: string }> = {
  vehicle: { kind: 'vehicle' },
  land: { kind: 'land' },
  building: { kind: 'land' },
  shareholding: { kind: 'shares' },
  securities: { kind: 'shares' },
  investment: { kind: 'shares', declared: 'shareholding' },
  'bank-account': { kind: 'bank' },
  mortgage: { kind: 'bank' },
  loan: { kind: 'bank' },
  guarantee: { kind: 'bank' },
  directorship: { kind: 'directorship' },
  'bio-tax': { kind: 'tax' },
};

/** How a suggestion of this item type reads; `other` for types the portal has no rules for. */
export function suggestionKind(itemType: string | undefined): SuggestionKind {
  return KINDS[(itemType === undefined ? undefined : ITEM_TYPES[itemType]?.kind) ?? 'other'];
}

/** The declaration.v1 item type a suggestion adds: BRS's `investment` is a shareholding. */
export function declaredType(itemType: string): string {
  return ITEM_TYPES[itemType]?.declared ?? itemType;
}

/** The statement category an item type belongs to, or null (e.g. `bio-tax`). */
export function categoryOf(itemType: string): Category | null {
  const type = declaredType(itemType);
  if ((ASSET_TYPES as readonly string[]).includes(type)) return 'assets';
  if ((INCOME_TYPES as readonly string[]).includes(type)) return 'income';
  if ((LIABILITY_TYPES as readonly string[]).includes(type)) return 'liabilities';
  return null;
}

/** The item type in words, e.g. "Vehicle"; "KRA PIN" for `bio-tax`. */
export function typeWord(itemType: string): string {
  const { target } = suggestionKind(itemType);
  if (target === 'tax') return 'KRA PIN';
  if (target === 'interest') return 'Directorship';
  const category = categoryOf(itemType);
  return (category && TYPE_LABELS[category][declaredType(itemType)]) ?? 'Suggestion';
}

/**
 * The card's title, composed from the fields because the contract has none (gap 4):
 * "KCA 123A · Toyota Fielder 2016", "Uasin Gishu/Kimumu/2231 · 0.5 acres",
 * "Rift Valley Agrovet Ltd · 500 shares", "Kimumu Transporters Limited · Director",
 * "KRA PIN A00•••••76K · Compliance: Compliant".
 * Falls back to the item type in words when the fields say nothing usable.
 */
export function suggestionTitle({ itemType, fields }: SuggestionLike): string {
  return (
    suggestionKind(itemType).title(fields) || fieldText(fields.description) || typeWord(itemType)
  );
}

/**
 * What accepting the suggestion writes into the item (or, for `bio-tax`, the spouse), in the
 * order the card lists it. Value fields stay empty: the declarant enters them. The mock writes
 * exactly these paths, so "Fills: …" on a matching card is what applying fills.
 */
export function suggestionPatch({ itemType, fields }: SuggestionLike): PatchEntry[] {
  const kind = suggestionKind(itemType);
  const patch = kind.patch(fields);
  if (!kind.description) return patch;
  return [
    ...patch,
    ...entry(
      'description',
      'Description',
      fieldText(fields.description) || kind.description(fields),
    ),
  ];
}

/** The field that identifies an item of this type, used to match suggestions to items. */
export function identifierPath(itemType: string): string | null {
  return suggestionKind(itemType).identifier;
}

/** Identifiers compare without case, spaces or separators: "kca-123 a" is "KCA123A". */
export function sameIdentifier(a: unknown, b: unknown): boolean {
  const normal = (value: unknown) =>
    fieldText(value)
      .toUpperCase()
      .replace(/[\s/.,-]+/g, '');
  return normal(a) !== '' && normal(a) === normal(b);
}

/** Reads a dotted path from an object; undefined when any step is missing. */
export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The item's values at the paths a patch writes, keyed by path (for `emptyFieldDiff`). */
export function valuesAt(target: unknown, patch: PatchEntry[]): Record<string, unknown> {
  return Object.fromEntries(patch.map(({ path }) => [path, readPath(target, path)]));
}

/** The first item whose identifier equals the suggestion's, for the service's `matchItemId`. */
export function findMatch(suggestion: SuggestionLike, items: Item[]): string | null {
  const path = identifierPath(suggestion.itemType);
  if (!path) return null;
  const identifier = suggestionPatch(suggestion).find((each) => each.path === path)?.value;
  const hit = items.find((item) => sameIdentifier(readPath(item, path), identifier));
  return hit?.id ?? null;
}

/**
 * The paragraph 9 directorship already listed for the suggestion's company, compared like an
 * identifier ("Kimumu Transporters Ltd" is "KIMUMU TRANSPORTERS LTD"), or undefined.
 */
export function listedDirectorship<T extends { company?: string }>(
  suggestion: SuggestionLike,
  directorships: readonly T[],
): T | undefined {
  const company = suggestion.fields.companyName;
  return directorships.find((each) => sameIdentifier(each.company, company));
}

/** The set each registry last answered with (the newest by `requestedAt`). */
export function latestSets(
  sets: LoadedSuggestionSet[],
): Partial<Record<RegistrySystem, LoadedSuggestionSet>> {
  const latest: Partial<Record<RegistrySystem, LoadedSuggestionSet>> = {};
  for (const set of sets) {
    if (set.source === 'document') continue;
    const current = latest[set.source];
    if (!current || current.requestedAt <= set.requestedAt) latest[set.source] = set;
  }
  return latest;
}

export interface ShownSuggestion {
  suggestion: LoadedSuggestion;
  source: RegistrySystem;
  /** When the registry answered (or was asked, while it has not), for "From NTSA, {date}". */
  at: string;
}

/**
 * The registry suggestions to show, grouped by registry in the strip's order: new, accepted and
 * dismissed ones from every check (a re-run supersedes only `new` ones, which are not shown).
 */
export function shownSuggestions(sets: LoadedSuggestionSet[]): ShownSuggestion[] {
  const seen = new Set<string>();
  const shown: ShownSuggestion[] = [];
  for (const source of REGISTRIES) {
    for (const set of sets) {
      if (set.source !== source) continue;
      for (const suggestion of set.suggestions) {
        if (suggestion.status === 'superseded' || seen.has(suggestion.id)) continue;
        seen.add(suggestion.id);
        shown.push({ suggestion, source, at: set.readyAt ?? set.requestedAt });
      }
    }
  }
  return shown;
}

/** One registry's state in words the status strip knows. */
export function registryStatus(
  set: LoadedSuggestionSet | undefined,
  count: number,
): RegistryStatus {
  if (!set || set.status === 'no-id') return 'not-checked';
  if (set.status === 'pending') return 'checking';
  if (set.status === 'ready') return count > 0 ? 'found' : 'nothing-found';
  return 'unavailable';
}

/**
 * The status strip: one entry per registry, counting the still-actionable (`new`) suggestions of
 * the registry's latest set. Accepted and dismissed ones, and earlier checks, do not count, so a
 * re-check that finds nothing new reads "Nothing found".
 */
export function registryEntries(sets: LoadedSuggestionSet[]): RegistryStatusEntry[] {
  const latest = latestSets(sets);
  return REGISTRIES.map((source) => {
    const set = latest[source];
    const count = set?.suggestions.filter((each) => each.status === 'new').length ?? 0;
    return {
      id: source,
      name: SOURCE_NAMES[source],
      status: registryStatus(set, count),
      count,
    };
  });
}

/** Some registry has not answered yet. */
export function isChecking(sets: LoadedSuggestionSet[]): boolean {
  return Object.values(latestSets(sets)).some((set) => set.status === 'pending');
}

/** When the person's registries were last asked, or null if never. */
export function lastChecked(sets: LoadedSuggestionSet[]): string | null {
  const times = Object.values(latestSets(sets)).map((set) => set.readyAt ?? set.requestedAt);
  return times.length === 0 ? null : times.reduce((a, b) => (a > b ? a : b));
}

/** Replaces sets by id with newer copies and adds new ones. */
export function mergeSets(
  current: LoadedSuggestionSet[],
  incoming: LoadedSuggestionSet[],
): LoadedSuggestionSet[] {
  const byId = new Map(current.map((set) => [set.id, set]));
  for (const set of incoming) byId.set(set.id, set);
  return [...byId.values()];
}

/** Puts an updated suggestion (after accept or dismiss) into its set. */
export function withSuggestion(
  sets: LoadedSuggestionSet[],
  suggestion: LoadedSuggestion,
): LoadedSuggestionSet[] {
  return sets.map((set) =>
    set.id === suggestion.setId
      ? {
          ...set,
          suggestions: set.suggestions.map((each) =>
            each.id === suggestion.id ? suggestion : each,
          ),
        }
      : set,
  );
}

/** The category and item with this id in a statement-shaped object, or null. */
function locateItem(statement: object, itemId: string): { category: Category; item: Item } | null {
  for (const category of CATEGORIES) {
    const items = (statement as Record<string, unknown>)[category];
    if (!Array.isArray(items)) continue;
    const item: unknown = items.find(
      (candidate: unknown) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        (candidate as { id?: unknown }).id === itemId,
    );
    if (item) return { category, item: item as Item };
  }
  return null;
}

/**
 * The statement as the declarant has it, with the item an accept added or filled taken from
 * the section as the service now holds it. Everything else stays as edited on screen.
 */
export function withAcceptedItem(
  local: Draft<Statement>,
  fresh: JsonObject,
  itemId: string,
): Draft<Statement> {
  const found = locateItem(fresh, itemId);
  if (!found) return local;
  const { category, item: accepted } = found;
  const current: Item[] = local[category] ?? [];
  const exists = current.some((each) => each.id === itemId);
  return {
    ...local,
    [NIL_KEY[category]]: false,
    [category]: exists
      ? current.map((each) => (each.id === itemId ? accepted : each))
      : [...current, accepted],
  };
}

/** Where an item lives in a statement, to open it from an accepted card. */
export function categoryOfItem(statement: Draft<Statement>, itemId: string): Category | null {
  return locateItem(statement, itemId)?.category ?? null;
}

/** The editable fields for a suggestion's type, then Description for a type that adds one. */
export function editFields(itemType: string): EditField[] {
  const kind = suggestionKind(itemType);
  if (!kind.description) return kind.editFields;
  return [...kind.editFields, { key: 'description', label: 'Description' }];
}

/** The text an edit field starts with: the suggestion's field, or the description it would add. */
export function editValue(suggestion: SuggestionLike, key: string): string {
  if (key === 'description') {
    return suggestionPatch(suggestion).find((each) => each.path === 'description')?.value ?? '';
  }
  return fieldText(suggestion.fields[key]);
}

/**
 * The sets as a re-run leaves them before the service answers: the person's `new` suggestions
 * from the registries asked again are superseded, accepted and dismissed ones kept (S5).
 */
export function supersededBy(
  sets: LoadedSuggestionSet[],
  personKey: string,
  sources: readonly RegistrySystem[],
): LoadedSuggestionSet[] {
  return sets.map((set) =>
    set.personKey === personKey && set.source !== 'document' && sources.includes(set.source)
      ? {
          ...set,
          suggestions: set.suggestions.map((each) =>
            each.status === 'new' ? { ...each, status: 'superseded' as const } : each,
          ),
        }
      : set,
  );
}
