/**
 * Source-ref validation (spec 07c S4): every source ref and flag id in an output must point at
 * something in the task input, or the output is treated as hallucinated and the job fails with
 * reason `validation`. Task-independent: refs are found by shape (`sectionKey`, `personKey`,
 * `itemId`, `fieldPath`) and flag ids by name (`flagId`, `flagIds`), wherever they sit.
 *
 * A ref resolves when it is one of the refs the input itself carries (tasks given flags or item
 * context rather than documents), or when it resolves against a declaration.v1 document in the
 * input with parts that agree with each other: a real item paired with the wrong person is as
 * broken as an invented one. Unknown parts are null; a ref of nulls points at nothing and is
 * left alone.
 */

export interface SourceRef {
  sectionKey: string | null;
  personKey: string | null;
  itemId: string | null;
  fieldPath: string | null;
}

/** declaration.v1 sections that are not a person's statement (`statement:<personKey>`). */
const FIXED_SECTIONS = new Set(['bio', 'household', 'other']);
const STATEMENT_SECTION = 'statement:';
const CATEGORIES = ['income', 'assets', 'liabilities'] as const;

interface DocumentIndex {
  documents: Record<string, unknown>[];
  /** Item id → person key, across the documents. */
  owners: Map<string, string>;
  people: Set<string>;
}

interface InputIndex extends DocumentIndex {
  refs: SourceRef[];
  flagIds: Set<string>;
}

/** What is wrong with a ref or flag id, as a code safe to log. */
export type RefProblemCode =
  | 'unknown-flag'
  | 'unknown-ref'
  | 'unknown-person'
  | 'unknown-item'
  | 'unknown-section'
  | 'unknown-field'
  | 'item-not-of-person'
  | 'person-not-of-section'
  | 'item-not-of-section';

/**
 * A ref or flag id that does not resolve. `message` quotes what the model wrote: never log it
 * (use `problemCounts`), since the model's text can carry anything, an identifier included.
 */
export interface RefProblem {
  code: RefProblemCode;
  message: string;
}

/** Why the output's refs do not resolve against the input; empty when they all do. */
export function sourceRefProblems(input: unknown, output: unknown): RefProblem[] {
  const index = indexInput(input);
  const problems: RefProblem[] = [];
  const unknownFlag = (id: string): RefProblem => ({
    code: 'unknown-flag',
    message: `flag ${id} is not in the input`,
  });
  walk(output, (node, key) => {
    if (key === 'flagId' && typeof node === 'string' && !index.flagIds.has(node)) {
      problems.push(unknownFlag(node));
    }
    if (key === 'flagIds' && Array.isArray(node)) {
      for (const id of node) {
        if (typeof id === 'string' && !index.flagIds.has(id)) problems.push(unknownFlag(id));
      }
    }
    if (isSourceRef(node)) {
      const problem = refProblem(node, index);
      if (problem) problems.push(problem);
    }
  });
  return problems;
}

/** How many problems of each kind: what may be logged of them. */
export function problemCounts(
  problems: readonly RefProblem[],
): Partial<Record<RefProblemCode, number>> {
  const counts: Partial<Record<RefProblemCode, number>> = {};
  for (const { code } of problems) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}

function indexInput(input: unknown): InputIndex {
  const documents: Record<string, unknown>[] = [];
  const refs: SourceRef[] = [];
  const flagIds = new Set<string>();
  walk(input, (node) => {
    if (!isObject(node)) return;
    if (isSourceRef(node)) refs.push(node);
    if (node.schemaVersion === 'declaration.v1') documents.push(node);
    // A flag: an id with the rule that raised it.
    if (typeof node.id === 'string' && typeof node.ruleId === 'string') flagIds.add(node.id);
  });
  return { ...indexDocuments(documents), refs, flagIds };
}

function indexDocuments(documents: readonly unknown[]): DocumentIndex {
  const index: DocumentIndex = { documents: [], owners: new Map(), people: new Set() };
  for (const document of documents.filter(isObject)) {
    index.documents.push(document);
    const statements = Array.isArray(document.statements) ? document.statements : [];
    for (const statement of statements.filter(isObject)) {
      if (typeof statement.personKey !== 'string') continue;
      index.people.add(statement.personKey);
      for (const category of CATEGORIES) {
        const items = Array.isArray(statement[category]) ? statement[category] : [];
        for (const item of items.filter(isObject)) {
          if (typeof item.id === 'string') index.owners.set(item.id, statement.personKey);
        }
      }
    }
  }
  return index;
}

