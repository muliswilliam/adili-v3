import { describe, expect, it } from 'vitest';

import { countryName, countyName } from './places';

describe('places', () => {
  it('names counties and countries from their codes, and keeps a code it does not know', () => {
    expect(countyName('022')).toBe('Kiambu');
    expect(countyName('047')).toBe('Nairobi City');
    expect(countyName('099')).toBe('099');
    expect(countryName('UG')).toBe('Uganda');
    expect(countryName('ZZ')).toBe('ZZ');
  });
});
