// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RosterImport } from '../../server/directory/client';
import { ImportHistoryResults } from './import-history-table';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: { importId: string };
    children: ReactNode;
  }) => (
    <a href={to.replace('$importId', params.importId)} {...props}>
      {children}
    </a>
  ),
}));

const completed: RosterImport = {
  id: '0199a0b4-0000-7000-8000-0000000000aa',
  channel: 'file',
  declaredComplete: true,
  state: 'completed',
  fileName: 'psc-roster-2026-09-25.xlsx',
  format: 'xlsx',
  totalRows: 48_317,
  processedRows: 48_317,
  counts: {
    accepted: 48_286,
    created: 58,
    updated: 312,
    unchanged: 47_916,
    rejected: 31,
    flaggedAbsent: 14,
    exitsRecorded: 0,
  },
  mapping: null,
  failure: null,
  startedBy: { kind: 'user', id: 'user-1', name: 'Grace Muthoni' },
  startedAt: '2026-09-25T11:12:00Z',
  completedAt: '2026-09-25T11:31:00Z',
  rowsRetainedUntil: '2026-10-25T11:31:00Z',
};

const running: RosterImport = {
  ...completed,
  id: '0199a0b4-0000-7000-8000-0000000000bb',
  channel: 'api',
  declaredComplete: false,
  state: 'processing',
  fileName: null,
  format: 'json',
  totalRows: 240,
  processedRows: 60,
  counts: null,
  startedBy: { kind: 'client', id: 'roster-psc', name: 'roster-psc' },
  startedAt: '2026-09-26T03:00:00Z',
  completedAt: null,
  rowsRetainedUntil: null,
};

function rowOf(table: HTMLElement, startedAt: string): HTMLElement {
  const row = within(table).getByRole('link', { name: startedAt }).closest('tr');
  if (!row) throw new Error(`no row for ${startedAt}`);
  return row;
}

describe('ImportHistoryResults', () => {
  it('lists each import with its channel, completeness, state, counts and who started it', () => {
    render(<ImportHistoryResults items={[completed]} />);
    const table = screen.getByRole('table', { name: 'Imports, newest first' });
    const row = rowOf(table, '25 Sep 2026, 14:12');
    expect(within(row).getByRole('link').getAttribute('href')).toBe(
      `/roster/imports/${completed.id}`,
    );
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual(['File', 'Yes', 'Completed', '58', '312', '31', '14', 'Grace Muthoni']);
    expect(within(row).getByText('psc-roster-2026-09-25.xlsx')).toBeTruthy();
  });

  it('shows a running HR system batch with its progress and no counts yet', () => {
    render(<ImportHistoryResults items={[running]} />);
    const table = screen.getByRole('table', { name: 'Imports, newest first' });
    const row = rowOf(table, '26 Sep 2026, 06:00');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]?.textContent).toBe('API');
    expect(cells[1]?.textContent).toBe('Partial');
    expect(cells[2]?.textContent).toBe('Processing25%');
    expect(cells[3]?.textContent).toBe('-Not counted yet');
    expect(cells[7]?.textContent).toBe('HR systemroster-psc');
    expect(within(row).getByText('Batch of 240 rows')).toBeTruthy();
  });

  it('names an officer whose token had no name as unknown', () => {
    render(
      <ImportHistoryResults
        items={[{ ...completed, startedBy: { kind: 'user', id: 'user-2', name: null } }]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Imports, newest first' });
    expect(within(table).getByText('Unknown user')).toBeTruthy();
  });
});
