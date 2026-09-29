import { describe, expect, it } from 'vitest';

import type { Draft, Household } from './contents';
import {
  childInclusion,
  HOUSEHOLD_MESSAGES,
  householdIssues,
  householdMember,
  householdPersons,
  includedAtStatementDate,
  isBlankPerson,
  renamesPerson,
  spouseState,
  statementsNeeded,
} from './household';

const STATEMENT_DATE = '2027-11-01';
const SPOUSE = '11111111-1111-4111-8111-111111111111';
const SEPARATED = '22222222-2222-4222-8222-222222222222';
const CHILD = '33333333-3333-4333-8333-333333333333';
const ADULT = '44444444-4444-4444-8444-444444444444';

/** S5: two spouses (one separated) and three children, one 18 on the statement date. */
const s5: Draft<Household> = {
  spouses: {
    none: false,
    items: [
      { id: SPOUSE, name: { surname: 'Kennedy', firstName: 'Mary', otherNames: 'Wanjiru' } },
      {
        id: SEPARATED,
        name: { surname: 'Achieng', firstName: 'Grace' },
        separated: true,
        separationDate: '2024-03-01',
      },
    ],
  },
  children: {
    none: false,
    items: [
      { id: CHILD, name: { surname: 'Kamau', firstName: 'Tom' }, dateOfBirth: '2015-01-01' },
      { id: ADULT, name: { surname: 'Kamau', firstName: 'Ann' }, dateOfBirth: '2009-11-01' },
    ],
  },
};

function messages(household: Draft<Household>, status: Parameters<typeof householdIssues>[1]) {
  return householdIssues(household, status).map((issue) => issue.message);
}

describe('household rules', () => {
  it('passes a complete household (S5)', () => {
    expect(householdIssues(s5, 'married')).toEqual([]);
  });

  it('asks for marital status before spouses', () => {
    expect(messages({ children: { none: true, items: [] } }, undefined)).toEqual([
      HOUSEHOLD_MESSAGES.maritalStatusMissing,
    ]);
  });

  it('blocks a spouse when the declarant said they are single (S6)', () => {
    const issues = householdIssues({ spouses: s5.spouses, children: { none: true } }, 'single');
    expect(issues).toEqual([
      {
        path: '/spouses',
        code: 'spouse-conflicts-with-marital-status',
        kind: 'missing',
        message:
          'You said you are single, but you added a spouse. Change your marital status in Your details, or remove the spouse.',
      },
    ]);
  });

  it('is incomplete when married with no spouse and no explicit none (S6)', () => {
    expect(messages({ children: { none: true } }, 'married')).toEqual([
      HOUSEHOLD_MESSAGES.spouseUnanswered,
    ]);
    expect(messages({ children: { none: true } }, 'separated')).toEqual([
      HOUSEHOLD_MESSAGES.spouseUnanswered,
    ]);
  });

  it('is complete when married and the declarant confirms no spouse (S6)', () => {
    expect(messages({ spouses: { none: true }, children: { none: true } }, 'married')).toEqual([]);
  });

  it('needs no spouse answer when single, divorced or widowed', () => {
    for (const status of ['single', 'divorced', 'widowed'] as const) {
      expect(messages({ children: { none: true } }, status)).toEqual([]);
    }
  });

  it('asks about children until one is added or none is confirmed', () => {
    expect(messages({}, 'single')).toEqual([HOUSEHOLD_MESSAGES.childrenUnanswered]);
  });

  it('checks each spouse, naming them or their position', () => {
    const issues = householdIssues(
      {
        spouses: {
          items: [
            { id: SPOUSE, name: { surname: 'Kennedy', firstName: 'Mary' }, nationalId: '12a' },
            { id: SEPARATED, separated: true, kraPin: 'X123' },
          ],
        },
        children: { none: true },
      },
      'married',
    );
    expect(issues).toEqual([
      {
        path: '/spouses/items/0/nationalId',
        code: 'pattern',
        kind: 'invalid',
        itemId: SPOUSE,
        field: 'nationalId',
        message: "Check Mary Kennedy's national ID: 5 to 10 digits.",
      },
      {
        path: '/spouses/items/1/name',
        code: 'required',
        kind: 'missing',
        itemId: SEPARATED,
        field: 'name',
        message: "Enter Spouse 2's surname and first name.",
      },
      {
        path: '/spouses/items/1/kraPin',
        code: 'pattern',
        kind: 'invalid',
        itemId: SEPARATED,
        field: 'kraPin',
        message: "Check Spouse 2's KRA PIN, e.g. A000000000Z.",
      },
      {
        path: '/spouses/items/1/separationDate',
        code: 'required',
        kind: 'missing',
        itemId: SEPARATED,
        field: 'separationDate',
        message: 'Enter the date you separated from Spouse 2.',
      },
    ]);
  });

  it('accepts a well-formed national ID and KRA PIN', () => {
    expect(
      messages(
        {
          spouses: {
            items: [
              {
                id: SPOUSE,
                name: { surname: 'Kennedy', firstName: 'Mary' },
                nationalId: '12345678',
                kraPin: 'A123456789Z',
              },
            ],
          },
          children: { none: true },
        },
        'married',
      ),
    ).toEqual([]);
  });

  it('checks each child', () => {
    expect(
      messages(
        {
          spouses: { none: true },
          children: {
            items: [{ id: CHILD, name: { surname: 'Kamau' }, nationalId: '1' }],
          },
        },
        'married',
      ),
    ).toEqual([
      "Enter Child 1's surname and first name.",
      "Enter Child 1's date of birth.",
      "Check Child 1's national ID: 5 to 10 digits.",
    ]);
  });
});