function refProblem(ref: SourceRef, index: InputIndex): RefProblem | null {
  const { sectionKey, personKey, itemId, fieldPath } = ref;
  if (sectionKey === null && personKey === null && itemId === null && fieldPath === null) {
    return null;
  }
  if (index.refs.some((each) => sameTarget(ref, each))) return null;
  if (index.documents.length === 0) {
    return { code: 'unknown-ref', message: `ref ${describe(ref)} is not one of the input's refs` };
  }
  return problemIn(ref, index);
}

/**
 * Why `ref` does not resolve against these declaration.v1 documents (null entries are skipped),
 * or null when it does: its parts exist and agree. The check the task evals score with.
 */
export function documentRefProblem(ref: SourceRef, documents: readonly unknown[]): string | null {
  return problemIn(ref, indexDocuments(documents))?.message ?? null;
}

function problemIn(ref: SourceRef, index: DocumentIndex): RefProblem | null {
  const problem = (code: RefProblemCode, message: string): RefProblem => ({ code, message });
  const { sectionKey, personKey, itemId, fieldPath } = ref;
  const sectionPerson = sectionKey?.startsWith(STATEMENT_SECTION)
    ? sectionKey.slice(STATEMENT_SECTION.length)
    : null;
  if (personKey !== null && !index.people.has(personKey)) {
    return problem('unknown-person', `person ${personKey} is not in the input`);
  }
  if (itemId !== null && !index.owners.has(itemId)) {
    return problem('unknown-item', `item ${itemId} is not in the input`);
  }
  if (
    sectionKey !== null &&
    !FIXED_SECTIONS.has(sectionKey) &&
    !index.people.has(sectionPerson ?? '')
  ) {
    return problem('unknown-section', `section ${sectionKey} is not in the input`);
  }
  if (
    fieldPath !== null &&
    index.documents.every((document) => resolvePointer(document, fieldPath) === undefined)
  ) {
    return problem('unknown-field', `field ${fieldPath} is not in the input`);
  }
  const owner = itemId === null ? undefined : index.owners.get(itemId);
  if (personKey !== null && owner !== undefined && owner !== personKey) {
    return problem('item-not-of-person', `item ${itemId} does not belong to ${personKey}`);
  }
  if (sectionPerson !== null && personKey !== null && sectionPerson !== personKey) {
    return problem(
      'person-not-of-section',
      `person ${personKey} does not belong to section ${sectionKey}`,
    );
  }
  if (sectionPerson !== null && owner !== undefined && owner !== sectionPerson) {
    return problem(
      'item-not-of-section',
      `item ${itemId} does not belong to section ${sectionKey}`,
    );
  }
  return null;
}

/** The same section, person and item as an input ref, and its field path or none. */
export function sameTarget(ref: SourceRef, inputRef: SourceRef): boolean {
  return (
    ref.sectionKey === inputRef.sectionKey &&
    ref.personKey === inputRef.personKey &&
    ref.itemId === inputRef.itemId &&
    (ref.fieldPath === null || ref.fieldPath === inputRef.fieldPath)
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

function describe(ref: SourceRef): string {
  return [ref.sectionKey, ref.personKey, ref.itemId, ref.fieldPath]
    .map((part) => part ?? '-')
    .join(' ');
}

const REF_KEYS = ['sectionKey', 'personKey', 'itemId', 'fieldPath'] as const;

function isSourceRef(node: unknown): node is SourceRef {
  return (
    isObject(node) &&
    REF_KEYS.every(
      (key) => Object.hasOwn(node, key) && (node[key] === null || typeof node[key] === 'string'),
    )
  );
}

function isObject(node: unknown): node is Record<string, unknown> {
  return node !== null && typeof node === 'object' && !Array.isArray(node);
}

/** Visits every value in `value` with the key it sits under (array items: the array's key). */
function walk(
  value: unknown,
  visit: (node: unknown, key: string | undefined) => void,
  key?: string,
): void {
  visit(value, key);
  if (Array.isArray(value)) {
    for (const each of value) walk(each, visit, key);
  } else if (isObject(value)) {
    for (const [childKey, child] of Object.entries(value)) walk(child, visit, childKey);
  }
}
