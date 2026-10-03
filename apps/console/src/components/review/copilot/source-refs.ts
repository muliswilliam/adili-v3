import type { SourceRef, SourceRefTarget } from '@adili/ui';

import { messages as t } from './messages';

/**
 * Turns the source refs of a copilot output into what a `SourceRefLink` shows, read against the
 * case's `declaration.v1` document, and names the element in the declaration pane each ref
 * opens. The case view gives its sections, statements and items these ids
 * (`declarationAnchorId`) so the panel can scroll to and highlight them.
 */

export interface ResolvedRef {
  ref: SourceRef;
  /** The chip's text: the item's description, a statement, a section. */
  label: string;
  /**
   * Whose statement an item is in, when another statement has an item described the same way
   * (a plot held jointly with the spouse), so the two chips read apart; null otherwise.
   */
  detail: string | null;
  /** Where it goes, for the accessible name: "Assets · Plot Kisumu/Manyatta/1234 · John Otieno". */
  targetLabel: string;
  /** The element in the declaration pane, see `declarationAnchorId`. */
  anchorId: string;
  target: SourceRefTarget;
}

type Category = 'income' | 'assets' | 'liabilities';
const CATEGORIES: readonly Category[] = ['income', 'assets', 'liabilities'];

const isCategory = (value: string | null | undefined): value is Category =>
  CATEGORIES.includes(value as Category);

/** Top-level parts of the document a ref can name, by section key or JSON pointer head. */
const DOCUMENT_SECTIONS: Record<string, keyof typeof t.sections> = {
  officer: 'personal',
  personal: 'personal',
  spouses: 'spouses',
  children: 'children',
  otherInformation: 'other',
  other: 'other',
};

/**
 * The id of the element a ref opens in the declaration pane: `decl-item-{itemId}`,
 * `decl-statement-{personKey}` (a person's financial statement, First Schedule section 8) or
 * `decl-section-{personal|spouses|children|other}`.
 */
export function declarationAnchorId(
  target:
    | { kind: 'item'; itemId: string }
    | { kind: 'statement'; personKey: string }
    | { kind: 'section'; section: keyof typeof t.sections },
): string {
  if (target.kind === 'item') return `decl-item-${target.itemId}`;
  if (target.kind === 'statement') return `decl-statement-${target.personKey}`;
  return `decl-section-${target.section}`;
}

interface DocItem {
  id: string;
  description: string;
}

interface DocStatement {
  personKey: string;
  personName: string;
  items: Record<Category, DocItem[]>;
}

/** `officer`, `spouse:{id}`, `child:{id}`: the person's place in the household. */
function relationOf(personKey: string): string {
  if (personKey.startsWith('spouse:')) return t.relations.spouse;
  if (personKey.startsWith('child:')) return t.relations.child;
  return t.relations.declarant;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function nameOf(value: unknown): string {
  if (!isRecord(value)) return '';
  // As the declaration pane names people (`personName`): first, other names, surname.
  return [value.firstName, value.otherNames, value.surname]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

function itemsOf(value: unknown): DocItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string'
      ? [{ id: item.id, description: typeof item.description === 'string' ? item.description : '' }]
      : [],
  );
}

/** The statements of a `declaration.v1` document, read defensively (it is loosely typed). */
function statementsOf(document: Record<string, unknown> | null): DocStatement[] {
  const statements = document?.statements;
  if (!Array.isArray(statements)) return [];
  return statements.flatMap((statement) => {
    if (!isRecord(statement) || typeof statement.personKey !== 'string') return [];
    return [
      {
        personKey: statement.personKey,
        personName: nameOf(statement.personName),
        items: {
          income: itemsOf(statement.income),
          assets: itemsOf(statement.assets),
          liabilities: itemsOf(statement.liabilities),
        },
      },
    ];
  });
}

/**
 * A resolver for one document: `resolve(ref)` is the link for a ref, or null when the ref names
 * nothing the document has (the panel then leaves it out).
 */
