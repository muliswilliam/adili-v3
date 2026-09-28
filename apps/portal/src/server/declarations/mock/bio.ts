import { BIO_FIELD_ORDER, BIO_FIELD_PATHS, bioIssues } from '../../../declaration/bio';
import type { Draft, Officer } from '../../../declaration/contents';
import type { CompletenessIssue } from '../types';
import { issue, type RuleContext } from './context';

/** Paragraphs 1-5: the same rules the Your details screen shows. */
export function bioCompleteness(
  officer: Draft<Officer>,
  context: RuleContext,
): CompletenessIssue[] {
  const issues = bioIssues(officer, context.statementDate);
  return BIO_FIELD_ORDER.flatMap((field) => {
    const found = issues[field];
    return found ? [issue(context, BIO_FIELD_PATHS[field], found.kind, found.message)] : [];
  });
}

/** The roster fields a declarant cannot change (400 `identity-locked-field`). */
export function lockedFieldsChanged(saved: Draft<Officer>, next: Draft<Officer>): boolean {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (
    !same(saved.name, next.name) ||
    !same(saved.employment?.designation, next.employment?.designation) ||
    !same(saved.employment?.employer, next.employment?.employer) ||
    !same(saved.employment?.responsibleCommission, next.employment?.responsibleCommission)
  );
}
