import { describe, expect, it } from 'vitest';

import { listNames } from './list-names';

describe('listNames', () => {
  it('names one, two or more in a sentence', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['KRA'])).toBe('KRA');
    expect(listNames(['KRA', 'NTSA'])).toBe('KRA and NTSA');
    expect(listNames(['KRA', 'NTSA', 'BRS', 'ArdhiSasa'])).toBe('KRA, NTSA, BRS and ArdhiSasa');
  });
});
