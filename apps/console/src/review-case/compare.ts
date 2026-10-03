import { DIFF_HIGHLIGHT_PERCENT, type DiffGroup, type DiffRow } from '@adili/ui';

import type { VersionComparison } from '../server/review/types';
import { CATEGORIES, type Relation, relationOf } from './declaration';
import {
  ASSET_TYPE_LABELS,
  CATEGORY_LABELS,
  INCOME_TYPE_LABELS,
  LIABILITY_TYPE_LABELS,
  RELATION_LABELS,
} from './labels';

/**
 * The version comparison (spec 07a FE-3, S10) as the case view's `DiffTable`s read it: per
 * statement, the review service's matched and unmatched items grouped by category in First
 * Schedule order, each saying whether the declarant marked the change. Pure.
 */

type ComparedStatementInput = VersionComparison['statements'][number];
type Category = ComparedStatementInput['matched'][number]['category'];

export interface ComparedStatement {
  personKey: string;
  name: string;
  relation: Relation;
  /** "Declarant", "Spouse", "Child". */
  relationLabel: string;
  /** Categories with items in either version; none when both versions declared nothing. */
  groups: DiffGroup[];
  empty: boolean;
}

export interface ComparisonView {
  previousVersion: number;
  currentVersion: number;
  /**
   * The previous version is an earlier version of this declaration (an amendment); otherwise it
   * is the person's previous declaration (the last cycle's), numbered on its own.
   */
  previousIsEarlierVersion: boolean;
  statements: ComparedStatement[];
  counts: {
    matched: number;
    /** Matched items whose value changed by `DIFF_HIGHLIGHT_PERCENT` or more. */
    changedBig: number;
    oneVersionOnly: number;
  };
}

export const COMPARE_COPY = {
  marked: 'Marked as changed',
  notMarked: 'Not marked',
  markedNew: 'marked as new',
  notMarkedNew: 'not marked',
} as const;

const TYPE_LABELS: Record<Category, Record<string, string>> = {
  income: INCOME_TYPE_LABELS,
  assets: ASSET_TYPE_LABELS,
  liabilities: LIABILITY_TYPE_LABELS,
};

const typeLabel = (category: Category, type: string) => TYPE_LABELS[category][type] ?? type;

const isBig = ({ previousCents, currentCents }: { previousCents: number; currentCents: number }) =>
  previousCents !== 0 &&
  (Math.abs(currentCents - previousCents) / Math.abs(previousCents)) * 100 >=
    DIFF_HIGHLIGHT_PERCENT;

function matchedRow(
  personKey: string,
  index: number,
  item: ComparedStatementInput['matched'][number],
): DiffRow {
  // Whether the declarant marked it matters for a change the rules would flag (25% or more);
  // a mark on a smaller change or none is worth showing too. Other rows speak for themselves.
  const marked = item.flaggedByDeclarant;
  return {
    id: `${personKey}:matched:${String(index)}`,
    label: typeLabel(item.category, item.type),
    description: item.description,
    previousCents: item.previousCents,
    currentCents: item.currentCents,
    // Null says why there is no percentage; otherwise the table works it out from the amounts,
    // to one decimal (the service rounds to whole percent).
    ...(item.deltaPercent === null ? { deltaPercent: null } : {}),
    ...(marked || isBig(item)
      ? { note: marked ? COMPARE_COPY.marked : COMPARE_COPY.notMarked }
      : {}),
  };
}

function statementOf(statement: ComparedStatementInput): ComparedStatement {
  const { personKey } = statement;
  const groups: DiffGroup[] = [];
  for (const category of CATEGORIES) {
    const rows: DiffRow[] = [
      ...statement.matched
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.category === category)
        .map(({ item, index }) => matchedRow(personKey, index, item)),
      ...statement.onlyCurrent
        .filter((item) => item.category === category)
        .map((item): DiffRow => ({
          id: `${personKey}:current:${item.itemId}`,
          label: typeLabel(category, item.type),
          description: item.description,
          previousCents: null,
          currentCents: item.valueCents,
          note: item.flaggedByDeclarant ? COMPARE_COPY.markedNew : COMPARE_COPY.notMarkedNew,
        })),
      // The disposal itself is recorded in paragraph 9, which the comparison does not carry.
      ...statement.onlyPrevious
        .filter((item) => item.category === category)
        .map((item): DiffRow => ({
          id: `${personKey}:previous:${item.itemId}`,
          label: typeLabel(category, item.type),
          description: item.description,
          previousCents: item.valueCents,
          currentCents: null,
        })),
    ];
    if (rows.length > 0) groups.push({ id: category, label: CATEGORY_LABELS[category], rows });
  }
  const relation = relationOf(personKey);
  return {
    personKey,
    name: statement.personName,
    relation,
    relationLabel: RELATION_LABELS[relation],
    groups,
    empty: groups.length === 0,
  };
}

export function comparisonView(comparison: VersionComparison): ComparisonView {
  const matched = comparison.statements.flatMap((statement) => statement.matched);
  return {
    previousVersion: comparison.previousVersion,
    currentVersion: comparison.currentVersion,
    previousIsEarlierVersion: comparison.previousVersion < comparison.currentVersion,
    statements: comparison.statements.map(statementOf),
    counts: {
      matched: matched.length,
      changedBig: matched.filter(isBig).length,
      oneVersionOnly: comparison.statements.reduce(
        (total, statement) => total + statement.onlyPrevious.length + statement.onlyCurrent.length,
        0,
      ),
    },
  };
}
