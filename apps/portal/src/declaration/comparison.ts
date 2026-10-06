import {
  type Category,
  compareDeclarations,
  type Compared,
  GONE_KIND,
  type Item,
  MONEY_FIELD,
  NEW_KIND,
  normalise,
  personKind,
  type PlacedItem,
  type StatementComparison,
  valueOf,
} from '@adili/forms/compare';

import type {
  AssetItem,
  Draft,
  IncomeItem,
  LiabilityItem,
  MaterialChangeEntry,
  Statement,
} from './contents';
import { fullName } from './format';
import { OFFICER_KEY } from './section-key';

type AnyItem = Draft<IncomeItem> | Draft<AssetItem> | Draft<LiabilityItem>;

/**
 * The declarant's comparison with their previous declaration while filing (ADR-006 point 10,
 * EACC story 7): the same matcher and 25% threshold (Act s.31(4)) the reviewer's comparison
 * uses, run in the browser on the draft as it stands, so a statement shows its changes as the
 * declarant edits it.
 */

/** Marks an item compared before its value was given: it pairs, but shows no change yet. */
const UNVALUED = 'unvalued';

/** Whose a draft statement is: one saved before its person was set is the officer's. */
const personOf = (statement: Draft<Statement>): string => statement.personKey ?? OFFICER_KEY;

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
        const field = MONEY_FIELD[category];
        const money = (item as Record<string, { kesCents?: number } | undefined>)[field];
        const valued = typeof money?.kesCents === 'number';
        return {
          ...item,
          description: item.description ?? '',
          // The kind is kept: whether an item counts as marked depends on it, as for the reviewer.
          change: {
            changed: item.change?.changed === true,
            ...(item.change?.kind && { kind: item.change.kind }),
          },
          ...(!valued && { [field]: { kesCents: 0 }, [UNVALUED]: true }),
        };
      }) as unknown as T[];
  return {
    statements: statements.map((statement) => ({
      personKey: personOf(statement),
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
  const previousKeys = new Set(previous.map(personOf));
  const currentKeys = new Set(current.map(personOf));
  const unclaimed = current.filter((statement) => !previousKeys.has(personOf(statement)));
  const nameOf = (statement: Draft<Statement>) => normalise(fullName(statement.personName));
  return previous.map((statement) => {
    const key = personOf(statement);
    if (currentKeys.has(key) || nameOf(statement) === '') return statement;
    const index = unclaimed.findIndex(
      (other) =>
        personKind(personOf(other)) === personKind(key) && nameOf(other) === nameOf(statement),
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
  /** Act s.31(4): 25% or more either way, an acquisition or a disposal. */
  material: boolean;
  /**
   * The current item is marked as the change it is, as the reviewer's rules read the marking: a
   * new item as changed with its category's new kind (an acquisition, a new source), a value
   * change as changed with any other kind.
   */
  markedAsChanged: boolean;
  /**
   * For an item that is gone: paragraph 9 records it as gone, as the reviewer's rules read it.
   * Unset on other rows, and where paragraph 9 is not known (a statement on its own).
   */
  recordedInParagraph9?: boolean;
}

export interface Changes {
  rows: ChangeRow[];
  /** Items of both declarations whose value did not move. */
  unchanged: number;
}

/**
 * A statement's changes: value changes in the draft's order, then new items, then gone ones.
 * Given paragraph 9's material changes, each gone item says whether they record it.
 */
export function changeRows(
  statement: StatementComparison,
  materialChanges?: readonly Draft<MaterialChangeEntry>[],
): Changes {
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
        material: pair.material,
        markedAsChanged: marked(pair.category, pair.current, false),
      })),
      ...statement.onlyCurrent
        .filter((placed) => !isUnvalued(placed.item))
        .map((placed): ChangeRow => ({
          kind: 'new',
          ...unmatched(placed),
          itemId: placed.item.id,
          previousCents: null,
          currentCents: valueOf(placed.item),
          markedAsChanged: marked(placed.category, placed.item, true),
        })),
      ...statement.onlyPrevious.map((placed): ChangeRow => ({
        kind: 'gone',
        ...unmatched(placed),
        itemId: null,
        previousCents: valueOf(placed.item),
        currentCents: null,
        markedAsChanged: false,
        ...(materialChanges && {
          recordedInParagraph9: recordedAsGone(placed, materialChanges),
        }),
      })),
    ],
    unchanged: valued.length - moved.length,
  };
}

/** Whether an item is marked as changed, and with the kind for a new item exactly when it is one. */
function marked(category: Category, item: Item, isNew: boolean): boolean {
  const { changed, kind } = item.change;
  return changed && (kind === NEW_KIND[category]) === isNew;
}

function described(category: Category, item: Item) {
  return { category, type: item.type, description: item.description };
}

/** Acquired or disposed of: material whatever the value (Act s.31(4)(b)). */
function unmatched({ category, item }: PlacedItem) {
  return { ...described(category, item), material: true };
}

/**
 * Whether paragraph 9 records an item as gone, as the reviewer's `disposal-unflagged` rule reads
 * it: an entry of its category's gone kind (a disposal, a source ended, a debt settled) for the
 * item's id, or for the same person and the same description however worded. The person is the
 * one the draft declares them as, the key paragraph 9's entries carry.
 */
function recordedAsGone(
  placed: PlacedItem,
  materialChanges: readonly Draft<MaterialChangeEntry>[],
): boolean {
  return materialChanges.some(
    (entry) =>
      entry.kind === GONE_KIND[placed.category] &&
      // A draft's item may lack an id the reviewer's always has: it never pairs on a missing one.
      ((entry.itemId !== undefined && entry.itemId === placed.item.id) ||
        (entry.personKey === placed.personKey &&
          entry.itemDescription !== undefined &&
          normalise(entry.itemDescription) === normalise(placed.item.description))),
  );
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
