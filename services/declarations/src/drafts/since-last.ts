import { isRecord } from '../guards.js';
import {
  FLAGGED_INTERESTS,
  isStatementKey,
  type SectionContents,
  STATEMENT_CATEGORIES,
} from './sections.js';

/**
 * "Changed since the last declaration" (Act s.31(3)-(4), Regs r.21) means something only on a
 * declaration that follows an earlier one: every type but the initial, the officer's first. An
 * initial declaration does not ask it (the portal hides the marital status change and the item
 * and interest flags), so whatever a section holds of it is cleared: on save, so it is not
 * stored, and on every read, so a draft saved before it was hidden is assessed, composed and
 * submitted without it. Paragraph 9's material changes, composed from these flags, are then none.
 */

/** Whether a declaration of the type follows an earlier one, so changes since it are asked. */
export function followsEarlierDeclaration(type: string): boolean {
  return type !== 'initial';
}

/** No change since the last declaration: what an item of an initial declaration says. */
const UNCHANGED = { changed: false } as const;

/**
 * The section's contents as a declaration of the type holds them: as given when it follows an
 * earlier one; otherwise without the bio's marital status change, every statement item flagged
 * unchanged (declaration.v1 requires the flag) and no flag on a directorship or membership.
 * Pure; the contents given are not changed.
 */
export function asDeclaredFor(
  type: string,
  key: string,
  contents: SectionContents,
): SectionContents {
  if (followsEarlierDeclaration(type)) return contents;
  if (key === 'bio') return without(contents, 'maritalStatusChange');
  if (isStatementKey(key)) {
    const cleared = { ...contents };
    for (const { list } of STATEMENT_CATEGORIES) {
      const items = contents[list];
      if (!Array.isArray(items)) continue;
      cleared[list] = items.map((item: unknown) =>
        isRecord(item) ? { ...item, change: UNCHANGED } : item,
      );
    }
    return cleared;
  }
  if (key === 'other' && isRecord(contents.registrableInterests)) {
    const interests = { ...contents.registrableInterests };
    for (const { list } of FLAGGED_INTERESTS) {
      const entries = interests[list];
      if (!Array.isArray(entries)) continue;
      interests[list] = entries.map((entry: unknown) =>
        isRecord(entry) ? without(entry, 'change') : entry,
      );
    }
    return { ...contents, registrableInterests: interests };
  }
  return contents;
}

/** A copy of the record without the field. */
function without(record: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== field));
}
