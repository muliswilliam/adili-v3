import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatRelativeDate,
} from './format';

describe('formatFileSize', () => {
  it.each([
    [0, '1 KB'],
    [1, '1 KB'],
    [12_000, '12 KB'],
    [1024 * 1024 - 1, '1,024 KB'],
    [1024 * 1024, '1.0 MB'],
    [4.3 * 1024 * 1024, '4.3 MB'],
    [50 * 1024 * 1024, '50.0 MB'],
    [50 * 1024 * 1024 + 1, '50.1 MB'],
    [63.4 * 1024 * 1024, '63.4 MB'],
  ])('shows %d bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

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
    ['2026-08-28T08:00:00Z', '30 days ago'],
    ['2026-08-20T08:00:00Z', '1 month ago'],
    ['2026-07-27T08:00:00Z', '2 months ago'],
    ['2025-09-20T08:00:00Z', '1 year ago'],
    ['2023-09-20T08:00:00Z', '3 years ago'],
  ])('describes %s as %s', (iso, expected) => {
    expect(formatRelativeDate(iso, now)).toBe(expected);
  });

  it('counts calendar days in Kenya, not 24-hour periods', () => {
    // 23:30 on the 26th in Nairobi is yesterday at 08:00 on the 27th.
    expect(formatRelativeDate('2026-09-26T20:30:00Z', now)).toBe('yesterday');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(48312)).toBe('48,312');
  });
});
