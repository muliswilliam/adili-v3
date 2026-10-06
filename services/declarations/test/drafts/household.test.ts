import { describe, expect, it } from 'vitest';

import {
  carriedHousehold,
  duplicatePeople,
  householdPeople,
  planStatements,
} from '../../src/drafts/household.js';

const SPOUSE = '0192f1a0-5a11-7000-8000-000000000101';
const CHILD = '0192f1a0-5a11-7000-8000-000000000201';
const ADULT = '0192f1a0-5a11-7000-8000-000000000202';
const name = { surname: 'Otieno', firstName: 'Grace' };

describe('householdPeople', () => {
  it('derives inclusion from the date of birth, ignoring what the client sent', () => {
    const people = householdPeople(
      {
        spouses: { none: false, items: [{ id: SPOUSE, name, separated: true }] },
        children: {
          none: false,
          items: [
            { id: CHILD, name, dateOfBirth: '2009-11-02', includedAtStatementDate: false },
            { id: ADULT, name, dateOfBirth: '2009-11-01', includedAtStatementDate: true },
          ],
        },
      },
      '2027-11-01',
    );

    expect(people.statements.map((p) => p.personKey)).toEqual([
      `spouse:${SPOUSE}`,
      `child:${CHILD}`,
    ]);
    expect(people.notIncluded).toEqual([
      { personKey: `child:${ADULT}`, reason: 'over-18-at-statement-date' },
    ]);
    const children = (people.contents.children as { items: Record<string, unknown>[] }).items;
    expect(children.map((c) => c.includedAtStatementDate)).toEqual([true, false]);
  });

  it('sets up no statement for a person with no id or a child with no date of birth yet', () => {
    const people = householdPeople(
      {
        spouses: { none: false, items: [{ name, separated: false }] },
        children: { none: false, items: [{ id: CHILD, name, includedAtStatementDate: true }] },
      },
      '2027-11-01',
    );

    expect(people.statements).toEqual([]);
    expect(people.notIncluded).toEqual([]);
    const [undated] = (people.contents.children as { items: Record<string, unknown>[] }).items;
    expect(undated).not.toHaveProperty('includedAtStatementDate');
  });

  it('keys statements by lower-case ids', () => {
    const people = householdPeople(
      { spouses: { none: false, items: [{ id: SPOUSE.toUpperCase(), name, separated: false }] } },
      '2027-11-01',
    );

    expect(people.statements[0]?.personKey).toBe(`spouse:${SPOUSE}`);
    expect(people.contents).not.toHaveProperty('children');
  });
});

describe('duplicatePeople', () => {
  it('reports a person listed twice', () => {
    expect(
      duplicatePeople({
        spouses: { items: [{ id: SPOUSE }, { id: SPOUSE }] },
        children: { items: [{ id: CHILD }] },
      }),
    ).toEqual([{ path: 'spouses.items.1.id', message: 'Listed twice' }]);
  });
});

describe('planStatements', () => {
  it("creates, keeps, restores and archives; never the declarant's own", () => {
    const plan = planStatements(
      [
        { personKey: `spouse:${SPOUSE}`, personName: name },
        { personKey: `child:${CHILD}`, personName: name },
        { personKey: `child:${ADULT}`, personName: name },
      ],
      [
        { personKey: 'officer', archived: false },
        { personKey: `child:${CHILD}`, archived: false },
        { personKey: `child:${ADULT}`, archived: true },
        { personKey: 'spouse:0192f1a0-5a11-7000-8000-000000000999', archived: false },
        { personKey: 'spouse:0192f1a0-5a11-7000-8000-000000000998', archived: true },
      ],
    );

    expect(plan.create.map((p) => p.personKey)).toEqual([`spouse:${SPOUSE}`]);
    expect(plan.keep.map((p) => p.personKey)).toEqual([`child:${CHILD}`]);
    expect(plan.restore.map((p) => p.personKey)).toEqual([`child:${ADULT}`]);
    expect(plan.archive).toEqual(['spouse:0192f1a0-5a11-7000-8000-000000000999']);
  });
});

describe('carriedHousehold', () => {
  it('offers the people last declared under their ids, without the none answers', () => {
    const spouse = { id: SPOUSE.toUpperCase(), name, separated: false, kraPin: 'A123456789B' };
    const child = { id: CHILD, name, dateOfBirth: '2009-11-02', includedAtStatementDate: true };

    expect(
      carriedHousehold({
        spouses: { none: false, items: [spouse] },
        children: { none: false, items: [child] },
      }),
    ).toEqual({
      spouses: { none: false, items: [{ ...spouse, id: SPOUSE }] },
      children: { none: false, items: [child] },
    });
  });

  it('carries one list without the other, the other left unanswered', () => {
    expect(
      carriedHousehold({
        spouses: { none: true, items: [] },
        children: { none: false, items: [{ id: CHILD, name, dateOfBirth: '2009-11-02' }] },
      }),
    ).toMatchObject({ spouses: { none: false, items: [] } });
  });

  it('carries nothing from a household that listed nobody', () => {
    expect(
      carriedHousehold({ spouses: { none: true, items: [] }, children: { none: true, items: [] } }),
    ).toBeNull();
    expect(carriedHousehold({})).toBeNull();
  });
});
