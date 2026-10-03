import { isRecord } from '../mock-http';
import { MOCK_ITEM_IDS as I } from './copilot-mock.server';
import type { VersionComparison } from './types';

/**
 * The review mock's version comparison (`GET /v1/review/cases/{caseId}/compare`, spec 07a S10)
 * for a declaration built on `MOCK_DECLARATION`: the current values come from the document, the
 * previous ones from the table below, as the 2024 declaration had them. Items the table leaves
 * out are new in the current version; the Probox is no longer declared. Matched as the service
 * matches (same person, category, type and description).
 */

type Statement = VersionComparison['statements'][number];
type Category = Statement['matched'][number]['category'];

/** What each current item was worth in the previous version, in cents. */
const PREVIOUS_CENTS: Record<string, number> = {
  [I.salary]: 288_000_000,
  [I.plot]: 180_000_000,
  [I.house]: 980_000_000,
  [I.saccoShares]: 100_000_000,
  [I.mortgage]: 390_000_000,
  [I.shop]: 84_000_000,
  [I.stock]: 35_000_000,
  // Opened after the previous statement date with nothing in it.
  [I.childFund]: 0,
};

/** Items of the previous version the current one no longer has, by person key. */
const ONLY_PREVIOUS: Record<string, Statement['onlyPrevious']> = {
  officer: [
    {
      itemId: '1e2d3c4b-0000-4000-8000-000000000091',
      category: 'assets',
      type: 'vehicle',
      description: 'Toyota Probox KCA 123X',
      valueCents: 60_000_000,
      flaggedByDeclarant: false,
    },
  ],
};

const CATEGORIES: Category[] = ['income', 'assets', 'liabilities'];

const centsOf = (item: Record<string, unknown>): number => {
  const money = item.amount ?? item.value ?? item.outstanding;
  return isRecord(money) && typeof money.kesCents === 'number' ? money.kesCents : 0;
};

const nameOf = (name: unknown): string =>
  isRecord(name)
    ? [name.firstName, name.otherNames, name.surname]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' ')
    : '';

export function mockComparison(
  document: Record<string, unknown>,
  previousVersion: number,
  currentVersion: number,
): VersionComparison {
  const statements = Array.isArray(document.statements) ? document.statements : [];
  return {
    previousVersion,
    currentVersion,
    statements: statements.filter(isRecord).map((statement): Statement => {
      const personKey = String(statement.personKey);
      const result: Statement = {
        personKey,
        personName: nameOf(statement.personName),
        matched: [],
        onlyPrevious: ONLY_PREVIOUS[personKey] ?? [],
        onlyCurrent: [],
      };
      for (const category of CATEGORIES) {
        const items = Array.isArray(statement[category]) ? statement[category] : [];
        for (const item of items.filter(isRecord)) {
          const id = String(item.id);
          const currentCents = centsOf(item);
          const flaggedByDeclarant = isRecord(item.change) && item.change.changed === true;
          const common = {
            category,
            type: String(item.type),
            description: String(item.description),
            flaggedByDeclarant,
          };
          const previousCents = PREVIOUS_CENTS[id];
          if (previousCents === undefined) {
            result.onlyCurrent.push({ ...common, itemId: id, valueCents: currentCents });
            continue;
          }
          const deltaCents = currentCents - previousCents;
          result.matched.push({
            ...common,
            previousCents,
            currentCents,
            deltaCents,
            deltaPercent:
              previousCents === 0 ? null : Math.round((deltaCents / previousCents) * 100),
          });
        }
      }
      return result;
    }),
  };
}
