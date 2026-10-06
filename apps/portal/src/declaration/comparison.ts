import {
  type Category,
  compareDeclarations,
  type Compared,
  type Item,
  normalise,
  personKind,
  type PlacedItem,
  type StatementComparison,
  valueOf,
} from '@adili/forms/compare';

import type { DeclarationListItem } from '../server/declarations/types';
import type { AssetItem, Draft, IncomeItem, LiabilityItem, Statement } from './contents';
import { fullName } from './format';

type AnyItem = Draft<IncomeItem> | Draft<AssetItem> | Draft<LiabilityItem>;

/**
 * The declarant's comparison with their previous declaration while filing (ADR-006 point 10,
 * EACC story 7): the same matcher and 25% threshold (Act s.31(4)) the reviewer's comparison
 * uses, run in the browser on the draft as it stands, so a statement shows its changes as the
 * declarant edits it.
 */

/** Where each category keeps an item's money. */
const MONEY = { income: 'amount', assets: 'value', liabilities: 'outstanding' } as const;

/** Marks an item compared before its value was given: it pairs, but shows no change yet. */
const UNVALUED = 'unvalued';

/**
 * A draft's statements as the matcher reads them. An item without a type yet is left out: there
 * is nothing to pair it on. One without a value still pairs, so its earlier counterpart is not
 * shown as gone while the declarant types the figure, but it is marked to show no change yet.
 */
function comparable(statements: readonly Draft<Statement>[]): Compared {
  // The matcher reads an item's type, description, value, change flag and registry details: type
  // is checked, and the rest are defaulted or optional.
  const items = <T>(category: Category, list: readonly AnyItem[] | undefined) =>
    (list ?? [])
      .filter((item) => typeof item.type === 'string')
      .map((item) => {
        const money = (item as Record<string, { kesCents?: number } | undefined>)[MONEY[category]];
        const valued = typeof money?.kesCents === 'number';
        return {
          ...item,
          description: item.description ?? '',
          change: { changed: item.change?.changed === true },
          ...(!valued && { [MONEY[category]]: { kesCents: 0 }, [UNVALUED]: true }),
        };
      }) as unknown as T[];
  return {
    statements: statements.map((statement) => ({
      personKey: statement.personKey ?? 'officer',
      income: items('income', statement.income),
      assets: items('assets', statement.assets),
      liabilities: items('liabilities', statement.liabilities),
    })),
  };
}

const isUnvalued = (item: Item) => UNVALUED in item;

/**
 * The previous statements keyed as the draft keys the same people. A spouse or child is given a
 * new id in each declaration, so one the draft has no statement under the old id is paired by
 * kind and name with a draft statement the previous declaration has none of; anyone else keeps
 * their old key.
 */
function alignPersons(
  previous: readonly Draft<Statement>[],
  current: readonly Draft<Statement>[],
): Draft<Statement>[] {
  const keyOf = (statement: Draft<Statement>) => statement.personKey ?? 'officer';
  const previousKeys = new Set(previous.map(keyOf));
  const currentKeys = new Set(current.map(keyOf));
  const unclaimed = current.filter((statement) => !previousKeys.has(keyOf(statement)));
  const nameOf = (statement: Draft<Statement>) => normalise(fullName(statement.personName));
  return previous.map((statement) => {
    const key = keyOf(statement);
    if (currentKeys.has(key) || nameOf(statement) === '') return statement;
    const index = unclaimed.findIndex(
      (other) =>
        personKind(keyOf(other)) === personKind(key) && nameOf(other) === nameOf(statement),
    );
    if (index === -1) return statement;
    const [same] = unclaimed.splice(index, 1);
    return same ? { ...statement, personKey: same.personKey } : statement;
  });
}

/** Every statement of the draft against the previous declaration's. */
export function compareStatements(
  previous: readonly Draft<Statement>[],
  current: readonly Draft<Statement>[],
): StatementComparison[] {
  return compareDeclarations(comparable(alignPersons(previous, current)), comparable(current));
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
  const valued = statement.matched.filter((pair) => !isUnvalued(pair.current));
  const moved = valued.filter((pair) => pair.deltaCents !== 0);
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
      ...statement.onlyCurrent
        .filter((placed) => !isUnvalued(placed.item))
        .map((placed): ChangeRow => ({
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
    unchanged: valued.length - moved.length,
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
