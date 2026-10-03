import {
  cn,
  EmptyState,
  focusRing,
  Icon,
  SegmentedChoice,
  SuppressionLegend,
  SuppressionMarker,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type UnshownFigureKind,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Building03Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useState } from 'react';

import {
  ACCESS_REQUEST_FIGURES,
  COMPLIANCE_FIGURES,
  type ComplianceFigure,
  CYCLES,
  type Cycle,
  FILING_FIGURES,
  type OpenDataTableKey,
  type ReadTables,
} from '../../server/open-data-tables';
import { CursorPager } from '../cursor-pager';
import { formatNumber } from '../format';
import { messages as m } from './messages';

/** Rows per page of a release table, as the prototype pages them. */
const PER_PAGE = 15;

type Sort = { column: string; direction: 'asc' | 'desc' } | null;

const BY_NAME: Sort = { column: 'commission', direction: 'asc' };

/** Why a figure is not shown; null when it is. */
type Gap = UnshownFigureKind | null;

interface Column<Row> {
  id: string;
  label: string;
  numeric: boolean;
  /** The header over a run of columns (the compliance table's). */
  group?: string;
  /** What the column sorts by; null sorts last. */
  sortValue: (row: Row) => number | string | null;
  cell: (row: Row) => ReactNode;
}

interface TableModel<Row> {
  rows: Row[];
  /** The column naming each row (its row header). */
  name: Column<Row>;
  columns: Column<Row>[];
  /** A row whose figures are not there at all: one marker across them. */
  rowGap?: (row: Row) => Gap;
  /** The kinds of marker the rows show, for the legend's keys. */
  gaps: Gap[];
  key: (row: Row) => string;
  /** The order before any column is sorted: Commissions by name. */
  defaultSort?: Sort;
}

/** A figure, or the marker saying why it is not shown. */
function Figure({
  value,
  gap,
  threshold,
  format = formatNumber,
}: {
  value: number | null;
  gap: Gap;
  threshold: number;
  format?: (value: number) => string;
}) {
  if (gap) return <SuppressionMarker kind={gap} threshold={threshold} />;
  if (value === null) return <span className="text-muted-foreground">{m.notApplicable}</span>;
  return <>{format(value)}</>;
}

const RATE_FORMAT = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A rate (0 to 1) as a percentage to one decimal, so a column of rates lines up: `90.0%`. */
const rate = (value: number) => `${RATE_FORMAT.format(value * 100)}%`;

/** A figure's gap: suppressed, or for want of data. */
function gapOf(
  value: number | null,
  {
    suppressed,
    notCollected = false,
    notReported = false,
  }: {
    suppressed: boolean;
    notCollected?: boolean;
    notReported?: boolean;
  },
): Gap {
  if (suppressed) return 'suppressed';
  if (value !== null) return null;
  if (notCollected) return 'not-collected';
  if (notReported) return 'not-reported';
  return null;
}

interface FilingFigures {
  expected: number | null;
  filed: number | null;
  nonFilers: number | null;
  filingRate: number | null;
  suppressed: boolean;
}

function filingColumns<Row extends FilingFigures>(threshold: number): Column<Row>[] {
  const labels: Record<(typeof FILING_FIGURES)[number], string> = {
    expected: m.columnExpected,
    filed: m.columnDeclared,
    nonFilers: m.columnNotDeclared,
    filingRate: m.columnRate,
  };
  return FILING_FIGURES.map((figure) => ({
    id: figure,
    label: labels[figure],
    numeric: true,
    sortValue: (row) => (row.suppressed ? null : row[figure]),
    cell: (row) => (
      <Figure
        value={row[figure]}
        gap={gapOf(row[figure], { suppressed: row.suppressed })}
        threshold={threshold}
        format={figure === 'filingRate' ? rate : formatNumber}
      />
    ),
  }));
}

function textColumn<Row>(id: string, label: string, text: (row: Row) => string): Column<Row> {
  return { id, label, numeric: false, sortValue: text, cell: text };
}

