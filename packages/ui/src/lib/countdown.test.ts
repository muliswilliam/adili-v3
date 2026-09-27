import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  countdownAnnouncement,
  formatClock,
  secondsUntil,
  useCountdownAnnouncement,
} from './countdown';

const describe_ = (seconds: number) => `${String(seconds)}s`;

describe('countdownAnnouncement', () => {
  it('announces every 10-second step and stays silent in between', () => {
    const heard: string[] = [];
    for (let left = 119; left >= 0; left -= 1) {
      const message = countdownAnnouncement(left + 1, left, describe_);
      if (message) heard.push(message);
    }
    expect(heard).toEqual([
      '110s',
      '100s',
      '90s',
      '80s',
      '70s',
      '60s',
      '50s',
      '40s',
      '30s',
      '20s',
      '10s',
      '0s',
    ]);
  });

  it('announces a step that a throttled tab skipped past', () => {
    expect(countdownAnnouncement(33, 27, describe_)).toBe('27s');
    expect(countdownAnnouncement(2, 0, describe_)).toBe('0s');
    expect(countdownAnnouncement(48, 41, describe_)).toBeNull();
  });

  it('says nothing when a countdown starts or restarts', () => {
    expect(countdownAnnouncement(0, 60, describe_)).toBeNull();
    expect(countdownAnnouncement(0, 0, describe_)).toBeNull();
  });
});

describe('useCountdownAnnouncement', () => {
  it('announces at 10-second steps and clears when a new countdown starts', () => {
    const { result, rerender } = renderHook(
      ({ seconds }) => useCountdownAnnouncement(seconds, describe_),
      { initialProps: { seconds: 21 } },
    );
    expect(result.current).toBe('');

    rerender({ seconds: 20 });
    expect(result.current).toBe('20s');
    rerender({ seconds: 19 });
    expect(result.current).toBe('20s');

    rerender({ seconds: 60 });
    expect(result.current).toBe('');
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
