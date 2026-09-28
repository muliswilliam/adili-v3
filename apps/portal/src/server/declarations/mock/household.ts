import { householdIssues, includedAtStatementDate } from '../../../declaration/household';
import type { Draft, Household } from '../../../declaration/contents';
import type { CompletenessIssue } from '../types';
import { issue, type RuleContext } from './context';

export { fullName } from '../../../declaration/format';
export { householdPersons } from '../../../declaration/household';

/** The service derives `includedAtStatementDate`; the mock does the same on save. */
export function deriveHousehold(household: Draft<Household>, statementDate: string) {
  return {
    ...household,
    children: {
      ...household.children,
      items: (household.children?.items ?? []).map((child) => ({
        ...child,
        includedAtStatementDate: includedAtStatementDate(child.dateOfBirth, statementDate),
      })),
    },
  };
}

/** Paragraphs 6-7 (S5, S6): the same rules the Spouses and children screen shows. */
export function householdCompleteness(
  household: Draft<Household>,
  context: RuleContext,
): CompletenessIssue[] {
  return householdIssues(household, context.officer.maritalStatus).map((found) =>
    issue(context, found.path, found.code, found.message),
  );
}