const COMPLIANCE_COLUMNS: Record<ComplianceFigure, { label: string; group?: string }> = {
  determinationsCompliant: { label: m.columnCompliant, group: m.groupDeterminations },
  determinationsNonCompliant: { label: m.columnNonCompliant, group: m.groupDeterminations },
  determinationsFurtherAction: { label: m.columnFurtherAction, group: m.groupDeterminations },
  clarificationsIssued: { label: m.columnIssued, group: m.groupClarifications },
  clarificationsResolved: { label: m.columnResolved, group: m.groupClarifications },
  actionsNoticeToComply: { label: m.columnNoticeToComply, group: m.groupActions },
  actionsWarning: { label: m.columnWarning, group: m.groupActions },
  actionsSalaryStoppage: { label: m.columnSalaryStoppage, group: m.groupActions },
  actionsDisciplinaryReferral: { label: m.columnDisciplinaryReferral, group: m.groupActions },
  referrals: { label: m.columnReferrals },
};

/** The table's rows and columns as the release page shows them. */
type AnyModel = TableModel<Record<string, unknown>>;

/** One table's model, its row type erased so the page renders any of the six alike. */
function erase<Row>(model: TableModel<Row>): AnyModel {
  return model as unknown as AnyModel;
}

function modelOf(tables: ReadTables, table: OpenDataTableKey, cycle: Cycle): AnyModel {
  const { threshold } = tables[table].suppression;
  const notCollected = new Set(tables[table].notCollected);
  switch (table) {
    case 'filing-by-commission': {
      const rows = tables[table].rows.filter((row) => row.cycle === cycle);
      type Row = (typeof rows)[number];
      const notReported = (row: Row) =>
        row.reportStatus === 'not-reported' && row.expected === null && !row.suppressed;
      return erase({
        rows,
        key: (row: Row) => row.commission,
        name: textColumn('commission', m.columnCommission, (row: Row) => row.commissionName),
        defaultSort: BY_NAME,
        columns: filingColumns<Row>(threshold),
        rowGap: (row: Row) => (notReported(row) ? 'not-reported' : null),
        gaps: rows.map((row) =>
          row.suppressed ? 'suppressed' : notReported(row) ? 'not-reported' : null,
        ),
      });
    }
    case 'compliance-by-commission': {
      const { rows } = tables[table];
      type Row = (typeof rows)[number];
      const notReported = (row: Row) =>
        !row.suppressed && COMPLIANCE_FIGURES.every((figure) => row[figure] === null);
      return erase({
        rows,
        key: (row: Row) => row.commission,
        name: textColumn('commission', m.columnCommission, (row: Row) => row.commissionName),
        defaultSort: BY_NAME,
        columns: COMPLIANCE_FIGURES.map((figure) => ({
          id: figure,
          ...COMPLIANCE_COLUMNS[figure],
          numeric: true,
          sortValue: (row: Row) => row[figure],
          cell: (row: Row) => (
            <Figure
              value={row[figure]}
              gap={gapOf(row[figure], { suppressed: row.suppressed })}
              threshold={threshold}
            />
          ),
        })),
        rowGap: (row: Row) => (notReported(row) ? 'not-reported' : null),
        gaps: rows.map((row) =>
          row.suppressed ? 'suppressed' : notReported(row) ? 'not-reported' : null,
        ),
      });
    }
    case 'by-entity-type': {
      const rows = tables[table].rows.filter((row) => row.cycle === 'all');
      type Row = (typeof rows)[number];
      return erase({
        rows,
        key: (row: Row) => row.entityType,
        name: textColumn('entityType', m.columnEntityType, (row: Row) => row.entityType),
        columns: filingColumns<Row>(threshold),
        gaps: rows.map((row) => (row.suppressed ? 'suppressed' : null)),
      });
    }
    case 'by-cycle': {
      const { rows } = tables[table];
      type Row = (typeof rows)[number];
      return erase({
        rows,
        key: (row: Row) => row.cycle,
        name: textColumn('cycle', m.columnCycle, (row: Row) => m.cycles[row.cycle]),
        columns: filingColumns<Row>(threshold),
        gaps: rows.map((row) => (row.suppressed ? 'suppressed' : null)),
      });
    }
    case 'access-requests': {
      const { rows } = tables[table];
      type Row = (typeof rows)[number];
      const labels = {
        received: m.columnReceived,
        granted: m.columnGranted,
        declined: m.columnDeclined,
      };
      return erase({
        rows,
        key: (row: Row) => row.commission,
        name: textColumn('commission', m.columnCommission, (row: Row) => row.commissionName),
        defaultSort: BY_NAME,
        columns: ACCESS_REQUEST_FIGURES.map((figure) => ({
          id: figure,
          label: labels[figure],
          numeric: true,
          sortValue: (row: Row) => row[figure],
          cell: (row: Row) => (
            <Figure
              value={row[figure]}
              gap={gapOf(row[figure], {
                suppressed: row.suppressed,
                notCollected: notCollected.has(figure),
              })}
              threshold={threshold}
            />
          ),
        })),
        gaps: rows.flatMap((row) =>
          ACCESS_REQUEST_FIGURES.map((figure) =>
            gapOf(row[figure], {
              suppressed: row.suppressed,
              notCollected: notCollected.has(figure),
            }),
          ),
        ),
      });
    }
    case 'national-totals': {
      const { rows } = tables[table];
      type Row = (typeof rows)[number];
      const isRate = (row: Row) => row.measure === 'filingRate' || row.measure === 'reportingRate';
      const gap = (row: Row) =>
        gapOf(row.value, {
          suppressed: row.suppressed,
          notCollected: notCollected.has(row.measure),
        });
      return erase({
        rows,
        key: (row: Row) => row.measure,
        name: textColumn('measure', m.columnMeasure, (row: Row) => m.measures[row.measure]),
        columns: [
          {
            id: 'value',
            label: m.columnValue,
            numeric: true,
            sortValue: (row: Row) => row.value,
            cell: (row: Row) => (
              <Figure
                value={row.value}
                gap={gap(row)}
                threshold={threshold}
                format={isRate(row) ? rate : formatNumber}
              />
            ),
          },
        ],
        gaps: rows.map(gap),
      });
    }
  }
}

