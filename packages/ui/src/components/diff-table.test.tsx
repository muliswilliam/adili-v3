import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  diffDelta,
  type DiffGroup,
  diffHighlighted,
  diffKind,
  diffPercent,
  type DiffRow,
  DiffTable,
} from './diff-table';

const KES = (shillings: number) => shillings * 100;

const house: DiffRow = {
  id: 'house',
  label: 'Building',
  description: '4-bedroom house on LR 12715/482',
  previousCents: KES(12_000_000),
  currentCents: KES(16_900_000),
  deltaPercent: 40.83,
  note: 'Marked as changed',
};
const savings: DiffRow = {
  id: 'savings',
  label: 'Bank and cash',
  description: 'KCB Junior savings account',
  previousCents: 0,
  currentCents: KES(45_000),
  deltaPercent: null,
};
const plot: DiffRow = {
  id: 'plot',
  label: 'Land',
  previousCents: KES(2_400_000),
  currentCents: KES(2_400_000),
  deltaPercent: 0,
};
const fund: DiffRow = {
  id: 'fund',
  label: 'Investments',
  description: 'CIC Money Market Fund units',
  previousCents: null,
  currentCents: KES(850_000),
  note: 'marked as acquired',
};
const car: DiffRow = {
  id: 'car',
  label: 'Vehicle',
  description: 'Toyota Probox, KBZ 771A',
  previousCents: KES(600_000),
  currentCents: null,
};
const mortgage: DiffRow = {
  id: 'mortgage',
  label: 'Mortgage',
  description: 'HFC Bank',
  previousCents: KES(7_100_000),
  currentCents: KES(6_300_000),
  deltaPercent: -11.27,
};

const groups: DiffGroup[] = [
  { id: 'assets', label: 'Assets', rows: [house, savings, plot, fund, car] },
  { id: 'liabilities', label: 'Liabilities', rows: [mortgage] },
];

function renderTable() {
  render(
    <DiffTable
      caption="Changes for Wanjiku Kamau between version 1 and version 2"
      previousVersion={1}
      currentVersion={2}
      groups={groups}
    />,
  );
  return screen.getByRole('table', {
    name: 'Changes for Wanjiku Kamau between version 1 and version 2',
  });
}

/** The cells of the row headed by `label`, as screen readers read them. */
function rowOf(label: string) {
  const header = screen.getByRole('rowheader', { name: new RegExp(`^${label}`) });
  const row = header.closest('tr');
  return [...(row?.cells ?? [])].map((cell) =>
    [...cell.querySelectorAll('.sr-only')].length
      ? [...cell.querySelectorAll('.sr-only')].map((el) => el.textContent).join(' ')
      : cell.textContent,
  );
}

describe('diff helpers', () => {
  it('tells matched rows from rows in one version only', () => {
    expect(diffKind(house)).toBe('matched');
    expect(diffKind(fund)).toBe('only-current');
    expect(diffKind(car)).toBe('only-previous');
  });

  it('counts a missing side as zero', () => {
    expect(diffDelta(house)).toBe(KES(4_900_000));
    expect(diffDelta(fund)).toBe(KES(850_000));
    expect(diffDelta(car)).toBe(-KES(600_000));
  });

  it("takes the service's percentage, or computes it; none from zero or for unmatched rows", () => {
    expect(diffPercent(house)).toBe(40.83);
    expect(diffPercent({ ...house, deltaPercent: undefined })).toBeCloseTo(40.83, 2);
    expect(diffPercent(savings)).toBeNull();
    expect(diffPercent({ ...savings, deltaPercent: undefined })).toBeNull();
    expect(diffPercent(fund)).toBeNull();
    expect(diffPercent(car)).toBeNull();
  });
});

