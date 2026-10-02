import { describe, expect, it } from 'vitest';

import { ageOn, blank, fullName } from './format';

describe('declaration format helpers', () => {
  it('treats missing and whitespace-only text as blank', () => {
    expect(blank(undefined)).toBe(true);
    expect(blank('  ')).toBe(true);
    expect(blank(' a ')).toBe(false);
  });

  it('joins the parts of a name that are given', () => {
    expect(fullName({ surname: 'Kennedy', firstName: 'Mary', otherNames: 'Wanjiru' })).toBe(
      'Mary Wanjiru Kennedy',
    );
    expect(fullName({ surname: ' ', firstName: 'Mary' })).toBe('Mary');
    expect(fullName(undefined)).toBe('');
  });

  it('counts whole years up to a date', () => {
    expect(ageOn('2009-11-01', '2027-11-01')).toBe(18);
    expect(ageOn('2009-11-02', '2027-11-01')).toBe(17);
  });
});
