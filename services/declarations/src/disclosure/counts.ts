import type { DeclarationV1 } from '@adili/forms';

import { type DisclosedContent, disclose, type DisclosureScope } from './scope.js';

/**
 * How much a grant would disclose of a version, in counts only (spec 10, decision 1): what the
 * access officer sees before deciding, never the content. Counted on what `disclose` lets out
 * of the version, so nothing outside the scope is ever counted:
 * - `bio`: the persons whose particulars go out (the officer, and the included spouses and
 *   children);
 * - `income`, `assets`, `liabilities`: the entries of those parts across the included persons'
 *   statements;
 * - `other`: the material changes, directorships, memberships and pending cases, and one for a
 *   written statement;
 * - `spouses`, `children`: the included household members anything goes out about, null when
 *   that kind is not included.
 */
export interface VersionCounts {
  sections: Partial<Record<DisclosureScope['sections'][number], number>>;
  spouses: ReadonlySet<string> | null;
  children: ReadonlySet<string> | null;
}

/** The counts of one version under `scope`. */
export function countVersion(document: DeclarationV1, scope: DisclosureScope): VersionCounts {
  const content = disclose(document, scope);
  const sections: VersionCounts['sections'] = {};
  for (const section of new Set(scope.sections)) sections[section] = sectionCount(content, section);
  return {
    sections,
    spouses: scope.includeSpouses ? householdKeys(content, 'spouse') : null,
    children: scope.includeChildren ? householdKeys(content, 'child') : null,
  };
}

function sectionCount(
  content: DisclosedContent,
  section: DisclosureScope['sections'][number],
): number {
  const statements = content.statements ?? [];
  switch (section) {
    case 'bio':
      return (
        (content.officer ? 1 : 0) +
        (content.spouses?.items.length ?? 0) +
        (content.children?.items.length ?? 0)
      );
    case 'income':
      return statements.reduce((sum, statement) => sum + (statement.income?.length ?? 0), 0);
    case 'assets':
      return statements.reduce((sum, statement) => sum + (statement.assets?.length ?? 0), 0);
    case 'liabilities':
      return statements.reduce((sum, statement) => sum + (statement.liabilities?.length ?? 0), 0);
    case 'other': {
      const other = content.otherInformation;
      if (!other) return 0;
      const interests = other.registrableInterests;
      return (
        other.materialChanges.length +
        interests.directorships.length +
        interests.memberships.length +
        interests.pendingCases.length +
        (other.freeText.trim() === '' ? 0 : 1)
      );
    }
  }
}

/** The household members of a kind anything in the disclosed content is about, by id. */
function householdKeys(content: DisclosedContent, kind: 'spouse' | 'child'): Set<string> {
  const keys = new Set<string>();
  const items = kind === 'spouse' ? content.spouses?.items : content.children?.items;
  for (const item of items ?? []) keys.add(item.id);
  const prefix = `${kind}:`;
  const personKeys = [
    ...(content.statements ?? []).map((statement) => statement.personKey),
    ...(content.otherInformation?.materialChanges ?? []).map((change) => change.personKey),
  ];
  for (const key of personKeys) {
    if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
  }
  return keys;
}
