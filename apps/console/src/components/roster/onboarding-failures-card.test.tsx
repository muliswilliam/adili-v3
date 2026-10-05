// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SERVICE_UNAVAILABLE } from '../../server/service-call';
import { OnboardingFailuresCard } from './onboarding-failures-card';

const failures = {
  since: '2026-09-30T10:00:00.000Z',
  failedAttempts: 15,
  hours: [
    { windowStart: '2026-09-30T10:00:00.000Z', failedAttempts: 3 },
    { windowStart: '2026-10-01T02:00:00.000Z', failedAttempts: 10 },
    { windowStart: '2026-10-01T09:00:00.000Z', failedAttempts: 2 },
  ],
};

const card = () => screen.getByRole('region', { name: 'Failed onboarding attempts' });

describe('OnboardingFailuresCard', () => {
  it('shows the last 24 hours’ total, what counts as a failure and the busiest hour', () => {
    render(<OnboardingFailuresCard result={{ ok: true, data: failures }} />);

    expect(within(card()).getByText('15')).toBeTruthy();
    expect(card().textContent).toContain('Last 24 hours, Kenyan time');
    expect(card().textContent).toContain('matched nobody on the roster');
    expect(card().textContent).toContain('ran out of codes or resends');
    // 02:00 UTC is 05:00 in Kenya.
    expect(card().textContent).toContain('Busiest hour: 1 Oct 2026, 05:00-06:00 (10 attempts)');
  });

  it('drills down by hour, latest first', () => {
    render(<OnboardingFailuresCard result={{ ok: true, data: failures }} />);

    fireEvent.click(screen.getByText('Show by hour'));

    const hours = within(screen.getByRole('list', { name: 'Failed attempts by hour' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(hours).toEqual([
      '1 Oct 2026, 12:00-13:002 attempts',
      '1 Oct 2026, 05:00-06:0010 attempts',
      '30 Sep 2026, 13:00-14:003 attempts',
    ]);
  });

  it('says so when nothing failed, with no drill-down', () => {
    render(
      <OnboardingFailuresCard
        result={{ ok: true, data: { since: failures.since, failedAttempts: 0, hours: [] } }}
      />,
    );

    expect(card().textContent).toContain('No failed attempts in the last 24 hours.');
    expect(screen.queryByText('Show by hour')).toBeNull();
  });

  it('says the count could not be loaded', () => {
    render(<OnboardingFailuresCard result={SERVICE_UNAVAILABLE} />);

    expect(card().textContent).toContain('Failed attempts could not be loaded.');
  });

  it('counts one attempt in the singular', () => {
    render(
      <OnboardingFailuresCard
        result={{
          ok: true,
          data: {
            since: failures.since,
            failedAttempts: 1,
            hours: [{ windowStart: '2026-10-01T09:00:00.000Z', failedAttempts: 1 }],
          },
        }}
      />,
    );

    expect(card().textContent).toContain('(1 attempt)');
  });
});
