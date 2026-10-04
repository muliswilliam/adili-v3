import type { ItemSource } from '@adili/forms';

import { validationProblem } from '../drafts/problems.js';
import type { SectionContents, StatementKey } from '../drafts/sections.js';
import { recordOf } from '../guards.js';
import type { AcceptedFields, Placement } from './acceptance.js';
import { valueAt } from './item-sources.js';
import type { StatementList } from './schema.js';

/**
 * Accepting a document's reading (spec 05b S6), pure. Unlike a registry's suggestion, a reading's
 * fields are already declaration.v1 paths within the item it was read into (`details.registration`,
 * `outstanding.kesCents`), typed as the item types them (`document-reading.ts`), so accepting
 * writes each where it names, values included: the declarant reviewed every field, the document's
 * own figure among them.
 *
 * Only the fields the reading gave are taken, each typed as the reading typed it: a figure the
 * declarant edited as text ("1,180,000") is a number again, and a field emptied is left out. The
 * section save validates the item as declaration.v1 has it.
 *
 * As new, the item is of the reading's type in its list, with the reading as its `source`. Applied
 * to an item (the one the document is on), it fills only what that item leaves empty unless
 * `overwrite`, and takes the reading as `source` when it has none, or with `overwrite`. Unlike a
 * registry's, it is never refused for holding another identifier: the declarant applies a
 * document to the item they attached it to, with what it would replace shown.
 */

export interface ReadingToAccept {
  sectionKey: StatementKey;
  list: StatementList;
  itemType: string;
  /** The fields as read: declaration.v1 paths within the item, typed. */
  fields: Record<string, unknown>;
}

type Value = string | number | boolean;

const NIL_FLAG = { assets: 'assetsNil', income: 'incomeNil', liabilities: 'liabilitiesNil' };

export function readingPlacementOf(
  reading: ReadingToAccept,
  accepted: AcceptedFields,
  source: ItemSource,
  newId: string,
): Placement {
  const patch = typedPatch(reading.fields, accepted.fields);
  return {
    sectionKey: reading.sectionKey,
    apply: (stored: SectionContents) => {
      const items = arrayOf(stored[reading.list]);
      if (accepted.applyToItemId === null) {
        const base: Record<string, unknown> = {
          id: newId,
          type: reading.itemType,
          location: { inKenya: true },
          change: { changed: false },
          ...(reading.list === 'assets' ? { joint: { isJoint: false } } : {}),
        };
        return {
          contents: {
            ...stored,
            [NIL_FLAG[reading.list]]: false,
            [reading.list]: [...items, { ...patched(base, patch, true), source }],
          },
          itemId: newId,
        };
      }
      const target = items.find((item) => item.id === accepted.applyToItemId);
      if (!target) {
        throw validationProblem([
          { path: 'applyToItemId', message: 'No such item in the section' },
        ]);
      }
      if (target.type !== reading.itemType) {
        throw validationProblem([
          { path: 'applyToItemId', message: `The item is not a ${reading.itemType}` },
        ]);
      }
      const filled = patched(target, patch, accepted.overwrite);
      const sourced =
        accepted.overwrite || target.source === undefined ? { ...filled, source } : filled;
      return {
        contents: {
          ...stored,
          [reading.list]: items.map((item) => (item === target ? sourced : item)),
        },
        itemId: accepted.applyToItemId,
      };
    },
  };
}

/**
 * The accepted fields as paths and typed values: each one the reading gave (400 for any other),
 * as the reading typed it (400 when an edit cannot be), less those emptied.
 */
function typedPatch(
  read: Record<string, unknown>,
  accepted: Record<string, unknown>,
): [string, Value][] {
  const errors: { path: string; message: string }[] = [];
  const patch = Object.entries(accepted).flatMap(([path, value]): [string, Value][] => {
    if (!Object.hasOwn(read, path)) {
      errors.push({ path: `fields.${path}`, message: 'Not a field the document was read for' });
      return [];
    }
    const typed = typedAs(read[path], value);
    if (typed === undefined) {
      errors.push({ path: `fields.${path}`, message: 'Not a value this field takes' });
      return [];
    }
    return typed === null ? [] : [[path, typed]];
  });
  if (errors.length > 0) throw validationProblem(errors);
  return patch;
}

/** `value` typed as `like` is; null when empty, undefined when it cannot be. */
function typedAs(like: unknown, value: unknown): Value | null | undefined {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof like === 'number') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;
    const digits = value.replaceAll(/[\s,]/gu, '');
    return /^-?\d+(\.\d+)?$/u.test(digits) ? Number(digits) : undefined;
  }
  if (typeof like === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    return undefined;
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function patched(
  item: Record<string, unknown>,
  patch: [string, Value][],
  overwrite: boolean,
): Record<string, unknown> {
  let result = item;
  for (const [path, value] of patch) {
    if (!overwrite && !isEmpty(valueAt(result, path))) continue;
    result = withValue(result, path.split('.'), value);
  }
  return result;
}

function withValue(
  target: Record<string, unknown>,
  [head, ...rest]: string[],
  value: Value,
): Record<string, unknown> {
  if (head === undefined) return target;
  if (rest.length === 0) return { ...target, [head]: value };
  return { ...target, [head]: withValue(recordOf(target[head]), rest, value) };
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

function arrayOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
