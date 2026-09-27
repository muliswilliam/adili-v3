// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DirectoryResult,
  RosterRecordListItem,
  RosterRecordPage,
} from '../../server/directory/client';
import { FlaggedList, type FlaggedListProps } from './flagged-list';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const confirmRosterExits = vi.fn();
const keepRosterRecords = vi.fn();
vi.mock('../../server/roster-exits', () => ({
  confirmRosterExits: (...args: unknown[]) => confirmRosterExits(...args) as unknown,
  keepRosterRecords: (...args: unknown[]) => keepRosterRecords(...args) as unknown,
}));

function record(index: number, overrides: Partial<RosterRecordListItem> = {}) {
  return {
    id: `0191f8d2-0000-7000-8000-00000000000${String(index)}`,
    personnelFileNumber: `PSC/2019/000${String(index)}`,
    fullName: ['Achieng Otieno', 'Brian Kiprono', 'Chebet Wanjiru', 'Daniel Mwangi'][index] ?? '',
    nationalIdMasked: '•••••123',
    designation: 'Senior Accountant',
    jobGroup: 'L',
    reportingEntity: null,
    state: 'not_onboarded',
    absentFromLatestImport: true,
    flaggedByImportId: '0191f8d2-0000-7000-8000-0000000000f1',
    flaggedAt: '2026-09-21T09:30:00Z',
    ...overrides,
  } satisfies RosterRecordListItem;
}

function page(items: RosterRecordListItem[], nextCursor: string | null = null) {
  return { ok: true, data: { items, nextCursor } } as DirectoryResult<RosterRecordPage>;
}

function renderList(overrides: Partial<FlaggedListProps> = {}) {
  const props: FlaggedListProps = {
    slug: 'psc',
    result: page([record(0), record(1), record(2)]),
    loadPage: vi.fn(),
    recordLink: (item) => <a href={`/roster/records/${item.id}`}>{item.fullName}</a>,
    readOnly: false,
    ...overrides,
  };
  render(
    <ToastProvider>
      <FlaggedList {...props} />
    </ToastProvider>,
  );
  return props;
}

const table = () => screen.getByRole('table', { name: 'Flagged officers ordered by name' });
const selectAll = () => screen.getByRole('checkbox', { name: 'Select all on page' });
const bulkBar = () => screen.queryByRole('region', { name: 'Bulk actions' });
const bar = () => screen.getByRole('region', { name: 'Bulk actions' });

beforeEach(() => {
  invalidate.mockReset();
  confirmRosterExits.mockReset();
  keepRosterRecords.mockReset();
});

describe('FlaggedList', () => {
  it('lists flagged officers with the date they were flagged, and no bulk bar yet', () => {
    renderList();
    const row = within(table()).getByRole('row', { name: /Achieng Otieno/ });
    expect(within(row).getByText('PSC/2019/0000')).toBeTruthy();
    expect(within(row).getByText('21 Sep 2026')).toBeTruthy();
    expect(within(row).getByText('Not onboarded')).toBeTruthy();
    expect(bulkBar()).toBeNull();
  });

  it('selects all on the page and shows the bulk bar with the count', () => {
    renderList();
    fireEvent.click(selectAll());
    expect(within(bar()).getByText('3 officers selected')).toBeTruthy();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Clear' }));
    expect(bulkBar()).toBeNull();
  });

  it('select all covers officers loaded with "Load more"', async () => {
    const loadPage = vi.fn().mockResolvedValue(page([record(3)]));
    renderList({ result: page([record(0), record(1)], 'next'), loadPage });
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Daniel Mwangi');
    expect(loadPage).toHaveBeenCalledWith('next');
    expect((selectAll() as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(selectAll());
    expect(within(bar()).getByText('3 officers selected')).toBeTruthy();
  });

  it('marks the selected officers as still employed and reloads', async () => {
    keepRosterRecords.mockResolvedValue({ ok: true, data: { count: 2 } });
    renderList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Achieng Otieno' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Chebet Wanjiru' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Still employed' }));
    await screen.findByText('2 officers marked as still employed');
    expect(keepRosterRecords).toHaveBeenCalledWith({
      data: {
        slug: 'psc',
        idempotencyKey: expect.any(String) as string,
        recordIds: [record(0).id, record(2).id],
      },
    });
    expect(invalidate).toHaveBeenCalled();
    expect(bulkBar()).toBeNull();
  });

  it('keeps the selection and says so when "Still employed" fails', async () => {
    keepRosterRecords.mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    renderList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Brian Kiprono' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Still employed' }));
    await screen.findByText('Nobody was marked as still employed. Try again.');
    expect(within(bar()).getByText('1 officer selected')).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('confirms exits for the selection with one date', async () => {
    confirmRosterExits.mockResolvedValue({ ok: true, data: { batchId: 'b', count: 2 } });
    renderList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Achieng Otieno' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Brian Kiprono' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Confirm exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm 2 exits' });
    fireEvent.change(within(dialog).getByLabelText('Exit date'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm 2 exits' }));
    await screen.findByText('2 exits recorded');
    expect(confirmRosterExits).toHaveBeenCalledWith({
      data: {
        slug: 'psc',
        idempotencyKey: expect.any(String) as string,
        exits: {
          exitDate: '2026-09-01',
          records: [{ recordId: record(0).id }, { recordId: record(1).id }],
        },
      },
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
    expect(bulkBar()).toBeNull();
  });

  it('drops officers who are no longer flagged when the list reloads', () => {
    const { rerender } = render(
      <ToastProvider>
        <FlaggedList
          slug="psc"
          result={page([record(0), record(1)])}
          loadPage={vi.fn()}
          recordLink={(item) => item.fullName}
          readOnly={false}
        />
      </ToastProvider>,
    );
    fireEvent.click(selectAll());
    rerender(
      <ToastProvider>
        <FlaggedList
          slug="psc"
          result={page([record(1)])}
          loadPage={vi.fn()}
          recordLink={(item) => item.fullName}
          readOnly={false}
        />
      </ToastProvider>,
    );
    expect(within(bar()).getByText('1 officer selected')).toBeTruthy();
  });

  it('has no checkboxes or bulk bar for commission admins', () => {
    renderList({ readOnly: true });
    expect(within(table()).queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('says when nobody is flagged', () => {
    renderList({ result: page([]), emptyAction: <a href="/roster">Roster overview</a> });
    expect(screen.getByText('Nobody is flagged.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Roster overview' })).toBeTruthy();
  });

  it('shows a load error with the reason', () => {
    renderList({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('Flagged officers could not be loaded.')).toBeTruthy();
  });
});
