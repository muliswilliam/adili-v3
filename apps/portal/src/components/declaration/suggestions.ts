import type { RegistryStatus, RegistryStatusEntry } from '@adili/ui';
import { SOURCE_NAMES } from '@adili/ui';

import type {
  JsonObject,
  LoadedSuggestion,
  LoadedSuggestionSet,
  RegistrySystem,
} from '../../server/declarations.server';
import { ASSET_TYPES, type Draft, INCOME_TYPES, LIABILITY_TYPES, type Statement } from './contents';
import { countyName } from './format';
import { TYPE_LABELS } from './labels';
import { type Category, type Item, NIL_KEY } from './statement';

/**
 * Pure rules for registry suggestions (spec 05b), shared by the Check registries panel and the
 * declarations mock so both read a suggestion the same way.
 *
 * The contract leaves a suggestion's `fields` free-form and gives it no title (contract gaps 4
 * and 10), so this module fixes the field names per item type, as the mock emits them:
 * - `vehicle`: registration, make, model, year
 * - `land`: parcelNumber, size, location, county (a county code)
 * - `shareholding` (BRS; the spec's `investment`, which declaration.v1 does not have):
 *   companyName, registrationNumber, role, shares
 * - `bio-tax` (KRA): kraPin, complianceStatus
 * Any type may also carry `description`, which the declarant can edit before adding.
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
function text(value: unknown): string {
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
  const status = text(value);
  return COMPLIANCE_WORDS[status.toLowerCase()] ?? status;
}

/** 500 → "500 shares"; "12.5%" or "500 shares" as sent. */
export function sharesText(value: unknown): string {
  const shares = text(value);
  return /^\d[\d,]*$/.test(shares) ? `${shares} shares` : shares;
}

/** The declaration.v1 item type a suggestion adds: BRS's `investment` is a shareholding. */
export function declaredType(itemType: string): string {
  return itemType === 'investment' ? 'shareholding' : itemType;
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
  if (itemType === 'bio-tax') return 'KRA PIN';
  const category = categoryOf(itemType);
  return (category && TYPE_LABELS[category][declaredType(itemType)]) ?? 'Suggestion';
}

/**
 * The card's title, composed from the fields because the contract has none (gap 4):
 * "KCA 123A · Toyota Fielder 2016", "Uasin Gishu/Kimumu/2231 · 0.5 acres",
 * "Rift Valley Agrovet Ltd · 500 shares", "KRA PIN A00•••••76K · Compliance: Compliant".
 * Falls back to the item type in words when the fields say nothing usable.
 */
