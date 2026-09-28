// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  CommissionObligationsSummary,
  DeclarationsResult,
  ObligationDetail,
  ObligationListItem,
  ObligationPage,
} from '../../server/declarations/client';
import { ObligationsView, type ObligationsViewProps } from './obligations-view';

// LoadError's Retry reruns loaders through the router; no router is needed to render it here.
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

const PSC = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };

const counts = (upcoming = 0, due = 0, overdue = 0, filed = 0) => ({
  upcoming,
  due,
  overdue,
  filed,
});

/** A biennial cycle under the statutory dates. */
const cycle = (year: number, opened: boolean) => ({
  key: `biennial:${String(year)}`,
  statementDate: `${String(year)}-11-01`,
  dueDate: `${String(year)}-12-31`,
  opensOn: `${String(year)}-07-04`,
  opened,
});

function summary(
  overrides: Partial<CommissionObligationsSummary> = {},
): DeclarationsResult<CommissionObligationsSummary> {
  return {
    ok: true,
    data: {
      commission: PSC,
      cycle: cycle(2027, true),
      cycles: [cycle(2027, true), cycle(2029, false), cycle(2031, false)],
      total: counts(1_204, 18, 7),
      byType: { initial: counts(0, 14, 5), biennial: counts(1_204, 0, 0), final: counts(0, 4, 2) },
      notOnboarded: { due: 9, overdue: 4 },
      ...overrides,
    },
  };
}

function obligation(overrides: Partial<ObligationListItem> = {}): ObligationListItem {
  return {
    id: '0199a0b4-0000-7000-8000-000000000001',
    commission: PSC,
    type: 'initial',
    cycleKey: 'initial:2026-08-20',
    statementDate: '2026-08-20',
    dueDate: '2026-09-19',
    status: 'overdue',
    cancelReason: null,
    remindersSent: 3,
    policyVersion: 1,
    createdAt: '2026-08-21T06:00:00Z',
    lastReminder: null,
    declarant: {
      rosterRecordId: '0199a0b4-0000-7000-8000-0000000000a1',
      personnelFileNumber: 'PSC/2009/0412',
      fullName: 'Achieng Otieno',
      onboarded: true,
      ofr: 'OFR-7K2M-9QX4',
    },
    ...overrides,
  };
}

const notOnboarded = obligation({
  id: '0199a0b4-0000-7000-8000-000000000002',
  type: 'biennial',
  cycleKey: 'biennial:2027',
  statementDate: '2027-11-01',
  dueDate: '2027-12-31',
  status: 'upcoming',
  remindersSent: 0,
  declarant: {
    rosterRecordId: '0199a0b4-0000-7000-8000-0000000000a2',
    personnelFileNumber: 'PSC/2014/0088',
    fullName: 'Juma Mwangi',
    onboarded: false,
    ofr: null,
  },
});

function page(items: ObligationListItem[], nextCursor: string | null = null) {
  return { ok: true, data: { items, nextCursor } } as DeclarationsResult<ObligationPage>;
}

const problem = (status: number): DeclarationsResult<never> => ({
  ok: false,
  error: { kind: 'problem', problem: { type: 'about:blank', title: 'No', status } },
});

const unavailable: DeclarationsResult<never> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

function detail(item: ObligationListItem): DeclarationsResult<ObligationDetail> {
  return {
    ok: true,
    data: {
      ...item,
      reminders: [
        {
          offsetDays: 14,
          scheduledAt: '2026-09-05T06:00:00Z',
          sentAt: '2026-09-05T06:02:00Z',
          channels: ['sms', 'email'],
          outcome: 'sent',
        },
        {
          offsetDays: 7,
          scheduledAt: '2026-09-12T06:00:00Z',
          sentAt: null,
          channels: [],
          outcome: 'skipped-no-contact',
        },
        {
          offsetDays: 30,
          scheduledAt: '2026-08-20T06:00:00Z',
          sentAt: null,
          channels: [],
          outcome: 'skipped-past-due-at-creation',
        },
      ],
    },
  };
}

