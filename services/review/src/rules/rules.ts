import type { ChangeFlag, DeclarationV1, MaterialChangeEntry } from '@adili/forms';

import {
  CATEGORIES,
  compositeKey,
  type Category,
  match,
  type MatchedPair,
  normalise,
  type PlacedItem,
  placedItems,
  statementSectionKey,
  valueOf,
} from './match.js';
import { RULES, type RuleId, type Severity } from './registry.js';

/** What the rules read: the submitted version and, if the person has one, the previous one. */
export interface RulesInput {
  current: DeclarationV1;
  /** The person's previous submitted version at the same Commission; absent for a first. */
  previous?: DeclarationV1;
  /** Set when the version was submitted after its due date. */
  late?: { dueDate: string; submittedOn: string };
  /** Schema issues tolerated at submission; none are expected. */
  schemaIssues?: number;
}

/** Evidence is clear facts only: percentages, counts, dates and codes, never amounts or descriptions. */
export type Evidence = Record<string, string | number | boolean | null | string[]>;

export interface ItemRef {
  personKey: string;
  /** The item concerned, or null when the flag is about a whole category or statement. */
  itemId: string | null;
  sectionKey: string | null;
}

export interface Flag {
  ruleId: RuleId;
  severity: Severity;
  title: string;
  indicator: string;
  evidence: Evidence;
  itemRefs: ItemRef[];
}

type ChangeKind = NonNullable<ChangeFlag['kind']>;

/** The change kind that marks an item as new in its category. */
const NEW_KIND: Record<Category, ChangeKind> = {
  income: 'new-source',
  assets: 'acquisition',
  liabilities: 'acquisition',
};

/** The paragraph 9 kind that accounts for an item of each category no longer declared. */
const GONE_KIND: Record<Category, MaterialChangeEntry['kind']> = {
  income: 'source-ended',
  assets: 'disposal',
  liabilities: 'settled',
};

/**
 * The deterministic checks run on each submitted version (spec 07a, BE-1). Flags are indicators
 * for a reviewer; their score orders the queue. A first declaration on Adili skips the
 * comparisons and records that fact instead.
 */
export function runRules({ current, previous, late, schemaIssues = 0 }: RulesInput): Flag[] {
  const flags: Flag[] = [];
  if (schemaIssues > 0) {
    flags.push(flag('completeness-residual', 'info', { issues: schemaIssues }, []));
  }
  if (previous) flags.push(...comparisonFlags(previous, current));
  else flags.push(flag('no-previous-version', 'info', {}, []));
  if (late) {
    const daysLate = daysBetween(late.dueDate, late.submittedOn);
    flags.push(flag('late-filing', 'low', { ...late, daysLate }, []));
  }
  flags.push(...foreignHoldings(current), ...jointShares(current));
  return flags;
}

function comparisonFlags(previous: DeclarationV1, current: DeclarationV1): Flag[] {
  const { matched, onlyPrevious, onlyCurrent } = match(previous, current);
  const nilCategories = nilAfterPopulated(previous, current);
  const nilKeys = new Set(nilCategories.map(categoryKey));
  const { materialChanges } = current.otherInformation;

  return [
    ...matched.flatMap(valueChange),
    ...onlyCurrent.flatMap((placed) => {
      const { changed, kind } = placed.item.change;
      return changed && kind === NEW_KIND[placed.category]
        ? []
        : [flag('acquisition-unflagged', 'medium', { category: placed.category }, [ref(placed)])];
    }),
    ...onlyPrevious
      // A category now declared nil has its own flag below.
      .filter((placed) => !nilKeys.has(categoryKey(placed)))
      .filter((placed) => !recordedAsGone(placed, materialChanges))
      .map((placed) =>
        flag('disposal-unflagged', 'medium', { category: placed.category }, [ref(placed)]),
      ),
    ...nilCategories.map(({ personKey, category, previousItems }) =>
      flag('nil-after-populated', 'medium', { category, previousItems }, [
        { personKey, itemId: null, sectionKey: statementSectionKey(personKey) },
      ]),
    ),
    ...incomeVersusAssetGrowth(previous, current),
  ];
}

/**
 * A matched item's value change of 25% or more (high above 100%), and whether the declarant's
 * marking agrees: a value change is marked as one, and an item declared before is not marked as
 * new. Thresholds apply to the exact ratio; the evidence gives it as a whole percentage.
 */