/** The legend's keys, in the kit's order, for the markers the table shows. */
const LEGEND_KEYS: UnshownFigureKind[] = ['suppressed', 'not-reported', 'not-collected'];

/** The cycles the release has figures for, All cycles first. */
function cyclesOf(tables: ReadTables): Cycle[] {
  const present = tables['by-cycle'].rows
    .filter((row) => row.cycle !== 'all' && (row.suppressed || (row.expected ?? 0) > 0))
    .map((row) => row.cycle);
  return ['all', ...CYCLES.filter((cycle) => present.includes(cycle))];
}

/**
 * One of a release's six tables (S4, S6): its legend with how many figures suppression hides,
 * the cycle filter on Declarations by Commission, the rows sortable by any column and paged.
 * Suppressed figures show "‹10"; a Commission that has not reported, and figures not collected
 * yet, say so instead of showing a zero.
 */
export function ReleaseTable({ tables, table }: { tables: ReadTables; table: OpenDataTableKey }) {
  const [cycle, setCycle] = useState<Cycle>('all');
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);
  const model = modelOf(tables, table, cycle);
  const { threshold, cellsSuppressed } = tables[table].suppression;
  const keys = LEGEND_KEYS.filter((kind) => model.gaps.includes(kind));
  const all = [model.name, ...model.columns];
  const sorted = sortRows(model.rows, all, sort ?? model.defaultSort ?? null);
  // The national totals are one list of measures, read whole.
  const perPage = table === 'national-totals' ? sorted.length || 1 : PER_PAGE;
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const shown = sorted.slice(from, from + perPage);
  const grouped = model.columns.some((column) => column.group);
  const toggleSort = (column: string) => {
    setPage(1);
    setSort((previous) =>
      previous?.column !== column
        ? { column, direction: 'asc' }
        : previous.direction === 'asc'
          ? { column, direction: 'desc' }
          : null,
    );
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
        <SuppressionLegend
          threshold={threshold}
          cellsSuppressed={cellsSuppressed > 0 ? cellsSuppressed : undefined}
          keys={keys}
          className="flex-[1_1_280px]"
        />
        {table === 'filing-by-commission' ? (
          <SegmentedChoice
            variant="track"
            legend={m.cycleLegend}
            value={cycle}
            onValueChange={(value) => {
              setCycle(value as Cycle);
              setPage(1);
            }}
            options={cyclesOf(tables).map((each) => ({ value: each, label: m.cycles[each] }))}
          />
        ) : null}
      </div>
      {model.rows.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Building03Icon} />}
          title={m.noEntityTypes}
          description={m.noEntityTypesText}
        />
      ) : (
        <Table caption={m.tables[table]}>
          <TableHeader>
            {grouped ? (
              <TableRow>
                <SortHead column={model.name} sort={sort} onSort={toggleSort} rowSpan={2} />
                {groupsOf(model.columns).map(({ group, columns }) =>
                  group ? (
                    <TableHead
                      key={group}
                      scope="colgroup"
                      colSpan={columns.length}
                      className="border-b text-center text-secondary-foreground"
                    >
                      {group}
                    </TableHead>
                  ) : (
                    columns.map((column) => (
                      <SortHead
                        key={column.id}
                        column={column}
                        sort={sort}
                        onSort={toggleSort}
                        rowSpan={2}
                      />
                    ))
                  ),
                )}
              </TableRow>
            ) : null}
            <TableRow>
              {grouped ? null : <SortHead column={model.name} sort={sort} onSort={toggleSort} />}
              {model.columns
                .filter((column) => !grouped || column.group)
                .map((column) => (
                  <SortHead key={column.id} column={column} sort={sort} onSort={toggleSort} />
                ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => {
              const gap = model.rowGap?.(row) ?? null;
              return (
                <TableRow key={model.key(row)}>
                  <TableHead
                    scope="row"
                    className={cn(
                      'min-w-[180px] py-2.5 text-[14px] font-medium whitespace-normal text-foreground min-[700px]:whitespace-nowrap',
                      gap && 'text-muted-foreground',
                    )}
                  >
                    {model.name.cell(row)}
                  </TableHead>
                  {gap ? (
                    <TableCell colSpan={model.columns.length} className="py-2.5 text-right">
                      <SuppressionMarker kind={gap} threshold={threshold} />
                    </TableCell>
                  ) : (
                    model.columns.map((column) => (
                      <TableCell
                        key={column.id}
                        className="py-2.5 text-right whitespace-nowrap tabular-nums"
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {pages > 1 ? (
        <CursorPager
          labels={{
            pagination: m.tables[table],
            pageRange: (start, end) => m.pageRange(start, end, sorted.length),
            pageRows: m.pageRows,
            previousPage: m.previousPage,
            nextPage: m.nextPage,
          }}
          range={{ from: from + 1, to: from + shown.length }}
          rows={shown.length}
          hasPrevious={current > 1}
          hasNext={current < pages}
          onPrevious={() => {
            setPage(current - 1);
          }}
          onNext={() => {
            setPage(current + 1);
          }}
        />
      ) : null}
    </>
  );
}

function groupsOf<Row>(columns: Column<Row>[]): { group?: string; columns: Column<Row>[] }[] {
  const groups: { group?: string; columns: Column<Row>[] }[] = [];
  for (const column of columns) {
    const last = groups.at(-1);
    if (last && column.group && last.group === column.group) last.columns.push(column);
    else groups.push({ group: column.group, columns: [column] });
  }
  return groups;
}

function sortRows<Row>(rows: Row[], columns: Column<Row>[], sort: Sort): Row[] {
  const column = sort && columns.find((each) => each.id === sort.column);
  if (!sort || !column) return rows;
  return [...rows].sort((a, b) => {
    const x = column.sortValue(a);
    const y = column.sortValue(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y);
    return sort.direction === 'desc' ? -order : order;
  });
}

/** A column header that sorts the table, announcing the order it is in (`aria-sort`). */
function SortHead<Row>({
  column,
  sort,
  onSort,
  rowSpan,
}: {
  column: Column<Row>;
  sort: Sort;
  onSort: (column: string) => void;
  rowSpan?: number;
}) {
  const active = sort?.column === column.id ? sort.direction : null;
  const icon =
    active === 'asc' ? ArrowUp01Icon : active === 'desc' ? ArrowDown01Icon : ArrowUpDownIcon;
  return (
    <TableHead
      rowSpan={rowSpan}
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      className={cn(column.numeric && 'text-right', rowSpan && 'align-bottom')}
    >
      <button
        type="button"
        aria-label={m.sortBy(column.label)}
        onClick={() => {
          onSort(column.id);
        }}
        className={cn(
          '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 whitespace-nowrap hover:text-foreground',
          column.numeric && 'flex-row-reverse',
          focusRing,
          active && 'text-foreground',
        )}
      >
        {column.label}
        <Icon icon={icon} className="size-3.5" />
      </button>
    </TableHead>
  );
}
