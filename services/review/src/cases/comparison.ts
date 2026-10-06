import type { DeclarationV1, PersonName } from '@adili/forms';
import { z } from 'zod';

import { CATEGORIES, match, type PlacedItem, valueOf } from '@adili/forms/compare';

const categorySchema = z.enum(CATEGORIES as ['income', 'assets', 'liabilities']);

/** An item of both versions, with the change in its declared value. */
const matchedItemSchema = z.object({
  category: categorySchema,
  type: z.string(),
  description: z.string(),
  previousCents: z.int(),
  currentCents: z.int(),
  deltaCents: z.int(),
  deltaPercent: z.int().nullable().meta({
    description:
      'Whole percent of the previous value, signed; null when the previous value was nothing',
  }),
  flaggedByDeclarant: z
    .boolean()
    .meta({ description: 'Whether the declarant marked the current item as changed' }),
});

/** An item of only one of the versions. */
const unmatchedItemSchema = z.object({
  itemId: z.uuid(),
  category: categorySchema,
  type: z.string(),
  description: z.string(),
  valueCents: z.int(),
  flaggedByDeclarant: z.boolean(),
});
type UnmatchedItem = z.infer<typeof unmatchedItemSchema>;

/** review.yaml `VersionComparison`: the reviewer's diff of two versions. */
export const versionComparisonSchema = z.object({
  previousVersion: z.int(),
  currentVersion: z.int(),
  statements: z.array(
    z.object({
      personKey: z.string(),
      personName: z.string(),
      matched: z.array(matchedItemSchema),
      onlyPrevious: z.array(unmatchedItemSchema),
      onlyCurrent: z.array(unmatchedItemSchema),
    }),
  ),
});
export type VersionComparison = z.infer<typeof versionComparisonSchema>;

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
