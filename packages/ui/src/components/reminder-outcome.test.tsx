import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReminderOutcomeText } from './reminder-outcome';

describe('ReminderOutcomeText', () => {
  it('says how a sent reminder went, with a green tick', () => {
    render(<ReminderOutcomeText outcome="sent" channels={['sms', 'email']} />);

    const text = screen.getByText('Sent by SMS and email');
    const icon = text.parentElement?.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('text-success');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks a failure red and a skip muted', () => {
    render(
      <>
        <ReminderOutcomeText outcome="failed" channels={['sms']} />
        <ReminderOutcomeText outcome="skipped-no-contact" channels={[]} />
      </>,
    );

    expect(
      screen.getByText('Failed').parentElement?.querySelector('svg')?.getAttribute('class'),
    ).toContain('text-destructive');
    expect(
      screen
        .getByText('Skipped: no contact details')
        .parentElement?.querySelector('svg')
        ?.getAttribute('class'),
    ).toContain('text-muted-foreground');
  });
});
