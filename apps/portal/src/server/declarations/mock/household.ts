import { ageOn } from '../../../components/declaration/bio';
import type { Draft, Household, PersonName } from '../../../components/declaration/contents';
import type { CompletenessIssue } from '../types';
import { issue, type RuleContext } from './context';

export function fullName(name: Draft<PersonName> | undefined): string {
  return [name?.firstName, name?.otherNames, name?.surname]
    .filter((part) => part && part.trim() !== '')
    .join(' ');
}

/** A child is included when under 18 on the statement date; turning 18 that day excludes them. */
export function includedAtStatementDate(dateOfBirth: string | undefined, statementDate: string) {
  return dateOfBirth ? ageOn(dateOfBirth, statementDate) < 18 : false;
}

/** The people who need a statement besides the officer, in schedule order. */
export function householdPersons(household: Draft<Household>, statementDate: string) {
  const spouses = (household.spouses?.items ?? []).flatMap((spouse) =>
    spouse.id ? [{ key: `statement:spouse:${spouse.id}`, name: spouse.name }] : [],
  );
  const children = (household.children?.items ?? []).flatMap((child) =>
    child.id && includedAtStatementDate(child.dateOfBirth, statementDate)
      ? [{ key: `statement:child:${child.id}`, name: child.name }]
      : [],
  );
  return [...spouses, ...children];
}

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

/** Paragraphs 6-7 (S5, S6). Refined by the household screen (#119). */
export function householdCompleteness(
  household: Draft<Household>,
  context: RuleContext,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const status = context.officer.maritalStatus;
  const spouses = household.spouses?.items ?? [];
  if (!status) {
    issues.push(
      issue(
        context,
        '/spouses',
        'marital-status-missing',
        'Choose your marital status in Your details, then add your spouse if you have one.',
      ),
    );
  } else if (['single', 'divorced', 'widowed'].includes(status) && spouses.length > 0) {
    issues.push(
      issue(
        context,
        '/spouses',
        'spouse-conflicts-with-marital-status',
        `You said you are ${status}, but you added a spouse. Change your marital status in Your details, or remove the spouse.`,
      ),
    );
  } else if (
    ['married', 'separated'].includes(status) &&
    spouses.length === 0 &&
    household.spouses?.none !== true
  ) {
    issues.push(
      issue(context, '/spouses', 'spouse-unanswered', 'Add your spouse, or confirm you have none.'),
    );
  }
  spouses.forEach((spouse, index) => {
    const who = fullName(spouse.name) || `Spouse ${String(index + 1)}`;
    if (!spouse.name?.surname?.trim() || !spouse.name.firstName?.trim()) {
      issues.push(
        issue(
          context,
          `/spouses/items/${String(index)}/name`,
          'required',
          `Enter ${who}'s surname and first name.`,
        ),
      );
    }
    if (spouse.separated && !spouse.separationDate) {
      issues.push(
        issue(
          context,
          `/spouses/items/${String(index)}/separationDate`,
          'required',
          `Enter the date you separated from ${who}.`,
        ),
      );
    }
  });

  const children = household.children?.items ?? [];
  if (children.length === 0 && household.children?.none !== true) {
    issues.push(
      issue(
        context,
        '/children',
        'children-unanswered',
        'Add your dependent children, or confirm you have none under 18.',
      ),
    );
  }
  children.forEach((child, index) => {
    const who = fullName(child.name) || `Child ${String(index + 1)}`;
    if (!child.name?.surname?.trim() || !child.name.firstName?.trim()) {
      issues.push(
        issue(
          context,
          `/children/items/${String(index)}/name`,
          'required',
          `Enter ${who}'s surname and first name.`,
        ),
      );
    }
    if (!child.dateOfBirth) {
      issues.push(
        issue(
          context,
          `/children/items/${String(index)}/dateOfBirth`,
          'required',
          `Enter ${who}'s date of birth.`,
        ),
      );
    }
  });
  return issues;
}
