import { describe, expect, it } from 'vitest';

import { formatCalendarDate, formatDate, formatDateTime, formatMonth } from './format-date';

describe('formatDate', () => {
  it('prints day, short month and year', () => {
    expect(formatDate('2026-09-26T07:42:00Z')).toBe('26 Sep 2026');
  });

  it('uses Kenyan time, so a late-evening UTC time is already the next day', () => {
    expect(formatDate('2026-03-11T22:30:00Z')).toBe('12 Mar 2026');
  });
});

describe('formatDateTime', () => {
  it('prints date and 24-hour time in Kenyan time', () => {
    expect(formatDateTime('2026-09-26T07:42:00Z')).toBe('26 Sep 2026, 10:42');
  });

  it('rolls over to the next day after 21:00 UTC', () => {
    expect(formatDateTime('2026-03-11T21:05:00Z')).toBe('12 Mar 2026, 00:05');
  });
});

describe('formatCalendarDate', () => {
  it('prints the ISO calendar date in Kenyan time', () => {
    expect(formatCalendarDate('2026-09-26T07:42:00Z')).toBe('2026-09-26');
    expect(formatCalendarDate('2026-03-11T21:05:00Z')).toBe('2026-03-12');
  });

  it('takes epoch milliseconds', () => {
    expect(formatCalendarDate(Date.parse('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('formatMonth', () => {
  it('prints the full month and year in Kenyan time', () => {
    expect(formatMonth('2026-09-26T07:42:00Z')).toBe('September 2026');
    expect(formatMonth('2026-08-31T21:30:00Z')).toBe('September 2026');
  });
});