function renderView(overrides: Partial<ObligationsViewProps> = {}) {
  const props: ObligationsViewProps = {
    summary: summary(),
    list: page([obligation(), notOnboarded]),
    search: {},
    onSearchChange: vi.fn(),
    loadPage: vi.fn(),
    loadObligation: vi.fn((id: string) =>
      Promise.resolve(detail(id === notOnboarded.id ? notOnboarded : obligation())),
    ),
    roster: {
      notOnboardedLink: <a href="/roster/records?state=not_onboarded">View roster</a>,
      recordLink: (declarant) => (
        <a href={`/roster/records/${declarant.rosterRecordId}`}>Roster record</a>
      ),
    },
    ...overrides,
  };
  render(<ObligationsView {...props} />);
  return props;
}

const tiles = () => screen.getByRole('group', { name: 'Summary' });
const table = () =>
  screen.getByRole('table', { name: 'Declarants and their obligations, overdue first' });

describe('S23 summary tiles', () => {
  it('shows the counts by status with their split by type, and the not-onboarded tile', () => {
    renderView();
    const group = tiles();
    const overdue = within(group).getByRole('button', { name: 'Overdue 7' });
    expect(overdue.getAttribute('aria-pressed')).toBe('false');
    const byType = within(group).getByRole('list', { name: 'Overdue by type' });
    expect(
      within(byType)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Initial5', 'Biennial0', 'Final2']);
    expect(within(group).getByRole('button', { name: 'Upcoming 1,204' })).toBeTruthy();
    expect(within(group).getByText('Due or overdue but not onboarded')).toBeTruthy();
    const split = within(group).getByRole('list', { name: 'Not onboarded by status' });
    expect(split.textContent).toBe('Due9Overdue4');
  });

  it('filters the list by the status of the tile pressed, and stops when pressed again', () => {
    const { onSearchChange } = renderView({ search: { type: 'initial' } });
    fireEvent.click(within(tiles()).getByRole('button', { name: 'Overdue 7' }));
    expect(onSearchChange).toHaveBeenCalledWith({ type: 'initial', status: 'overdue' });
  });

  it('marks the tile of the status filtered by as pressed', () => {
    const { onSearchChange } = renderView({ search: { status: 'due' } });
    const due = within(tiles()).getByRole('button', { name: 'Due 18' });
    expect(due.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(due);
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('shows placeholders while the counts load', () => {
    renderView({ summary: null });
    expect(tiles().getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Overdue/ })).toBeNull();
  });

  it('says what the current cycle is, and when it opens while it has not', () => {
    renderView({
      summary: summary({
        cycle: { ...cycle(2027, false), opensOn: '2027-06-15' },
        byType: { initial: counts(), biennial: counts(), final: counts() },
      }),
    });
    expect(screen.getByText('Biennial 2027 · statement 1 Nov 2027 · due 31 Dec 2027')).toBeTruthy();
    expect(screen.getByText('Public Service Commission')).toBeTruthy();
    expect(screen.getByText('Not open yet').getAttribute('title')).toBe(
      "The cycle's obligations are created on 15 Jun 2027.",
    );
  });

  it('says nothing of opening once the cycle has opened', () => {
    renderView();
    expect(screen.queryByText('Not open yet')).toBeNull();
  });

  it('shows the counts failing to load as an alert with retry, and keeps the list', () => {
    renderView({ summary: unavailable });
    expect(screen.getByRole('alert').textContent).toContain('Obligations could not be loaded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(table()).toBeTruthy();
  });
});

describe('S23 not-onboarded callout', () => {
  it('tells the Commission to chase declarants who get no reminders, linking to the roster', () => {
    renderView();
    const callout = screen.getByRole('status');
    expect(callout.textContent).toContain(
      '13 declarants with a declaration due have not onboarded. They receive no reminders from Adili. Chase them through your own channels.',
    );
    expect(within(callout).getByRole('link', { name: 'View roster' }).getAttribute('href')).toBe(
      '/roster/records?state=not_onboarded',
    );
  });

  it('filters the list to declarants not onboarded from "Show in list"', () => {
    const { onSearchChange } = renderView({ search: { status: 'due', search: 'PSC' } });
    fireEvent.click(
      within(screen.getByRole('status')).getByRole('button', { name: 'Show in list' }),
    );
    expect(onSearchChange).toHaveBeenCalledWith({ search: 'PSC', onboarded: false });
  });

  it('offers no roster link to those who cannot open the roster', () => {
    renderView({ roster: undefined });
    expect(within(screen.getByRole('status')).queryByRole('link')).toBeNull();
  });

  it('is hidden when every declarant with a declaration due has onboarded', () => {
    renderView({ summary: summary({ notOnboarded: { due: 0, overdue: 0 } }) });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('counts one declarant in the singular', () => {
    renderView({ summary: summary({ notOnboarded: { due: 0, overdue: 1 } }) });
    expect(screen.getByRole('status').textContent).toContain(
      '1 declarant with a declaration due has not onboarded.',
    );
  });
});

describe('S23 obligations list', () => {
  it('lists declarants with type, dates, status, onboarded and reminders', () => {
    renderView();
    const [header, firstRow, secondRow, ...rest] = within(table()).getAllByRole('row');
    expect(header).toBeTruthy();
    expect(rest).toHaveLength(0);
    if (!firstRow || !secondRow) throw new Error('expected two rows');
    const first = within(firstRow);
    expect(first.getByRole('rowheader').textContent).toBe('Achieng OtienoPSC/2009/0412');
    expect(first.getByText('Initial')).toBeTruthy();
    expect(first.getByText('20 Aug 2026')).toBeTruthy();
    expect(first.getByText('19 Sep 2026')).toBeTruthy();
    expect(first.getByText('Overdue')).toBeTruthy();
    expect(first.getByText('Yes')).toBeTruthy();
    expect(first.getByLabelText('3 reminders sent')).toBeTruthy();
    const second = within(secondRow);
    expect(second.getByText('Biennial 2027')).toBeTruthy();
    expect(second.getByText('Upcoming')).toBeTruthy();
    expect(second.getByText('No')).toBeTruthy();
    expect(second.getByText('Opens 1 November 2027')).toBeTruthy();
    expect(screen.getByText('All 2 obligations shown')).toBeTruthy();
  });

  it("tells the reminders sent and the last one's outcome on focus", async () => {
    renderView({
      list: page([
        obligation({
          remindersSent: 1,
          lastReminder: {
            offsetDays: 7,
            scheduledAt: '2026-09-12T09:00:00Z',
            sentAt: null,
            channels: [],
            outcome: 'skipped-no-contact',
          },
        }),
      ]),
    });
    fireEvent.focus(within(table()).getByLabelText('1 reminder sent'));
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toBe(
      '1 reminder sentLast (7 days before): Skipped: no contact detailsOpen the declarant for the reminder history.',
    );
  });

  it('shows placeholder rows while the first page loads', () => {
    renderView({ list: null });
    const loading = screen.getByRole('table', { name: 'Obligations (loading)' });
    expect(loading.getAttribute('aria-busy')).toBe('true');
  });

  it('says there are no obligations yet, offering an import while the roster is empty', () => {
    renderView({
      list: page([]),
      emptyAction: <a href="/roster/import">Import roster</a>,
    });
    expect(screen.getByText('No obligations yet')).toBeTruthy();
    expect(
      screen.getByText('Obligations appear when the roster is imported and a cycle opens.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Import roster' })).toBeTruthy();
  });

  it('says nothing matches the filters and clears them', () => {
    const { onSearchChange } = renderView({ list: page([]), search: { onboarded: false } });
    expect(screen.getByText('No matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('shows one alert when the counts and the list both fail', () => {
    renderView({ summary: unavailable, list: unavailable });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('shows a failed load as an alert with retry', () => {
    renderView({ list: unavailable });
    expect(screen.getByRole('alert').textContent).toContain('Obligations could not be loaded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('points EACC staff, refused the list, to the counts on the Commission page', () => {
    renderView({ list: problem(403), forbiddenAction: <a href="/commissions/psc">Back</a> });
    expect(
      screen.getByText('You can see counts on the Commission page, not the declarant list.'),
    ).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Summary' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy();
  });

  it('reads another Commission as not found', () => {
    renderView({ summary: problem(404), list: problem(404) });
    expect(screen.getByText('Commission not found')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('filters by onboarded from the segmented control', () => {
    const { onSearchChange } = renderView({ search: { status: 'due' } });
    const group = screen.getByRole('group', { name: 'Onboarded' });
    expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'Any' }).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Not onboarded' }));
    expect(onSearchChange).toHaveBeenCalledWith({ status: 'due', onboarded: false });
  });

  it('offers Clear while filters are set', () => {
    const { onSearchChange } = renderView({ search: { cycle: 'biennial:2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('appends the next page from "Load more"', async () => {
    const later = obligation({
      id: '0199a0b4-0000-7000-8000-000000000003',
      declarant: { ...obligation().declarant, fullName: 'Wanjiru Kamau' },
    });
    const loadPage = vi.fn(() => Promise.resolve(page([later])));
    renderView({ list: page([obligation()], 'c2'), loadPage });
    expect(screen.getByText('Showing 1 obligation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(within(table()).getByText('Wanjiru Kamau')).toBeTruthy();
    });
    expect(loadPage).toHaveBeenCalledWith('c2');
    expect(screen.getByText('All 2 obligations shown')).toBeTruthy();
  });
});

describe('obligation drawer', () => {
  it('opens from the row with its fields and the reminder history in words', async () => {
    const { loadObligation } = renderView();
    fireEvent.click(within(table()).getByRole('button', { name: 'Achieng Otieno' }));
    const drawer = await screen.findByRole('dialog', { name: 'Achieng Otieno' });
    expect(within(drawer).getByText('Initial declaration', { selector: 'p' })).toBeTruthy();
    expect(within(drawer).getByText('OFR-7K2M-9QX4')).toBeTruthy();
    expect(within(drawer).getByText('20 August 2026')).toBeTruthy();
    expect(
      within(drawer).getByText('Reminder schedule set by Public Service Commission · policy v1'),
    ).toBeTruthy();
    const history = await within(drawer).findByRole('table', { name: 'Reminder history' });
    expect(loadObligation).toHaveBeenCalledWith(obligation().id);
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      '14 days before5 Sep 20265 Sep 2026SMS, EmailSent by SMS and email',
      '7 days before12 Sep 2026--Skipped: no contact details',
      '30 days before20 Aug 2026--Skipped: the date had passed when this obligation was created',
    ]);
    expect(within(drawer).getByRole('link', { name: 'Roster record' }).getAttribute('href')).toBe(
      `/roster/records/${obligation().declarant.rosterRecordId}`,
    );
  });

  it('notes that no reminders go out until the declarant onboards', async () => {
    renderView();
    fireEvent.click(within(table()).getByRole('button', { name: 'Juma Mwangi' }));
    const drawer = await screen.findByRole('dialog', { name: 'Juma Mwangi' });
    expect(
      within(drawer).getByText(
        'Reminder schedule set by Public Service Commission · policy v1 · none sent until onboarded',
      ),
    ).toBeTruthy();
  });

  it('says so when the reminder history cannot be read', async () => {
    renderView({ loadObligation: vi.fn(() => Promise.resolve(unavailable)) });
    fireEvent.click(within(table()).getByRole('button', { name: 'Achieng Otieno' }));
    const drawer = await screen.findByRole('dialog');
    expect((await within(drawer).findByRole('alert')).textContent).toBe(
      'The obligation could not be loaded',
    );
  });
});
