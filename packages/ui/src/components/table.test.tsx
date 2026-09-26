import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from './table';

function CommissionsTable() {
  return (
    <Table>
      <TableCaption>Responsible Commissions</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Commission</TableHead>
          <TableHead>Type</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <TableRowLink href="/commissions/mombasa-cpsb">Mombasa CPSB</TableRowLink>
          </TableCell>
          <TableCell>Hosted</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe('Table', () => {
  it('names the table with a visually hidden caption', () => {
    render(<CommissionsTable />);

    const table = screen.getByRole('table', { name: 'Responsible Commissions' });
    expect(table.querySelector('caption')?.className).toContain('sr-only');
  });

  it('scopes header cells to their column', () => {
    render(<CommissionsTable />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((th) => th.getAttribute('scope'))).toEqual(['col', 'col']);
  });

  it('lets a header cell scope a row instead', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableHead scope="row">Issuer code</TableHead>
          </tr>
        </tbody>
      </table>,
    );

    expect(screen.getByRole('rowheader', { name: 'Issuer code' }).getAttribute('scope')).toBe(
      'row',
    );
  });

  it('shows the caption on screen when visible is set', () => {
    render(
      <Table>
        <TableCaption visible>Recent imports</TableCaption>
      </Table>,
    );

    expect(screen.getByText('Recent imports').className).not.toContain('sr-only');
  });

  it('stretches the row link over its row', () => {
    render(<CommissionsTable />);

    const link = screen.getByRole('link', { name: 'Mombasa CPSB' });
    expect(link.getAttribute('href')).toBe('/commissions/mombasa-cpsb');
    expect(link.className).toContain('after:inset-0');
    expect(link.closest('tr')?.className).toContain('relative');
  });

  it('renders a router link as the row link when asChild is set', () => {
    render(
      <TableRowLink asChild>
        <a href="/commissions/kenya-ports" data-router="">
          Kenya Ports Authority
        </a>
      </TableRowLink>,
    );

    const link = screen.getByRole('link', { name: 'Kenya Ports Authority' });
    expect(link.hasAttribute('data-router')).toBe(true);
    expect(link.className).toContain('after:absolute');
  });
});
