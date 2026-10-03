import { describe, expect, it } from 'vitest';

import { type Decision, decisionStands } from '../../src/suggestions/decided.js';

const CAR_ID = '0192f1a0-5a11-7000-8000-00000000d001';
const SPOUSE_ID = '0192f1a0-5a11-7000-8000-00000000d002';
const DIRECTORSHIP_ID = '0192f1a0-5a11-7000-8000-00000000d003';
const SALARY_ID = '0192f1a0-5a11-7000-8000-00000000d004';

const fielder: Decision = {
  itemType: 'vehicle',
  sectionKey: 'statement:officer',
  status: 'accepted',
  acceptedItemId: CAR_ID,
  matchKeys: ['registration:KCA123A'],
};

function statement(assets: unknown[] = [], income: unknown[] = []) {
  return { assets, income, liabilities: [] };
}

const car = (registration: string) => ({
  id: CAR_ID,
  type: 'vehicle',
  details: { registration },
});

describe('whether a decision stands when the registry is checked again', () => {
  it('keeps every dismissal, whatever the draft holds', () => {
    expect(
      decisionStands({ ...fielder, status: 'dismissed', acceptedItemId: null }, undefined),
    ).toBe(true);
  });

  it('keeps an acceptance while its item holds the identifier, however written', () => {
    expect(decisionStands(fielder, statement([car('kca-123a')]))).toBe(true);
  });

  it.each([
    ['the item was deleted', statement([])],
    ['its section is gone', undefined],
    ['the registration was changed', statement([car('KDA 456X')])],
    ['the registration was cleared', statement([car('')])],
  ])('lets an acceptance go when %s', (_, section) => {
    expect(decisionStands(fielder, section)).toBe(false);
  });

  it("keeps a spouse's KRA PIN while Household still gives it, and lets it go once cleared", () => {
    const pin: Decision = {
      itemType: 'bio-tax',
      sectionKey: 'household',
      status: 'accepted',
      acceptedItemId: SPOUSE_ID,
      matchKeys: ['kra-pin:A005231876K'],
    };
    const household = (spouse: Record<string, unknown>) => ({
      spouses: { none: false, items: [{ id: SPOUSE_ID, ...spouse }] },
    });

    expect(decisionStands(pin, household({ kraPin: 'A005231876K' }))).toBe(true);
    expect(decisionStands(pin, household({}))).toBe(false);
    expect(decisionStands(pin, { spouses: { none: true, items: [] } })).toBe(false);
  });

  it('keeps a directorship while paragraph 9 still names the company', () => {
    const directorship: Decision = {
      itemType: 'directorship',
      sectionKey: 'other',
      status: 'accepted',
      acceptedItemId: DIRECTORSHIP_ID,
      matchKeys: ['company-number:CPR200912345', 'company-name:KIMUMUTRANSPORTERSLTD'],
    };
    const other = (company: string) => ({
      registrableInterests: { directorships: [{ id: DIRECTORSHIP_ID, company, role: 'Director' }] },
    });

    expect(decisionStands(directorship, other('Kimumu Transporters Limited'))).toBe(true);
    expect(decisionStands(directorship, other('Rift Valley Agrovet Ltd'))).toBe(false);
  });

  it('keeps an income hint, which has no identifier, while its salary item is there', () => {
    const hint: Decision = {
      itemType: 'income-hint',
      sectionKey: 'statement:officer',
      status: 'accepted',
      acceptedItemId: SALARY_ID,
      matchKeys: [],
    };
    const salary = { id: SALARY_ID, type: 'salary-emoluments', description: 'Salary' };

    expect(decisionStands(hint, statement([], [salary]))).toBe(true);
    expect(decisionStands(hint, statement())).toBe(false);
  });
});
