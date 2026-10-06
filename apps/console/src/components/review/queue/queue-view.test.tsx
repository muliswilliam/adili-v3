// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { caseItem, ME, WAFULA } from '../../../review-case/fixtures';
import { QUEUE_COPY as m } from '../../../review-queue/messages';
import type { QueueSearch } from '../../../review-queue/query';
import type { QueueSummary } from '../../../review-queue/rows';
import { claimCase, reassignCase } from '../../../server/review-case';
import type { QueuePage } from '../../../server/review-queue';
import type { CaseListItem } from '../../../server/review/types';
import type { ServiceResult } from '../../../server/service-call';
import { QueueView, type QueueViewProps } from './queue-view';

const invalidate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: { caseId?: string };
    children: ReactNode;
  }) => (
    <a href={to.replace('$caseId', params?.caseId ?? '')} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate }),
}));
vi.mock('../../../server/review-case', () => ({
  claimCase: vi.fn(),
  getReviewers: vi.fn(),
  reassignCase: vi.fn(),
  releaseCase: vi.fn(),
}));

const bands = (high: number, medium: number, low: number) => ({ high, medium, low });
const none = bands(0, 0, 0);

const SUMMARY: QueueSummary = {
  byStatus: {},
  byBand: {},
  byStatusAndBand: {
    unassigned: bands(62, 399, 826),
    assigned: none,
    'awaiting-clarification': bands(24, 75, 55),
    clarified: none,
    'ready-for-determination': bands(3, 20, 34),
    'sample-review': none,
    'further-action': none,
    determined: none,
  },
  mine: bands(3, 4, 2),
  overdueClarifications: 2,
};

const ok = <T,>(data: T) => ({ ok: true as const, data });
const page = (items: CaseListItem[], nextCursor: string | null = null) =>
  ok<QueuePage>({ items, nextCursor });

const UNASSIGNED = caseItem();
const HELD = caseItem({
  id: 'ca5e0000-0000-4000-8000-000000000002',
  reference: 'DCB-PSC-2025-0004390-H',
  declarantName: 'Kevin Omondi Owino',
  assignee: WAFULA,
  status: 'awaiting-clarification',
  band: 'medium',
  late: false,
  registryUnavailable: true,
  clarification: { open: 1, status: 'issued', dueAt: '2026-10-08T09:00:00Z' },
});

const reviewer = { ...ME, supervisor: false };
const supervisor = { ...ME, supervisor: true };

function view(overrides: Partial<QueueViewProps> = {}) {
  const props: QueueViewProps = {
    commission: 'Public Service Commission',
    summary: ok(SUMMARY),
    list: page([UNASSIGNED, HELD]),
    search: {},
    onSearchChange: vi.fn(),
    viewer: reviewer,
    slug: 'psc',
    cycles: [2026, 2025, 2024],
    reviewers: null,
    href: 'http://localhost/review',
    loadPage: vi.fn(),
    refresh: () => invalidate(),
    ...overrides,
  };
  return (
    <TooltipProvider>
      <ToastProvider>
        <QueueView {...props} />
      </ToastProvider>
    </TooltipProvider>
  );
}

