import { describe, expect, it } from 'vitest';

import { addMonths } from '../../src/cases/case-creation.js';

describe('the clarification window', () => {
  it('ends the given number of calendar months after receipt', () => {
    expect(addMonths(new Date('2027-12-15T09:30:00Z'), 6).toISOString()).toBe(
      '2028-06-15T09:30:00.000Z',
    );
  });

  it('ends on the last day of a shorter month', () => {
    expect(addMonths(new Date('2027-08-31T10:00:00Z'), 6).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });
});
