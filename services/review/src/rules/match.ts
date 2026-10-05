import type {
  AssetItem,
  DeclarationSectionKey,
  DeclarationV1,
  IncomeItem,
  LiabilityItem,
  PersonKey,
} from '@adili/forms';

export type Category = 'income' | 'assets' | 'liabilities';
export type Item = IncomeItem | AssetItem | LiabilityItem;

export const CATEGORIES: readonly Category[] = ['income', 'assets', 'liabilities'];

/** An item where it sits in a declaration: whose statement and which category. */
export interface PlacedItem {
  personKey: string;
  category: Category;
  item: Item;
}

export interface MatchedPair {
  personKey: string;
  category: Category;
  previous: Item;
  current: Item;
}

export interface MatchResult {
  matched: MatchedPair[];
  onlyPrevious: PlacedItem[];
  onlyCurrent: PlacedItem[];
}

/** Lower case, letters and digits only, single spaces: "Plot in Kisumu." and "plot in  KISUMU" agree. */
export function normalise(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A statement's key in the draft and review contracts. */
// The person key comes from a statement the schema has validated against its PersonKey pattern.
export function statementSectionKey(personKey: string): DeclarationSectionKey {
  return `statement:${personKey as PersonKey}`;
}

/** One key from several parts, for maps and sets; parts cannot run into each other. */
export function compositeKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

/** Every item of a declaration, in document order. */
export function placedItems(document: DeclarationV1): PlacedItem[] {
  return document.statements.flatMap((statement) =>
    CATEGORIES.flatMap((category) =>
      statement[category].map((item): PlacedItem => ({
        personKey: statement.personKey,
        category,
        item,
      })),
    ),
  );
}

/** An item's declared value in KES cents: its amount, value or outstanding balance. */
export function valueOf(item: Item): number {
  if ('amount' in item) return item.amount.kesCents;
  if ('value' in item) return item.value.kesCents;
  return item.outstanding.kesCents;
}

/** What makes two items the same thing when neither names it: their type and normalised description. */
export function sameItemKey(item: Item): string {
  return compositeKey(item.type, normalise(item.description));
}

/** Identifiers compare without case, spaces or separators: "KCX 214J" and "kcx-214j" agree. */
const identifierKey = (value: string) => value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The registry identifier that names an asset whatever its description says: a vehicle's
 * registration, a parcel's number, the company of a shareholding or securities holding. Null for
 * other items and for an item declared without one.
 */
export function itemIdentifier(item: Item): string | null {
  if (!('details' in item) || !item.details) return null;
  const identifier =
    item.type === 'vehicle'
      ? item.details.registration
      : item.type === 'land' || item.type === 'building'
        ? item.details.parcelNumber
        : item.type === 'shareholding' || item.type === 'securities'
          ? item.details.issuer
          : undefined;
  const key = identifierKey(identifier ?? '');
  return key === '' ? null : key;
}

const identifierMatchKey = ({ personKey, category, item }: PlacedItem) => {
  const identifier = itemIdentifier(item);
  return identifier === null ? null : compositeKey(personKey, category, item.type, identifier);
};

const descriptionMatchKey = ({ personKey, category, item }: PlacedItem) =>
  compositeKey(personKey, category, sameItemKey(item));

/**
 * Pairs the items of two versions (spec 07a, BE-1). Items have no identity across cycles, so
 * items of the same person, category and type pair first by the registry identifier they carry
 * (a vehicle's registration, a parcel number, a company), whatever their descriptions say: the
 * same car worded differently, or read in by the AI from a logbook, is still one car. Items left
 * pair by normalised description. Several items with the same key pair in document order. The
 * comparison rules and the reviewer's diff both use it.
 */
export function match(previous: DeclarationV1, current: DeclarationV1): MatchResult {
  const result: MatchResult = { matched: [], onlyPrevious: [], onlyCurrent: [] };
  let waiting = placedItems(previous);
  let unmatched = placedItems(current);
  for (const key of [identifierMatchKey, descriptionMatchKey]) {
    const byKey = new Map<string, PlacedItem[]>();
    const rest: PlacedItem[] = [];
    for (const placed of waiting) {
      const k = key(placed);
      if (k === null) rest.push(placed);
      else byKey.set(k, [...(byKey.get(k) ?? []), placed]);
    }
    const stillUnmatched: PlacedItem[] = [];
    for (const placed of unmatched) {
      const k = key(placed);
      // Two items that both name an identifier, different ones, are different things whatever
      // their descriptions say: they never pair by description.
      const candidates = k === null ? undefined : byKey.get(k);
      const index =
        candidates?.findIndex(
          (earlier) =>
            itemIdentifier(earlier.item) === null || itemIdentifier(placed.item) === null,
        ) ?? -1;
      const earlier =
        key === identifierMatchKey
          ? candidates?.shift()
          : index === -1
            ? undefined
            : candidates?.splice(index, 1)[0];
      if (earlier) {
        result.matched.push({ ...placed, previous: earlier.item, current: placed.item });
      } else {
        stillUnmatched.push(placed);
      }
    }
    waiting = [...rest, ...[...byKey.values()].flat()];
    unmatched = stillUnmatched;
  }
  // Document order, as before: pairs and new items in the current version's, the rest in the
  // previous version's.
  const currentOrder = new Map(placedItems(current).map((placed, index) => [placed.item, index]));
  const previousOrder = new Map(placedItems(previous).map((placed, index) => [placed.item, index]));
  const position = (order: Map<Item, number>, item: Item) => order.get(item) ?? 0;
  result.matched.sort(
    (a, b) => position(currentOrder, a.current) - position(currentOrder, b.current),
  );
  result.onlyCurrent = unmatched.sort(
    (a, b) => position(currentOrder, a.item) - position(currentOrder, b.item),
  );
  result.onlyPrevious = waiting.sort(
    (a, b) => position(previousOrder, a.item) - position(previousOrder, b.item),
  );
  return result;
}
