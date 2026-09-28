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

/** What makes two items the same thing: their type and normalised description. */
export function sameItemKey(item: Item): string {
  return compositeKey(item.type, normalise(item.description));
}

const matchKey = ({ personKey, category, item }: PlacedItem) =>
  compositeKey(personKey, category, sameItemKey(item));

/**
 * Pairs the items of two versions (spec 07a, BE-1). Items have no identity across cycles, so a
 * pair is the same person, category, type and normalised description; several such items pair
 * in document order. The comparison rules and the reviewer's diff both use it.
 */
export function match(previous: DeclarationV1, current: DeclarationV1): MatchResult {
  const waiting = new Map<string, PlacedItem[]>();
  for (const placed of placedItems(previous)) {
    waiting.set(matchKey(placed), [...(waiting.get(matchKey(placed)) ?? []), placed]);
  }
  const result: MatchResult = { matched: [], onlyPrevious: [], onlyCurrent: [] };
  for (const placed of placedItems(current)) {
    const earlier = waiting.get(matchKey(placed))?.shift();
    if (earlier) {
      result.matched.push({ ...placed, previous: earlier.item, current: placed.item });
    } else {
      result.onlyCurrent.push(placed);
    }
  }
  result.onlyPrevious = [...waiting.values()].flat();
  return result;
}
