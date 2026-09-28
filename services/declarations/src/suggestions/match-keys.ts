import type { AssetItem, IncomeItem, LiabilityItem, Spouse } from '@adili/forms';

/**
 * Match keys (spec 05b, S4): normalised identifiers that say a suggestion and an item already in
 * the person's statement describe the same thing, so the declarant is offered "Apply to this
 * item" instead of a duplicate. A key is `<kind>:<normalised identifier>`, so a registration can
 * never match a parcel number; a suggestion matches an item when any of their keys coincide.
 */

/** "kca 123a", "KCA-123A" → `registration:KCA123A`. */
export function registrationMatchKey(registration: string): string | null {
  return alnumKey('registration', registration);
}

/**
 * "Uasin Gishu / Kimumu / 2231" → `parcel:UASIN GISHU/KIMUMU/2231`. Separators stay, so
 * "Block 7/1234" and "Block 71/234" remain different parcels.
 */
export function parcelMatchKey(parcelNumber: string): string | null {
  const normal = parcelNumber
    .toUpperCase()
    .replace(/\s*([/.-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return normal ? `parcel:${normal}` : null;
}

/** "PVT-AB12CD3E" → `company-number:PVTAB12CD3E`. */
export function companyNumberMatchKey(registrationNumber: string): string | null {
  return alnumKey('company-number', registrationNumber);
}

/**
 * "Rift Valley Agrovet Limited", "RIFT VALLEY AGROVET LTD." → `company-name:RIFTVALLEYAGROVETLTD`.
 * Items hold only the company's name (`details.issuer`), so a BRS suggestion matches an item by
 * name as well as by number.
 */
export function companyNameMatchKey(companyName: string): string | null {
  const normal = companyName
    .toUpperCase()
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/[^A-Z0-9]/g, '');
  return normal ? `company-name:${normal}` : null;
}

/** "a005231876k" → `kra-pin:A005231876K`. */
export function kraPinMatchKey(pin: string): string | null {
  return alnumKey('kra-pin', pin);
}

export type StatementItem = AssetItem | IncomeItem | LiabilityItem;

/** The match keys of an item already in a financial statement; none for untyped identifiers. */
export function matchKeysOfItem(item: StatementItem): string[] {
  if (!('details' in item) || !item.details) return [];
  const { details } = item;
  switch (item.type) {
    case 'vehicle':
      return present(details.registration && registrationMatchKey(details.registration));
    case 'land':
    case 'building':
      return present(details.parcelNumber && parcelMatchKey(details.parcelNumber));
    case 'shareholding':
    case 'securities':
      return present(details.issuer && companyNameMatchKey(details.issuer));
    default:
      return [];
  }
}

/** The match keys of a spouse already in the household (their KRA PIN). */
export function matchKeysOfSpouse(spouse: Pick<Spouse, 'kraPin'>): string[] {
  return present(spouse.kraPin && kraPinMatchKey(spouse.kraPin));
}

/** The first item whose keys coincide with the suggestion's, for the suggestion's `matchItemId`. */
export function findMatchingItem(
  suggestion: { matchKeys: readonly string[] },
  items: readonly StatementItem[],
): string | null {
  if (suggestion.matchKeys.length === 0) return null;
  const wanted = new Set(suggestion.matchKeys);
  return items.find((item) => matchKeysOfItem(item).some((key) => wanted.has(key)))?.id ?? null;
}

/** `<prefix>:<raw upper-cased, letters and digits only>`, or null when nothing is left. */
function alnumKey(prefix: string, raw: string): string | null {
  const normal = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normal ? `${prefix}:${normal}` : null;
}

function present(key: string | null | undefined): string[] {
  return key ? [key] : [];
}
