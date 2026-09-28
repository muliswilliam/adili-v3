// @vitest-environment jsdom
import { TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  CommissionRef,
  Obligation,
  ObligationDetail,
  Reminder,
  ReminderOutcome,
} from '../../server/declarations/types';
import type { MyObligationsResult, ObligationDetailResult } from '../../server/obligations.server';
import { ObligationsSection, ObligationsView } from './obligations-view';

const TSC: CommissionRef = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };
const PSC: CommissionRef = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };

// 21 Dec 2026, 15:00 in Nairobi.
const now = Date.parse('2026-12-21T12:00:00Z');

function obligation(overrides: Partial<Obligation> = {}): Obligation {
  return {
    id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e01',
    commission: TSC,
    type: 'initial',
    cycleKey: 'initial:2026-12-03',
    statementDate: '2026-12-03',
    dueDate: '2027-01-02',
    status: 'due',
    cancelReason: null,
    remindersSent: 2,
    policyVersion: 1,
    createdAt: '2026-12-04T06:00:00Z',
    ...overrides,
  };
}

const biennial = obligation({
  id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e02',
  type: 'biennial',
  cycleKey: 'biennial:2027',
  statementDate: '2027-11-01',
  dueDate: '2027-12-31',
  status: 'upcoming',
  remindersSent: 0,
});

const overdueFinal = obligation({
  id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e11',
  commission: PSC,
  type: 'final',
  cycleKey: 'final:2026-10-29',
  statementDate: '2026-10-29',
  dueDate: '2026-11-28',
  status: 'overdue',
  remindersSent: 1,
});

function detailOf(entry: Obligation, reminders: ObligationDetail['reminders'] = []) {
  return { ...entry, reminders, declarant: null } satisfies ObligationDetail;
}

function renderView(
  result: MyObligationsResult,
  {
    onRetry = vi.fn(),
    loadDetail = vi.fn(() => new Promise<ObligationDetailResult>(() => undefined)),
  }: {
    onRetry?: () => void;
    loadDetail?: (id: string) => Promise<ObligationDetailResult>;
  } = {},
) {
  render(
    <TooltipProvider delayDuration={0}>
      <ObligationsView result={result} onRetry={onRetry} loadDetail={loadDetail} now={now} />
    </TooltipProvider>,
  );
  return { onRetry, loadDetail };
}

const card = (title: string) => {
  const heading = screen.getByRole('heading', { name: title });
  const article = heading.closest('article');
  if (!article) throw new Error(`${title} is not in a card`);
  return article;
};

