import { describe, expect, it } from 'vitest';

import { holdsCarriedItems } from './filing.js';

const salary = { type: 'salary-emoluments', description: 'Salary from KEMSA' };
const loan = { type: 'loan', description: 'Sacco loan' };

describe('holdsCarriedItems', () => {
  it('accepts a draft holding the carried items, whatever else the server added', () => {
    const statement = {
      income: [{ ...salary, id: 'x', location: { inKenya: true } }],
      liabilities: [{ ...loan, outstanding: 100 }],
    };
    expect(holdsCarriedItems(statement, { income: [salary], liabilities: [loan] })).toBe(true);
  });

  it('refuses a draft seeded before the salary and loan were carried over (#704)', () => {
    const statement = { incomeNil: false, income: [], liabilitiesNil: true, liabilities: [] };
    expect(holdsCarriedItems(statement, { income: [salary], liabilities: [loan] })).toBe(false);
  });
});
