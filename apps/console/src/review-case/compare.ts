import { type DiffGroup, diffHighlighted, diffKind, type DiffRow } from '@adili/ui';

import type { VersionComparison } from '../server/review/types';
import { CATEGORIES, type Relation, relationOf } from './declaration';
import {
  ASSET_TYPE_LABELS,
  CATEGORY_LABELS,
  INCOME_TYPE_LABELS,
  LIABILITY_TYPE_LABELS,
  RELATION_LABELS,
} from './labels';
import { COMPARE_COPY } from './messages';

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
    /** Matched items the rules flag: changed by `DIFF_HIGHLIGHT_PERCENT` or more, or up from nothing. */
    rulesFlagged: number;
    oneVersionOnly: number;
  };
}

const TYPE_LABELS: Record<Category, Record<string, string>> = {
  income: INCOME_TYPE_LABELS,
  assets: ASSET_TYPE_LABELS,
  liabilities: LIABILITY_TYPE_LABELS,
};

const typeLabel = (category: Category, type: string) => TYPE_LABELS[category][type] ?? type;

/**
 * A matched change the rules flag as `value-change-25`: by the exact percentage the table shows
 * and shades (`diffHighlighted`), or up from nothing, which the rules count as more than any
 * percentage (the table shows n/a there, unshaded).
 */
const isRulesFlagged = (row: DiffRow) =>
  diffKind(row) === 'matched' &&
  (diffHighlighted(row) || (row.previousCents === 0 && row.currentCents !== 0));

function matchedRow(
  personKey: string,
  index: number,
  item: ComparedStatementInput['matched'][number],
): DiffRow {
  // Whether the declarant marked it matters for a change the rules would flag (`isRulesFlagged`);
  // a mark on a smaller change or none is worth showing too. Other rows speak for themselves.
  const marked = item.flaggedByDeclarant;
  const row: DiffRow = {
    id: `${personKey}:matched:${String(index)}`,
    label: typeLabel(item.category, item.type),
    description: item.description,
    previousCents: item.previousCents,
    currentCents: item.currentCents,
    // Null says why there is no percentage; otherwise the table works it out from the amounts,
    // to one decimal (the service rounds to whole percent).
    ...(item.deltaPercent === null ? { deltaPercent: null } : {}),
  };
  if (marked || isRulesFlagged(row))
    row.note = marked ? COMPARE_COPY.marked : COMPARE_COPY.notMarked;
  return row;
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
          note: item.flaggedByDeclarant ? COMPARE_COPY.newMarked : COMPARE_COPY.newNotMarked,
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
  const statements = comparison.statements.map(statementOf);
  const rows = statements.flatMap((statement) => statement.groups.flatMap((group) => group.rows));
  const matchedRows = rows.filter((row) => diffKind(row) === 'matched');
  return {
    previousVersion: comparison.previousVersion,
    currentVersion: comparison.currentVersion,
    previousIsEarlierVersion: comparison.previousVersion < comparison.currentVersion,
    statements,
    counts: {
      matched: matchedRows.length,
      rulesFlagged: matchedRows.filter(isRulesFlagged).length,
      oneVersionOnly: rows.length - matchedRows.length,
    },
  };
}
