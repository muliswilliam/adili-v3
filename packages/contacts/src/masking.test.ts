import { describe, expect, it } from 'vitest';

import { maskContact, maskEmail, maskPhone } from './masking.js';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane.doe@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('j@moe.go.ke')).toBe('j***@moe.go.ke');
  });

  it('leaves an already masked value alone and hides a malformed one', () => {
    expect(maskEmail('j***@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('masks a value that merely contains a star', () => {
    expect(maskEmail('a*b@moe.go.ke')).toBe('a***@moe.go.ke');
    expect(maskEmail('jane*doe.smith@moe.go.ke')).toBe('j***@moe.go.ke');
  });
});

describe('maskPhone', () => {
  it('shows Kenyan numbers in local format with the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('07** *** 678');
    expect(maskPhone('0712 345 678')).toBe('07** *** 678');
  });

  it('normalises 254 without the plus, spaces and dashes', () => {
    expect(maskPhone('254712345678')).toBe('07** *** 678');
    expect(maskPhone('+254 712-345-678')).toBe('07** *** 678');
    expect(maskPhone('0712-345-678')).toBe('07** *** 678');
    expect(maskPhone('+254110345678')).toBe('01** *** 678');
  });

  it('keeps the country code of other international numbers', () => {
    expect(maskPhone('+44 20 7946 0958')).toBe('+44 ** *** 958');
    expect(maskPhone('+442079460958')).toBe('+44 ** *** 958');
    expect(maskPhone('+1 415 555 2671')).toBe('+1 ** *** 671');
    expect(maskPhone('+256 772 123456')).toBe('+256 ** *** 456');
  });

  it('hides every digit of a short value', () => {
    expect(maskPhone('123')).toBe('** *** ***');
    expect(maskPhone('12345678')).toBe('** *** ***');
    expect(maskPhone('+44 1234')).toBe('** *** ***');
  });

  it('leaves an already masked value alone', () => {
    expect(maskPhone('07** *** 678')).toBe('07** *** 678');
    expect(maskPhone('07** *** 123')).toBe('07** *** 123');
    expect(maskPhone('+44 ** *** 958')).toBe('+44 ** *** 958');
    expect(maskPhone('** *** ***')).toBe('** *** ***');
  });

  it('masks a value that merely contains a star', () => {
    expect(maskPhone('0712*345678')).toBe('07** *** 678');
    expect(maskPhone('07*2345678')).toBe('07** *** 678');
    expect(maskPhone('0712345678*')).toBe('07** *** 678');
  });
});

describe('maskContact', () => {
  it("masks by the channel's rule", () => {
    expect(maskContact('phone', '+254712345123')).toBe('07** *** 123');
    expect(maskContact('email', 'wanjiru@tsc.go.ke')).toBe('w***@tsc.go.ke');
  });
});
