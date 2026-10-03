import {
  Button,
  cn,
  focusRing,
  formatNumber,
  Icon,
  SegmentedChoice,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Download04Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useState } from 'react';

import {
  columnWords,
  cycleName,
  type Language,
  measureName,
  pageCopy,
  tableName,
} from '../../open-data/copy';
import { formatRate, reportStatuses } from '../../open-data/model';
import type { OpenDataPage } from '../../server/open-data.server';
import {
  CYCLES,
  type Cycle,
  OPEN_DATA_TABLES,
  type OpenDataTable,
  type OpenDataTableName,
  type TableRow as Row,
} from '../../server/reporting/types';
import { fileHref } from './open-data-downloads';
import { PageCard } from './page-card';
import { Unshown, UnshownLegend } from './unshown';

const PAGE_SIZE = 15;

/** Columns that name a row, not figures: the first is the row header, the rest are left out. */
const ROW_NAMES: Record<OpenDataTableName, string> = {
  'filing-by-commission': 'commissionName',
  'compliance-by-commission': 'commissionName',
  'by-entity-type': 'entityType',
  'by-cycle': 'cycle',
  'access-requests': 'commissionName',
  'national-totals': 'measure',
};
const NOT_SHOWN = new Set([
  'commission',
  'commissionName',
  'entityType',
  'measure',
  'reportStatus',
  'suppressed',
]);
/** Tables of one row per cycle, shown one cycle at a time. */
const BY_CYCLE: ReadonlySet<OpenDataTableName> = new Set([
  'filing-by-commission',
  'by-entity-type',
]);
const RATES = new Set(['filingRate', 'reportingRate']);

interface Sort {
  column: string;
  direction: 'asc' | 'desc';
}

function compare(a: Row, b: Row, { column, direction }: Sort): number {
  const shown = (row: Row) => (row.suppressed === true ? null : row[column]);
  const left = shown(a);
  const right = shown(b);
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
  if (right === null || right === undefined) return -1;
  const order =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right));
  return direction === 'asc' ? order : -order;
}

/**
 * The release's six tables as tabs (spec 09b FE-4), with the suppression legend, the cycle for
 * tables by cycle, sortable columns, pages of 15 rows and the CSV of the table shown. A figure
 * not shown reads as its marker: suppressed, the Commission not reported, or not collected.
 */
