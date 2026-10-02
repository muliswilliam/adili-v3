/**
 * What a clarification item can be about (spec 07a FE-4): the sections of the declaration as
 * filed, each person's financial statement and every item in it, read from the case's current
 * `declaration.v1` document. Each target carries the refs review.yaml's `ClarificationItemInput`
 * takes and the label the review service prints on the letter (`itemLabel` in
 * `services/review/src/clarifications/labels.ts`), so the composer, its preview and the issued
 * letter name an item the same way. Pure.
 */

export interface TargetRef {
  /** `bio`, `household`, `other` or `statement:{personKey}`. */
  sectionKey: string | null;
  /** `officer`, `spouse:{id}` or `child:{id}`. */
  personKey: string | null;
  itemId: string | null;
}

export interface ClarificationTarget {
  /** Unique in a list: `section:bio`, `statement:officer`, `item:{id}`, `saved:...`. */
  key: string;
  /** The picker's heading: "Declaration", or the person's name. */
  group: string;
  /** As the letter prints it, e.g. "Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno". */
  label: string;
  kind: 'section' | 'statement' | 'item';
  ref: TargetRef;
  /** An item's category and description in the declaration, for short labels (chips). */
  item?: { category: ItemCategory; description: string };
}

export type ItemCategory = 'income' | 'assets' | 'liabilities';

export const DECLARATION_GROUP = 'Declaration';
/** Heading of a saved target the current version no longer has. */
const SAVED_GROUP = 'Saved';

/** The review service's section labels (labels.ts `SECTION_LABELS`). */
const SECTIONS = [
  ['bio', 'Personal details'],
  ['household', 'Spouses and children'],
  ['other', 'Other information'],
] as const;

const CATEGORIES = [
  ['income', 'Income'],
  ['assets', 'Assets'],
  ['liabilities', 'Liabilities'],
] as const;

const STATEMENT_LABEL = 'Financial statement';
/** What the service prints for an item that names no section, person or item. */
const DECLARATION_LABEL = 'Declaration';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** First, other and surname, as the letter prints a person (labels.ts `fullName`). */
function fullName(value: unknown): string {
  if (!isRecord(value)) return '';
  return [value.firstName, value.otherNames, value.surname]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

function sectionTarget(sectionKey: string, label: string): ClarificationTarget {
  return {
    key: `section:${sectionKey}`,
    group: DECLARATION_GROUP,
    label,
    kind: 'section',
    ref: { sectionKey, personKey: null, itemId: null },
  };
}

/** Every target of a document, in First Schedule order; the sections even without one. */
export function clarificationTargets(
  document: Record<string, unknown> | null,
): ClarificationTarget[] {
  const targets = SECTIONS.map(([key, label]) => sectionTarget(key, label));
  const statements = Array.isArray(document?.statements) ? document.statements : [];
  for (const statement of statements) {
    if (!isRecord(statement) || typeof statement.personKey !== 'string') continue;
    const personKey = statement.personKey;
    const name = fullName(statement.personName);
    const group = name || STATEMENT_LABEL;
    const sectionKey = `statement:${personKey}`;
    targets.push({
      key: sectionKey,
      group,
      label: [STATEMENT_LABEL, name].filter(Boolean).join(' · '),
      kind: 'statement',
      ref: { sectionKey, personKey, itemId: null },
    });
    for (const [category, categoryLabel] of CATEGORIES) {
      const items = statement[category];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!isRecord(item) || typeof item.id !== 'string') continue;
        const description = typeof item.description === 'string' ? item.description : '';
        targets.push({
          key: `item:${item.id}`,
          group,
          label: [categoryLabel, description, name].filter(Boolean).join(' · '),
          kind: 'item',
          ref: { sectionKey, personKey, itemId: item.id },
          item: { category, description },
        });
      }
    }
  }
  return targets;
}

/** What a saved or drafted item names, as review.yaml has it (each part optional). */
export type SavedRef = { [K in keyof TargetRef]?: TargetRef[K] | undefined } & {
  label?: string | null;
};

const personOf = (ref: TargetRef): string | null =>
  ref.personKey ??
  (ref.sectionKey?.startsWith('statement:') ? ref.sectionKey.slice('statement:'.length) : null);

/**
 * The target a saved item points at. An item the current version no longer has keeps its saved
 * label when it has one (a `saved:` target), else falls back to its statement, as the letter
 * does. Null when the item names nothing.
 */
export function targetOf(
  item: SavedRef,
  targets: readonly ClarificationTarget[],
): ClarificationTarget | null {
  const ref: TargetRef = {
    sectionKey: item.sectionKey ?? null,
    personKey: item.personKey ?? null,
    itemId: item.itemId ?? null,
  };
  if (ref.itemId) {
    const found = targets.find((target) => target.ref.itemId === ref.itemId);
    if (found) return found;
    if (item.label) {
      return {
        key: `saved:${[ref.sectionKey, ref.personKey, ref.itemId].join(':')}`,
        group: SAVED_GROUP,
        label: item.label,
        kind: 'item',
        ref,
      };
    }
  }
  const person = personOf(ref);
  if (person) {
    return (
      targets.find((target) => target.kind === 'statement' && target.ref.personKey === person) ??
      null
    );
  }
  if (ref.sectionKey) {
    return targets.find((target) => target.key === `section:${ref.sectionKey}`) ?? null;
  }
  return null;
}

/** The label of a saved item: its target's, its own, or "Declaration" when it names nothing. */
export function labelOf(item: SavedRef, targets: readonly ClarificationTarget[]): string {
  return targetOf(item, targets)?.label ?? item.label ?? DECLARATION_LABEL;
}