describe('spouseState', () => {
  it('follows the marital status and the answers given', () => {
    expect(spouseState(undefined, {})).toBe('needs-status');
    expect(spouseState('single', {})).toBe('not-expected');
    expect(spouseState('widowed', s5)).toBe('conflict');
    expect(spouseState('married', {})).toBe('unanswered');
    expect(spouseState('married', { spouses: { none: true, items: [] } })).toBe('none');
    expect(spouseState('married', s5)).toBe('listed');
    expect(spouseState(undefined, s5)).toBe('listed');
  });
});

describe('child inclusion (S5, S18)', () => {
  it('includes a child under 18 on the statement date', () => {
    expect(childInclusion('2015-01-01', STATEMENT_DATE)).toEqual({ included: true });
    expect(includedAtStatementDate('2009-11-02', STATEMENT_DATE)).toBe(true);
  });

  it('excludes a child who turns 18 on the statement date', () => {
    expect(childInclusion('2009-11-01', STATEMENT_DATE)).toEqual({ included: false, age: 18 });
    expect(includedAtStatementDate('2009-11-01', STATEMENT_DATE)).toBe(false);
  });

  it('cannot tell without a date of birth', () => {
    expect(childInclusion(undefined, STATEMENT_DATE)).toBeNull();
  });
});

describe('people and statements', () => {
  it('spots a person whose name no longer matches their statement', () => {
    const key = `statement:spouse:${SPOUSE}`;
    const household: Draft<Household> = {
      spouses: {
        none: false,
        items: [{ id: SPOUSE, name: { firstName: 'Mary', surname: 'Kennedy' } }],
      },
    };
    expect(renamesPerson([{ key, personName: null }], household, STATEMENT_DATE)).toBe(true);
    expect(renamesPerson([{ key, personName: 'Mary Kennedy' }], household, STATEMENT_DATE)).toBe(
      false,
    );
    // A statement not created yet is reported by sectionsChanged instead.
    expect(renamesPerson([], household, STATEMENT_DATE)).toBe(false);
  });

  it('lists the statements the household needs, excluding adult children (S5)', () => {
    expect(householdPersons(s5, STATEMENT_DATE).map((person) => person.key)).toEqual([
      `statement:spouse:${SPOUSE}`,
      `statement:spouse:${SEPARATED}`,
      `statement:child:${CHILD}`,
    ]);
    expect(statementsNeeded(s5, STATEMENT_DATE)).toEqual([
      'you',
      'Mary Wanjiru Kennedy',
      'Grace Achieng',
      'Tom Kamau',
    ]);
  });

  it('knows a card nobody has filled in yet', () => {
    expect(isBlankPerson({ id: SPOUSE, separated: false })).toBe(true);
    expect(isBlankPerson({ id: CHILD, name: { surname: 'Kamau', firstName: '' } })).toBe(true);
    expect(isBlankPerson({ id: CHILD, name: { surname: 'Kamau', firstName: 'Tom' } })).toBe(false);
  });
});

describe('householdMember', () => {
  const household: Draft<Household> = {
    spouses: { none: false, items: [{ id: SPOUSE, nationalId: '12345678' }] },
    children: { none: false, items: [{ id: CHILD }] },
  };

  it('finds the spouse or child a person key names', () => {
    expect(householdMember(household, `spouse:${SPOUSE}`)).toEqual({
      relation: 'spouse',
      person: { id: SPOUSE, nationalId: '12345678' },
    });
    expect(householdMember(household, `child:${CHILD}`)?.relation).toBe('child');
  });

  it('is null for the officer and for someone not in Household', () => {
    expect(householdMember(household, 'officer')).toBeNull();
    expect(householdMember(household, `spouse:${CHILD}`)).toBeNull();
  });
});
