import { describe, expect, it } from 'vitest';

import { countdownAnnouncement, formatClock, parseInstant } from './countdown';

const describe_ = (seconds: number) => `${String(seconds)}s`;

describe('countdownAnnouncement', () => {
  it('announces only the coarse steps', () => {
    const heard: string[] = [];
    for (let left = 59; left >= 0; left -= 1) {
      const message = countdownAnnouncement(left + 1, left, describe_);
      if (message) heard.push(message);
    }
    expect(heard).toEqual(['30s', '10s', '0s']);
  });

  it('announces a step a throttled tab skipped past', () => {
    expect(countdownAnnouncement(33, 27, describe_)).toBe('27s');
  });
});

describe('formatClock and parseInstant', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(9)).toBe('0:09');
  });

  it('reads ISO instants and ignores absent or broken ones', () => {
    expect(parseInstant('2026-09-26T10:00:00Z')).toBe(Date.parse('2026-09-26T10:00:00Z'));
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant('soon')).toBeNull();
  });
});
