/**
 * Statistical disclosure control for open data tables (spec 09b S4). Pure: a table of counts in,
 * the same table with its totals and suppression markers out.
 *
 * A cell is suppressed when its officer denominator (the officers it counts over) is below the
 * threshold: the published marker is `suppressed: true` with `value: null`. Totals are recomputed
 * from the cells and published as true sums, so a release still reconciles with the NCR. Because
 * every row and column adds up to its total, a lone suppressed cell in a line could be recovered
 * by subtraction; complementary suppression therefore checks every row and column (totals
 * included) and, while any line holds exactly one suppressed figure, suppresses the next smallest
 * figure in that line. Totals apply the same threshold to their own denominators.
 *
 * Deterministic and idempotent: the same table always yields the same markers, and the result
 * has no line with a single suppressed figure, so suppressing it again changes nothing.
 */

/** The default minimum officer denominator for a published figure. */
export const SUPPRESSION_THRESHOLD = 10;

/** One count and the number of officers it counts over (e.g. declared of expected officers). */
export interface CountCell {
  value: number;
  officers: number;
}

/**
 * A two-way table of counts, such as Responsible Commissions by reporting entity type.
 * `cells[r][c]` is the count for `rows[r]` and `columns[c]`.
 */
export interface CountTable {
  rows: readonly string[];
  columns: readonly string[];
  cells: readonly (readonly CountCell[])[];
}

/** A figure as released: its value, or the suppression marker. */
export type ReleasedCell = { suppressed: false; value: number } | { suppressed: true; value: null };

/** A table as released, with recomputed row, column and grand totals. */
export interface ReleasedTable {
  rows: string[];
  columns: string[];
  cells: ReleasedCell[][];
  rowTotals: ReleasedCell[];
  columnTotals: ReleasedCell[];
  total: ReleasedCell;
}

export interface SuppressionOptions {
  /** Figures over fewer officers than this are suppressed. Default {@link SUPPRESSION_THRESHOLD}. */
  threshold?: number;
}

/** Interior cells are suppressed in preference to totals, and the grand total last. */
const Rank = { Cell: 0, Margin: 1, Total: 2 } as const;
type Rank = (typeof Rank)[keyof typeof Rank];

interface Figure {
  value: number;
  officers: number;
  rank: Rank;
  /** Position in a fixed order, the final tiebreak. */
  order: number;
  suppressed: boolean;
}

export function suppressTable(table: CountTable, options: SuppressionOptions = {}): ReleasedTable {
  const threshold = options.threshold ?? SUPPRESSION_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError(
      `Suppression threshold must be a non-negative number, got ${String(threshold)}`,
    );
  }
  if (table.cells.length !== table.rows.length) {
    throw new RangeError(
      `Table has ${String(table.rows.length)} rows but ${String(table.cells.length)} cell rows`,
    );
  }
  for (const row of table.cells) {
    if (row.length !== table.columns.length) {
      throw new RangeError(
        `Table has ${String(table.columns.length)} columns but a row of ${String(row.length)} cells`,
      );
    }
  }

  let order = 0;
  const figure = (value: number, officers: number, rank: Rank): Figure => ({
    value,
    officers,
    rank,
    order: (order += 1),
    suppressed: officers < threshold,
  });
  /** A line of figures with the total they add up to. */
  const lineOf = (members: Figure[], rank: Rank): { members: Figure[]; total: Figure } => ({
    members,
    total: figure(
      members.reduce((total, f) => total + f.value, 0),
      members.reduce((total, f) => total + f.officers, 0),
      rank,
    ),
  });

  const cells = table.cells.map((row) =>
    row.map((cell) => figure(cell.value, cell.officers, Rank.Cell)),
  );
  const columnCells: Figure[][] = table.columns.map(() => []);
  for (const row of cells) row.forEach((f, c) => columnCells[c]?.push(f));

  const rowLines = cells.map((row) => lineOf(row, Rank.Margin));
  const columnLines = columnCells.map((column) => lineOf(column, Rank.Margin));
  const rowTotals = rowLines.map((line) => line.total);
  const columnTotals = columnLines.map((line) => line.total);
  const total = lineOf(rowTotals, Rank.Total).total;

  // Every line adds up: each row with its total, each column with its total, and the margins
  // with the grand total.
  const lines: Figure[][] = [
    ...rowLines,
    { members: columnTotals, total },
    ...columnLines,
    { members: rowTotals, total },
  ].map((line) => [...line.members, line.total]);

  for (;;) {
    // A one-figure line (a total of an empty table) adds nothing a reader could subtract.
    const next = lines
      .find((line) => line.length > 1 && line.filter((f) => f.suppressed).length === 1)
      ?.filter((f) => !f.suppressed)
      .sort(bySuppressionPreference)[0];
    if (next === undefined) break;
    next.suppressed = true;
  }

  return {
    rows: [...table.rows],
    columns: [...table.columns],
    cells: cells.map((row) => row.map(released)),
    rowTotals: rowTotals.map(released),
    columnTotals: columnTotals.map(released),
    total: released(total),
  };
}

/** Suppress cells before totals, then the smallest value, then the fewest officers. */
function bySuppressionPreference(a: Figure, b: Figure): number {
  return a.rank - b.rank || a.value - b.value || a.officers - b.officers || a.order - b.order;
}

function released(figure: Figure): ReleasedCell {
  return figure.suppressed
    ? { suppressed: true, value: null }
    : { suppressed: false, value: figure.value };
}
