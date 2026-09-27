import { describe, expect, it } from 'vitest';

import { formatDateTime } from './format-date-time';

describe('formatDateTime', () => {
  it('prints date and 24-hour time in Kenyan time', () => {
    expect(formatDateTime('2026-09-26T07:42:00Z')).toBe('26 Sep 2026, 10:42');
  });

  it('rolls over to the next day after 21:00 UTC', () => {
    expect(formatDateTime('2026-03-11T21:05:00Z')).toBe('12 Mar 2026, 00:05');
  });
});
