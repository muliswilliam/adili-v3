import type { AssetItem, DeclarationV1, IncomeItem, LiabilityItem } from '@adili/forms';

export type Category = 'income' | 'assets' | 'liabilities';
export type Item = IncomeItem | AssetItem | LiabilityItem;

export const CATEGORIES: readonly Category[] = ['income', 'assets', 'liabilities'];

/** An item where it sits in a declaration: whose statement and which category. */
export interface Placed {
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
  onlyPrevious: Placed[];
  onlyCurrent: Placed[];
}

/** Lower case, letters and digits only, single spaces: "Plot in Kisumu." and "plot in  KISUMU" agree. */
export function normalise(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every item of a declaration, in document order. */
export function placedItems(document: DeclarationV1): Placed[] {
  return document.statements.flatMap((statement) =>
    CATEGORIES.flatMap((category) =>
      statement[category].map((item): Placed => ({
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

const matchKey = ({ personKey, category, item }: Placed) =>
  JSON.stringify([personKey, category, item.type, normalise(item.description)]);

/**
 * Pairs the items of two versions (spec 07a, BE-1). Items have no identity across cycles, so a
 * pair is the same person, category, type and normalised description; several such items pair
 * in document order. The comparison rules and the reviewer's diff both use it.
 */
export function match(previous: DeclarationV1, current: DeclarationV1): MatchResult {
  const waiting = new Map<string, Placed[]>();
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
