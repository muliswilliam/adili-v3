import type { DeclarationSectionKey, ItemSource } from '@adili/forms';

import { validationProblem } from '../drafts/problems.js';
import { recordOf } from '../guards.js';
import type { SectionContents } from '../drafts/sections.js';

/**
 * Accepting a suggestion (spec 05b, S4), pure: where each kind of suggestion lands in
 * declaration.v1 and what it writes there, from the fields the declarant accepted (as the
 * registry gave them, or as they edited them). The service runs the result through the section
 * save with `If-Match`.
 *
 * Placement, by item type:
 * - `vehicle`, `land`, `shareholding`: an asset in the person's statement
 * - `income-hint`: a `salary-emoluments` income in the person's statement, with no amount (KRA's
 *   figure is a hint for the declarant to check, never a value)
 * - `directorship`: a directorship among the officer's registrable interests (paragraph 9)
 * - `bio-tax` for a spouse: the spouse's KRA PIN in Household. The officer's has no field in
 *   declaration.v1, so it cannot be accepted.
 *
 * A new item carries the suggestion as its `source`. Applied to an existing item, a suggestion
 * fills only the fields the item leaves empty unless `overwrite` is set, and marks the item with
 * its `source` if it has none. Values (`value`, `amount`) are never written: valuing is the
 * declarant's call. A spouse in Household has no `source` in declaration.v1, so a PIN carries
 * none.
 */

export interface AcceptedFields {
  /** Suggestion field names (see `registry-mapping.ts`), after the declarant's edits. */
  fields: Record<string, unknown>;
  applyToItemId: string | null;
  overwrite: boolean;
}

export interface SuggestionToAccept {
  itemType: string;
  sectionKey: DeclarationSectionKey;
  personKey: string;
}

/** What accepting writes: into which section, and the edit that makes its new contents. */
export interface Placement {
  sectionKey: DeclarationSectionKey;
  /** The section's contents with the suggestion accepted, and the item it went into. */
  apply: (stored: SectionContents) => { contents: SectionContents; itemId: string };
}

/** A dotted path in an item, and the value accepting writes there. */
type Patch = [path: string, value: string][];

/** Statement item types a suggestion can add, with their list and declaration.v1 type. */
const STATEMENT_ITEMS: Record<
  string,
  { list: 'assets' | 'income'; type: string; patch: (fields: Record<string, unknown>) => Patch }
> = {
  vehicle: {
    list: 'assets',
    type: 'vehicle',
    patch: (fields) => {
      const makeModel = joined([text(fields.make), text(fields.model)], ' ');
      return [
        ['details.registration', text(fields.registration)],
        ['details.makeModel', joined([makeModel, text(fields.year)], ', ')],
        ['description', text(fields.description) || makeModel],
      ];
    },
  },
  land: {
    list: 'assets',
    type: 'land',
    patch: (fields) => {
      const location = text(fields.location);
      return [
        ['details.parcelNumber', text(fields.parcelNumber)],
        ['details.size', text(fields.size)],
        ['location.detail', location],
        ['location.county', text(fields.county)],
        ['description', text(fields.description) || (location ? `Land in ${location}` : '')],
      ];
    },
  },
  shareholding: {
    list: 'assets',
    type: 'shareholding',
    patch: (fields) => {
      const company = text(fields.companyName) || text(fields.registrationNumber);
      const shares = text(fields.shares);
      return [
        ['details.issuer', company],
        ['details.quantityOrPercent', /^\d[\d,]*$/.test(shares) ? `${shares} shares` : shares],
        ['description', text(fields.description) || (company ? `Shares in ${company}` : '')],
      ];
    },
  },
  'income-hint': {
    list: 'income',
    type: 'salary-emoluments',
    patch: (fields) => [['description', text(fields.description)]],
  },
};

const NIL_FLAG = { assets: 'assetsNil', income: 'incomeNil' } as const;

/**
 * Where the suggestion lands and how, or a 400 when it has no place in declaration.v1 (the
 * officer's KRA PIN, an item type the service does not know).
 */
