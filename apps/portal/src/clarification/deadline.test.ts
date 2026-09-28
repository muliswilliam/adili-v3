import { describe, expect, it } from 'vitest';

import { countdown, daysBetween, isOpen, lateDays, reminderSent } from './deadline';

describe('daysBetween', () => {
  it('counts calendar days in Kenyan time, not 24-hour spans', () => {
    // 23:30 and 00:30 the next day in Nairobi are one day apart though an hour passed.
    expect(daysBetween('2026-09-27T20:30:00Z', '2026-09-27T21:30:00Z')).toBe(1);
    expect(daysBetween('2026-09-01T06:00:00Z', '2026-09-01T18:00:00Z')).toBe(0);
    expect(daysBetween('2026-09-01T06:00:00Z', '2026-10-01T06:00:00Z')).toBe(30);
    expect(daysBetween('2026-10-01T06:00:00Z', '2026-09-28T06:00:00Z')).toBe(-3);
  });
});

describe('countdown', () => {
  const due = '2026-10-10T20:59:00Z';

  it('says how many days are left, warning from ten', () => {
    expect(countdown(due, '2026-09-28T09:00:00Z')).toEqual({
      text: 'Respond within 12 days',
      tone: 'neutral',
      overdue: false,
    });
    expect(countdown(due, '2026-10-02T09:00:00Z')).toEqual({
      text: 'Respond within 8 days',
      tone: 'warning',
      overdue: false,
    });
    expect(countdown(due, '2026-10-09T09:00:00Z').text).toBe('Respond within 1 day');
  });

  it('says today on the due date and overdue after it', () => {
    expect(countdown(due, '2026-10-10T09:00:00Z')).toEqual({
      text: 'Respond by today',
      tone: 'danger',
      overdue: false,
    });
    expect(countdown(due, '2026-10-13T09:00:00Z')).toEqual({
      text: 'Overdue by 3 days',
      tone: 'danger',
      overdue: true,
    });
  });
});

describe('lateDays', () => {
  it('counts the days after the due date, at least one', () => {
    expect(lateDays('2026-09-01T20:59:00Z', '2026-09-04T08:00:00Z')).toBe(3);
    expect(lateDays('2026-09-01T20:59:00Z', '2026-09-01T21:30:00Z')).toBe(1);
  });
});

describe('reminderSent', () => {
  it('is true from day 20 after issue', () => {
    expect(reminderSent('2026-09-01T08:00:00Z', '2026-09-20T08:00:00Z')).toBe(false);
    expect(reminderSent('2026-09-01T08:00:00Z', '2026-09-21T08:00:00Z')).toBe(true);
  });
});

describe('isOpen', () => {
  it('is open while issued or overdue', () => {
    expect(isOpen('issued')).toBe(true);
    expect(isOpen('overdue')).toBe(true);
    expect(isOpen('responded')).toBe(false);
    expect(isOpen('resolved')).toBe(false);
    expect(isOpen('withdrawn')).toBe(false);
    expect(isOpen('draft')).toBe(false);
  });
});
