import { describe, expect, it } from 'vitest';

import { CONTACT_ERRORS, contactError, contactSchema, normalisePhone } from './contact';

describe('normalisePhone', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['0712-345-678', '+254712345678'],
    ['0110 123 456', '+254110123456'],
    ['254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['(+254) 712 345678', '+254712345678'],
    ['+44 7911 123456', '+447911123456'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    '',
    '0712 345',
    '0812 345 678',
    '+254 812 345 678',
    '712345678',
    '+0 123 4567',
    'phone',
  ])('rejects %s', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe('contactSchema', () => {
  it('sends the phone to the directory in E.164', () => {
    expect(contactSchema.parse({ channel: 'phone', value: '0712 345 678' })).toEqual({
      channel: 'phone',
      value: '+254712345678',
    });
  });

  it('trims an email address and checks its format', () => {
    expect(contactSchema.parse({ channel: 'email', value: ' jane@tsc.go.ke ' }).value).toBe(
      'jane@tsc.go.ke',
    );
    expect(contactError('email', 'jane@')).toBe(CONTACT_ERRORS.email);
    expect(contactError('email', 'jane@tsc.go.ke')).toBeNull();
  });

  it('explains a phone number it cannot use', () => {
    expect(contactError('phone', '12345')).toBe(CONTACT_ERRORS.phone);
    expect(contactError('phone', '0712345678')).toBeNull();
  });
});
