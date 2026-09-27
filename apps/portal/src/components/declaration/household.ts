import type { Child, Draft, Household, MaritalStatus, PersonName, Spouse } from './contents';
import { ageOn, blank, fullName } from './format';

/**
 * Rules for Spouses and children (paragraphs 6-7), shared by the household screen and the
 * declarations mock so both report the same issues (S5, S6). Follows declaration.v1
 * (`household`): names need a surname and first name (other names are optional), a national
 * ID is 5 to 10 digits, a KRA PIN looks like A000000000Z, a separated spouse needs the date,
 * and a child needs a date of birth. A child is included while under 18 on the statement date.
 */

export const HOUSEHOLD_MESSAGES = {
  maritalStatusMissing:
    'Choose your marital status in Your details, then add your spouse if you have one.',
  spouseConflict: (status: string) =>
    `You said you are ${status}, but you added a spouse. Change your marital status in Your details, or remove the spouse.`,
  spouseUnanswered: 'Add your spouse, or confirm you have none.',
  childrenUnanswered: 'Add your dependent children, or confirm you have none under 18.',
  name: (who: string) => `Enter ${who}'s surname and first name.`,
  nationalId: (who: string) => `Check ${who}'s national ID: 5 to 10 digits.`,
  kraPin: (who: string) => `Check ${who}'s KRA PIN, e.g. A000000000Z.`,
  separationDate: (who: string) => `Enter the date you separated from ${who}.`,
  dateOfBirth: (who: string) => `Enter ${who}'s date of birth.`,
} as const;

export type PersonField = 'name' | 'nationalId' | 'kraPin' | 'separationDate' | 'dateOfBirth';

export interface HouseholdIssue {
  /** JSON pointer into the household section, as the service reports it. */
  path: string;
  code: string;
  /** `missing` waits until the field was visited; `invalid` shows as soon as it is typed. */
  kind: 'missing' | 'invalid';
  message: string;
  /** The spouse or child the issue is about. */
  itemId?: string;
  field?: PersonField;
}

const NATIONAL_ID = /^[0-9]{5,10}$/;
const KRA_PIN = /^[AP][0-9]{9}[A-Z]$/;
const NO_SPOUSE_EXPECTED: readonly MaritalStatus[] = ['single', 'divorced', 'widowed'];

/** The card's heading: the person's name once it has a first name, else "Spouse 2". */
export function personTitle(name: Draft<PersonName> | undefined, fallback: string): string {
  return blank(name?.firstName) ? fallback : fullName(name);
}

/** Nothing entered yet beyond a pre-filled surname: removing it loses no work. */
export function isBlankPerson(person: Draft<Spouse> | Draft<Child>): boolean {
  const values = [
    person.name?.firstName,
    person.name?.otherNames,
    person.nationalId,
    'kraPin' in person ? person.kraPin : undefined,
    'separationDate' in person ? person.separationDate : undefined,
    'dateOfBirth' in person ? person.dateOfBirth : undefined,
  ];
  return values.every(blank);
}

export type ChildInclusion = { included: true } | { included: false; age: number };

/** S5, S18: under 18 on the statement date is included; turning 18 that day is not. */
export function childInclusion(
  dateOfBirth: string | undefined,
  statementDate: string,
): ChildInclusion | null {
  if (!dateOfBirth) return null;
  const age = ageOn(dateOfBirth, statementDate);
  return age < 18 ? { included: true } : { included: false, age };
}

export function includedAtStatementDate(dateOfBirth: string | undefined, statementDate: string) {
  return childInclusion(dateOfBirth, statementDate)?.included === true;
}

/**
 * Where the spouses card stands: no marital status yet, no spouse expected, a spouse that
 * contradicts the marital status, a spouse still to add or confirm, confirmed none, or listed.
 */
export type SpouseState =
  'needs-status' | 'not-expected' | 'conflict' | 'unanswered' | 'none' | 'listed';

export function spouseState(
  maritalStatus: MaritalStatus | undefined | null,
  household: Draft<Household>,
): SpouseState {
  const count = household.spouses?.items?.length ?? 0;
  const expected = maritalStatus ? !NO_SPOUSE_EXPECTED.includes(maritalStatus) : null;
  if (count > 0) return expected === false ? 'conflict' : 'listed';
  if (expected === null) return 'needs-status';
  if (!expected) return 'not-expected';
  return household.spouses?.none === true ? 'none' : 'unanswered';
}

