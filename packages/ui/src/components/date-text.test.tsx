import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DateText, duePhrase } from './date-text';

// 26 Sep 2026, 15:00 in Nairobi.
const now = Date.parse('2026-09-26T12:00:00Z');

describe('duePhrase', () => {
  it('says how many days are left, today, or how many days overdue', () => {
    expect(duePhrase(12)).toBe('Due in 12 days');
    expect(duePhrase(1)).toBe('Due in 1 day');
    expect(duePhrase(0)).toBe('Due today');
    expect(duePhrase(-1)).toBe('1 day overdue');
    expect(duePhrase(-3)).toBe('3 days overdue');
  });
});

describe('DateText', () => {
  it('shows the relative phrase, with the absolute date in the title and for screen readers', () => {
    render(<DateText date="2026-10-08" now={now} />);

    const time = screen.getByText('Due in 12 days').closest('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-08');
    expect(time?.getAttribute('title')).toBe('Due 8 Oct 2026');
    expect(time?.textContent).toContain('Due in 12 days (due 8 Oct 2026)');
    expect(time?.getAttribute('data-state')).toBe('due');
  });

  it('marks the due day and overdue dates', () => {
    const { rerender } = render(<DateText date="2026-09-26" now={now} />);
    expect(screen.getByText('Due today').closest('time')?.getAttribute('data-state')).toBe('today');

    rerender(<DateText date="2026-09-23" now={now} />);
    const time = screen.getByText('3 days overdue').closest('time');
    expect(time?.getAttribute('data-state')).toBe('overdue');
    expect(time?.getAttribute('title')).toBe('Due 23 Sep 2026');
  });

  // S22: calendar days, so month ends and the year end do not shift the count.
  it.each([
    ['2026-09-30T09:00:00Z', '2026-10-01', 'Due in 1 day'],
    ['2026-09-30T22:00:00Z', '2026-10-01', 'Due today'],
    ['2026-10-02T09:00:00Z', '2026-09-30', '2 days overdue'],
    ['2027-02-27T09:00:00Z', '2027-03-01', 'Due in 2 days'],
    ['2028-02-27T09:00:00Z', '2028-03-01', 'Due in 3 days'],
    ['2027-12-19T09:00:00Z', '2027-12-31', 'Due in 12 days'],
    ['2026-12-29T09:00:00Z', '2027-01-05', 'Due in 7 days'],
    ['2028-01-03T09:00:00Z', '2027-12-31', '3 days overdue'],
    ['2027-01-01T06:00:00Z', '2026-12-31', '1 day overdue'],
  ])('on %s, due %s reads "%s"', (today, due, phrase) => {
    render(<DateText date={due} now={Date.parse(today)} />);

    screen.getByText(phrase);
  });

  it('shows when an upcoming duty opens, as a long date', () => {
    render(<DateText date="2027-11-01" kind="opens" now={now} />);

    const time = screen.getByText('Opens 1 November 2027').closest('time');
    expect(time?.getAttribute('datetime')).toBe('2027-11-01');
    expect(time?.getAttribute('title')).toBe('Opens 1 Nov 2027');
    expect(time?.getAttribute('data-state')).toBe('upcoming');
  });

  it('takes a label for the title and screen readers', () => {
    render(<DateText date="2026-10-08" label="Filing closes" now={now} />);

    const time = screen.getByText('Due in 12 days').closest('time');
    expect(time?.getAttribute('title')).toBe('Filing closes 8 Oct 2026');
    expect(time?.textContent).toContain('(filing closes 8 Oct 2026)');
  });

  it('moves on a day at Kenyan midnight when left open', () => {
    vi.useFakeTimers();
    try {
      // 23:59:30 on 7 Oct in Nairobi.
      vi.setSystemTime(Date.parse('2026-10-07T20:59:30Z'));
      render(<DateText date="2026-10-08" />);
      screen.getByText('Due in 1 day');

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      screen.getByText('Due today');
    } finally {
      vi.useRealTimers();
    }
  });
});
