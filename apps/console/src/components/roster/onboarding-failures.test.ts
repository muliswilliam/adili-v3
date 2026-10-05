import { describe, expect, it } from 'vitest';

import type { OnboardingFailures } from '../../server/directory/client';
import { failureBreakdown } from './onboarding-failures';

const view: OnboardingFailures = {
  since: '2026-09-30T10:00:00.000Z',
  failedAttempts: 15,
  hours: [
    { windowStart: '2026-09-30T10:00:00.000Z', failedAttempts: 3 },
    { windowStart: '2026-10-01T02:00:00.000Z', failedAttempts: 10 },
    { windowStart: '2026-10-01T09:00:00.000Z', failedAttempts: 2 },
  ],
};

describe('failureBreakdown', () => {
  it('lists the hours with failed attempts, latest first', () => {
    expect(failureBreakdown(view).hours.map((hour) => hour.windowStart)).toEqual([
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T02:00:00.000Z',
      '2026-09-30T10:00:00.000Z',
    ]);
  });

  it('sizes each hour against the busiest one, in whole percent of it', () => {
    expect(failureBreakdown(view).hours.map((hour) => hour.share)).toEqual([20, 100, 30]);
  });

  it('names the busiest hour, the latest of equal ones', () => {
    expect(failureBreakdown(view).peak).toEqual({
      windowStart: '2026-10-01T02:00:00.000Z',
      failedAttempts: 10,
    });
    const tied = failureBreakdown({
      ...view,
      failedAttempts: 8,
      hours: [
        { windowStart: '2026-09-30T10:00:00.000Z', failedAttempts: 4 },
        { windowStart: '2026-10-01T09:00:00.000Z', failedAttempts: 4 },
      ],
    });
    expect(tied.peak?.windowStart).toBe('2026-10-01T09:00:00.000Z');
  });

  it("keeps the directory's total", () => {
    expect(failureBreakdown(view).total).toBe(15);
  });

  it('has no hours and no peak when nothing failed', () => {
    expect(failureBreakdown({ since: view.since, failedAttempts: 0, hours: [] })).toEqual({
      since: view.since,
      total: 0,
      hours: [],
      peak: null,
    });
  });

  it('gives a sliver to an hour far below the peak, so its bar still shows', () => {
    const skewed = failureBreakdown({
      ...view,
      failedAttempts: 1001,
      hours: [
        { windowStart: '2026-09-30T10:00:00.000Z', failedAttempts: 1000 },
        { windowStart: '2026-10-01T09:00:00.000Z', failedAttempts: 1 },
      ],
    });
    expect(skewed.hours.map((hour) => hour.share)).toEqual([1, 100]);
  });
});