/** The table's rows (jsdom applies no container queries, so the table and the cards both render). */
function tableRow(reference: string) {
  const table = screen.getByRole('table', { name: /highest priority first/ });
  const row = within(table).getByText(reference).closest('tr');
  if (!row) throw new Error(`no row for ${reference}`);
  return within(row);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QueueView', () => {
  it("is headed with the Commission's name, and without it while unknown", () => {
    const { unmount } = render(view());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Review queue · Public Service Commission',
    );
    unmount();
    render(view({ commission: null }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Review queue');
  });

  it('shows the tiles with their split by priority and the overdue clarifications', () => {
    render(view());
    const tiles = screen.getByRole('group', { name: 'Cases by status' });
    expect(within(tiles).getByRole('button', { name: /Unassigned\s*1,287/ })).toBeTruthy();
    expect(within(tiles).getByRole('button', { name: /Mine\s*9/ })).toBeTruthy();
    const unassigned = within(tiles).getByRole('list', { name: 'Unassigned by priority' });
    expect(unassigned.textContent).toBe('High62Medium399Low826');
    expect(screen.getByText('2 clarifications overdue')).toBeTruthy();
  });

  it('filters by a tile: the list shows its cases alone', () => {
    const onSearchChange = vi.fn();
    render(view({ search: { band: 'high', search: 'Kamau' }, onSearchChange }));
    fireEvent.click(screen.getByRole('button', { name: /Mine\s*9/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ search: 'Kamau', assignee: 'mine' });
  });

  it('marks the tile of the filter on show as pressed', () => {
    render(view({ search: { status: 'awaiting-clarification' } }));
    expect(
      screen
        .getByRole('button', { name: /Awaiting clarification\s*154/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('lists a row per case with its priority, flags, assignee and clarification', () => {
    render(view());
    const row = tableRow('DCB-PSC-2025-0004390-H');
    expect(row.getByRole('link', { name: 'DCB-PSC-2025-0004390-H' }).getAttribute('href')).toBe(
      `/review/cases/${HELD.id}`,
    );
    expect(row.getByText('Kevin Omondi Owino')).toBeTruthy();
    expect(row.getByText('Medium')).toBeTruthy();
    expect(row.getByText('Wafula Barasa')).toBeTruthy();
    expect(row.getByText('Open until 8 Oct 2026')).toBeTruthy();
    expect(row.getByRole('link', { name: 'View' })).toBeTruthy();
    const first = tableRow('DCI-PSC-2026-9164002-3');
    expect(first.getByText('Late filing')).toBeTruthy();
    expect(first.getByText('Unassigned')).toBeTruthy();
    expect(first.getByText('None')).toBeTruthy();
  });

  it('explains the Priority column in a tip named by a short label', () => {
    render(view());
    const table = screen.getByRole('table', { name: /highest priority first/ });
    expect(within(table).getByRole('button', { name: 'About priority' })).toBeTruthy();
  });

  it('marks a case whose registries could not all be checked (spec 07b)', () => {
    render(view());
    expect(
      tableRow('DCB-PSC-2025-0004390-H').getByRole('img', {
        name: 'One or more registries could not be checked',
      }),
    ).toBeTruthy();
    expect(
      tableRow('DCI-PSC-2026-9164002-3').queryByRole('img', {
        name: 'One or more registries could not be checked',
      }),
    ).toBeNull();
  });

  it('switches the registry unavailable filter', () => {
    const onSearchChange = vi.fn();
    render(view({ search: { band: 'high' }, onSearchChange }));
    fireEvent.click(screen.getByRole('button', { name: 'Registry unavailable' }));
    expect(onSearchChange).toHaveBeenCalledWith({ band: 'high', registryUnavailable: true });
  });

  it('claims a case for a reviewer straight away and reloads', async () => {
    vi.mocked(claimCase).mockResolvedValue(ok(caseItem({ assignee: ME, status: 'assigned' })));
    render(view());
    await act(async () => {
      fireEvent.click(tableRow('DCI-PSC-2026-9164002-3').getByRole('button', { name: 'Claim' }));
      await Promise.resolve();
    });
    expect(claimCase).toHaveBeenCalledWith({ data: { caseId: UNASSIGNED.id } });
    expect(invalidate).toHaveBeenCalled();
    expect(await screen.findByText('Case claimed. You hold it now.')).toBeTruthy();
  });

  it('says who claimed it first when the claim lost the race (409)', async () => {
    vi.mocked(claimCase).mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'case-already-assigned', title: 'Case already assigned', status: 409 },
      },
    });
    const { rerender } = render(view());
    await act(async () => {
      fireEvent.click(tableRow('DCI-PSC-2026-9164002-3').getByRole('button', { name: 'Claim' }));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalled();
    // The reload brings the row as Wafula holds it.
    rerender(view({ list: page([{ ...UNASSIGNED, assignee: WAFULA, status: 'assigned' }, HELD]) }));
    expect(await screen.findByText('Already claimed by Wafula Barasa')).toBeTruthy();
    expect(tableRow('DCI-PSC-2026-9164002-3').queryByRole('button', { name: 'Claim' })).toBeNull();
  });

  it('asks a supervisor to confirm a claim, as they become a reviewer of record', () => {
    render(view({ viewer: supervisor }));
    fireEvent.click(tableRow('DCI-PSC-2026-9164002-3').getByRole('button', { name: 'Claim' }));
    expect(screen.getByRole('dialog', { name: 'Claim this case?' })).toBeTruthy();
    expect(claimCase).not.toHaveBeenCalled();
  });

  it('gives a supervisor a row menu to unassign a held case', async () => {
    vi.mocked(reassignCase).mockResolvedValue(ok(HELD));
    render(view({ viewer: supervisor }));
    const row = tableRow('DCB-PSC-2025-0004390-H');
    expect(row.getByRole('link', { name: 'Open' })).toBeTruthy();
    const trigger = row.getByRole('button', { name: 'More actions for Kevin Omondi Owino' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unassign' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unassign this case?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Unassign' }));
      await Promise.resolve();
    });
    expect(reassignCase).toHaveBeenCalledWith({ data: { caseId: HELD.id, assignee: null } });
    expect(await screen.findByText('Case unassigned')).toBeTruthy();
  });

  it('shows skeletons while the counts and the first page load', () => {
    render(view({ summary: null, list: null }));
    expect(screen.getByRole('group', { name: 'Cases by status' }).getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getByRole('table', { name: 'Loading review cases' })).toBeTruthy();
  });

  it('M8: switches the skeleton between table and cards where the list does, so loading keeps the layout', () => {
    // The container query that shows or hides an element: its own, or its nearest ancestor's.
    const breakpoint = (element: Element | undefined) => {
      for (let at: Element | null = element ?? null; at; at = at.parentElement) {
        const query = /\S*@\[\d+px\]\S*/u.exec(at.className)?.[0];
        if (query) return query;
      }
      return null;
    };
    const { unmount } = render(view({ list: null }));
    const loading = {
      table: breakpoint(screen.getByRole('table', { name: m.loadingCaption })),
      cards: breakpoint(screen.getByRole('list', { name: m.loadingCaption })),
    };
    unmount();
    render(view());
    const loaded = {
      table: breakpoint(screen.getByRole('table', { name: m.caption })),
      cards: breakpoint(screen.getByRole('list', { name: m.caption })),
    };

    expect(loading.table).toBe('@[1120px]:block');
    expect(loading).toEqual(loaded);
  });

  it('says there are no cases yet when nothing is filtered', () => {
    render(view({ list: page([]) }));
    expect(screen.getByText('No cases yet')).toBeTruthy();
    expect(screen.getByText('Cases appear here as declarations are submitted.')).toBeTruthy();
  });

  it('offers to clear the filters when none match', () => {
    const onSearchChange = vi.fn();
    const search: QueueSearch = { band: 'high', late: true };
    render(view({ list: page([]), search, onSearchChange }));
    expect(screen.getByText('No matches')).toBeTruthy();
    const empty = screen.getByText('No cases match these filters or this search.').parentElement;
    if (!empty) throw new Error('no empty state');
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('shows an error with a retry when the queue cannot be loaded', () => {
    const failed: ServiceResult<QueuePage> = {
      ok: false,
      error: { kind: 'unavailable', detail: null },
    };
    render(view({ list: failed }));
    expect(screen.getByText('The review queue could not be loaded')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    // The tiles still show the counts.
    expect(screen.getByRole('group', { name: 'Cases by status' })).toBeTruthy();
  });

  it('loads more cases after the first page', async () => {
    const loadPage = vi.fn().mockResolvedValue(page([HELD]));
    render(view({ list: page([UNASSIGNED], 'next'), loadPage }));
    expect(screen.getByText('Showing the first 1 case')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      await Promise.resolve();
    });
    expect(loadPage).toHaveBeenCalledWith('next');
    expect(await screen.findByText('Showing all 2 cases')).toBeTruthy();
  });

  it('N5: starts the list again with each first page loaded, even one with the same cases', async () => {
    const loadPage = vi.fn().mockResolvedValue(page([HELD]));
    const { rerender } = render(view({ list: page([UNASSIGNED], 'next'), loadPage }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      await Promise.resolve();
    });
    expect(await screen.findByText('Showing all 2 cases')).toBeTruthy();

    // A reload (after a claim, say) gives a new first page.
    rerender(view({ list: page([UNASSIGNED], 'next'), loadPage }));

    expect(screen.getByText('Showing the first 1 case')).toBeTruthy();
  });
});
