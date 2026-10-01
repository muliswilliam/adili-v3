/**
 * The "refs resolve" check (spec 07c S9): every source ref in an output points at something in the
 * input, and its parts agree with each other, so the console's links land on the right item. A
 * real item id paired with the wrong person is as broken as an invented one.
 */

export interface SourceRef {
  sectionKey: string | null;
  personKey: string | null;
  itemId: string | null;
  fieldPath: string | null;
}

/** The sections of declaration.v1 that are not a person's financial statement. */
const FIXED_SECTIONS = new Set(['bio', 'household', 'other']);

const CATEGORIES = ['income', 'assets', 'liabilities'] as const;

interface Statement {
  personKey: string;
  income?: { id: string }[];
  assets?: { id: string }[];
  liabilities?: { id: string }[];
}

/** Item id → person key, across the given declaration documents. */
function itemOwners(documents: readonly unknown[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const document of documents) {
    const statements = (document as { statements?: Statement[] } | null)?.statements ?? [];
    for (const statement of statements) {
      for (const category of CATEGORIES) {
        for (const item of statement[category] ?? []) owners.set(item.id, statement.personKey);
      }
    }
  }
  return owners;
}

function personKeys(documents: readonly unknown[]): Set<string> {
  return new Set(
    documents.flatMap(
      (document) =>
        (document as { statements?: Statement[] } | null)?.statements?.map((s) => s.personKey) ??
        [],
    ),
  );
}

/** Resolves a JSON pointer (RFC 6901) in `document`; undefined when it leads nowhere. */
function resolvePointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) return undefined;
  let node: unknown = document;
  for (const raw of pointer.slice(1).split('/')) {
    const part = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Why `ref` does not resolve against the declaration documents (current, previous; null for
 * none), or null when it does.
 */
export function refProblem(ref: SourceRef, documents: readonly unknown[]): string | null {
  const present = documents.filter((document) => document !== null);
  const owners = itemOwners(present);
  const people = personKeys(present);
  const { sectionKey, personKey, itemId, fieldPath } = ref;
  const sectionPerson = sectionKey?.startsWith('statement:')
    ? sectionKey.slice('statement:'.length)
    : null;

  if (personKey !== null && !people.has(personKey)) return `personKey ${personKey} not in input`;
  if (itemId !== null && !owners.has(itemId)) return `itemId ${itemId} not in input`;
  if (sectionKey !== null && !FIXED_SECTIONS.has(sectionKey) && !people.has(sectionPerson ?? '')) {
    return `sectionKey ${sectionKey} not in input`;
  }
  if (fieldPath !== null && present.every((doc) => resolvePointer(doc, fieldPath) === undefined)) {
    return `fieldPath ${fieldPath} not in input`;
  }
  if (personKey !== null && itemId !== null && owners.get(itemId) !== personKey) {
    return `itemId ${itemId} does not belong to ${personKey}`;
  }
  if (sectionPerson !== null && personKey !== null && sectionPerson !== personKey) {
    return `personKey ${personKey} does not belong to ${sectionKey}`;
  }
  if (sectionPerson !== null && itemId !== null && owners.get(itemId) !== sectionPerson) {
    return `itemId ${itemId} does not belong to ${sectionKey}`;
  }
  return null;
}

/**
 * Whether `ref` is one of the input's refs (tasks given refs rather than documents): the same
 * section, person and item, and the same field path or none.
 */
export function refsAmong(ref: SourceRef, allowed: readonly SourceRef[]): boolean {
  return allowed.some(
    (each) =>
      each.sectionKey === ref.sectionKey &&
      each.personKey === ref.personKey &&
      each.itemId === ref.itemId &&
      (ref.fieldPath === null || ref.fieldPath === each.fieldPath),
  );
}

export function describeRef(ref: SourceRef): string {
  return JSON.stringify(ref);
}
