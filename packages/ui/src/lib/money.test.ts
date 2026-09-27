import { describe, expect, it } from 'vitest';

import { formatMoney, parseMoney, shapeMoneyText } from './money';

describe('parseMoney', () => {
  it('S19: parses 1,250,000.50 to 125000050 cents', () => {
    expect(parseMoney('1,250,000.50')).toEqual({ status: 'valid', cents: 125000050 });
  });

  it('S19: rejects negatives', () => {
    expect(parseMoney('-1,250')).toEqual({ status: 'invalid', reason: 'negative' });
    expect(parseMoney('- 5')).toEqual({ status: 'invalid', reason: 'negative' });
  });

  it('reads whole shillings and one decimal place', () => {
    expect(parseMoney('1250000')).toEqual({ status: 'valid', cents: 125000000 });
    expect(parseMoney('12.5')).toEqual({ status: 'valid', cents: 1250 });
    expect(parseMoney('0.05')).toEqual({ status: 'valid', cents: 5 });
    expect(parseMoney('7.')).toEqual({ status: 'valid', cents: 700 });
  });

  it('ignores surrounding space and a KES prefix', () => {
    expect(parseMoney('  KES 3,000 ')).toEqual({ status: 'valid', cents: 300000 });
  });

  it('treats blank text as empty, not zero', () => {
    expect(parseMoney('')).toEqual({ status: 'empty' });
    expect(parseMoney('   ')).toEqual({ status: 'empty' });
  });

  it('rejects more than two decimals, stray characters and misplaced separators', () => {
    for (const text of ['1.234', '12a', '1,25,0', '1.2.3', '.', ',100', 'KES']) {
      expect(parseMoney(text)).toEqual({ status: 'invalid', reason: 'format' });
    }
  });

  it('rejects amounts too large to store exactly', () => {
    expect(parseMoney('999,999,999,999,999,999')).toEqual({
      status: 'invalid',
      reason: 'too-large',
    });
  });
});

describe('formatMoney', () => {
  it('groups thousands and shows cents only when there are some', () => {
    expect(formatMoney(125000050)).toBe('1,250,000.50');
    expect(formatMoney(125000000)).toBe('1,250,000');
    expect(formatMoney(5)).toBe('0.05');
    expect(formatMoney(0)).toBe('0');
  });

  it('can always show cents and prefix a currency', () => {
    expect(formatMoney(125000000, { currency: 'KES', alwaysShowCents: true })).toBe(
      'KES 1,250,000.00',
    );
    expect(formatMoney(99, { currency: 'KES' })).toBe('KES 0.99');
  });

  it('round-trips with parseMoney', () => {
    for (const cents of [0, 1, 10, 99, 100, 123456789, 125000050]) {
      expect(parseMoney(formatMoney(cents))).toEqual({ status: 'valid', cents });
    }
  });
});

describe('shapeMoneyText', () => {
  it('adds thousands separators as the user types', () => {
    expect(shapeMoneyText('1250000')).toBe('1,250,000');
    expect(shapeMoneyText('1250000.5')).toBe('1,250,000.5');
    expect(shapeMoneyText('1,2500')).toBe('12,500');
  });

  it('keeps a leading minus so a negative can be refused, and drops other characters', () => {
    expect(shapeMoneyText('-1250')).toBe('-1,250');
    expect(shapeMoneyText(' - 12-50')).toBe('-1,250');
    expect(shapeMoneyText('-')).toBe('-');
    expect(shapeMoneyText('KES 12a3')).toBe('123');
  });

  it('keeps at most two decimals and one point', () => {
    expect(shapeMoneyText('12.345')).toBe('12.34');
    expect(shapeMoneyText('1.2.3')).toBe('1.23');
  });

  it('drops leading zeros but keeps a zero before the point', () => {
    expect(shapeMoneyText('007')).toBe('7');
    expect(shapeMoneyText('.5')).toBe('0.5');
    expect(shapeMoneyText('0')).toBe('0');
    expect(shapeMoneyText('')).toBe('');
  });
});