function valueChange(pair: MatchedPair): Flag[] {
  const before = valueOf(pair.previous);
  const after = valueOf(pair.current);
  // Up from nothing is more than any percentage, and there is none to give.
  const ratio = before === 0 ? (after === 0 ? 0 : Infinity) : Math.abs(after - before) / before;
  const changePercent = Number.isFinite(ratio) ? Math.round(ratio * 100) : null;
  const material = ratio >= 0.25;
  const { changed, kind } = pair.current.change;
  const markedAsNew = changed && kind === NEW_KIND[pair.category];
  const refs = [ref({ personKey: pair.personKey, category: pair.category, item: pair.current })];
  const flags: Flag[] = [];
  if (material) {
    const direction = after > before ? 'up' : 'down';
    flags.push(
      flag('value-change-25', ratio > 1 ? 'high' : 'medium', { changePercent, direction }, refs),
    );
  }
  if (material !== changed || markedAsNew) {
    flags.push(
      flag('change-flag-mismatch', 'low', { changePercent, markedAsChanged: changed }, refs),
    );
  }
  return flags;
}

/** Whether paragraph 9 records the item as gone, with the kind its category calls for. */
function recordedAsGone(placed: PlacedItem, materialChanges: MaterialChangeEntry[]): boolean {
  return materialChanges.some(
    (entry) =>
      entry.kind === GONE_KIND[placed.category] &&
      (entry.itemId === placed.item.id ||
        (entry.personKey === placed.personKey &&
          entry.itemDescription !== undefined &&
          normalise(entry.itemDescription) === normalise(placed.item.description))),
  );
}

interface NilCategory {
  personKey: string;
  category: Category;
  previousItems: number;
}

function nilAfterPopulated(previous: DeclarationV1, current: DeclarationV1): NilCategory[] {
  return current.statements.flatMap((statement) => {
    const before = previous.statements.find((s) => s.personKey === statement.personKey);
    return CATEGORIES.flatMap((category) => {
      const previousItems = before?.[category].length ?? 0;
      return statement[`${category}Nil`] && previousItems > 0
        ? [{ personKey: statement.personKey, category, previousItems }]
        : [];
    });
  });
}

const categoryKey = ({ personKey, category }: { personKey: string; category: Category }) =>
  compositeKey(personKey, category);

/**
 * Growth in total assets since the previous version against total income for the period: medium
 * above it, high above three times. The current version's income period runs from the previous
 * statement date (spec 05's derivation), so its income is the income since that version.
 */
function incomeVersusAssetGrowth(previous: DeclarationV1, current: DeclarationV1): Flag[] {
  const total = (document: DeclarationV1, category: Category) =>
    placedItems(document)
      .filter((placed) => placed.category === category)
      .reduce((sum, placed) => sum + valueOf(placed.item), 0);
  const income = total(current, 'income');
  const growth = total(current, 'assets') - total(previous, 'assets');
  if (growth <= income) return [];
  const ratio = income > 0 ? growth / income : Infinity;
  const growthToIncome = Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : null;
  return [flag('income-vs-asset-growth', ratio > 3 ? 'high' : 'medium', { growthToIncome }, [])];
}

function foreignHoldings(current: DeclarationV1): Flag[] {
  const abroad = placedItems(current).filter(
    (placed) => placed.category !== 'liabilities' && !placed.item.location.inKenya,
  );
  if (abroad.length === 0) return [];
  const countries = [
    ...new Set(abroad.flatMap((placed) => placed.item.location.country ?? [])),
  ].sort();
  return [flag('foreign-holdings', 'info', { items: abroad.length, countries }, abroad.map(ref))];
}

/** Joint shares of one asset (same description) across household statements must sum to 100%. */
function jointShares(current: DeclarationV1): Flag[] {
  const joint = placedItems(current).flatMap((placed) =>
    placed.category === 'assets' && 'joint' in placed.item && placed.item.joint.isJoint
      ? // A valid joint asset always has a share; a missing one counts as 0 and so shows as not adding up.
        [{ placed, sharePercent: placed.item.joint.sharePercent ?? 0 }]
      : [],
  );
  const groups = Map.groupBy(joint, ({ placed }) => normalise(placed.item.description));
  return [...groups.values()].flatMap((group) => {
    if (new Set(group.map(({ placed }) => placed.personKey)).size < 2) return [];
    const sharePercentTotal = group.reduce((sum, { sharePercent }) => sum + sharePercent, 0);
    if (sharePercentTotal === 100) return [];
    const refs = group.map(({ placed }) => ref(placed));
    return [
      flag(
        'joint-share-inconsistent',
        'info',
        { sharePercentTotal, statements: group.length },
        refs,
      ),
    ];
  });
}

function flag(ruleId: RuleId, severity: Severity, evidence: Evidence, itemRefs: ItemRef[]): Flag {
  return { ruleId, severity, ...RULES[ruleId], evidence, itemRefs };
}

function ref({ personKey, item }: PlacedItem): ItemRef {
  return { personKey, itemId: item.id, sectionKey: statementSectionKey(personKey) };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
