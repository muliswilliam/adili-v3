import { describe, expect, it } from 'vitest';

import { formatDate } from './format-date';

describe('formatDate', () => {
  it('prints day, short month and year', () => {
    expect(formatDate('2026-09-26T07:42:00Z')).toBe('26 Sep 2026');
  });

  it('uses Kenyan time, so a late-evening UTC time is already the next day', () => {
    expect(formatDate('2026-03-11T22:30:00Z')).toBe('12 Mar 2026');
  });
});
