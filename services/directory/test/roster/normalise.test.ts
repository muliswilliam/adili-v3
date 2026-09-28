import { describe, expect, it } from 'vitest';

import {
  fileNumberKey,
  normaliseEmail,
  normaliseNationalId,
  normalisePhone,
} from '../../src/roster/normalise.js';

/**
 * One normalisation for roster rows and what a declarant types at onboarding, so identify
 * matches what imports stored and supplied contacts look like the roster's.
 */
describe('roster normalisation', () => {
  it('keys file numbers trimmed and case-insensitively, and keeps national ID digits', () => {
    expect(fileNumberKey('  TSC/100200 ')).toBe('tsc/100200');
    expect(normaliseNationalId('1234 5678')).toBe('12345678');
  });

  it('trims and lower-cases emails, and refuses invalid ones', () => {
    expect(normaliseEmail('  Jane.Doe@MOE.go.ke ')).toBe('jane.doe@moe.go.ke');
    expect(normaliseEmail('not-an-email')).toBeNull();
    expect(normaliseEmail('jane@')).toBeNull();
    expect(normaliseEmail(`${'a'.repeat(250)}@x.ke`)).toBeNull();
  });

  it('turns Kenyan and international phone numbers into E.164, and refuses invalid ones', () => {
    expect(normalisePhone('0712 345 678')).toBe('+254712345678');
    expect(normalisePhone('+254712345678')).toBe('+254712345678');
    expect(normalisePhone('254712345678')).toBe('+254712345678');
    expect(normalisePhone('0110 345 678')).toBe('+254110345678');
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalisePhone('12')).toBeNull();
    expect(normalisePhone('0712')).toBeNull();
    expect(normalisePhone('+2547123456789012345678')).toBeNull();
  });
});
