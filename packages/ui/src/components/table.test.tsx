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

  it('scopes column headers to columns and row headers to rows', () => {
    render(<CommissionsTable />);

    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('scope')).toBe('col');
    expect(
      screen.getByRole('rowheader', { name: 'Public Service Commission' }).getAttribute('scope'),
    ).toBe('row');
  });

  it('renders the row link as a single keyboard-reachable link', () => {
    render(<CommissionsTable />);

    const link = screen.getByRole('link', { name: 'Public Service Commission' });
    expect(link.getAttribute('href')).toBe('/commissions/psc');
    expect(link.hasAttribute('data-row-link')).toBe(true);
  });
});
