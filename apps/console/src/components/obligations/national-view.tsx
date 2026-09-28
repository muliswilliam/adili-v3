import {
  Alert,
  AlertDescription,
  Card,
  cn,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  Select,
  SelectItem,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Calendar03Icon,
  ChartColumnIcon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import type {
  DeclarationsResult,
  NationalCommissionRow,
  NationalObligationsSummary,
} from '../../server/declarations/client';
import { CursorPager } from '../cursor-pager';
import { formatNumber } from '../format';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { messages as m } from './messages';
import {
  hasNationalObligations,
  type NationalSearch,
  type NationalSort,
  nationalPage,
  type NationalTotals,
  nationalTotals,
  sortNationalRows,
  sortState,
  toggleSort,
} from './national-summary';
import { cycleLabel } from './obligations-query';

export interface NationalViewProps {
  /** The summary; null while it loads. */
  result: DeclarationsResult<NationalObligationsSummary> | null;
  search: NationalSearch;
  onSearchChange: (next: NationalSearch) => void;
  /** The Commission's name as a link to its page. */
  commissionLink: (row: NationalCommissionRow) => ReactNode;
  /** Offered to staff refused the page (403), e.g. their own Commission's obligations. */
  forbiddenAction?: ReactNode;
}

interface Column {
  sort: NationalSort;
  label: string;
  numeric: boolean;
  hint?: string;
}

const COLUMNS: Column[] = [
  { sort: 'name', label: m.columnCommission, numeric: false },
  { sort: 'upcoming', label: m.columnUpcoming, numeric: true },
  { sort: 'due', label: m.columnDue, numeric: true },
  { sort: 'overdue', label: m.columnOverdue, numeric: true },
  {
    sort: 'notOnboarded',
    label: m.columnNotOnboarded,
    numeric: true,
    hint: m.columnNotOnboardedHint,
  },
  { sort: 'lastImport', label: m.columnLastImport, numeric: false },
];

const problemStatus = (result: DeclarationsResult<unknown> | null) =>
  result && !result.ok && result.error.kind === 'problem' ? result.error.problem.status : null;

/**
 * EACC's national obligations summary (spec 04 FE-5): per Commission the cycle's upcoming, due
 * and overdue counts, declarants not onboarded and the last roster import, most overdue first,
 * with totals. Counts only, no declarant.
 */
export function NationalView(props: NationalViewProps) {
  const { result } = props;
  if (problemStatus(result) === 403) {
    return (
      <Page narrow>
        <PageHead title={m.nationalTitle} />
        <NoAccess text={m.nationalNoAccess} action={props.forbiddenAction} />
      </Page>
    );
  }
  const summary = result?.ok ? result.data : null;
  const cycle = summary?.cycle ?? null;
  return (
    <Page>
      <PageHead title={m.nationalTitle}>
        {result === null ? (
          <Skeleton className="mt-2 h-4 w-60 max-w-full" />
        ) : summary ? (
          <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-secondary-foreground">
            <Icon icon={Calendar03Icon} className="size-3.75" />
            {m.nationalCycle(cycleLabel(summary.cycle.key), formatDate(summary.cycle.dueDate))}
          </p>
        ) : null}
      </PageHead>
      <div className="flex flex-col gap-4">
        {cycle && !cycle.opened ? (
          <Alert variant="info" role="status">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>
              {m.nationalNotOpen(cycleLabel(cycle.key), formatDate(cycle.opensOn))}
            </AlertDescription>
          </Alert>
        ) : null}
        {result && !result.ok ? (
          <LoadError
            title={m.nationalErrorTitle}
            detail={
              result.error.kind === 'unavailable' && result.error.detail
                ? result.error.detail
                : m.nationalErrorDetail
            }
            retryLabel={m.tryAgain}
          />
        ) : (
          <Card className="@container overflow-hidden p-0 sm:p-0">
            {summary === null ? (
              <NationalSkeleton />
            ) : hasNationalObligations(summary) ? (
              <NationalTable {...props} summary={summary} />
            ) : (
              <EmptyState
                icon={<Icon icon={ChartColumnIcon} />}
                title={m.nationalEmptyTitle}
                description={m.nationalEmptyText}
              />
            )}
          </Card>
        )}
      </div>
    </Page>
  );
}

function NationalTable({
  summary,
  search,
  onSearchChange,
  commissionLink,
}: NationalViewProps & { summary: NationalObligationsSummary }) {
  const order = sortState(search);
  const sorted = sortNationalRows(summary.commissions, order);
  const page = nationalPage(sorted, search.page);
  const totals = nationalTotals(summary);
  const goTo = (target: number) => {
    onSearchChange({ ...search, page: target > 1 ? target : undefined });
  };
  return (
    <>
      <div className="hidden @[760px]:block">
        <Table caption={m.nationalCaption(cycleLabel(summary.cycle.key))}>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <SortHead
                  key={column.sort}
                  column={column}
                  active={order.sort === column.sort ? order.dir : null}
                  onSort={() => {
                    onSearchChange(toggleSort(search, column.sort));
                  }}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <TableRow key={row.commission.slug}>
                <TableHead scope="row" className="py-3 font-normal">
                  {commissionLink(row)}
                  <span className="mt-0.5 block font-mono text-xs tracking-[0.04em] text-muted-foreground">
                    {row.commission.issuerCode}
                  </span>
                </TableHead>
                <CountCell value={row.total.upcoming} />
                <CountCell value={row.total.due} />
                <CountCell value={row.total.overdue} warn />
                <CountCell value={row.notOnboarded} />
                <TableCell className="whitespace-nowrap">
                  {row.lastRosterImportAt ? (
                    <time
                      dateTime={row.lastRosterImportAt}
                      title={formatDateTime(row.lastRosterImportAt)}
                    >
                      {formatDate(row.lastRosterImportAt)}
                    </time>
                  ) : (
                    <span className="text-muted-foreground">{m.noRosterYet}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <tfoot className="border-t bg-background/60 font-semibold">
            <TableRow className="border-0">
              <TableHead scope="row" className="py-3">
                {m.nationalTotal(totals.commissions)}
              </TableHead>
              <TotalCell value={totals.upcoming} />
              <TotalCell value={totals.due} />
              <TotalCell value={totals.overdue} />
              <TotalCell value={totals.notOnboarded} />
              <TableCell />
            </TableRow>
          </tfoot>
        </Table>
      </div>
      <div className="@[760px]:hidden">
        <NationalCards
          rows={page.rows}
          totals={totals}
          caption={m.nationalCaption(cycleLabel(summary.cycle.key))}
          sort={order.sort}
          onSortChange={(sort) => {
            onSearchChange({ sort: sort === 'overdue' ? undefined : sort });
          }}
          commissionLink={commissionLink}
        />
      </div>
      {page.pages > 1 ? (
        <CursorPager
          labels={{
            pagination: m.nationalPagination,
            pageRange: (from, to) => m.nationalPageRange(from, to, sorted.length),
            pageRows: m.nationalPageRows,
            previousPage: m.previousPage,
            nextPage: m.nextPage,
          }}
          range={{ from: page.from, to: page.to }}
          rows={page.rows.length}
          hasPrevious={page.page > 1}
          hasNext={page.page < page.pages}
          onPrevious={() => {
            goTo(page.page - 1);
          }}
          onNext={() => {
            goTo(page.page + 1);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The table as a list for narrow containers, where six columns would push Overdue out of view:
 * each Commission with its four counts, a sort select in place of the column headers, then the
 * totals.
 */
function NationalCards({
  rows,
  totals,
  caption,
  sort,
  onSortChange,
  commissionLink,
}: {
  rows: readonly NationalCommissionRow[];
  totals: NationalTotals;
  caption: string;
  sort: NationalSort;
  onSortChange: (sort: NationalSort) => void;
  commissionLink: NationalViewProps['commissionLink'];
}) {
  const id = useId();
  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <label htmlFor={`${id}-sort`} className="text-[13px] text-muted-foreground">
          {m.sortLabel}
        </label>
        <Select
          id={`${id}-sort`}
          value={sort}
          onValueChange={(value) => {
            onSortChange(value as NationalSort);
          }}
          className="h-9 w-auto min-w-45 text-sm"
        >
          {COLUMNS.map((column) => (
            <SelectItem key={column.sort} value={column.sort}>
              {m.sortOption[column.sort]}
            </SelectItem>
          ))}
        </Select>
      </div>
      <ul aria-label={caption}>
        {rows.map((row) => (
          <li
            key={row.commission.slug}
            className="relative grid gap-2.5 border-b px-4 py-3.5 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 leading-snug">
                {commissionLink(row)}
                <span className="mt-0.5 block font-mono text-xs tracking-[0.04em] text-muted-foreground">
                  {row.commission.issuerCode}
                </span>
              </div>
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {row.lastRosterImportAt ? formatDate(row.lastRosterImportAt) : m.noRosterYet}
              </span>
            </div>
            <CardCounts
              counts={{
                upcoming: row.total.upcoming,
                due: row.total.due,
                overdue: row.total.overdue,
                notOnboarded: row.notOnboarded,
              }}
            />
          </li>
        ))}
      </ul>
      <div className="grid gap-2.5 bg-background/60 px-4 py-3.5">
        <p className="text-sm font-semibold">{m.nationalTotal(totals.commissions)}</p>
        <CardCounts counts={totals} />
      </div>
    </>
  );
}

function CardCounts({
  counts,
}: {
  counts: { upcoming: number; due: number; overdue: number; notOnboarded: number };
}) {
  const items = [
    [m.columnUpcoming, counts.upcoming, false],
    [m.columnDue, counts.due, false],
    [m.columnOverdue, counts.overdue, counts.overdue > 0],
    [m.columnNotOnboarded, counts.notOnboarded, false],
  ] as const;
  return (
    <dl className="grid grid-cols-4 gap-2">
      {items.map(([label, value, warn]) => (
        <div key={label} className="flex min-w-0 flex-col justify-end gap-0.5">
          <dt className="text-xs leading-tight text-muted-foreground">{label}</dt>
          <dd
            className={cn(
              'text-[15px] font-semibold tabular-nums',
              value === 0 && 'font-normal text-muted-foreground/70',
              warn && 'text-warning-subtle-foreground',
            )}
          >
            {formatNumber(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A column header that sorts the table, announcing the order it is in (`aria-sort`). */
function SortHead({
  column,
  active,
  onSort,
}: {
  column: Column;
  active: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  const icon =
    active === 'asc' ? ArrowUp01Icon : active === 'desc' ? ArrowDown01Icon : ArrowUpDownIcon;
  return (
    <TableHead
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      className={cn(column.numeric && 'text-right')}
    >
      <span className={cn('inline-flex items-center gap-1', column.numeric && 'flex-row-reverse')}>
        {column.hint ? (
          <Tooltip content={column.hint}>
            <button
              type="button"
              aria-label={m.columnNotOnboardedHintLabel}
              className="inline-grid size-5 place-items-center rounded-full outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Icon icon={InformationCircleIcon} className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
        <button
          type="button"
          onClick={onSort}
          className={cn(
            '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            active && 'text-foreground',
          )}
        >
          {column.label}
          <Icon icon={icon} className="size-3.5" />
        </button>
      </span>
    </TableHead>
  );
}

function CountCell({ value, warn = false }: { value: number; warn?: boolean }) {
  return (
    <TableCell
      className={cn(
        'text-right tabular-nums',
        value === 0 && 'text-muted-foreground/70',
        warn && value > 0 && 'font-semibold text-warning-subtle-foreground',
      )}
    >
      {formatNumber(value)}
    </TableCell>
  );
}

function TotalCell({ value }: { value: number }) {
  return <TableCell className="text-right tabular-nums">{formatNumber(value)}</TableCell>;
}

function NationalSkeleton() {
  return (
    <Table caption={m.nationalLoadingCaption} aria-busy="true">
      <TableHeader>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHead key={column.sort} className={cn(column.numeric && 'text-right')}>
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            <TableCell>
              <Skeleton className="w-55 max-w-full" />
              <Skeleton className="mt-1.5 w-12" />
            </TableCell>
            {Array.from({ length: 4 }, (_, column) => (
              <TableCell key={column}>
                <Skeleton className="ml-auto w-12" />
              </TableCell>
            ))}
            <TableCell>
              <Skeleton className="w-24" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