export function suggestionTitle({ itemType, fields }: SuggestionLike): string {
  const type = declaredType(itemType);
  let title = '';
  if (type === 'vehicle') {
    const model = joined([text(fields.make), text(fields.model), text(fields.year)], ' ');
    title = joined([text(fields.registration), model], ' · ');
  } else if (type === 'land' || type === 'building') {
    title = joined([text(fields.parcelNumber), text(fields.size)], ' · ');
  } else if (type === 'shareholding' || type === 'securities') {
    const holding = sharesText(fields.shares) || text(fields.role);
    title = joined([text(fields.companyName), holding], ' · ');
  } else if (type === 'bio-tax') {
    const pin = text(fields.kraPin);
    const compliance = complianceText(fields.complianceStatus);
    title = joined(
      [pin ? `KRA PIN ${maskKraPin(pin)}` : '', compliance ? `Compliance: ${compliance}` : ''],
      ' · ',
    );
  }
  return title || text(fields.description) || typeWord(itemType);
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

/**
 * What accepting the suggestion writes into the item (or, for `bio-tax`, the spouse), in the
 * order the card lists it. Value fields stay empty: the declarant enters them. The mock writes
 * exactly these paths, so "Fills: …" on a matching card is what applying fills.
 */
export function suggestionPatch({ itemType, fields }: SuggestionLike): PatchEntry[] {
  const type = declaredType(itemType);
  const edited = text(fields.description);
  const description = (derived: string) => entry('description', 'Description', edited || derived);

  if (type === 'vehicle') {
    const makeModel = joined([text(fields.make), text(fields.model)], ' ');
    return [
      ...entry('details.registration', 'Registration', text(fields.registration)),
      ...entry('details.makeModel', 'Make and model', joined([makeModel, text(fields.year)], ', ')),
      ...description(makeModel),
    ];
  }
  if (type === 'land' || type === 'building') {
    const county = text(fields.county);
    const location = text(fields.location);
    return [
      ...entry('details.parcelNumber', 'Parcel or plot number', text(fields.parcelNumber)),
      ...entry('details.size', 'Size', text(fields.size)),
      ...entry('location.detail', 'Location', location),
      ...entry('location.county', 'County', county, countyName(county) ?? county),
      ...description(location ? `Land in ${location}` : ''),
    ];
  }
  if (type === 'shareholding' || type === 'securities') {
    const company = text(fields.companyName);
    return [
      ...entry('details.issuer', 'Company or issuer', company),
      ...entry('details.quantityOrPercent', 'Number or percentage', sharesText(fields.shares)),
      ...description(company ? `Shares in ${company}` : ''),
    ];
  }
  if (type === 'bio-tax') {
    const pin = text(fields.kraPin);
    return entry('kraPin', 'KRA PIN', pin, maskKraPin(pin));
  }
  return description('');
}

/** The field that identifies an item of this type, used to match suggestions to items. */
export function identifierPath(itemType: string): string | null {
  const type = declaredType(itemType);
  if (type === 'vehicle') return 'details.registration';
  if (type === 'land' || type === 'building') return 'details.parcelNumber';
  if (type === 'shareholding' || type === 'securities') return 'details.issuer';
  return null;
}

/** Identifiers compare without case, spaces or separators: "kca-123 a" is "KCA123A". */
export function sameIdentifier(a: unknown, b: unknown): boolean {
  const normal = (value: unknown) =>
    text(value)
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

function isEmpty(value: unknown) {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** The item's values at the paths a patch writes, keyed by path (for `emptyFieldDiff`). */
export function valuesAt(target: unknown, patch: PatchEntry[]): Record<string, unknown> {
  return Object.fromEntries(patch.map(({ path }) => [path, readPath(target, path)]));
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

/** The first item whose identifier equals the suggestion's, for the service's `matchItemId`. */
export function findMatch(suggestion: SuggestionLike, items: Item[]): string | null {
  const path = identifierPath(suggestion.itemType);
  if (!path) return null;
  const identifier = suggestionPatch(suggestion).find((each) => each.path === path)?.value;
  const hit = items.find((item) => sameIdentifier(readPath(item, path), identifier));
  return hit?.id ?? null;
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

/**
 * The statement as the declarant has it, with the item an accept added or filled taken from
 * the section as the service now holds it. Everything else stays as edited on screen.
 */
export function withAcceptedItem(
  local: Draft<Statement>,
  fresh: JsonObject,
  itemId: string,
): Draft<Statement> {
  for (const category of ['income', 'assets', 'liabilities'] as const) {
    const items = fresh[category];
    if (!Array.isArray(items)) continue;
    const item = items.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        candidate.id === itemId,
    );
    if (!item) continue;
    const accepted = item as Item;
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
  return local;
}

/** Where an item lives in a statement, to open it from an accepted card. */
export function categoryOfItem(statement: Draft<Statement>, itemId: string): Category | null {
  for (const category of ['income', 'assets', 'liabilities'] as const) {
    const items: Item[] = statement[category] ?? [];
    if (items.some((item) => item.id === itemId)) return category;
  }
  return null;
}

/** The fields "Edit and add" offers per item type, in suggestion field names. */
export const EDIT_FIELDS: Record<string, { key: string; label: string }[]> = {
  vehicle: [
    { key: 'registration', label: 'Registration' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'year', label: 'Year' },
  ],
  land: [
    { key: 'parcelNumber', label: 'Parcel or plot number' },
    { key: 'size', label: 'Size' },
    { key: 'location', label: 'Location' },
  ],
  shareholding: [
    { key: 'companyName', label: 'Company' },
    { key: 'shares', label: 'Number or percentage' },
  ],
};

/** The editable fields for a suggestion's type, then Description. */
export function editFields(itemType: string): { key: string; label: string }[] {
  const type = declaredType(itemType);
  return [
    ...(EDIT_FIELDS[type === 'building' ? 'land' : type === 'securities' ? 'shareholding' : type] ??
      []),
    { key: 'description', label: 'Description' },
  ];
}

/** The text an edit field starts with: the suggestion's field, or the description it would add. */
export function editValue(suggestion: SuggestionLike, key: string): string {
  if (key === 'description') {
    return suggestionPatch(suggestion).find((each) => each.path === 'description')?.value ?? '';
  }
  return text(suggestion.fields[key]);
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