describe('ObligationsView', () => {
  it('lists one Commission without a group heading', () => {
    renderView({
      status: 'ok',
      groups: [{ commission: TSC, obligations: [biennial, obligation()] }],
    });

    expect(screen.getByRole('heading', { name: 'Your declarations' })).toBeTruthy();
    expect(
      screen
        .getAllByRole('article')
        .map((article) => within(article).getByRole('heading').textContent),
    ).toEqual(['Initial declaration', 'Biennial declaration 2027']);
    expect(screen.queryByRole('heading', { name: /Teachers Service Commission/ })).toBeNull();
  });

  // S22: grouped by Commission when there is more than one.
  it('groups by Commission, the most pressing first, each under its name and issuer code', () => {
    renderView({
      status: 'ok',
      groups: [
        { commission: TSC, obligations: [obligation()] },
        { commission: PSC, obligations: [overdueFinal] },
      ],
    });

    const groups = screen.getAllByRole('heading', { level: 3 });
    expect(groups.map((heading) => heading.textContent)).toEqual([
      'PSCPublic Service Commission',
      'TSCTeachers Service Commission',
    ]);
    expect(card('Final declaration').compareDocumentPosition(card('Initial declaration'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows the type, dates, status, days left and reminders of each obligation', () => {
    renderView({
      status: 'ok',
      groups: [{ commission: TSC, obligations: [obligation(), biennial] }],
    });

    const initial = card('Initial declaration');
    expect(initial.querySelector('[data-variant="info"]')?.textContent).toBe('Due');
    expect(initial.textContent).toContain('Statement date');
    expect(initial.textContent).toContain('3 Dec 2026');
    expect(initial.textContent).toContain('2 Jan 2027');
    expect(initial.textContent).toContain('2 reminders sent');

    const upcoming = card('Biennial declaration 2027');
    expect(upcoming.textContent).toContain('Upcoming');
    expect(upcoming.textContent).toContain('Opens 1 November 2027');
    expect(upcoming.textContent).toContain('No reminders sent yet');
  });

  // S22: relative days across the month and year boundaries.
  it('counts days left across the year end and days overdue across a month end', () => {
    renderView({
      status: 'ok',
      groups: [
        { commission: TSC, obligations: [obligation()] },
        { commission: PSC, obligations: [overdueFinal] },
      ],
    });

    expect(card('Initial declaration').textContent).toContain('Due in 12 days');
    const overdue = card('Final declaration');
    expect(overdue.textContent).toContain('23 days overdue');
    expect(overdue.textContent).toContain('Overdue');
    expect(overdue.textContent).toContain(
      'If you have already declared by other means, contact your Commission.',
    );
  });

  it('explains the statement date in a tooltip', () => {
    renderView({ status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] });

    fireEvent.focus(within(card('Initial declaration')).getByText('Statement date'));

    expect(screen.getByRole('tooltip').textContent).toBe(
      'The date your financial position is declared as at.',
    );
  });

  // S22: the disabled action renders with its tooltip.
  it('renders Start declaration disabled, explained by a tooltip and aria-describedby', () => {
    renderView({ status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] });

    const start = within(card('Initial declaration')).getByRole('button', {
      name: 'Start declaration',
    });
    expect(start.hasAttribute('disabled')).toBe(true);
    const description = document.getElementById(start.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Filing opens soon. You will be reminded.');

    const trigger = start.parentElement;
    if (!trigger) throw new Error('Start declaration has no tooltip trigger');
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'Filing opens soon. You will be reminded.',
    );
  });

  it('shows the empty state when the declarant owes nothing', () => {
    renderView({ status: 'ok', groups: [] });

    expect(screen.getByRole('heading', { name: 'No obligations yet' })).toBeTruthy();
    expect(
      screen.getByText(
        "Your Commission's roster shows no declaration due for you right now. Obligations appear here when a cycle opens or when your appointment or exit creates one.",
      ),
    ).toBeTruthy();
  });

  it('treats only cancelled obligations as none', () => {
    renderView({
      status: 'ok',
      groups: [
        {
          commission: TSC,
          obligations: [obligation({ status: 'cancelled', cancelReason: 'superseded' })],
        },
      ],
    });

    expect(screen.getByRole('heading', { name: 'No obligations yet' })).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('offers a retry when the obligations cannot be loaded', () => {
    const { onRetry } = renderView({ status: 'unavailable' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Your obligations could not be loaded');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('asks to sign in again when the session has ended', () => {
    renderView({ status: 'unauthenticated' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Your session has ended');
    expect(within(alert).getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/auth/login',
    );
  });

  it('renders nothing for someone who is not a declarant', () => {
    renderView({ status: 'not-declarant' });

    expect(screen.queryByRole('heading', { name: 'Your declarations' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Obligation drawer', () => {
  const reminders: ObligationDetail['reminders'] = [
    {
      offsetDays: 30,
      scheduledAt: '2026-12-03T06:12:00Z',
      sentAt: null,
      channels: [],
      outcome: 'skipped-past-due-at-creation',
    },
    {
      offsetDays: 14,
      scheduledAt: '2026-12-19T06:12:00Z',
      sentAt: '2026-12-19T06:12:30Z',
      channels: ['sms', 'email'],
      outcome: 'sent',
    },
    {
      offsetDays: 7,
      scheduledAt: '2026-12-26T06:12:00Z',
      sentAt: null,
      channels: ['sms'],
      outcome: 'failed',
    },
  ];

  it('opens from Details with every field, the reminder history and the disabled action', async () => {
    const loadDetail = vi.fn(() =>
      Promise.resolve<ObligationDetailResult>({
        status: 'ok',
        obligation: detailOf(obligation(), reminders),
      }),
    );
    renderView(
      { status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] },
      { loadDetail },
    );

    const details = within(card('Initial declaration')).getByRole('button', { name: /Details/ });
    await act(async () => {
      fireEvent.click(details);
      await Promise.resolve();
    });

    const drawer = screen.getByRole('dialog', { name: 'Initial declaration' });
    expect(loadDetail).toHaveBeenCalledWith(obligation().id);
    expect(drawer.textContent).toContain('Teachers Service Commission');
    expect(drawer.textContent).toContain('TSC');
    expect(drawer.textContent).toContain('Appointment on 3 Dec 2026');
    expect(drawer.textContent).toContain('The date your financial position is declared as at.');
    expect(drawer.textContent).toContain('Due in 12 days');
    expect(drawer.textContent).toContain('Reminder schedule set by Teachers Service Commission');

    const table = within(drawer).getByRole('table', { name: 'Reminder history' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      [
        '30 days before',
        '3 Dec 2026, 09:12',
        '-',
        '-',
        'Skipped: the date had passed when this obligation was created',
      ],
      [
        '14 days before',
        '19 Dec 2026, 09:12',
        '19 Dec 2026, 09:12',
        'SMS, Email',
        'Sent by SMS and email',
      ],
      ['7 days before', '26 Dec 2026, 09:12', '-', 'SMS', 'Failed'],
    ]);

    const start = within(drawer).getByRole('button', { name: 'Start declaration' });
    expect(start.hasAttribute('disabled')).toBe(true);
    expect(drawer.textContent).toContain('Filing opens soon. You will be reminded.');
  });

  // A Record over the contract's enum: a new outcome in declarations.yaml fails typecheck here.
  const everyOutcome: Record<ReminderOutcome, { channels: Reminder['channels']; words: string }[]> =
    {
      sent: [
        { channels: ['sms', 'email'], words: 'Sent by SMS and email' },
        { channels: ['sms'], words: 'Sent by SMS' },
        { channels: ['email'], words: 'Sent by email' },
      ],
      'skipped-not-onboarded': [{ channels: [], words: 'Skipped: not yet onboarded' }],
      'skipped-no-contact': [{ channels: [], words: 'Skipped: no contact details' }],
      'skipped-past-due-at-creation': [
        { channels: [], words: 'Skipped: the date had passed when this obligation was created' },
      ],
      failed: [{ channels: ['sms', 'email'], words: 'Failed' }],
    };

  it('puts every reminder outcome in the contract into plain words', async () => {
    const cases = Object.entries(everyOutcome).flatMap(([outcome, variants]) =>
      variants.map((variant) => ({ outcome: outcome as ReminderOutcome, ...variant })),
    );
    const history = cases.map(({ outcome, channels }, index): Reminder => ({
      offsetDays: 30 - index,
      scheduledAt: `2026-12-${String(3 + index).padStart(2, '0')}T06:12:00Z`,
      sentAt: outcome === 'sent' ? `2026-12-${String(3 + index).padStart(2, '0')}T06:12:30Z` : null,
      channels,
      outcome,
    }));
    const loadDetail = () =>
      Promise.resolve<ObligationDetailResult>({
        status: 'ok',
        obligation: detailOf(obligation(), history),
      });
    renderView(
      { status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] },
      { loadDetail },
    );

    await act(async () => {
      fireEvent.click(within(card('Initial declaration')).getByRole('button', { name: /Details/ }));
      await Promise.resolve();
    });

    const table = within(screen.getByRole('dialog')).getByRole('table', {
      name: 'Reminder history',
    });
    const outcomes = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').at(-1)?.textContent);
    expect(outcomes).toEqual(cases.map(({ words }) => words));
  });

  it('opens when the card is clicked and returns focus to Details on close', async () => {
    renderView({ status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] });
    const details = within(card('Initial declaration')).getByRole('button', { name: /Details/ });

    details.focus();
    fireEvent.click(details);
    const [close] = within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' });
    if (!close) throw new Error('the drawer has no close button');
    fireEvent.click(close);

    await waitFor(() => {
      expect(document.activeElement).toBe(details);
    });

    fireEvent.click(card('Initial declaration'));
    expect(screen.getByRole('dialog', { name: 'Initial declaration' })).toBeTruthy();
  });

  it('says so when no reminder has been recorded', async () => {
    const loadDetail = () =>
      Promise.resolve<ObligationDetailResult>({ status: 'ok', obligation: detailOf(biennial) });
    renderView(
      { status: 'ok', groups: [{ commission: TSC, obligations: [biennial] }] },
      { loadDetail },
    );

    await act(async () => {
      fireEvent.click(
        within(card('Biennial declaration 2027')).getByRole('button', { name: /Details/ }),
      );
      await Promise.resolve();
    });

    const drawer = screen.getByRole('dialog');
    expect(drawer.textContent).toContain('Biennial 2027');
    expect(drawer.textContent).toContain('Opens 1 November 2027');
    expect(drawer.textContent).toContain('No reminders sent yet.');
  });

  it('asks to sign in again when the session ended before the history loaded', async () => {
    const loadDetail = () => Promise.resolve<ObligationDetailResult>({ status: 'unauthenticated' });
    renderView(
      { status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] },
      { loadDetail },
    );

    await act(async () => {
      fireEvent.click(within(card('Initial declaration')).getByRole('button', { name: /Details/ }));
      await Promise.resolve();
    });

    const alert = within(screen.getByRole('dialog')).getByRole('alert');
    expect(alert.textContent).toContain('Your session has ended');
    expect(within(alert).getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/auth/login',
    );
  });

  it('offers a retry when the reminder history cannot be loaded', async () => {
    const loadDetail = vi
      .fn<(id: string) => Promise<ObligationDetailResult>>()
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockResolvedValueOnce({ status: 'ok', obligation: detailOf(obligation(), reminders) });
    renderView(
      { status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] },
      { loadDetail },
    );

    await act(async () => {
      fireEvent.click(within(card('Initial declaration')).getByRole('button', { name: /Details/ }));
      await Promise.resolve();
    });
    const drawer = screen.getByRole('dialog');
    const alert = within(drawer).getByRole('alert');
    expect(alert.textContent).toContain('Reminder history could not be loaded');

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(loadDetail).toHaveBeenCalledTimes(2);
    expect(within(drawer).getByRole('table', { name: 'Reminder history' })).toBeTruthy();
  });
});

describe('ObligationsSection', () => {
  it('shows skeleton cards while loading, then the obligations', async () => {
    let resolve: (result: MyObligationsResult) => void = () => undefined;
    const pending = new Promise<MyObligationsResult>((done) => {
      resolve = done;
    });
    await act(async () => {
      render(
        <ObligationsSection
          obligations={pending}
          reload={vi.fn()}
          loadDetail={vi.fn()}
          now={now}
        />,
      );
      await Promise.resolve();
    });

    const loading = screen.getByLabelText('Loading your declarations');
    expect(loading.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      resolve({ status: 'ok', groups: [{ commission: TSC, obligations: [obligation()] }] });
      await pending;
    });

    expect(screen.queryByLabelText('Loading your declarations')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Initial declaration' })).toBeTruthy();
  });

  it('loads again on retry', async () => {
    const reload = vi.fn(() =>
      Promise.resolve<MyObligationsResult>({
        status: 'ok',
        groups: [{ commission: TSC, obligations: [obligation()] }],
      }),
    );
    const failed = Promise.resolve<MyObligationsResult>({ status: 'unavailable' });
    await act(async () => {
      render(
        <ObligationsSection obligations={failed} reload={reload} loadDetail={vi.fn()} now={now} />,
      );
      await failed;
    });

    const retry = screen.getByRole('button', { name: 'Try again' });
    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Initial declaration' })).toBeTruthy();
  });
});
