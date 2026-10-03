import { describe, expect, it } from 'vitest';

import {
  type CountCell,
  type CountTable,
  type ReleasedCell,
  type ReleasedTable,
  suppressTable,
} from '../../src/open-data/suppression.js';

/**
 * S4 suppression golden fixtures: a figure over fewer than 10 officers is released as
 * `suppressed: true, value: null`, and complementary suppression leaves no row or column (totals
 * included) where a suppressed figure could be recovered from the others.
 */

const S: ReleasedCell = { suppressed: true, value: null };
const v = (value: number): ReleasedCell => ({ suppressed: false, value });
const c = (value: number, officers: number): CountCell => ({ value, officers });

/** Every additive line of a released table: rows and columns with their totals, and the margins. */
function linesOf(table: ReleasedTable): ReleasedCell[][] {
  const columns: ReleasedCell[][] = table.columnTotals.map((columnTotal) => [columnTotal]);
  for (const row of table.cells) row.forEach((cell, c) => columns[c]?.unshift(cell));
  return [
    ...table.cells.map((row, r) => [...row, table.rowTotals[r] ?? S]),
    [...table.columnTotals, table.total],
    ...columns,
    [...table.rowTotals, table.total],
  ];
}

/** Lines where one suppressed figure is the total minus (or plus) the published ones. */
function recoverableLines(table: ReleasedTable): ReleasedCell[][] {
  return linesOf(table).filter(
    (line) => line.length > 1 && line.filter((cell) => cell.suppressed).length === 1,
  );
}

// Responsible Commissions by reporting entity type: declared of expected officers.
const threeByThree: CountTable = {
  rows: ['psc', 'tsc', 'jsc'],
  columns: ['ministry', 'county', 'state-corporation'],
  cells: [
    [c(40, 50), c(7, 8), c(30, 35)],
    [c(60, 70), c(20, 25), c(15, 18)],
    [c(12, 15), c(25, 30), c(45, 50)],
  ],
};

describe('open data suppression', () => {
  it('releases every figure with recomputed totals when all denominators reach the threshold', () => {
    const table: CountTable = {
      rows: ['psc', 'tsc'],
      columns: ['ministry', 'county'],
      cells: [
        [c(10, 10), c(12, 20)],
        [c(30, 40), c(0, 15)],
      ],
    };

    expect(suppressTable(table)).toEqual({
      rows: ['psc', 'tsc'],
      columns: ['ministry', 'county'],
      cells: [
        [v(10), v(12)],
        [v(30), v(0)],
      ],
      rowTotals: [v(22), v(30)],
      columnTotals: [v(40), v(12)],
      total: v(52),
    });
  });

  it('suppresses complementary cells in a 3x3 where the row total would reveal the cell', () => {
    // psc's county cell counts 8 officers. Released alone, psc's total gives it away:
    // 77 - 40 - 30 = 7. So psc's next smallest cell goes too, and then the county and
    // state-corporation columns each need a second suppressed cell.
    const released = suppressTable(threeByThree);

    expect(released).toEqual({
      rows: ['psc', 'tsc', 'jsc'],
      columns: ['ministry', 'county', 'state-corporation'],
      cells: [
        [v(40), S, S],
        [v(60), S, S],
        [v(12), v(25), v(45)],
      ],
      rowTotals: [v(77), v(95), v(82)],
      columnTotals: [v(112), v(52), v(90)],
      total: v(254),
    });
    expect(recoverableLines(released)).toEqual([]);
  });

  it('suppresses a total over fewer than 10 officers and protects it through the margins', () => {
    // psc's cells and its total (9 officers) are all below the threshold. With two Commissions,
    // the grand total minus tsc's total would reveal psc's, so tsc's total is suppressed too.
    const released = suppressTable({
      rows: ['psc', 'tsc'],
      columns: ['ministry', 'county'],
      cells: [
        [c(3, 4), c(2, 5)],
        [c(50, 60), c(30, 40)],
      ],
    });

    expect(released).toEqual({
      rows: ['psc', 'tsc'],
      columns: ['ministry', 'county'],
      cells: [
        [S, S],
        [S, S],
      ],
      rowTotals: [S, S],
      columnTotals: [v(53), v(32)],
      total: v(85),
    });
    expect(recoverableLines(released)).toEqual([]);
  });

  it('suppresses a row total when it is the only other figure in its row', () => {
    const released = suppressTable({
      rows: ['psc', 'tsc', 'jsc'],
      columns: ['all'],
      cells: [[c(5, 8)], [c(40, 50)], [c(30, 40)]],
    });

    expect(released).toEqual({
      rows: ['psc', 'tsc', 'jsc'],
      columns: ['all'],
      cells: [[S], [v(40)], [S]],
      rowTotals: [S, v(40), S],
      columnTotals: [v(75)],
      total: v(75),
    });
    expect(recoverableLines(released)).toEqual([]);
  });

  it('picks the next smallest value, then the fewest officers, then the first in order', () => {
    const released = suppressTable({
      rows: ['psc'],
      columns: ['ministry', 'county', 'state-corporation', 'other'],
      cells: [[c(1, 2), c(20, 40), c(20, 30), c(20, 30)]],
    });

    // The tie at 20 goes to the fewer officers (30), and between those to state-corporation.
    expect(released.cells[0]).toEqual([S, v(20), S, v(20)]);
    expect(recoverableLines(released)).toEqual([]);
  });

  it('takes the threshold as a parameter', () => {
    expect(
      suppressTable(threeByThree, { threshold: 5 })
        .cells.flat()
        .some((cell) => cell.suppressed),
    ).toBe(false);

    const strict = suppressTable(threeByThree, { threshold: 20 });
    // Every cell under 20 officers (psc county, tsc state-corporation, jsc ministry) is suppressed.
    expect(strict.cells[0]?.[1]).toEqual(S);
    expect(strict.cells[1]?.[2]).toEqual(S);
    expect(strict.cells[2]?.[0]).toEqual(S);
    expect(recoverableLines(strict)).toEqual([]);
  });

  it('is idempotent: re-running, or re-running with its suppressions as given, changes nothing', () => {
    const released = suppressTable(threeByThree);
    expect(suppressTable(threeByThree)).toEqual(released);

    const withSuppressionsGiven: CountTable = {
      ...threeByThree,
      cells: threeByThree.cells.map((row, r) =>
        row.map((cell, col) =>
          released.cells[r]?.[col]?.suppressed ? { ...cell, officers: 0 } : cell,
        ),
      ),
    };
    expect(suppressTable(withSuppressionsGiven)).toEqual(released);
  });

  it('rejects a table whose cells do not match its rows and columns', () => {
    expect(() => suppressTable({ rows: ['psc'], columns: ['ministry'], cells: [] })).toThrow(
      RangeError,
    );
    expect(() =>
      suppressTable({ rows: ['psc'], columns: ['ministry', 'county'], cells: [[c(1, 10)]] }),
    ).toThrow(RangeError);
  });
});
