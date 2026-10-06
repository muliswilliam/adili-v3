import {
  type Category,
  compareDeclarations,
  type Compared,
  type Item,
  type PlacedItem,
  type StatementComparison,
  valueOf,
} from '@adili/forms/compare';

import type { DeclarationListItem } from '../server/declarations/types';
import type { AssetItem, Draft, IncomeItem, LiabilityItem, Statement } from './contents';

type AnyItem = Draft<IncomeItem> | Draft<AssetItem> | Draft<LiabilityItem>;

/**
 * The declarant's comparison with their previous declaration while filing (ADR-006 point 10,
 * EACC story 7): the same matcher and 25% threshold (Act s.31(4)) the reviewer's comparison
 * uses, run in the browser on the draft as it stands, so a statement shows its changes as the
 * declarant edits it.
 */

/**
 * A draft's statements as the matcher reads them. An item still being filled in, without a type
 * or a value yet, is left out: there is nothing to compare it on.
 */
function comparable(statements: readonly Draft<Statement>[]): Compared {
  // The matcher reads an item's type, description, value, change flag and registry details: the
  // filter checks type and value, and the rest are defaulted or optional.
  const items = <T>(list: readonly AnyItem[] | undefined) =>
    (list ?? []).filter(isComparable).map((item) => ({
      ...item,
      description: item.description ?? '',
      change: { changed: item.change?.changed === true },
    })) as unknown as T[];
  return {
    statements: statements.map((statement) => ({
      personKey: statement.personKey ?? 'officer',
      income: items(statement.income),
      assets: items(statement.assets),
      liabilities: items(statement.liabilities),
    })),
  };
}

function isComparable(item: AnyItem): boolean {
  const money =
    'amount' in item
      ? item.amount
      : 'value' in item
        ? item.value
        : 'outstanding' in item
          ? item.outstanding
          : undefined;
  return typeof item.type === 'string' && typeof money?.kesCents === 'number';
}

/** Every statement of the draft against the previous declaration's. */
export function compareStatements(
  previous: readonly Draft<Statement>[],
  current: readonly Draft<Statement>[],
): StatementComparison[] {
  return compareDeclarations(comparable(previous), comparable(current));
}

/** One change to show: a value that moved, an item that is new, or one that is gone. */
export interface ChangeRow {
  kind: 'value' | 'new' | 'gone';
  category: Category;
  type: string;
  description: string;
  /** The current item, to link to; null for one that is gone. */
  itemId: string | null;
  /** Null for a new item. */
  previousCents: number | null;
  /** Null for an item that is gone. */
  currentCents: number | null;
  /** Signed whole percent for a value change; null otherwise, or up from nothing. */
  changePercent: number | null;
  /** Act s.31(4): 25% or more either way, an acquisition or a disposal. */
  material: boolean;
  /** The current item is marked as changed since the last declaration. */
  markedAsChanged: boolean;
}

export interface Changes {
  rows: ChangeRow[];
  /** Items of both declarations whose value did not move. */
  unchanged: number;
}

/** A statement's changes: value changes in the draft's order, then new items, then gone ones. */
export function changeRows(statement: StatementComparison): Changes {
  const moved = statement.matched.filter((pair) => pair.deltaCents !== 0);
  return {
    rows: [
      ...moved.map((pair): ChangeRow => ({
        kind: 'value',
        ...described(pair.category, pair.current),
        itemId: pair.current.id,
        previousCents: pair.previousCents,
        currentCents: pair.currentCents,
        changePercent: pair.changePercent,
        material: pair.material,
        markedAsChanged: pair.current.change.changed,
      })),
      ...statement.onlyCurrent.map((placed): ChangeRow => ({
        kind: 'new',
        ...unmatched(placed),
        itemId: placed.item.id,
        previousCents: null,
        currentCents: valueOf(placed.item),
        markedAsChanged: placed.item.change.changed,
      })),
      ...statement.onlyPrevious.map((placed): ChangeRow => ({
        kind: 'gone',
        ...unmatched(placed),
        itemId: null,
        previousCents: valueOf(placed.item),
        currentCents: null,
        markedAsChanged: false,
      })),
    ],
    unchanged: statement.matched.length - moved.length,
  };
}

function described(category: Category, item: Item) {
  return { category, type: item.type, description: item.description };
}

/** Acquired or disposed of: material whatever the value (Act s.31(4)(b)). */
function unmatched({ category, item }: PlacedItem) {
  return { ...described(category, item), changePercent: null, material: true };
}

/** One person's changes; none when neither declaration has a statement for them. */
export function statementChanges(
  previous: readonly Draft<Statement>[],
  current: readonly Draft<Statement>[],
  personKey: string,
): Changes {
  const statement = compareStatements(previous, current).find(
    (each) => each.personKey === personKey,
  );
  return statement ? changeRows(statement) : { rows: [], unchanged: 0 };
}

/**
 * The declaration this one follows: of the declarant's others with a version filed, the one with
 * the latest statement date before this one's. None for a first declaration.
 */
export function previousDeclarationOf(
  list: readonly DeclarationListItem[],
  declarationId: string,
): DeclarationListItem | null {
  const self = list.find((item) => item.id === declarationId);
  if (!self) return null;
  const earlier = list.filter(
    (item) =>
      item.id !== declarationId &&
      item.currentVersion !== null &&
      item.statementDate < self.statementDate,
  );
  earlier.sort(
    (a, b) =>
      b.statementDate.localeCompare(a.statementDate) ||
      (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
  );
  return earlier[0] ?? null;
}
