import { describe, expect, it } from 'vitest';

import { maskContact, maskEmail, maskPhone } from '../../src/onboarding/masking.js';

/** The portal's vectors (packages/ui masked-contact.test.tsx): both sides mask alike. */
describe('contact masking', () => {
  it('masks emails to their first character and domain', () => {
    expect(maskEmail('jane.doe@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('j@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('j***@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('a*b@moe.go.ke')).toBe('a***@moe.go.ke');
  });

  it('masks Kenyan numbers in the local format, keeping the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('07** *** 678');
    expect(maskPhone('0712 345 678')).toBe('07** *** 678');
    expect(maskPhone('254712345678')).toBe('07** *** 678');
    expect(maskPhone('+254110345678')).toBe('01** *** 678');
  });

  it('keeps the country code of other numbers and hides short ones entirely', () => {
    expect(maskPhone('+44 20 7946 0958')).toBe('+44 ** *** 958');
    expect(maskPhone('+1 415 555 2671')).toBe('+1 ** *** 671');
    expect(maskPhone('+256 772 123456')).toBe('+256 ** *** 456');
    expect(maskPhone('12345678')).toBe('** *** ***');
  });

  it('never passes a value through unless it is exactly a masked shape', () => {
    expect(maskPhone('07** *** 678')).toBe('07** *** 678');
    expect(maskPhone('0712*345678')).toBe('07** *** 678');
    expect(maskContact('phone', '+254712345123')).toBe('07** *** 123');
    expect(maskContact('email', 'wanjiru@tsc.go.ke')).toBe('w***@tsc.go.ke');
  });
});