export function sourceRefResolver(document: Record<string, unknown> | null) {
  const statements = statementsOf(document);
  const statementOf = (personKey: string | null) =>
    statements.find((each) => each.personKey === personKey) ?? null;
  // How many statements hold an item described this way.
  const holders = new Map<string, number>();
  for (const statement of statements) {
    const described = new Set(
      CATEGORIES.flatMap((category) => statement.items[category].map((item) => item.description)),
    );
    for (const description of described) {
      if (description) holders.set(description, (holders.get(description) ?? 0) + 1);
    }
  }

  function itemRef(ref: SourceRef, itemId: string): ResolvedRef | null {
    for (const statement of statements) {
      for (const category of CATEGORIES) {
        const item = statement.items[category].find((each) => each.id === itemId);
        if (!item) continue;
        const label = item.description || t.categories[category];
        const shared = (holders.get(item.description) ?? 0) > 1 && statement.personName;
        return {
          ref,
          label,
          detail: shared || null,
          targetLabel: [t.categories[category], label, statement.personName]
            .filter(Boolean)
            .join(' · '),
          anchorId: declarationAnchorId({ kind: 'item', itemId }),
          target: 'item',
        };
      }
    }
    return null;
  }

  function statementRef(ref: SourceRef, statement: DocStatement, category: Category | null) {
    const label = category
      ? `${t.categories[category]} · ${statement.personName}`
      : t.statementOf(statement.personName, relationOf(statement.personKey));
    return {
      ref,
      label,
      detail: null,
      targetLabel: label,
      anchorId: declarationAnchorId({ kind: 'statement', personKey: statement.personKey }),
      target: 'person',
    } satisfies ResolvedRef;
  }

  function sectionRef(ref: SourceRef, key: string | undefined): ResolvedRef | null {
    const section = key ? DOCUMENT_SECTIONS[key] : undefined;
    if (!section) return null;
    const label = t.sections[section];
    return {
      ref,
      label,
      detail: null,
      targetLabel: label,
      anchorId: declarationAnchorId({ kind: 'section', section }),
      target: 'section',
    };
  }

  return function resolve(ref: SourceRef): ResolvedRef | null {
    if (ref.itemId) return itemRef(ref, ref.itemId);
    // `statement:{personKey}` names a person's whole statement.
    const sectionKey = ref.sectionKey ?? null;
    const statementKey = sectionKey?.startsWith('statement:')
      ? sectionKey.slice('statement:'.length)
      : null;
    const pointer = ref.fieldPath?.split('/').filter(Boolean) ?? [];
    if (pointer[0] === 'statements') {
      const statement = statements[Number(pointer[1])];
      if (!statement) return null;
      const category = isCategory(pointer[2]) ? pointer[2] : null;
      return { ...statementRef(ref, statement, category), target: 'field' };
    }
    const personKey = statementKey ?? ref.personKey;
    if (personKey) {
      const statement = statementOf(personKey);
      if (!statement) return null;
      return statementRef(ref, statement, isCategory(sectionKey) ? sectionKey : null);
    }
    if (pointer[0]) {
      const field = sectionRef(ref, pointer[0]);
      return field ? { ...field, target: 'field' } : null;
    }
    return sectionRef(ref, sectionKey ?? undefined);
  };
}

/** How long the target of a source link stays highlighted. */
export const HIGHLIGHT_MS = 2_400;

/**
 * Scrolls the declaration pane to a ref's target and highlights it (`data-target-highlight`,
 * which `@adili/ui` styles), for `HIGHLIGHT_MS`. Returns false when the pane does not have the
 * element, for instance while it shows another version.
 */
export function highlightInDeclaration(anchorId: string, root: Document = document): boolean {
  const element = root.getElementById(anchorId);
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.setAttribute('data-target-highlight', '');
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
  setTimeout(() => {
    element.removeAttribute('data-target-highlight');
  }, HIGHLIGHT_MS);
  return true;
}
