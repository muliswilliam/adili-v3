import { describe, expect, it } from 'vitest';

import {
  calendarDaysUntil,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatMonth,
  formatMonthDay,
  msUntilKenyanMidnight,
} from './format-date';

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

describe('msUntilKenyanMidnight', () => {
  it('counts to 00:00 in Nairobi, 21:00 UTC', () => {
    expect(msUntilKenyanMidnight(Date.parse('2026-09-26T20:59:00Z'))).toBe(60_000);
    expect(msUntilKenyanMidnight(Date.parse('2026-09-26T21:00:00Z'))).toBe(86_400_000);
  });
});

describe('formatLongDate', () => {
  it('spells the month out', () => {
    expect(formatLongDate('2027-11-01')).toBe('1 November 2027');
    expect(formatLongDate('2026-09-26T07:42:00Z')).toBe('26 September 2026');
  });

  it('uses Kenyan time', () => {
    expect(formatLongDate('2027-10-31T21:30:00Z')).toBe('1 November 2027');
  });
});

describe('calendarDaysUntil', () => {
  // 26 Sep 2026, 15:00 in Nairobi.
  const now = Date.parse('2026-09-26T12:00:00Z');

  it('counts whole calendar days, ignoring the time of day', () => {
    expect(calendarDaysUntil('2026-10-08', now)).toBe(12);
    expect(calendarDaysUntil('2026-09-26', now)).toBe(0);
    expect(calendarDaysUntil('2026-09-23', now)).toBe(-3);
    // 23:30 today in Nairobi is still today; 00:30 tomorrow is one day away.
    expect(calendarDaysUntil('2026-09-26T20:30:00Z', now)).toBe(0);
    expect(calendarDaysUntil('2026-09-26T21:30:00Z', now)).toBe(1);
  });

  it('counts in Kenyan time: 01:00 on 1 Oct in Nairobi is still 30 Sep in UTC', () => {
    expect(calendarDaysUntil('2026-10-01', Date.parse('2026-09-30T22:00:00Z'))).toBe(0);
  });

  it('is correct across month ends, leap days and the year end', () => {
    expect(calendarDaysUntil('2027-03-01', Date.parse('2027-02-28T09:00:00Z'))).toBe(1);
    expect(calendarDaysUntil('2028-03-01', Date.parse('2028-02-28T09:00:00Z'))).toBe(2);
    expect(calendarDaysUntil('2027-01-05', Date.parse('2026-12-29T09:00:00Z'))).toBe(7);
    expect(calendarDaysUntil('2027-12-31', Date.parse('2028-01-03T09:00:00Z'))).toBe(-3);
  });
});

describe('formatMonthDay', () => {
  it('reads a policy month-day as a short date', () => {
    expect(formatMonthDay('11-01')).toBe('1 Nov');
    expect(formatMonthDay('12-31')).toBe('31 Dec');
    expect(formatMonthDay('02-29')).toBe('29 Feb');
  });

  it('leaves anything that is not a month-day as it is', () => {
    expect(formatMonthDay('nonsense')).toBe('nonsense');
    expect(formatMonthDay('13-01')).toBe('13-01');
    expect(formatMonthDay('02-30')).toBe('02-30');
  });
});
