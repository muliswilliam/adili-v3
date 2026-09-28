import type { DeclarationV1 } from '@adili/forms';

import {
  type Category,
  match,
  type MatchedPair,
  normalise,
  type Placed,
  placedItems,
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
  /** The item concerned, or null when the flag is about a whole category or section. */
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

/** The change kind that marks an item as new: a new source of income, or an acquisition. */
const NEW_KIND: Record<Category, string> = {
  income: 'new-source',
  assets: 'acquisition',
  liabilities: 'acquisition',
};

/** Paragraph 9 kinds that account for an item no longer declared. */
const GONE_KINDS = new Set(['disposal', 'source-ended', 'settled']);

/**
 * The deterministic checks run on each submitted version (spec 07a, BE-1). Flags are indicators
 * for a reviewer; their score orders the queue. A first declaration on Adili skips the
 * comparisons and records that fact instead.
 */
export function runRules({ current, previous, late, schemaIssues = 0 }: RulesInput): Flag[] {
  const flags: Flag[] = [];
  if (schemaIssues > 0)
    flags.push(flag('completeness-residual', 'info', { issues: schemaIssues }, []));
  if (previous) flags.push(...comparisonFlags(previous, current));
  else flags.push(flag('no-previous-version', 'info', {}, []));
  if (late) {
    flags.push(
      flag(
        'late-filing',
        'low',
        { ...late, daysLate: daysBetween(late.dueDate, late.submittedOn) },
        [],
      ),
    );
  }
  flags.push(...foreignHoldings(current), ...jointShares(current));
  return flags;
}

function comparisonFlags(previous: DeclarationV1, current: DeclarationV1): Flag[] {
  const { matched, onlyPrevious, onlyCurrent } = match(previous, current);
  const nil = nilAfterPopulated(previous, current);
  const nilCategories = new Set(nil.map(({ personKey, category }) => `${personKey} ${category}`));
  const currentPeople = new Set(current.statements.map((statement) => statement.personKey));

  return [
    ...matched.flatMap(valueChange),
    ...onlyCurrent.flatMap((placed) => {
      const { changed, kind } = placed.item.change;
      return changed && kind === NEW_KIND[placed.category]
        ? []
        : [flag('acquisition-unflagged', 'medium', { category: placed.category }, [ref(placed)])];
    }),
    ...onlyPrevious
      // A category now nil, or a person no longer declared for, is covered elsewhere.
      .filter((placed) => currentPeople.has(placed.personKey))
      .filter((placed) => !nilCategories.has(`${placed.personKey} ${placed.category}`))
      .filter((placed) => !recordedAsGone(placed, current))
      .map((placed) =>
        flag('disposal-unflagged', 'medium', { category: placed.category }, [ref(placed)]),
      ),
    ...nil.map(({ personKey, category, previousItems }) =>
      flag('nil-after-populated', 'medium', { category, previousItems }, [
        { personKey, itemId: null, sectionKey: `statement:${personKey}` },
      ]),
    ),
    ...incomeVersusAssetGrowth(previous, current),
  ];
}

/** A matched item's value change of 25% or more, and whether the declarant's marking agrees. */
function valueChange(pair: MatchedPair): Flag[] {
  const before = valueOf(pair.previous);
  const after = valueOf(pair.current);
  // With nothing before there is no percentage; the item is effectively new.
  if (before === 0) return [];
  const changePercent = Math.round((Math.abs(after - before) / before) * 100);
  const material = changePercent >= 25;
  const marked = pair.current.change.changed;
  const refs = [ref({ personKey: pair.personKey, category: pair.category, item: pair.current })];
  const flags: Flag[] = [];
  if (material) {
    flags.push(
      flag(
        'value-change-25',
        changePercent > 100 ? 'high' : 'medium',
        {
          changePercent,
          direction: after > before ? 'up' : 'down',
        },
        refs,
      ),
    );
  }
  if (material !== marked) {
    flags.push(
      flag('change-flag-mismatch', 'low', { changePercent, markedAsChanged: marked }, refs),
    );
  }
  return flags;
}

function recordedAsGone(placed: Placed, current: DeclarationV1): boolean {
  return current.otherInformation.materialChanges.some(
    (entry) =>
      GONE_KINDS.has(entry.kind) &&
      (entry.itemId === placed.item.id ||
        (entry.personKey === placed.personKey &&
          entry.itemDescription !== undefined &&
          normalise(entry.itemDescription) === normalise(placed.item.description))),
  );
}

function nilAfterPopulated(previous: DeclarationV1, current: DeclarationV1) {
  return current.statements.flatMap((statement) => {
    const before = previous.statements.find((s) => s.personKey === statement.personKey);
    return (['income', 'assets', 'liabilities'] as const).flatMap((category) => {
      const previousItems = before?.[category].length ?? 0;
      return statement[`${category}Nil`] && previousItems > 0
        ? [{ personKey: statement.personKey, category, previousItems }]
        : [];
    });
  });
}

/** Growth in total assets against total income for the period: medium above it, high above three times. */
function incomeVersusAssetGrowth(previous: DeclarationV1, current: DeclarationV1): Flag[] {
  const total = (document: DeclarationV1, category: Category) =>
    placedItems(document)
      .filter((placed) => placed.category === category)
      .reduce((sum, placed) => sum + valueOf(placed.item), 0);
  const income = total(current, 'income');
  const growth = total(current, 'assets') - total(previous, 'assets');
  if (growth <= income) return [];
  const growthToIncome = income > 0 ? Math.round((growth / income) * 10) / 10 : null;
  const severity = growthToIncome === null || growthToIncome > 3 ? 'high' : 'medium';
  return [flag('income-vs-asset-growth', severity, { growthToIncome }, [])];
}

function foreignHoldings(current: DeclarationV1): Flag[] {
  const abroad = placedItems(current).filter(
    (placed) =>
      placed.category !== 'liabilities' &&
      'location' in placed.item &&
      !placed.item.location.inKenya,
  );
  if (abroad.length === 0) return [];
  const countries = [
    ...new Set(abroad.flatMap((placed) => placed.item.location.country ?? [])),
  ].sort();
  return [flag('foreign-holdings', 'info', { items: abroad.length, countries }, abroad.map(ref))];
}

/** Joint shares of one asset (same type and description) across household statements must sum to 100%. */
function jointShares(current: DeclarationV1): Flag[] {
  const joint = placedItems(current).filter(
    (placed) => placed.category === 'assets' && 'joint' in placed.item && placed.item.joint.isJoint,
  );
  const groups = Map.groupBy(joint, (placed) =>
    JSON.stringify([placed.item.type, normalise(placed.item.description)]),
  );
  return [...groups.values()].flatMap((group) => {
    if (new Set(group.map((placed) => placed.personKey)).size < 2) return [];
    const sharePercentTotal = group.reduce(
      (sum, placed) => sum + ('joint' in placed.item ? (placed.item.joint.sharePercent ?? 0) : 0),
      0,
    );
    return sharePercentTotal === 100
      ? []
      : [
          flag(
            'joint-share-inconsistent',
            'info',
            { sharePercentTotal, statements: group.length },
            group.map(ref),
          ),
        ];
  });
}

function flag(ruleId: RuleId, severity: Severity, evidence: Evidence, itemRefs: ItemRef[]): Flag {
  return { ruleId, severity, ...RULES[ruleId], evidence, itemRefs };
}

function ref({ personKey, item }: Placed): ItemRef {
  return { personKey, itemId: item.id, sectionKey: `statement:${personKey}` };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
