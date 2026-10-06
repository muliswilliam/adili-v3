import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('Table scrolling sideways (#622)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** jsdom lays nothing out: give the scroller a width, its content one, and a scroll offset. */
  function measure(scroller: HTMLElement, sizes: { client: number; scroll: number; left: number }) {
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: sizes.client });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: sizes.scroll });
    scroller.scrollLeft = sizes.left;
  }

  function scrollerOf(table: HTMLElement): HTMLElement {
    const scroller = table.parentElement;
    if (!scroller) throw new Error('no scroller');
    return scroller;
  }

  it('marks the edge it can still scroll past (the content fades out there), and neither when the table fits', () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    render(<CommissionsTable />);
    const scroller = scrollerOf(screen.getByRole('table', { name: 'Commissions' }));
    expect(scroller.className).toContain('overflow-x-auto');

    measure(scroller, { client: 600, scroll: 900, left: 0 });
    act(() => {
      for (const resized of observers) resized();
    });
    expect(scroller.hasAttribute('data-scroll-end')).toBe(true);
    expect(scroller.hasAttribute('data-scroll-start')).toBe(false);

    measure(scroller, { client: 600, scroll: 900, left: 300 });
    fireEvent.scroll(scroller);
    expect(scroller.hasAttribute('data-scroll-start')).toBe(true);
    expect(scroller.hasAttribute('data-scroll-end')).toBe(false);

    measure(scroller, { client: 900, scroll: 900, left: 0 });
    act(() => {
      for (const resized of observers) resized();
    });
    expect(scroller.hasAttribute('data-scroll-start')).toBe(false);
    expect(scroller.hasAttribute('data-scroll-end')).toBe(false);
  });
});
