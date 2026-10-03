import type { AssetItem, IncomeItem, LiabilityItem, RegistrableInterests } from '@adili/forms';

/**
 * Match keys (spec 05b, S4): normalised identifiers that say a suggestion and an item already in
 * the declaration describe the same thing, so the declarant is offered "Apply to this item"
 * instead of a duplicate. A key is `<kind>:<normalised identifier>`, so a registration can never
 * match a parcel number; a suggestion matches an item when any of their keys coincide.
 */

export type MatchKeyKind =
  'registration' | 'parcel' | 'company-number' | 'company-name' | 'kra-pin';

export type MatchKey = `${MatchKeyKind}:${string}`;

/** "kca 123a", "KCA-123A" → `registration:KCA123A`. */
export function registrationMatchKey(registration: string): MatchKey | null {
  return alnumKey('registration', registration);
}

/**
 * A parcel or title number. "Uasin Gishu / Kimumu / 2231" → `parcel:UASIN GISHU/KIMUMU/2231`.
 * Separators stay, so "Block 7/1234" and "Block 71/234" remain different parcels.
 */
export function parcelMatchKey(parcelNumber: string): MatchKey | null {
  const normal = parcelNumber
    .toUpperCase()
    .replace(/\s*([/.-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return normal ? `parcel:${normal}` : null;
}

/** BRS's company registration number. "pvt-ab12cd3e" → `company-number:PVTAB12CD3E`. */
export function companyNumberMatchKey(registrationNumber: string): MatchKey | null {
  return alnumKey('company-number', registrationNumber);
}

/** "Rift Valley Agrovet Limited", "RIFT VALLEY AGROVET LTD." → `company-name:RIFTVALLEYAGROVETLTD`. */
export function companyNameMatchKey(companyName: string): MatchKey | null {
  return alnumKey('company-name', companyName.toUpperCase().replace(/\bLIMITED\b/g, 'LTD'));
}

/** "a005231876k" → `kra-pin:A005231876K`. */
export function kraPinMatchKey(pin: string): MatchKey | null {
  return alnumKey('kra-pin', pin);
}

/** The keys that are present, dropping identifiers that normalised to nothing. */
export function presentKeys(...candidates: (MatchKey | null | undefined)[]): MatchKey[] {
  return candidates.filter((each): each is MatchKey => typeof each === 'string');
}

/**
 * The keys of a company as a declarant writes it on an item (`details.issuer`, a directorship's
 * `company`): usually its name, sometimes its registration number. Both keys are kept so either
 * way meets a BRS suggestion, which carries the company's name and number.
 */
function companyKeys(company: string): MatchKey[] {
  return presentKeys(companyNameMatchKey(company), companyNumberMatchKey(company));
}

export type StatementItem = AssetItem | IncomeItem | LiabilityItem;

type Details = NonNullable<AssetItem['details']>;

/**
 * For each statement item type that carries an identifier, the `details` field holding it and
 * how it becomes keys. The registry mapping keys its suggestions through the same table, so a
 * new identified item type is added here once.
 */
const ITEM_IDENTIFIERS = {
  vehicle: { detail: 'registration', keys: (raw) => presentKeys(registrationMatchKey(raw)) },
  land: { detail: 'parcelNumber', keys: (raw) => presentKeys(parcelMatchKey(raw)) },
  building: { detail: 'parcelNumber', keys: (raw) => presentKeys(parcelMatchKey(raw)) },
  shareholding: { detail: 'issuer', keys: companyKeys },
  securities: { detail: 'issuer', keys: companyKeys },
} as const satisfies Partial<
  Record<AssetItem['type'], { detail: keyof Details; keys: (raw: string) => MatchKey[] }>
>;

export type IdentifiedItemType = keyof typeof ITEM_IDENTIFIERS;

/** The match keys of an identifier as an item of `itemType` holds it; none when it is blank. */
export function matchKeysFor(itemType: IdentifiedItemType, identifier: string): MatchKey[] {
  return identifier ? ITEM_IDENTIFIERS[itemType].keys(identifier) : [];
}

/** The match keys of an item already in a financial statement; none for untyped identifiers. */
export function matchKeysOfItem(item: StatementItem): MatchKey[] {
  if (!('details' in item) || !item.details || !(item.type in ITEM_IDENTIFIERS)) return [];
  const { detail } = ITEM_IDENTIFIERS[item.type as IdentifiedItemType];
  return matchKeysFor(item.type as IdentifiedItemType, item.details[detail] ?? '');
}

type Directorship = RegistrableInterests['directorships'][number];

/** The match keys of a paragraph 9 directorship already in the declaration: its company. */
export function matchKeysOfDirectorship(directorship: Directorship): MatchKey[] {
  return companyKeys(directorship.company);
}

/** The first item whose keys coincide with the suggestion's, for the suggestion's `matchItemId`. */
export function findMatchingItem(
  suggestion: { matchKeys: readonly MatchKey[] },
  items: readonly StatementItem[],
): string | null {
  if (suggestion.matchKeys.length === 0) return null;
  const wanted = new Set<string>(suggestion.matchKeys);
  return items.find((item) => matchKeysOfItem(item).some((key) => wanted.has(key)))?.id ?? null;
}

/** `<kind>:<raw upper-cased, letters and digits only>`, or null when nothing is left. */
function alnumKey(kind: MatchKeyKind, raw: string): MatchKey | null {
  const normal = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normal ? `${kind}:${normal}` : null;
}

/** What the re-suggestion rule compares of a suggestion. */
export interface Comparable {
  itemType: string;
  sectionKey: string;
  matchKeys: readonly MatchKey[];
}

/**
 * Whether a registry checked again is suggesting what the declarant has already decided on: an
 * earlier suggestion of the same registry and person, dismissed, or accepted with its item still
 * declared (the caller leaves out those whose item was deleted), of the same item type
 * and sharing a match key (the same car, parcel, company or PIN). A suggestion with no
 * identifier (KRA's income hint) repeats a decided one of its type in the same section. Such a
 * suggestion is stored `superseded` rather than `new`: the declarant's decision stands, and the
 * earlier card keeps showing it.
 */
export function repeatsDecided(suggestion: Comparable, decided: readonly Comparable[]): boolean {
  const keys = new Set<string>(suggestion.matchKeys);
  return decided.some(
    (earlier) =>
      earlier.itemType === suggestion.itemType &&
      (keys.size === 0
        ? earlier.matchKeys.length === 0 && earlier.sectionKey === suggestion.sectionKey
        : earlier.matchKeys.some((key) => keys.has(key))),
  );
}