function personIssues(
  group: 'spouses' | 'children',
  person: Draft<Spouse> | Draft<Child>,
  index: number,
  who: string,
): HouseholdIssue[] {
  const issues: HouseholdIssue[] = [];
  const at = (field: PersonField, code: string, kind: HouseholdIssue['kind'], message: string) => {
    issues.push({
      path: `/${group}/items/${String(index)}/${field}`,
      code,
      kind,
      ...(person.id ? { itemId: person.id } : {}),
      field,
      message,
    });
  };

  if (blank(person.name?.surname) || blank(person.name?.firstName)) {
    at('name', 'required', 'missing', HOUSEHOLD_MESSAGES.name(who));
  }
  if (group === 'children' && blank((person as Draft<Child>).dateOfBirth)) {
    at('dateOfBirth', 'required', 'missing', HOUSEHOLD_MESSAGES.dateOfBirth(who));
  }
  if (!blank(person.nationalId) && !NATIONAL_ID.test(person.nationalId ?? '')) {
    at('nationalId', 'pattern', 'invalid', HOUSEHOLD_MESSAGES.nationalId(who));
  }
  if (group === 'spouses') {
    const spouse = person as Draft<Spouse>;
    if (!blank(spouse.kraPin) && !KRA_PIN.test(spouse.kraPin ?? '')) {
      at('kraPin', 'pattern', 'invalid', HOUSEHOLD_MESSAGES.kraPin(who));
    }
    if (spouse.separated === true && blank(spouse.separationDate)) {
      at('separationDate', 'required', 'missing', HOUSEHOLD_MESSAGES.separationDate(who));
    }
  }
  return issues;
}

/** What stops Spouses and children from being complete, in screen order (S5, S6). */
export function householdIssues(
  household: Draft<Household>,
  maritalStatus: MaritalStatus | undefined | null,
): HouseholdIssue[] {
  const issues: HouseholdIssue[] = [];
  const spouses = household.spouses?.items ?? [];
  const children = household.children?.items ?? [];
  const section = (path: string, code: string, message: string) => {
    issues.push({ path, code, kind: 'missing', message });
  };

  if (!maritalStatus) {
    section('/spouses', 'marital-status-missing', HOUSEHOLD_MESSAGES.maritalStatusMissing);
  } else {
    const state = spouseState(maritalStatus, household);
    if (state === 'conflict') {
      section(
        '/spouses',
        'spouse-conflicts-with-marital-status',
        HOUSEHOLD_MESSAGES.spouseConflict(maritalStatus),
      );
    } else if (state === 'unanswered') {
      section('/spouses', 'spouse-unanswered', HOUSEHOLD_MESSAGES.spouseUnanswered);
    }
  }
  spouses.forEach((spouse, index) => {
    issues.push(
      ...personIssues(
        'spouses',
        spouse,
        index,
        personTitle(spouse.name, `Spouse ${String(index + 1)}`),
      ),
    );
  });

  if (children.length === 0 && household.children?.none !== true) {
    section('/children', 'children-unanswered', HOUSEHOLD_MESSAGES.childrenUnanswered);
  }
  children.forEach((child, index) => {
    issues.push(
      ...personIssues(
        'children',
        child,
        index,
        personTitle(child.name, `Child ${String(index + 1)}`),
      ),
    );
  });
  return issues;
}

/** The people who need a statement besides the officer, in schedule order (S5). */
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

/** Everyone who needs a financial statement, for the screen's footer: "you" first. */
export function statementsNeeded(household: Draft<Household>, statementDate: string): string[] {
  const spouses = (household.spouses?.items ?? []).map((spouse, index) =>
    personTitle(spouse.name, `Spouse ${String(index + 1)}`),
  );
  const children = (household.children?.items ?? []).flatMap((child, index) =>
    includedAtStatementDate(child.dateOfBirth, statementDate)
      ? [personTitle(child.name, `Child ${String(index + 1)}`)]
      : [],
  );
  return ['you', ...spouses, ...children];
}
