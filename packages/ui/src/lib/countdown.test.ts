import { describe, expect, it } from 'vitest';

import { countdownAnnouncement, formatClock, secondsUntil } from './countdown';

const describe_ = (seconds: number) => `${String(seconds)}s`;

describe('countdownAnnouncement', () => {
  it('stays silent between the coarse steps', () => {
    const heard: string[] = [];
    for (let left = 59; left >= 0; left -= 1) {
      const message = countdownAnnouncement(left + 1, left, describe_);
      if (message) heard.push(message);
    }
    expect(heard).toEqual(['30s', '10s', '0s']);
  });

  it('announces a step that a throttled tab skipped past', () => {
    expect(countdownAnnouncement(33, 27, describe_)).toBe('27s');
    expect(countdownAnnouncement(2, 0, describe_)).toBe('0s');
  });

  it('says nothing when a countdown starts or restarts', () => {
    expect(countdownAnnouncement(0, 60, describe_)).toBeNull();
    expect(countdownAnnouncement(0, 0, describe_)).toBeNull();
  });
});

describe('formatClock and secondsUntil', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(9)).toBe('0:09');
  });

  it('counts whole seconds to a time, never below zero', () => {
    const now = Date.parse('2026-09-26T10:00:00Z');
    expect(secondsUntil('2026-09-26T10:00:59.200Z', now)).toBe(60);
    expect(secondsUntil('2026-09-26T09:59:00Z', now)).toBe(0);
  });

  it('reads an absent or unreadable time as no wait', () => {
    expect(secondsUntil(null)).toBe(0);
    expect(secondsUntil(undefined)).toBe(0);
    expect(secondsUntil('soon')).toBe(0);
  });
});
