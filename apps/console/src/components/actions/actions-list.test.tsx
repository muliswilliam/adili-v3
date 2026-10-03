// @vitest-environment jsdom
import { REVIEWER } from '@adili/roles';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LadderPage, loadLadders } from '../../server/actions.server';
import { MOCK_LADDER_IDS as L } from '../../server/review/actions-mock.server';
import { mockReviewClient, resetReviewMock } from '../../server/review/mock.server';
import type { ServiceResult } from '../../server/service-call';
import { ActionsList } from './actions-list';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={to.replace('$ladderId', params?.ladderId ?? '')} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();

async function page(): Promise<ServiceResult<LadderPage>> {
  return loadLadders(mockReviewClient('me', 'Grace Wanjiru', [REVIEWER]), 'tsc', { limit: 50 });
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});
afterEach(cleanup);

describe('ActionsList', () => {
  it('reads Salary stopped for a stoppage payroll acknowledged before its letter (F18)', async () => {
    const result = await page();
    if (!result.ok) throw new Error('no ladders');
    const items = result.data.items.map((ladder) =>
      ladder.id === L.payrollPending
        ? {
            ...ladder,
            steps: ladder.steps.map((step) =>
              step.step === 'salary-stoppage'
                ? {
                    ...step,
                    status: 'approved' as const,
                    payrollStop: {
                      instructionReference: step.reference ?? '',
                      action: 'stop_salary' as const,
                      status: 'accepted',
                      payrollReference: 'PAY-ACK-2026-0099999',
                      receivedAt: NOW,
                    },
                  }
                : step,
            ),
          }
        : ladder,
    );
    render(
      <ActionsList
        result={{ ok: true, data: { ...result.data, items } }}
        filter="all"
        onFilter={vi.fn()}
        now={NOW}
      />,
    );
    const row = within(screen.getByRole('table')).getByRole('row', {
      name: /Hellen Atieno Ochieng/,
    });
    expect(within(row).getByText('Salary stopped')).toBeTruthy();
    expect(within(row).queryByText(/Approved, issuing/)).toBeNull();
  });

  it('lists each ladder with its subject, declarant, current step and window', async () => {
    render(<ActionsList result={await page()} filter="all" onFilter={vi.fn()} now={NOW} />);
    const table = screen.getByRole('table');

    const drafted = within(table).getByRole('row', { name: /Nancy Wairimu Muriuki/ });
    expect(within(drafted).getByText('Initial declaration')).toBeTruthy();
    expect(within(drafted).getByText('Declaration overdue')).toBeTruthy();
    expect(within(drafted).getByText('Notice to comply')).toBeTruthy();
    expect(within(drafted).getByText('Awaiting approval')).toBeTruthy();
    expect(
      within(drafted).getByRole('link', { name: 'Open the ladder of Nancy Wairimu Muriuki' }),
    ).toHaveProperty('href', expect.stringContaining(`/actions/${L.noticeProposed}`));
    expect(within(drafted).getByText('Review')).toBeTruthy();

    const responded = within(table).getByRole('row', { name: /Paul Kipchumba Sang/ });
    expect(within(responded).getByText('CLR-TSC-2026-0000318-5')).toBeTruthy();
    expect(within(responded).getByText('Clarification unanswered')).toBeTruthy();
    expect(within(responded).getByText('Responded')).toBeTruthy();
    expect(within(responded).getByText('30 Sep 2026')).toBeTruthy();
    expect(within(responded).getByText('in 2 days')).toBeTruthy();

    const complied = within(table).getByRole('row', { name: /Winnie Chebet Langat/ });
    expect(within(complied).getByText('Complied 18 Sep 2026')).toBeTruthy();

    const declined = within(table).getByRole('row', { name: /Abdullahi Hussein Ali/ });
    expect(within(declined).getByText('Declined')).toBeTruthy();
    expect(within(declined).getByText('Ended')).toBeTruthy();
  });

  it('filters by the current step status', async () => {
    const onFilter = vi.fn();
    render(<ActionsList result={await page()} filter="all" onFilter={onFilter} now={NOW} />);
    const chips = screen.getByRole('group', { name: 'Show ladders' });
    expect(within(chips).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Awaiting approval' }));
    expect(onFilter).toHaveBeenCalledWith('awaiting');
  });

  it('shows skeleton rows while loading', () => {
    render(<ActionsList result={null} filter="all" onFilter={vi.fn()} now={NOW} />);
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
  });

  it('says when there are no ladders yet, and when a filter matches none', () => {
    const empty = { ok: true as const, data: { items: [], nextCursor: null } };
    const { rerender } = render(
      <ActionsList result={empty} filter="all" onFilter={vi.fn()} now={NOW} />,
    );
    expect(screen.getByText('No administrative actions yet')).toBeTruthy();
    expect(
      screen.getByText('A ladder starts when a declaration or clarification is overdue.'),
    ).toBeTruthy();

    const onFilter = vi.fn();
    rerender(<ActionsList result={empty} filter="declined" onFilter={onFilter} now={NOW} />);
    expect(screen.getByText('No ladders match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onFilter).toHaveBeenCalledWith('all');
  });

  it('offers a retry when the review service does not answer', () => {
    render(
      <ActionsList
        result={{ ok: false, error: { kind: 'unavailable', detail: null } }}
        filter="all"
        onFilter={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByText('We could not load the ladders')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });
});