export function TablesCard({ page, language }: { page: OpenDataPage; language: Language }) {
  const copy = pageCopy(language);
  const [tab, setTab] = useState<OpenDataTableName>('filing-by-commission');
  const [cycle, setCycle] = useState<Cycle>('all');
  const [sort, setSort] = useState<Sort | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const table = page.tables[tab] as OpenDataTable;
  const cycles = CYCLES.filter((each) =>
    page.tables['by-cycle'].rows.some((row) => row.cycle === each && (row.expected ?? 1) > 0),
  );

  return (
    <PageCard
      id="tables"
      title={copy.tables}
      className="gap-0 overflow-hidden p-0 sm:p-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-5 sm:[&>div:first-child]:px-6 sm:[&>div:first-child]:pt-6"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as OpenDataTableName);
          setSort(null);
          setPageNumber(1);
        }}
        className="mt-3"
      >
        <TabsList className="px-5 sm:px-6">
          {OPEN_DATA_TABLES.map((name) => (
            <TabsTrigger key={name} value={name}>
              {tableName(name, language)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="mt-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-5 py-3.5 sm:px-6">
            <UnshownLegend
              threshold={table.suppression.threshold}
              cellsSuppressed={table.suppression.cellsSuppressed}
              language={language}
              className="min-w-0 flex-[1_1_320px]"
            />
            {BY_CYCLE.has(tab) ? (
              <SegmentedChoice
                variant="track"
                legend={copy.cycleChoice}
                value={cycle}
                onValueChange={(value) => {
                  setCycle(value as Cycle);
                  setPageNumber(1);
                }}
                options={[
                  ...cycles.filter((each) => each === 'all'),
                  ...cycles.filter((each) => each !== 'all'),
                ].map((each) => ({
                  value: each,
                  label: cycleName(each, language),
                }))}
              />
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <a
                href={fileHref(page.release, `${tab}.csv`)}
                download
                aria-label={copy.downloadCsv(`${tab}.csv`)}
              >
                <Icon icon={Download04Icon} />
                CSV
              </a>
            </Button>
          </div>
          {tab === 'access-requests' || table.notCollected.length > 0 ? (
            <p className="border-b bg-muted/50 px-5 py-2.5 text-[13px] text-secondary-foreground sm:px-6">
              {copy.notCollectedNote}
            </p>
          ) : null}
          <DatasetTable
            key={`${tab}-${cycle}`}
            page={page}
            name={tab}
            table={table}
            cycle={BY_CYCLE.has(tab) ? cycle : null}
            sort={sort}
            onSort={(column) => {
              setSort(
                sort?.column !== column
                  ? { column, direction: 'asc' }
                  : sort.direction === 'asc'
                    ? { column, direction: 'desc' }
                    : null,
              );
              setPageNumber(1);
            }}
            pageNumber={pageNumber}
            onPage={setPageNumber}
            language={language}
          />
        </TabsContent>
      </Tabs>
    </PageCard>
  );
}

function DatasetTable({
  page,
  name,
  table,
  cycle,
  sort,
  onSort,
  pageNumber,
  onPage,
  language,
}: {
  page: OpenDataPage;
  name: OpenDataTableName;
  table: OpenDataTable;
  cycle: Cycle | null;
  sort: Sort | null;
  onSort: (column: string) => void;
  pageNumber: number;
  onPage: (page: number) => void;
  language: Language;
}) {
  const copy = pageCopy(language);
  const statuses = reportStatuses(page.tables);
  const threshold = table.suppression.threshold;
  const rowName = ROW_NAMES[name];
  const columns = table.columns.filter(
    (column) =>
      !NOT_SHOWN.has(column) && !(cycle !== null && column === 'cycle') && column !== rowName,
  );
  const grouped = columns.some((column) => columnWords(column).group);
  let rows = cycle === null ? table.rows : table.rows.filter((row) => row.cycle === cycle);
  if (sort) rows = [...rows].sort((a, b) => compare(a, b, sort));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(
    (Math.min(pageNumber, pages) - 1) * PAGE_SIZE,
    Math.min(pageNumber, pages) * PAGE_SIZE,
  );

  const words = (column: string) => columnWords(column)[language];
  const head = (column: string, numeric: boolean, rowSpan?: number) => {
    const active = sort?.column === column ? sort.direction : null;
    return (
      <TableHead
        key={column}
        rowSpan={rowSpan}
        aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
        className={cn('whitespace-nowrap', numeric && 'text-right')}
      >
        <button
          type="button"
          onClick={() => {
            onSort(column);
          }}
          className={cn(
            focusRing,
            '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground',
            numeric && 'flex-row-reverse',
            active && 'text-foreground',
          )}
        >
          {words(column)}
          <Icon
            icon={
              active === 'asc'
                ? ArrowUp01Icon
                : active === 'desc'
                  ? ArrowDown01Icon
                  : ArrowUpDownIcon
            }
            className="size-3.5"
          />
        </button>
      </TableHead>
    );
  };

  const groups: { label: string; span: number; column?: string }[] = [];
  for (const column of columns) {
    const group = columnWords(column).group?.[language];
    const last = groups.at(-1);
    if (group && last?.label === group && last.column === undefined) last.span += 1;
    else groups.push(group ? { label: group, span: 1 } : { label: '', span: 1, column });
  }

  const rowHeader = (row: Row): ReactNode => {
    const value = row[rowName];
    if (rowName === 'cycle') return cycleName(value as Cycle, language);
    if (rowName === 'measure') return measureName(String(value), language);
    return String(value ?? '');
  };

  const cell = (row: Row, column: string): ReactNode => {
    if (row.suppressed === true)
      return <Unshown kind="suppressed" threshold={threshold} language={language} />;
    const notCollected =
      table.notCollected.includes(column) ||
      (name === 'national-totals' && table.notCollected.includes(String(row.measure)));
    if (notCollected)
      return <Unshown kind="not-collected" threshold={threshold} language={language} />;
    const value = row[column];
    if (value === null || value === undefined)
      return <span className="text-muted-foreground">-</span>;
    if (typeof value !== 'number') return String(value);
    const rate =
      RATES.has(column) || (name === 'national-totals' && RATES.has(String(row.measure)));
    return rate ? formatRate(value) : formatNumber(value);
  };

  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground sm:px-6">{copy.noRows}</p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table
          caption={tableName(name, language)}
          className="[&_td:first-child]:pl-5 [&_th:first-child]:pl-5 sm:[&_td:first-child]:pl-6 sm:[&_th:first-child]:pl-6 [&_td:last-child]:pr-5 [&_th:last-child]:pr-5 sm:[&_td:last-child]:pr-6 sm:[&_th:last-child]:pr-6"
        >
          <TableHeader>
            {grouped ? (
              <>
                <TableRow>
                  {head(rowName, false, 2)}
                  {groups.map((group) =>
                    group.column ? (
                      head(group.column, true, 2)
                    ) : (
                      <TableHead
                        key={group.label}
                        scope="colgroup"
                        colSpan={group.span}
                        className="text-center"
                      >
                        {group.label}
                      </TableHead>
                    ),
                  )}
                </TableRow>
                <TableRow>
                  {columns
                    .filter((column) => columnWords(column).group)
                    .map((column) => head(column, true))}
                </TableRow>
              </>
            ) : (
              <TableRow>
                {head(rowName, false)}
                {columns.map((column) => head(column, true))}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {shown.map((row, index) => {
              const status =
                typeof row.commission === 'string' ? statuses.get(row.commission) : undefined;
              const notReported =
                (row.reportStatus ?? status) === 'not-reported' && row.suppressed !== true;
              return (
                <TableRow
                  key={`${String(row.commission ?? row[rowName])}-${String(row.cycle ?? '')}-${String(index)}`}
                >
                  <TableHead
                    scope="row"
                    className="min-w-40 font-medium sm:min-w-48 text-foreground"
                  >
                    {rowHeader(row)}
                  </TableHead>
                  {notReported ? (
                    <TableCell colSpan={columns.length}>
                      <Unshown kind="not-reported" threshold={threshold} language={language} />
                    </TableCell>
                  ) : (
                    columns.map((column) => (
                      <TableCell key={column} className="text-right whitespace-nowrap tabular-nums">
                        {cell(row, column)}
                      </TableCell>
                    ))
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground sm:px-6">
          <span aria-live="polite">{copy.pageOf(Math.min(pageNumber, pages), pages)}</span>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={pageNumber <= 1}
              onClick={() => {
                onPage(pageNumber - 1);
              }}
            >
              <Icon icon={ArrowLeft01Icon} />
              {copy.previous}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pageNumber >= pages}
              onClick={() => {
                onPage(pageNumber + 1);
              }}
            >
              {copy.next}
              <Icon icon={ArrowRight01Icon} />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