export function placementOf(
  suggestion: SuggestionToAccept,
  accepted: AcceptedFields,
  source: ItemSource,
  newId: string,
): Placement {
  const statementItem = STATEMENT_ITEMS[suggestion.itemType];
  if (statementItem && suggestion.sectionKey.startsWith('statement:')) {
    const patch = statementItem.patch(accepted.fields);
    return {
      sectionKey: suggestion.sectionKey,
      apply: (stored) => {
        const items = arrayOf(stored[statementItem.list]);
        if (accepted.applyToItemId === null) {
          const base: Record<string, unknown> = {
            id: newId,
            type: statementItem.type,
            location: { inKenya: true },
            change: { changed: false },
            ...(statementItem.list === 'assets' ? { joint: { isJoint: false } } : {}),
          };
          return {
            contents: {
              ...stored,
              [NIL_FLAG[statementItem.list]]: false,
              [statementItem.list]: [...items, { ...patched(base, patch, true), source }],
            },
            itemId: newId,
          };
        }
        const target = existing(items, accepted.applyToItemId, statementItem.type);
        return {
          contents: {
            ...stored,
            [statementItem.list]: items.map((item) =>
              item === target ? markedFrom(patched(item, patch, accepted.overwrite), source) : item,
            ),
          },
          itemId: accepted.applyToItemId,
        };
      },
    };
  }
  if (suggestion.itemType === 'directorship' && suggestion.sectionKey === 'other') {
    const patch: Patch = [
      ['company', text(accepted.fields.companyName)],
      ['role', text(accepted.fields.role)],
    ];
    return {
      sectionKey: 'other',
      apply: (stored) => {
        const interests = recordOf(stored.registrableInterests);
        const directorships = arrayOf(interests.directorships);
        let next: Record<string, unknown>[];
        let itemId: string;
        if (accepted.applyToItemId === null) {
          next = [...directorships, { ...patched({ id: newId }, patch, true), source }];
          itemId = newId;
        } else {
          const target = existing(directorships, accepted.applyToItemId, null);
          next = directorships.map((each) =>
            each === target ? markedFrom(patched(each, patch, accepted.overwrite), source) : each,
          );
          itemId = accepted.applyToItemId;
        }
        return {
          contents: { ...stored, registrableInterests: { ...interests, directorships: next } },
          itemId,
        };
      },
    };
  }
  if (suggestion.itemType === 'bio-tax' && suggestion.sectionKey === 'household') {
    const spouseId = suggestion.personKey.replace(/^spouse:/, '');
    const patch: Patch = [['kraPin', text(accepted.fields.kraPin).toUpperCase()]];
    return {
      sectionKey: 'household',
      apply: (stored) => {
        const spouses = recordOf(stored.spouses);
        const items = arrayOf(spouses.items);
        const target = existing(items, spouseId, null, {
          path: 'personKey',
          message: 'The spouse is no longer in Household',
        });
        return {
          contents: {
            ...stored,
            spouses: {
              ...spouses,
              items: items.map((each) =>
                each === target ? patched(each, patch, accepted.overwrite) : each,
              ),
            },
          },
          itemId: spouseId,
        };
      },
    };
  }
  throw validationProblem([
    {
      path: 'suggestion',
      message:
        suggestion.itemType === 'bio-tax'
          ? "The officer's KRA PIN has no field in the declaration; it is shown, not added"
          : `A ${suggestion.itemType} suggestion cannot be added to the declaration`,
    },
  ]);
}

/** The item with `id` in `items`, of `type` when given; a 400 otherwise. */
function existing(
  items: Record<string, unknown>[],
  id: string,
  type: string | null,
  missing = { path: 'applyToItemId', message: 'No such item in the section' },
): Record<string, unknown> {
  const item = items.find((each) => each.id === id);
  if (!item) throw validationProblem([missing]);
  if (type !== null && item.type !== type) {
    throw validationProblem([{ path: missing.path, message: `The item is not a ${type}` }]);
  }
  return item;
}

/** `item` with each non-empty patch value written where the item is empty, or everywhere. */
function patched(
  item: Record<string, unknown>,
  patch: Patch,
  overwrite: boolean,
): Record<string, unknown> {
  let result = item;
  for (const [path, value] of patch) {
    if (value === '') continue;
    if (!overwrite && !isEmpty(valueAt(result, path))) continue;
    result = withValue(result, path.split('.'), value);
  }
  return result;
}

/** The item keeps the source it has (where it was first filled from), or takes this one. */
function markedFrom(item: Record<string, unknown>, source: ItemSource): Record<string, unknown> {
  return item.source === undefined ? { ...item, source } : item;
}

function withValue(
  target: Record<string, unknown>,
  [head, ...rest]: string[],
  value: string,
): Record<string, unknown> {
  if (head === undefined) return target;
  if (rest.length === 0) return { ...target, [head]: value };
  return { ...target, [head]: withValue(recordOf(target[head]), rest, value) };
}

function valueAt(target: Record<string, unknown>, path: string): unknown {
  let current: unknown = target;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

/** A field as text: trimmed strings and finite numbers; anything else is empty. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function joined(parts: string[], separator: string): string {
  return parts.filter((part) => part !== '').join(separator);
}

function arrayOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
