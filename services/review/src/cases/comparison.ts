import type { DeclarationV1, PersonName } from '@adili/forms';

import { type Category, match, type PlacedItem, valueOf } from '../rules/match.js';

/** review.yaml `VersionComparison`: the reviewer's diff of two versions. */
export interface VersionComparison {
  previousVersion: number;
  currentVersion: number;
  statements: StatementComparison[];
}

export interface StatementComparison {
  personKey: string;
  personName: string;
  matched: MatchedItem[];
  onlyPrevious: UnmatchedItem[];
  onlyCurrent: UnmatchedItem[];
}

/** An item of both versions, with the change in its declared value. */
export interface MatchedItem {
  category: Category;
  type: string;
  description: string;
  previousCents: number;
  currentCents: number;
  deltaCents: number;
  /** Whole percent of the previous value, signed; null when the previous value was nothing. */
  deltaPercent: number | null;
  /** Whether the declarant marked the current item as changed. */
  flaggedByDeclarant: boolean;
}

/** An item of only one of the versions. */
export interface UnmatchedItem {
  itemId: string;
  category: Category;
  type: string;
  description: string;
  valueCents: number;
  flaggedByDeclarant: boolean;
}

/**
 * Compares two versions statement by statement with the rules engine's matcher (spec 07a), so the
 * diff pairs items exactly as the comparison flags did. Statements are in the current version's
 * order, followed by those only the previous version has.
 */
export function compareVersions(
  previous: { version: number; document: DeclarationV1 },
  current: { version: number; document: DeclarationV1 },
): VersionComparison {
  const { matched, onlyPrevious, onlyCurrent } = match(previous.document, current.document);
  const statements = [...current.document.statements, ...previous.document.statements].filter(
    (statement, index, all) =>
      all.findIndex((other) => other.personKey === statement.personKey) === index,
  );
  const of = <T extends { personKey: string }>(items: T[], personKey: string) =>
    items.filter((item) => item.personKey === personKey);

  return {
    previousVersion: previous.version,
    currentVersion: current.version,
    statements: statements.map(({ personKey, personName }) => ({
      personKey,
      personName: fullName(personName),
      matched: of(matched, personKey).map(({ category, previous: before, current: after }) => {
        const previousCents = valueOf(before);
        const currentCents = valueOf(after);
        const deltaCents = currentCents - previousCents;
        return {
          category,
          type: after.type,
          description: after.description,
          previousCents,
          currentCents,
          deltaCents,
          deltaPercent: previousCents === 0 ? null : Math.round((deltaCents / previousCents) * 100),
          flaggedByDeclarant: after.change.changed,
        };
      }),
      onlyPrevious: of(onlyPrevious, personKey).map(unmatched),
      onlyCurrent: of(onlyCurrent, personKey).map(unmatched),
    })),
  };
}

function unmatched({ category, item }: PlacedItem): UnmatchedItem {
  return {
    itemId: item.id,
    category,
    type: item.type,
    description: item.description,
    valueCents: valueOf(item),
    flaggedByDeclarant: item.change.changed,
  };
}

function fullName({ firstName, otherNames, surname }: PersonName): string {
  return [firstName, otherNames, surname].filter(Boolean).join(' ');
}
