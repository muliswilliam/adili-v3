import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReminderHistory, type ReminderHistoryEntry } from './reminder-history';

const reminders: ReminderHistoryEntry[] = [
  {
    offsetDays: 30,
    scheduledAt: '2027-10-01T09:14:00.000Z',
    sentAt: '2027-10-01T09:14:05.000Z',
    channels: ['sms', 'email'],
    outcome: 'sent',
  },
  {
    offsetDays: 14,
    scheduledAt: '2027-10-17T09:14:00.000Z',
    sentAt: null,
    channels: [],
    outcome: 'skipped-no-contact',
  },
];

describe('ReminderHistory', () => {
  it('lists each reminder with its offset, scheduled and sent date and time, channels and outcome', () => {
    render(<ReminderHistory reminders={reminders} />);

    const table = screen.getByRole('table', { name: 'Reminder history' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['When', 'Scheduled', 'Sent', 'Channels', 'Outcome']);
    const [, sent, skipped] = within(table).getAllByRole('row');
    expect(sent?.textContent).toContain('30 days before');
    expect(sent?.textContent).toContain('1 Oct 2027, 12:14');
    expect(sent?.textContent).toContain('SMS, Email');
    expect(sent?.textContent).toContain('Sent by SMS and email');
    expect(skipped?.textContent).toContain('Skipped: no contact details');
  });

  it('shows skeleton lines while loading, and says when there are none yet', () => {
    const { rerender } = render(<ReminderHistory reminders={null} />);
    expect(screen.getByLabelText('Reminder history').getAttribute('aria-busy')).toBe('true');

    rerender(<ReminderHistory reminders={[]} />);
    expect(screen.getByText('No reminders sent yet.')).toBeTruthy();
  });

  it('shows an error with a retry', () => {
    const retry = vi.fn();
    render(
      <ReminderHistory
        reminders={null}
        error={{ title: 'Reminder history could not be loaded', detail: 'Try again later.' }}
        onRetry={retry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Reminder history could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows a warning without a retry when the error cannot be retried', () => {
    render(
      <ReminderHistory reminders={null} error={{ title: 'Gone', tone: 'warning', retry: false }} />,
    );

    expect(screen.getByText('Gone')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
