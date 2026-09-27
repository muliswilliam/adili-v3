import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatRelativeDate } from './format';

describe('formatDateTime', () => {
  it('shows Kenyan time with a 24-hour clock', () => {
    expect(formatDateTime('2026-09-21T09:40:00Z')).toBe('21 Sep 2026, 12:40');
  });
});

describe('formatDate', () => {
  it('uses the Kenyan calendar day', () => {
    expect(formatDate('2026-09-21T22:30:00Z')).toBe('22 Sep 2026');
  });
});

describe('formatRelativeDate', () => {
  const now = new Date('2026-09-27T08:00:00Z');

  it.each([
    ['2026-09-27T01:00:00Z', 'today'],
    ['2026-09-26T08:00:00Z', 'yesterday'],
    ['2026-09-22T08:00:00Z', '5 days ago'],
    ['2026-07-27T08:00:00Z', '2 months ago'],
    ['2025-09-20T08:00:00Z', 'last year'],
    ['2023-09-20T08:00:00Z', '3 years ago'],
  ])('describes %s as %s', (iso, expected) => {
    expect(formatRelativeDate(iso, now)).toBe(expected);
  });

  it('counts calendar days in Kenya, not 24-hour periods', () => {
    // 23:30 on the 26th in Nairobi is yesterday at 08:00 on the 27th.
    expect(formatRelativeDate('2026-09-26T20:30:00Z', now)).toBe('yesterday');
  });
});
