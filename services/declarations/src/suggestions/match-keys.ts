import type { AssetItem, IncomeItem, LiabilityItem } from '@adili/forms';

/**
 * Match keys (spec 05b, S4): normalised identifiers that say a suggestion and an item already in
 * the declaration describe the same thing, so the declarant is offered "Apply to this item"
 * instead of a duplicate. A key is `<kind>:<normalised identifier>`, so a registration can never
 * match a parcel number; a suggestion matches an item when any of their keys coincide.
 */

export type MatchKeyKind = 'registration' | 'parcel' | 'company-name' | 'kra-pin';

export type MatchKey = `${MatchKeyKind}:${string}`;

/** "kca 123a", "KCA-123A" → `registration:KCA123A`. */
export function registrationMatchKey(registration: string): MatchKey | null {
  return alnumKey('registration', registration);
}

/**
 * "Uasin Gishu / Kimumu / 2231" → `parcel:UASIN GISHU/KIMUMU/2231`. Separators stay, so
 * "Block 7/1234" and "Block 71/234" remain different parcels.
 */
export function parcelMatchKey(parcelNumber: string): MatchKey | null {
  const normal = parcelNumber
    .toUpperCase()
    .replace(/\s*([/.-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return normal ? `parcel:${normal}` : null;
}

/**
 * "Rift Valley Agrovet Limited", "RIFT VALLEY AGROVET LTD." → `company-name:RIFTVALLEYAGROVETLTD`.
 * Items and directorships hold only the company's name (`details.issuer`, `company`), so
 * companies match by name; BRS's company number stays in the suggestion's `sourceRef`.
 */
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

export type StatementItem = AssetItem | IncomeItem | LiabilityItem;

type Details = NonNullable<AssetItem['details']>;

/**
 * For each statement item type that carries an identifier, the `details` field holding it and
 * how it becomes a key. The registry mapping keys its suggestions through the same table, so a
 * new identified item type is added here once.
 */
const ITEM_IDENTIFIERS = {
  vehicle: { detail: 'registration', key: registrationMatchKey },
  land: { detail: 'parcelNumber', key: parcelMatchKey },
  building: { detail: 'parcelNumber', key: parcelMatchKey },
  shareholding: { detail: 'issuer', key: companyNameMatchKey },
  securities: { detail: 'issuer', key: companyNameMatchKey },
} as const satisfies Partial<
  Record<AssetItem['type'], { detail: keyof Details; key: (raw: string) => MatchKey | null }>
>;

export type IdentifiedItemType = keyof typeof ITEM_IDENTIFIERS;

/** The match keys of an identifier as an item of `itemType` holds it; none when it is blank. */
export function matchKeysFor(itemType: IdentifiedItemType, identifier: string): MatchKey[] {
  return presentKeys(identifier ? ITEM_IDENTIFIERS[itemType].key(identifier) : null);
}

/** The match keys of an item already in a financial statement; none for untyped identifiers. */
export function matchKeysOfItem(item: StatementItem): MatchKey[] {
  if (!('details' in item) || !item.details || !(item.type in ITEM_IDENTIFIERS)) return [];
  const { detail } = ITEM_IDENTIFIERS[item.type as IdentifiedItemType];
  return matchKeysFor(item.type as IdentifiedItemType, item.details[detail] ?? '');
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
