import { describe, expect, it } from 'vitest';

import { foreignNumbers, numbersIn } from './numbers.js';

describe('numbersIn', () => {
  it('reads thousands separators, decimals, percentages and scale words', () => {
    expect(numbersIn('KES 18,000,000 and 43% and 2.5 times')).toEqual([18_000_000, 43, 2.5]);
    expect(numbersIn('KES 1.29 million, USD 10k, 2 bn')).toEqual([1_290_000, 10_000, 2e9]);
  });

  it('reads Swahili scale words, which come before the number', () => {
    expect(numbersIn('shilingi milioni 18 na bilioni 1.5')).toEqual([18_000_000, 1.5e9]);
  });

  it('reads date parts as separate numbers', () => {
    expect(numbersIn('filed on 2025-12-31')).toEqual([2025, 12, 31]);
  });
});

describe('foreignNumbers', () => {
  const input = {
    document: {
      statementDate: '2025-12-31',
      assets: [
        { description: 'Plot with two flats', value: { kesCents: 1_800_000_000 } },
        {
          description: 'Savings',
          value: { kesCents: 129_000_000, original: { minorUnits: 1_000_000 } },
        },
      ],
      note: 'Repaid KES 500,000 of the principal.',
    },
    flags: [{ id: '0192f1a0-5a11-7000-8000-000000000101', evidence: { changePercent: 43 } }],
  };

  it('accepts amounts in shillings from cents, in any written form', () => {
    expect(foreignNumbers('The plot is valued at KES 18,000,000.', input)).toEqual([]);
    expect(foreignNumbers('The plot is valued at KES 18 million.', input)).toEqual([]);
    expect(foreignNumbers('Savings of KES 1.29 million (USD 10,000).', input)).toEqual([]);
  });

  it('accepts numbers quoted in input text, percentages and date parts', () => {
    expect(foreignNumbers('Repaid 500,000; value up 43% by 31 December 2025.', input)).toEqual([]);
  });

  it('accepts small counts and the legal references', () => {
    expect(
      foreignNumbers('Two items, 3 flags, s.35 and s.31(4) of the Act 2025; 25%; 100%.', input),
    ).toEqual([]);
  });

  it('rejects rounded, derived and invented amounts', () => {
    expect(foreignNumbers('Assets of about KES 20 million.', input)).toEqual(['20 million']);
    expect(foreignNumbers('An increase of KES 3,900,000.', input)).toEqual(['3,900,000']);
    expect(foreignNumbers('A rise of 44%.', input)).toEqual(['44%']);
  });

  it('ignores digits inside ids', () => {
    expect(foreignNumbers('Flag 101 applies.', input)).toEqual(['101']);
  });
});
