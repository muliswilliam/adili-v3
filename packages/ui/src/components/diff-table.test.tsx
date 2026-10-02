import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DiffTable, type DiffTableGroup } from './diff-table';

const groups: DiffTableGroup[] = [
  {
    id: 'assets',
    label: 'Assets',
    rows: [
      {
        id: 'house',
        item: 'Building',
        detail: '4-bedroom house on LR 12715/482',
        match: 'matched',
        previousCents: 1_200_000_000,
        currentCents: 1_690_000_000,
        deltaPercent: 40.83,
        note: 'Not marked',
      },
      {
        id: 'savings',
        item: 'Bank and cash',
        detail: 'KCB Junior savings account',
        match: 'matched',
        previousCents: 0,
        currentCents: 4_500_000,
        deltaPercent: null,
      },
      {
        id: 'land',
        item: 'Land',
        match: 'matched',
        previousCents: 240_000_000,
        currentCents: 240_000_000,
      },
      {
        id: 'fund',
        item: 'Investments',
        match: 'only-current',
        previousCents: null,
        currentCents: 85_000_000,
        note: 'marked as acquired',
      },
      {
        id: 'car',
        item: 'Vehicle',
        match: 'only-previous',
        previousCents: 60_000_000,
        currentCents: null,
      },
    ],
  },
  { id: 'income', label: 'Income', rows: [] },
  {
    id: 'liabilities',
    label: 'Liabilities',
    rows: [
      {
        id: 'mortgage',
        item: 'Mortgage',
        match: 'matched',
        previousCents: 710_000_000,
        currentCents: 630_000_000,
      },
    ],
  },
];

function renderTable(props: Partial<Parameters<typeof DiffTable>[0]> = {}) {
  render(
    <DiffTable
      groups={groups}
      previousVersion={1}
      currentVersion={2}
      caption="Changes for Wanjiku Kamau between version 1 and version 2"
      {...props}
    />,
  );
  return screen.getByRole('table', {
    name: 'Changes for Wanjiku Kamau between version 1 and version 2',
  });
}

const row = (name: string) =>
  screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr') as HTMLElement;
const cells = (name: string) => [...row(name).querySelectorAll('td')];

describe('DiffTable', () => {
  it('heads the columns with both versions and the currency', () => {
    const table = renderTable();

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Item', 'Version 1 (KES)', 'Version 2 (KES)', 'Change (KES)', '%', 'Match']);
  });

  it('groups rows under headings and skips empty groups', () => {
    const table = renderTable();

    expect(
      within(table)
        .getAllByRole('rowheader')
        .filter((header) => header.getAttribute('scope') === 'rowgroup')
        .map((header) => header.textContent),
    ).toEqual(['Assets', 'Liabilities']);
  });

  it('names each row by its item, with the detail', () => {
    renderTable();

    expect(row('Building').querySelector('th')?.textContent).toBe(
      'Building4-bedroom house on LR 12715/482',
    );
  });

  it('shows an increase with sign and percentage, and announces it in words', () => {
    renderTable();

    const [previous, current, change, percent, match] = cells('Building');
    expect(previous?.textContent).toBe('12,000,000');
    expect(current?.textContent).toBe('16,900,000');
    expect(change?.querySelector('[aria-hidden]')?.textContent).toBe('+4,900,000');
    expect(
      within(change as HTMLElement).getByText('Increase of KES 4,900,000, 40.8 percent.'),
    ).toBeTruthy();
    expect(change?.className).toContain('text-warning');
    expect(percent?.textContent).toBe('+40.8%');
    expect(match?.textContent).toBe('MatchedNot marked');
  });

  it('tints the percentage of a big change', () => {
    renderTable();

    expect(cells('Building')[3]?.className).toContain('bg-warning-subtle');
    expect(cells('Mortgage')[3]?.className).not.toContain('bg-warning-subtle');
    expect(row('Building').dataset.highlight).toBe('true');
  });

  it('works out a decrease and its percentage when they are not given', () => {
    renderTable();

    const [, , change, percent] = cells('Mortgage');
    expect(change?.querySelector('[aria-hidden]')?.textContent).toBe('−800,000');
    expect(change?.textContent).toContain('Decrease of KES 800,000, 11.3 percent.');
    expect(change?.className).toContain('text-info-subtle-foreground');
    expect(percent?.textContent).toBe('−11.3%');
  });

  it('handles a null percentage: n/a with the reason, read out with the change', () => {
    renderTable();

    const [, , change, percent] = cells('Bank and cash');
    expect(change?.textContent).toContain(
      'Increase of KES 45,000, no percentage because the previous value was zero.',
    );
    const na = within(percent as HTMLElement).getByRole('img', {
      name: 'No percentage: the previous value was zero',
    });
    expect(na.textContent).toBe('n/a');
    expect(na.tabIndex).toBe(0);
    fireEvent.focus(na);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'No percentage: the previous value was zero',
    );
  });

  it('works out a null percentage when the previous value was zero', () => {
    renderTable({
      groups: [
        {
          id: 'a',
          label: 'Assets',
          rows: [
            { id: 'x', item: 'Shares', match: 'matched', previousCents: 0, currentCents: 100 },
          ],
        },
      ],
    });

    expect(within(cells('Shares')[3] as HTMLElement).getByRole('img').textContent).toBe('n/a');
  });

  it('says when nothing changed', () => {
    renderTable();

    const [, , change, percent] = cells('Land');
    expect(change?.querySelector('[aria-hidden]')?.textContent).toBe('0');
    expect(change?.textContent).toContain('No change.');
    expect(percent?.textContent).toBe('0.0%');
  });

  it('labels an item only in the current version as unmatched, and where it is', () => {
    renderTable();

    const [previous, current, change, percent, match] = cells('Investments');
    expect(row('Investments').dataset.match).toBe('only-current');
    expect(previous?.textContent).toBe('-None');
    expect(current?.textContent).toBe('850,000');
    expect(change?.textContent).toBe('+850,000New item worth KES 850,000.');
    expect(percent?.textContent).toBe('n/aNot applicable');
    expect(match?.textContent).toBe('UnmatchedOnly in version 2 · marked as acquired');
  });

  it('labels an item no longer declared as unmatched', () => {
    renderTable();

    const [previous, current, change, , match] = cells('Vehicle');
    expect(previous?.textContent).toBe('600,000');
    expect(current?.textContent).toBe('-None');
    expect(change?.textContent).toBe('−600,000Item no longer declared, previously KES 600,000.');
    expect(match?.textContent).toBe('UnmatchedNot in current version');
  });

  it('says nothing was declared when no group has rows', () => {
    render(
      <DiffTable
        groups={[{ id: 'a', label: 'Assets', rows: [] }]}
        previousVersion={1}
        currentVersion={2}
        caption="Changes"
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Nil declared in both versions')).toBeTruthy();
  });

  it('takes other wording and currency', () => {
    renderTable({
      currency: 'KSh',
      messages: { matched: 'Imelingana', version: (version) => `Toleo ${String(version)}` },
    });

    expect(screen.getByRole('columnheader', { name: 'Toleo 1' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Change (KSh)' })).toBeTruthy();
    expect(screen.getAllByText('Imelingana')).toHaveLength(4);
    expect(cells('Building')[2]?.textContent).toContain('Increase of KSh 4,900,000');
  });
});
