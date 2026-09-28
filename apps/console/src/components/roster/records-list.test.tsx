// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  DirectoryResult,
  RosterRecordListItem,
  RosterRecordPage,
} from '../../server/directory/client';
import { RecordsList, type RecordsListProps } from './records-list';
import type { RecordsSearch } from './records-query';

// LoadError's Retry reruns loaders through the router; no router is needed to render it here.
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

function record(overrides: Partial<RosterRecordListItem> = {}): RosterRecordListItem {
  return {
    id: '0191f8d2-0000-7000-8000-000000000001',
    personnelFileNumber: 'PSC/2019/0412',
    fullName: 'Achieng Otieno',
    nationalIdMasked: '•••••123',
    designation: 'Senior Accountant',
    jobGroup: 'L',
    reportingEntity: {
      id: '0191f8d2-0000-7000-8000-0000000000e1',
      name: 'State Department for Devolution',
    },
    state: 'not_onboarded',
    absentFromLatestImport: false,
    flaggedByImportId: null,
    flaggedAt: null,
    ofr: null,
    onboardedAt: null,
    identityMismatchAt: null,
    ...overrides,
  };
}

function page(items: RosterRecordListItem[], nextCursor: string | null = null) {
  return { ok: true, data: { items, nextCursor } } as DirectoryResult<RosterRecordPage>;
}

function renderList(overrides: Partial<RecordsListProps> & { search?: RecordsSearch } = {}) {
  const props: RecordsListProps = {
    result: page([record()]),
    search: {},
    onSearchChange: vi.fn(),
    loadPage: vi.fn(),
    recordLink: (item) => <a href={`/roster/records/${item.id}`}>{item.fullName}</a>,
    readOnly: false,
    ...overrides,
  };
  render(<RecordsList {...props} />);
  return props;
}

const table = () => screen.getByRole('table', { name: 'Roster records ordered by name' });

describe('RecordsList', () => {
  it('lists records with the national ID masked and read out as masked', () => {
    renderList();
    const row = within(table()).getByRole('row', { name: /Achieng Otieno/ });
    expect(within(row).getByText('PSC/2019/0412')).toBeTruthy();
    expect(within(row).getByText('•••••123').getAttribute('aria-hidden')).toBe('true');
    expect(within(row).getByText('masked, ends in 1 2 3')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Achieng Otieno' }).getAttribute('href')).toBe(
      '/roster/records/0191f8d2-0000-7000-8000-000000000001',
    );
    expect(within(row).getByText('Not onboarded')).toBeTruthy();
  });

  it('never shows more than the last three digits, even if a full ID reaches the list', () => {
    renderList({ result: page([record({ nationalIdMasked: '27481123' })]) });
    expect(within(table()).queryByText('27481123')).toBeNull();
    expect(within(table()).getByText('•••••123')).toBeTruthy();
  });

  it('flags records missing from the latest import, but not exited ones', () => {
    renderList({
      result: page([
        record({ absentFromLatestImport: true }),
        record({
          id: '0191f8d2-0000-7000-8000-000000000002',
          fullName: 'Brian Kiprono',
          state: 'exited',
          absentFromLatestImport: true,
        }),
      ]),
    });
    expect(within(table()).getAllByText('Not in latest import')).toHaveLength(1);
    expect(within(table()).getByText('Exited')).toBeTruthy();
  });

  it('shows dashes for missing optional fields', () => {
    renderList({
      result: page([record({ designation: null, jobGroup: null, reportingEntity: null })]),
    });
    expect(within(table()).getAllByText('-')).toHaveLength(3);
  });

  it('offers the import when the roster is empty', () => {
    renderList({ result: page([]), emptyAction: <button type="button">Import roster</button> });
    expect(screen.getByRole('heading', { name: 'No roster records' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import roster' })).toBeTruthy();
  });

  it('tells read-only users the reporting officer has not imported yet', () => {
    renderList({ result: page([]), readOnly: true });
    expect(screen.getByText('The reporting officer has not imported the roster yet.')).toBeTruthy();
  });

  it('says national IDs match only in full when a number found nothing', () => {
    const { onSearchChange } = renderList({ result: page([]), search: { search: '3456' } });
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
    expect(screen.getByText('National IDs only match in full.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('suggests another search when a name found nothing', () => {
    renderList({ result: page([]), search: { search: 'Wanjiru', state: 'exited' } });
    expect(screen.getByText('Try another search or clear the filters.')).toBeTruthy();
  });

  it('says why the records could not be loaded', () => {
    renderList({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('Roster records could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('tells EACC staff records are not theirs to see', () => {
    renderList({
      result: {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
        },
      },
    });
    expect(screen.getByText('You do not have access to roster records.')).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('shows skeleton rows while the first page loads', () => {
    renderList({ result: null });
    expect(
      screen.getByRole('table', { name: 'Loading roster records' }).getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('loads the next page below the first and stops at the end', async () => {
    const loadPage = vi.fn(() =>
      Promise.resolve(
        page([record({ id: '0191f8d2-0000-7000-8000-000000000009', fullName: 'Zawadi Mwangi' })]),
      ),
    );
    renderList({ result: page([record()], 'cursor-2'), loadPage });
    expect(screen.getByText('Showing 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(within(table()).getByRole('link', { name: 'Zawadi Mwangi' })).toBeTruthy();
    });
    expect(loadPage).toHaveBeenCalledWith('cursor-2');
    expect(within(table()).getByRole('link', { name: 'Achieng Otieno' })).toBeTruthy();
    expect(screen.getByText('All 2 records shown')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('keeps the records on show when the next page fails, and lets the user try again', async () => {
    const loadPage = vi.fn(() =>
      Promise.resolve<DirectoryResult<RosterRecordPage>>({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    renderList({ result: page([record()], 'cursor-2'), loadPage });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('More records could not be loaded. Try again.')).toBeTruthy();
    expect(within(table()).getByRole('link', { name: 'Achieng Otieno' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('turns "Flagged only" on with its count', () => {
    const { onSearchChange } = renderList({ flaggedCount: 37 });
    const chip = screen.getByRole('button', { name: /Flagged only/ });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.textContent).toContain('37');
    fireEvent.click(chip);
    expect(onSearchChange).toHaveBeenCalledWith({ flagged: true });
  });

  it('clears every filter at once', () => {
    const { onSearchChange } = renderList({ search: { search: 'Otieno', flagged: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });
});
