// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NewDataTable } from './new-data-table';
import { TableRowLink } from './table';

const columns = [
  {
    id: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (row: { id: string; name: string }) => (
      <TableRowLink href={`/records/${row.id}`}>{row.name}</TableRowLink>
    ),
  },
];

describe('NewDataTable', () => {
  it('preserves table semantics and links with caller-defined columns', () => {
    render(
      <NewDataTable
        caption="Requests"
        columns={columns}
        rows={[{ id: 'one', name: 'Mercy' }]}
        getRowId={(row) => row.id}
        filters={<button type="button">All requests</button>}
        search={<input type="search" aria-label="Search requests" />}
      />,
    );
    const table = screen.getByRole('table', { name: 'Requests' });
    expect(within(table).getByRole('columnheader').textContent).toBe('Name');
    expect(within(table).getByRole('rowheader').textContent).toBe('Mercy');
    expect(within(table).getByRole('link').getAttribute('href')).toBe('/records/one');
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('keeps headers and marks the table busy while loading', () => {
    render(
      <NewDataTable
        caption="Requests"
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        loading
        loadingRows={3}
      />,
    );
    const table = screen.getByRole('table');
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('shows the supplied empty state and footer without an empty table', () => {
    render(
      <NewDataTable
        caption="Requests"
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        empty={<p>No requests</p>}
        footer={<p>0 requests</p>}
      />,
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No requests')).toBeTruthy();
    expect(screen.getByText('0 requests')).toBeTruthy();
  });
});
