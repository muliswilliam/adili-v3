import { describe, expect, it } from 'vitest';

import { formatPhone, normalisePhone } from './phone';

describe('normalisePhone (S20)', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['0712345678', '+254712345678'],
    ['0110 123 456', '+254110123456'],
    ['712345678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['+254-712-345-678', '+254712345678'],
    ['(0712) 345.678', '+254712345678'],
    ['00254712345678', '+254712345678'],
    [' 0712 345 678 ', '+254712345678'],
  ])('normalises Kenyan %s to %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    ['+44 20 7946 0958', '+442079460958'],
    ['0044 20 7946 0958', '+442079460958'],
    ['+1 (202) 555-0147', '+12025550147'],
    ['+256 772 123456', '+256772123456'],
  ])('accepts international %s as %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    ['12345', 'too short'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['071234567', 'one digit short'],
    ['07123456789', 'one digit long'],
    ['0212345678', 'not a mobile prefix'],
    ['+254 712 345 67', 'Kenyan number one digit short'],
    ['+254 712 345 6789', 'Kenyan number one digit long'],
    ['+0712345678', 'country code starting with 0'],
    ['+12345', 'fewer than 7 digits'],
    ['+1234567890123456', 'more than 15 digits'],
    ['0712 ABC 678', 'letters'],
  ])('rejects %s (%s)', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe('formatPhone', () => {
  it('groups Kenyan numbers', () => {
    expect(formatPhone('+254712345678')).toBe('+254 712 345 678');
  });

  it('leaves other numbers as stored', () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});
