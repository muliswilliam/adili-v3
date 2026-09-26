import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DataTable, type DataTableColumn } from './data-table';

interface Officer {
  id: string;
  name: string;
  designation: string;
}

const officers: Officer[] = [
  { id: 'a', name: 'Jane Doe', designation: 'Director' },
  { id: 'b', name: 'John Kamau', designation: 'Clerk' },
];

const columns: DataTableColumn<Officer>[] = [
  { id: 'name', header: 'Full name', cell: (row) => row.name, rowHeader: true },
  { id: 'designation', header: 'Designation', cell: (row) => row.designation },
];

function FlaggedTable({ initial = [] as string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  return (
    <>
      <DataTable
        caption="Flagged officers"
        columns={columns}
        rows={officers}
        getRowId={(row) => row.id}
        selection={{
          selected,
          onChange: setSelected,
          rowLabel: (id) => `Select ${officers.find((o) => o.id === id)?.name ?? id}`,
        }}
      />
      <p data-testid="selected">{[...selected].sort().join(',')}</p>
    </>
  );
}

function selectedIds() {
  return screen.getByTestId('selected').textContent;
}

describe('DataTable', () => {
  it('renders columns with the naming column as row headers', () => {
    render(
      <DataTable caption="Roster" columns={columns} rows={officers} getRowId={(row) => row.id} />,
    );

    expect(screen.getByRole('table', { name: 'Roster' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Designation' })).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Jane Doe' })).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('selects rows through labelled checkboxes and announces the count', () => {
    render(<FlaggedTable />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select John Kamau' }));

    expect(selectedIds()).toBe('b');
    expect(screen.getByRole('status').textContent).toBe('1 selected');
  });

  it('selects and clears every row on the page, keeping selections from other pages', () => {
    render(<FlaggedTable initial={['z']} />);
    const selectAll = screen.getByRole('checkbox', { name: 'Select all on page' });

    fireEvent.click(selectAll);
    expect(selectedIds()).toBe('a,b,z');
    expect((selectAll as HTMLInputElement).checked).toBe(true);

    fireEvent.click(selectAll);
    expect(selectedIds()).toBe('z');
  });

  it('shows the select-all checkbox as mixed when some rows are selected', () => {
    render(<FlaggedTable initial={['a']} />);

    const selectAll = screen.getByRole('checkbox', { name: 'Select all on page' });
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    expect((selectAll as HTMLInputElement).checked).toBe(false);
  });
});
