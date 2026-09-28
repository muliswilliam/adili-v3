import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeadlineChip, deadlineStatus } from './deadline-chip';

// 26 Sep 2026, 15:00 in Nairobi.
const now = Date.parse('2026-09-26T12:00:00Z');

describe('deadlineStatus', () => {
  it('counts whole calendar days in Kenyan time', () => {
    expect(deadlineStatus('2026-10-12T09:00:00+03:00', { now })).toEqual({
      state: 'due',
      days: 16,
    });
    // 23:30 on 26 Sep in Nairobi is 20:30 UTC: still today.
    expect(deadlineStatus('2026-09-26T20:30:00Z', { now })).toEqual({ state: 'today', days: 0 });
    // 00:30 on 27 Sep in Nairobi is 21:30 UTC on the 26th: tomorrow.
    expect(deadlineStatus('2026-09-26T21:30:00Z', { now })).toEqual({ state: 'soon', days: 1 });
  });

  it('is due soon within the reminder threshold and late after the day passes', () => {
    expect(deadlineStatus('2026-10-06T09:00:00+03:00', { now, soonDays: 10 })).toEqual({
      state: 'soon',
      days: 10,
    });
    expect(deadlineStatus('2026-10-07T09:00:00+03:00', { now, soonDays: 10 })).toEqual({
      state: 'due',
      days: 11,
    });
    // Earlier today is not late yet.
    expect(deadlineStatus('2026-09-26T09:00:00+03:00', { now })).toEqual({
      state: 'today',
      days: 0,
    });
    expect(deadlineStatus('2026-09-19T09:00:00+03:00', { now })).toEqual({
      state: 'late',
      days: -7,
    });
  });
});

describe('DeadlineChip', () => {
  it('shows the days left and reads the full deadline to screen readers', () => {
    const { container } = render(
      <DeadlineChip due="2026-10-12T09:00:00+03:00" label="Decision due" now={now} />,
    );

    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-12');
    expect(time?.dataset.state).toBe('due');
    expect(time?.getAttribute('title')).toBe('Decision due 12 Oct 2026');
    expect(time?.textContent).toBe('Decision due 12 Oct 2026, 16 days left16 days left');
    expect(screen.getByText('Decision due 12 Oct 2026, 16 days left').className).toContain(
      'sr-only',
    );
    expect(screen.getByText('16 days left').getAttribute('aria-hidden')).toBe('true');
  });

  it('turns due soon at the reminder threshold', () => {
    const { container } = render(
      <DeadlineChip due="2026-09-29T09:00:00+03:00" soonDays={10} now={now} />,
    );

    expect(container.querySelector('time')?.dataset.state).toBe('soon');
    expect(screen.getByText('Due 29 Sep 2026, 3 days left')).toBeDefined();
  });

  it('says a single day in the singular', () => {
    render(<DeadlineChip due="2026-09-27T09:00:00+03:00" now={now} />);

    expect(screen.getByText('1 day left')).toBeDefined();
  });

  it('is due today on the day itself', () => {
    const { container } = render(
      <DeadlineChip
        due="2026-09-26T17:00:00+03:00"
        label="Download until"
        todayText="Ends today"
        now={now}
      />,
    );

    expect(container.querySelector('time')?.dataset.state).toBe('today');
    expect(screen.getByText('Ends today')).toBeDefined();
    expect(screen.getByText('Download until 26 Sep 2026, ends today')).toBeDefined();
  });

  it('counts the days late once the day has passed', () => {
    const { container } = render(
      <DeadlineChip due="2026-09-19T09:00:00+03:00" label="Decision due" now={now} />,
    );

    expect(container.querySelector('time')?.dataset.state).toBe('late');
    expect(screen.getByText('7 days late')).toBeDefined();
    expect(screen.getByText('Decision due 19 Sep 2026, 7 days late')).toBeDefined();
  });

  it('shows when the deadline was met instead of a countdown', () => {
    const { container } = render(
      <DeadlineChip
        due="2026-09-19T09:00:00+03:00"
        label="Decision due"
        met="Decided 18 Sep"
        now={now}
        id="decision-deadline"
      />,
    );

    const time = container.querySelector('time');
    expect(time?.dataset.state).toBe('met');
    expect(time?.id).toBe('decision-deadline');
    expect(time?.getAttribute('datetime')).toBe('2026-09-19');
    expect(screen.getByText('Decided 18 Sep').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Decision due 19 Sep 2026, met: Decided 18 Sep').className).toContain(
      'sr-only',
    );
  });

  it('moves on a day at Kenyan midnight when counting from now', () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-26T20:59:00Z') }); // 23:59 in Nairobi
    try {
      render(<DeadlineChip due="2026-09-28T09:00:00+03:00" />);
      expect(screen.getByText('2 days left')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2 * 60 * 1000);
      });

      expect(screen.getByText('1 day left')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