describe('DiffTable', () => {
  it('has a column per value and a row header per item, under its group', () => {
    const table = renderTable();

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Item', 'Version 1 (KES)', 'Version 2 (KES)', 'Change (KES)', '%', 'Match']);
    expect(within(table).getByRole('rowheader', { name: 'Assets' }).getAttribute('scope')).toBe(
      'rowgroup',
    );
    expect(
      within(table).getByRole('rowheader', { name: 'Building 4-bedroom house on LR 12715/482' }),
    ).toBeTruthy();
  });

  it("names the previous version's column apart, e.g. for the last cycle's declaration", () => {
    render(
      <DiffTable
        caption="Changes for Wanjiku Kamau"
        previousVersion={1}
        currentVersion={1}
        groups={groups}
        messages={{ previousColumn: () => 'Previous (KES)' }}
      />,
    );
    expect(
      screen
        .getAllByRole('columnheader')
        .slice(1, 3)
        .map((th) => th.textContent),
    ).toEqual(['Previous (KES)', 'Version 1 (KES)']);
  });

  it('shows signed deltas and percentages, and reads them out in words', () => {
    renderTable();

    const visible = (label: string) =>
      [
        ...(screen.getByRole('rowheader', { name: new RegExp(`^${label}`) }).closest('tr')?.cells ??
          []),
      ].map(
        (cell) =>
          [...cell.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent).join('') ||
          cell.textContent,
      );
    expect(visible('Building').slice(1, 5)).toEqual([
      '12,000,000',
      '16,900,000',
      '+4,900,000',
      '+40.8%',
    ]);
    expect(visible('Mortgage').slice(3, 5)).toEqual(['−800,000', '−11.3%']);

    expect(rowOf('Building').slice(3)).toEqual([
      'Increase of KES 4,900,000',
      'Up 40.8 percent',
      'MatchedMarked as changed',
    ]);
    expect(rowOf('Mortgage').slice(3, 5)).toEqual(['Decrease of KES 800,000', 'Down 11.3 percent']);
    expect(rowOf('Land').slice(3, 5)).toEqual(['No change', 'No change']);
  });

  it('says a change under 0.1% is less than 0.1%, never +0.0%', () => {
    render(
      <DiffTable
        caption="Tiny changes"
        previousVersion={1}
        currentVersion={2}
        groups={[
          {
            id: 'assets',
            rows: [
              {
                id: 'up',
                label: 'Land',
                previousCents: KES(10_000_000),
                currentCents: KES(10_000_100),
              },
              {
                id: 'down',
                label: 'Mortgage',
                previousCents: KES(10_000_000),
                currentCents: KES(9_999_900),
                deltaPercent: -0.001,
              },
            ],
          },
        ]}
      />,
    );
    const percentOf = (label: string) => {
      const cells = screen
        .getByRole('rowheader', { name: new RegExp(`^${label}`) })
        .closest('tr')?.cells;
      const cell = cells?.[4];
      return {
        shown: cell?.querySelector('[aria-hidden="true"]')?.textContent,
        said: cell?.querySelector('.sr-only')?.textContent,
      };
    };
    expect(percentOf('Land')).toEqual({ shown: '+<0.1%', said: 'Up less than 0.1 percent' });
    expect(percentOf('Mortgage')).toEqual({
      shown: '−<0.1%',
      said: 'Down less than 0.1 percent',
    });
  });

  it('shows n/a for a null percentage and says why', () => {
    renderTable();

    expect(rowOf('Bank and cash').slice(3, 5)).toEqual([
      'Increase of KES 45,000',
      'No percentage: the previous value was zero',
    ]);
    fireEvent.focus(
      screen.getByText('n/a', { selector: '[tabindex="0"] > span' }).closest('[tabindex]') ??
        document.body,
    );
    expect(screen.getByRole('tooltip').textContent).toBe(
      'No percentage: the previous value was zero',
    );
  });

  it('labels items in one version only as unmatched, with no percentage', () => {
    renderTable();

    expect(rowOf('Investments')).toEqual([
      'InvestmentsCIC Money Market Fund units',
      'None',
      '850,000',
      'New item worth KES 850,000',
      'No percentage: the item is in one version only',
      'UnmatchedOnly in version 2 · marked as acquired',
    ]);
    expect(rowOf('Vehicle')).toEqual([
      'VehicleToyota Probox, KBZ 771A',
      '600,000',
      'None',
      'No longer declared, previously KES 600,000',
      'No percentage: the item is in one version only',
      'UnmatchedNot in current version',
    ]);
  });

  it('shades matched changes of 25% or more', () => {
    renderTable();

    const big = (label: string) =>
      screen
        .getByRole('rowheader', { name: new RegExp(`^${label}`) })
        .closest('tr')
        ?.hasAttribute('data-big');
    expect(big('Building')).toBe(true);
    expect(big('Mortgage')).toBe(false);
    expect(big('Bank and cash')).toBe(false);
    expect(big('Investments')).toBe(false);
  });

  it('shades by the exact percentage: 24.96% shows as +25.0% but is under the threshold', () => {
    const nearly: DiffRow = {
      id: 'nearly',
      label: 'Land',
      previousCents: 100_000_00,
      currentCents: 124_960_00,
    };
    expect(diffHighlighted(nearly)).toBe(false);
    expect(diffHighlighted({ ...nearly, currentCents: 125_000_00 })).toBe(true);
    // Up from nothing has no percentage to shade.
    expect(diffHighlighted({ ...nearly, previousCents: 0 })).toBe(false);
    render(
      <DiffTable
        caption="Nearly"
        previousVersion={1}
        currentVersion={2}
        groups={[{ id: 'g', rows: [nearly] }]}
      />,
    );
    const row = screen.getByRole('rowheader', { name: 'Land' }).closest('tr');
    expect(row?.textContent).toContain('+25.0%');
    expect(row?.hasAttribute('data-big')).toBe(false);
  });

  it('leaves out the group heading for an unnamed group', () => {
    render(
      <DiffTable
        caption="Changes"
        previousVersion={1}
        currentVersion={2}
        groups={[{ id: 'all', rows: [plot] }]}
      />,
    );

    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
  });
});
