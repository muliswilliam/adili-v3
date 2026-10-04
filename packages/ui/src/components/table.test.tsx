import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from './table';

function CommissionsTable() {
  return (
    <Table caption="Commissions">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableHead scope="row">
            <TableRowLink href="/commissions/psc">Public Service Commission</TableRowLink>
          </TableHead>
          <TableCell>Constitutional</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe('Table', () => {
  it('names the table with a visually hidden caption', () => {
    render(<CommissionsTable />);

    const table = screen.getByRole('table', { name: 'Commissions' });
    const caption = table.querySelector('caption');
    expect(caption?.className).toContain('sr-only');
  });

  it('can show its caption as the table’s title', () => {
    render(
      <Table caption="Section 1(d)" showCaption>
        <TableBody />
      </Table>,
    );

    expect(screen.getByRole('table', { name: 'Section 1(d)' })).toBeTruthy();
    const title = screen.getAllByText('Section 1(d)').find((node) => node.tagName !== 'CAPTION');
    expect(title?.getAttribute('aria-hidden')).toBe('true');
    expect(title?.className).not.toContain('sr-only');
  });

  it('scopes column headers to columns and row headers to rows', () => {
    render(<CommissionsTable />);

    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('scope')).toBe('col');
    expect(
      screen.getByRole('rowheader', { name: 'Public Service Commission' }).getAttribute('scope'),
    ).toBe('row');
  });

  it('states each part’s role, so a row restyled as a card on phones stays a table row (Q32)', () => {
    render(<CommissionsTable />);

    const table = screen.getByRole('table', { name: 'Commissions' });
    expect(table.getAttribute('role')).toBe('table');
    for (const group of table.querySelectorAll('thead, tbody')) {
      expect(group.getAttribute('role')).toBe('rowgroup');
    }
    for (const row of table.querySelectorAll('tr')) expect(row.getAttribute('role')).toBe('row');
    for (const cell of table.querySelectorAll('td')) expect(cell.getAttribute('role')).toBe('cell');
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('role')).toBe(
      'columnheader',
    );
    expect(
      screen.getByRole('rowheader', { name: 'Public Service Commission' }).getAttribute('role'),
    ).toBe('rowheader');
  });

  it('renders the row link as a single keyboard-reachable link', () => {
    render(<CommissionsTable />);

    const link = screen.getByRole('link', { name: 'Public Service Commission' });
    expect(link.getAttribute('href')).toBe('/commissions/psc');
    expect(link.hasAttribute('data-row-link')).toBe(true);
  });
});
