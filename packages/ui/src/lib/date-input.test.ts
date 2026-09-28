import { describe, expect, it } from 'vitest';

import { formatDayMonthYear, parseDayMonthYear, shapeDateText } from './date-input';

describe('parseDayMonthYear', () => {
  it('S19: accepts DD/MM/YYYY and returns an ISO date', () => {
    expect(parseDayMonthYear('26/09/2026')).toBe('2026-09-26');
    expect(parseDayMonthYear('01/01/1970')).toBe('1970-01-01');
  });

  it('accepts single-digit days and months and surrounding space', () => {
    expect(parseDayMonthYear(' 5/9/2026 ')).toBe('2026-09-05');
  });

  it('S19: rejects impossible dates', () => {
    for (const text of ['31/02/2026', '29/02/2025', '00/01/2026', '32/01/2026', '15/13/2026']) {
      expect(parseDayMonthYear(text)).toBeNull();
    }
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseDayMonthYear('29/02/2024')).toBe('2024-02-29');
    expect(parseDayMonthYear('29/02/2000')).toBe('2000-02-29');
    expect(parseDayMonthYear('29/02/1900')).toBeNull();
  });

  it('rejects other formats and partial text', () => {
    for (const text of [
      '',
      '2026-09-26',
      '26-09-2026',
      '26/09/26',
      '26/09',
      'soon',
      '26/09/20260',
    ]) {
      expect(parseDayMonthYear(text)).toBeNull();
    }
  });
});

describe('formatDayMonthYear', () => {
  it('prints an ISO date as DD/MM/YYYY', () => {
    expect(formatDayMonthYear('2026-09-05')).toBe('05/09/2026');
  });

  it('round-trips with parseDayMonthYear', () => {
    expect(parseDayMonthYear(formatDayMonthYear('1999-12-31'))).toBe('1999-12-31');
  });
});

describe('shapeDateText', () => {
  it('adds slashes after the day and month as the user types', () => {
    expect(shapeDateText('26', true)).toBe('26/');
    expect(shapeDateText('26/09', true)).toBe('26/09/');
    expect(shapeDateText('26092026', true)).toBe('26/09/2026');
  });

  it('does not re-add a slash the user just deleted', () => {
    expect(shapeDateText('26', false)).toBe('26');
    expect(shapeDateText('26/09', false)).toBe('26/09');
  });

  it('drops other characters and stops at ten', () => {
    expect(shapeDateText('2a6/09/2026x', true)).toBe('26/09/2026');
    expect(shapeDateText('26/09/20261', true)).toBe('26/09/2026');
  });

  it('leaves single-digit parts the user typed with slashes', () => {
    expect(shapeDateText('5/9/2026', true)).toBe('5/9/2026');
  });
});
