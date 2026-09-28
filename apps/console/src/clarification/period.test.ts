import { describe, expect, it } from 'vitest';

import { lateDays, reminderAt, reminderSent } from './period';

describe('reminderAt', () => {
  it('is day 20 after issue', () => {
    expect(reminderAt('2026-09-01T09:00:00Z')).toBe('2026-09-21T09:00:00.000Z');
  });
});

describe('reminderSent', () => {
  it('has gone from day 20 when there is no response', () => {
    expect(reminderSent('2026-09-01T08:00:00Z', null, '2026-09-20T08:00:00Z')).toBe(false);
    expect(reminderSent('2026-09-01T08:00:00Z', null, '2026-09-21T08:00:00Z')).toBe(true);
  });

  it('never went when the declarant responded before day 20', () => {
    expect(
      reminderSent('2026-09-01T08:00:00Z', '2026-09-05T08:00:00Z', '2026-09-28T08:00:00Z'),
    ).toBe(false);
    expect(
      reminderSent('2026-09-01T08:00:00Z', '2026-09-25T08:00:00Z', '2026-09-28T08:00:00Z'),
    ).toBe(true);
  });
});

describe('lateDays', () => {
  it('counts the days after the due date, at least one', () => {
    expect(lateDays('2026-09-01T20:59:00Z', '2026-09-04T08:00:00Z')).toBe(3);
    expect(lateDays('2026-09-01T20:59:00Z', '2026-09-01T21:30:00Z')).toBe(1);
  });
});
