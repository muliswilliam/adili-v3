import type { DeclarationSectionKey, PersonKey } from './declaration.js';
import type {
  AssetItem,
  ChangeFlag,
  IncomeItem,
  LiabilityItem,
  MaterialChangeEntry,
  Statement,
} from './declaration.v1.gen.js';

/**
 * Comparing a declaration with the person's previous one (Act s.31(3)-(4)): the item matcher the
 * review service's comparison rules and the reviewer's diff use (spec 07a), and the declarant's
 * comparison while filing (ADR-006 point 10), so both pair items and judge a value change alike.
 */

export type Category = 'income' | 'assets' | 'liabilities';

/** What comparing reads of a declaration: each statement's person and items. */
export interface Compared {
  statements: readonly Pick<Statement, 'personKey' | 'income' | 'assets' | 'liabilities'>[];
}
export type Item = IncomeItem | AssetItem | LiabilityItem;

export const CATEGORIES: readonly Category[] = ['income', 'assets', 'liabilities'];

/** Where each category keeps an item's money: its amount, value or outstanding balance. */
export const MONEY_FIELD = {
  income: 'amount',
  assets: 'value',
  liabilities: 'outstanding',
} as const satisfies Record<Category, string>;

export type ChangeKind = NonNullable<ChangeFlag['kind']>;

/**
 * The change kind that marks an item as new in its category. An item the previous declaration
 * lacked is marked as changed only with it, and one it had is not marked with it: the reviewer's
 * rules and the declarant's comparison read the marking alike.
 */
export const NEW_KIND: Record<Category, ChangeKind> = {
  income: 'new-source',
  assets: 'acquisition',
  liabilities: 'acquisition',
};

/**
 * The paragraph 9 kind that records an item of each category as no longer declared: disposed
 * of, a source ended, or a debt settled. The reviewer's rules take a gone item as accounted for
 * only by an entry of its category's kind, and the declarant's comparison reads it alike.
 */
export const GONE_KIND: Record<Category, MaterialChangeEntry['kind']> = {
  income: 'source-ended',
  assets: 'disposal',
  liabilities: 'settled',
};

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

/** Whose statement a person key is: `officer`, `spouse` or `child` (`spouse:<id>` without its id). */
export function personKind(personKey: string): string {
  const colon = personKey.indexOf(':');
  return colon < 0 ? personKey : personKey.slice(0, colon);
}

/** One key from several parts, for maps and sets; parts cannot run into each other. */
export function compositeKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

/** Every item of a declaration, in document order. */
export function placedItems(document: Compared): PlacedItem[] {
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
  if (MONEY_FIELD.income in item) return item.amount.kesCents;
  if (MONEY_FIELD.assets in item) return item.value.kesCents;
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
export function match(previous: Compared, current: Compared): MatchResult {
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

/** Act s.31(4)(a): a change of at least a quarter of an item's value is material. */
export const MATERIAL_CHANGE_RATIO = 0.25;

/** How an item's declared value moved from one declaration to the next. */
export interface ValueChange {
  previousCents: number;
  currentCents: number;
  deltaCents: number;
  /** Whole percent of the previous value, signed; null when the previous value was nothing. */
  changePercent: number | null;
  /** At least 25% up or down (the exact ratio, not the rounded percent), or up from nothing. */
  material: boolean;
}

export function valueChange(previousCents: number, currentCents: number): ValueChange {
  const deltaCents = currentCents - previousCents;
  // Up from nothing is more than any percentage, and there is none to give.
  const ratio =
    previousCents === 0
      ? currentCents === 0
        ? 0
        : Infinity
      : Math.abs(deltaCents) / previousCents;
  return {
    previousCents,
    currentCents,
    deltaCents,
    changePercent: previousCents === 0 ? null : Math.round((deltaCents / previousCents) * 100),
    material: ratio >= MATERIAL_CHANGE_RATIO,
  };
}

/** One person's statement against their previous one. */
export interface StatementComparison {
  personKey: string;
  /** Items of both declarations, in the current one's order, with their value change. */
  matched: (MatchedPair & ValueChange)[];
  /** Items the previous declaration had and this one does not: disposed of or paid off. */
  onlyPrevious: PlacedItem[];
  /** Items this declaration has and the previous one did not: acquired or new. */
  onlyCurrent: PlacedItem[];
}

/**
 * The declaration against the person's previous one, statement by statement: the current
 * declaration's statements in order, then those only the previous one has.
 */
export function compareDeclarations(previous: Compared, current: Compared): StatementComparison[] {
  const { matched, onlyPrevious, onlyCurrent } = match(previous, current);
  const personKeys = [
    ...new Set([...current.statements, ...previous.statements].map((s) => s.personKey)),
  ];
  const of = <T extends { personKey: string }>(items: T[], personKey: string) =>
    items.filter((item) => item.personKey === personKey);
  return personKeys.map((personKey) => ({
    personKey,
    matched: of(matched, personKey).map((pair) => ({
      ...pair,
      ...valueChange(valueOf(pair.previous), valueOf(pair.current)),
    })),
    onlyPrevious: of(onlyPrevious, personKey),
    onlyCurrent: of(onlyCurrent, personKey),
  }));
}
