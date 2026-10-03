import type { ItemSource } from '@adili/forms';

import type { SectionContents } from '../drafts/sections.js';
import { isRecord, recordOf } from '../guards.js';
import {
  companyNameMatchKey,
  kraPinMatchKey,
  parcelMatchKey,
  registrationMatchKey,
} from './match-keys.js';

/**
 * Where an item came from (declaration.v1 `ItemSource`, spec 05b) is the service's to say, pure:
 * accepting a suggestion sets it (`acceptance.ts`), and a section save keeps it as stored
 * (`keptSources`), never as the client sends it. It names the registry's verification result only
 * while the item holds what the registry said (`vouches`): a reviewer relies on that result not
 * to flag a registry-sourced item as a mismatch (story 16), so an item the declarant changed
 * where the registry spoke is no longer vouched for.
 */

export type Item = Record<string, unknown>;

/**
 * For each item type a registry speaks to, the paths holding what it said (the description, the
 * mapping's own wording, aside). A type with none, such as the salary KRA's income hint adds
 * (its figure is a hint, never a value), is never vouched for.
 */
const VOUCHED_PATHS: Partial<Record<string, readonly string[]>> = {
  vehicle: ['details.registration', 'details.makeModel'],
  land: ['details.parcelNumber', 'details.size', 'location.detail', 'location.county'],
  shareholding: ['details.issuer', 'details.quantityOrPercent'],
};

/** A paragraph 9 directorship (in `other`), which has no `type`. */
const DIRECTORSHIP_PATHS = ['company', 'role'] as const;

/**
 * How two values of a path are told to say the same: an identifier as its match key ("kca-123a"
 * is KCA 123A, but parcel "Block 7/1234" is not "Block 71/234"), anything else as text, case and
 * spacing aside ("1.5 ha" is not "15 ha").
 */
const IDENTIFIERS: Partial<Record<string, (raw: string) => string | null>> = {
  'details.registration': registrationMatchKey,
  'details.parcelNumber': parcelMatchKey,
  'details.issuer': companyNameMatchKey,
  company: companyNameMatchKey,
  kraPin: kraPinMatchKey,
};

/**
 * Whether `item`, in the section `sectionKey`, holds what the registry said (`said`, the item as
 * the registry's fields would fill it) on every path the registry speaks to, and the registry
 * said something there.
 */
export function vouches(sectionKey: string, item: Item, said: Item): boolean {
  const paths =
    sectionKey === 'other' ? DIRECTORSHIP_PATHS : (VOUCHED_PATHS[String(item.type)] ?? []);
  return (
    paths.some((path) => text(valueAt(said, path)) !== '') &&
    paths.every((path) => sameValue(path, valueAt(item, path), valueAt(said, path)))
  );
}

/** The source without the verification result, for an item the registry no longer vouches for. */
export function unverified(source: ItemSource): ItemSource {
  const rest = { ...source };
  delete rest.verificationResultId;
  return rest;
}

/**
 * The body of a section save with each item's `source` as stored: none for an item that had none
 * (a source the client sends is not taken), and without the verification result once the item no
 * longer holds what the registry said (`vouches`), or changed its type. The rest of the body is
 * left to the save's own checks.
 */
export function keptSources(sectionKey: string, stored: SectionContents, body: unknown): unknown {
  if (!isRecord(body)) return body;
  const before = new Map(sectionItems(sectionKey, stored).map((item) => [item.id, item]));
  return mapSectionItems(sectionKey, body, (item) => {
    const rest = { ...item };
    delete rest.source;
    const was = typeof item.id === 'string' ? before.get(item.id) : undefined;
    if (!was || !isRecord(was.source)) return rest;
    const source = was.source as unknown as ItemSource;
    const holds = was.type === item.type && vouches(sectionKey, item, was);
    return { ...rest, source: holds ? source : unverified(source) };
  });
}

/**
 * The items a section holds: a statement's income, assets and liabilities, paragraph 9's
 * directorships (`other`), Household's spouses.
 */
export function sectionItems(sectionKey: string, contents: SectionContents): Item[] {
  const items: Item[] = [];
  mapSectionItems(sectionKey, contents, (item) => {
    items.push(item);
    return item;
  });
  return items;
}

/** `contents` with each of its items (as `sectionItems` finds them) replaced by `edit`'s. */
function mapSectionItems(
  sectionKey: string,
  contents: SectionContents,
  edit: (item: Item) => Item,
): SectionContents {
  const mapped = (list: unknown) =>
    Array.isArray(list)
      ? (list as unknown[]).map((each) => (isRecord(each) ? edit(each) : each))
      : list;
  if (sectionKey.startsWith('statement:')) {
    return {
      ...contents,
      income: mapped(contents.income),
      assets: mapped(contents.assets),
      liabilities: mapped(contents.liabilities),
    };
  }
  if (sectionKey === 'other') {
    const interests = recordOf(contents.registrableInterests);
    return {
      ...contents,
      registrableInterests: { ...interests, directorships: mapped(interests.directorships) },
    };
  }
  if (sectionKey === 'household') {
    const spouses = recordOf(contents.spouses);
    return { ...contents, spouses: { ...spouses, items: mapped(spouses.items) } };
  }
  return contents;
}

function sameValue(path: string, a: unknown, b: unknown): boolean {
  const key = IDENTIFIERS[path] ?? plainText;
  return key(text(a)) === key(text(b));
}

function plainText(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, ' ');
}

export function valueAt(target: unknown, path: string): unknown {
  let current: unknown = target;
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** A field as text: trimmed strings and finite numbers; anything else is empty. */
export function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
