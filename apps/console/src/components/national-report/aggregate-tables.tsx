import {
  Card,
  cn,
  IntakeStatusBadge,
  RateBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import type { ReactNode, Ref } from 'react';

import type {
  CommissionAggregate,
  NationalAggregates,
  SectionAggregate,
} from '../../server/reporting/types';
import { CursorPager } from '../cursor-pager';
import { formatNumber } from '../format';
import { messages as m } from './messages';

const SECTIONS = ['initial', 'biennial', 'final'] as const;

/** Commissions per page of the per-Commission table, as the prototype pages it. */
export const COMMISSIONS_PER_PAGE = 10;

/** A national report card's heading, with what follows it on the line (a count, a tip). */
export function CardHeading({
  id,
  children,
  extra,
  ref,
}: {
  id: string;
  children: string;
  extra?: ReactNode;
  /** The heading, e.g. to take focus after a retry (it is focusable from script only). */
  ref?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-5 py-4">
      <h3
        id={id}
        ref={ref}
        tabIndex={ref ? -1 : undefined}
        className="text-[15.5px] font-semibold tracking-[-0.01em] outline-none"
      >
        {children}
      </h3>
      {extra}
    </div>
  );
}

/** The page of `items` shown, `perPage` to a page, `page` kept within the pages there are. */
export function pageOf<T>(items: readonly T[], page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const from = (current - 1) * perPage;
  return { pages, current, from, shown: items.slice(from, from + perPage) };
}

/** Previous and Next under a card paged in the browser, with the range shown; none for one page. */
export function CardPager({
  paged,
  total,
  labels,
  onPageChange,
}: {
  paged: ReturnType<typeof pageOf>;
  total: number;
  labels: { pagination: string; pageRows: (count: number) => string };
  onPageChange: (page: number) => void;
}) {
  const { pages, current, from, shown } = paged;
  if (pages <= 1) return null;
  return (
    <CursorPager
      labels={{
        pagination: labels.pagination,
        pageRange: (start, end) => m.pageRange(start, end, total),
        pageRows: labels.pageRows,
        previousPage: m.previousPage,
        nextPage: m.nextPage,
      }}
      range={{ from: from + 1, to: from + shown.length }}
      rows={shown.length}
      hasPrevious={current > 1}
      hasNext={current < pages}
      onPrevious={() => {
        onPageChange(current - 1);
      }}
      onNext={() => {
        onPageChange(current + 1);
      }}
    />
  );
}

/** National totals per Form M section and for all three, with the declared rate. */
export function NationalTotals({ aggregates }: { aggregates: NationalAggregates }) {
  const rows = [
    ...SECTIONS.map((section) => ({
      key: section,
      label: m.sectionRow[section],
      counts: aggregates.national[section],
      total: false,
    })),
    { key: 'all', label: m.allSections, counts: aggregates.national.all, total: true },
  ];
  return (
    <Card role="region" aria-labelledby="ncr-totals" className="overflow-hidden p-0 sm:p-0">
      <CardHeading id="ncr-totals">{m.totalsTitle}</CardHeading>
      <Table caption={m.totalsCaption}>
        <TableHeader>
          <TableRow>
            <TableHead>{m.columnSection}</TableHead>
            <TableHead className="text-right">{m.columnExpected}</TableHead>
            <TableHead className="text-right">{m.columnDeclared}</TableHead>
            <TableHead className="text-right">{m.columnNotDeclared}</TableHead>
            <TableHead className="min-w-[180px]">{m.columnRate}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} id={`ncr-total-${row.key}`}>
              <TableHead
                scope="row"
                className={cn(
                  'py-3 text-[14.5px] text-foreground',
                  row.total ? 'font-semibold' : 'font-medium',
                )}
              >
                {row.label}
              </TableHead>
              <Count value={row.counts.expected} strong={row.total} />
              <Count value={row.counts.declared} strong={row.total} />
              <Count value={row.counts.notDeclared} strong={row.total} />
              <TableCell>
                <SectionRate counts={row.counts} showCounts={false} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Count({ value, strong }: { value: number; strong: boolean }) {
  return (
    <TableCell className={cn('text-right tabular-nums', strong && 'font-semibold')}>
      {formatNumber(value)}
    </TableCell>
  );
}

function SectionRate({
  counts,
  showCounts = true,
}: {
  counts: SectionAggregate;
  showCounts?: boolean;
}) {
  return (
    <RateBar
      declared={counts.declared}
      expected={counts.expected}
      showCounts={showCounts}
      className="max-w-[200px]"
    />
  );
}

export interface CommissionRow extends CommissionAggregate {
  slug: string;
}

/** Every Commission the report counts, by name. */
export function commissionRows(aggregates: NationalAggregates): CommissionRow[] {
  return Object.entries(aggregates.byCommission)
    .map(([slug, row]) => ({ slug, ...row }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Per Commission: its Form M's status and the declared rate per section; a Commission that has
 * not reported shows no figures. Paged in the browser, `COMMISSIONS_PER_PAGE` to a page.
 */
export function CommissionsTable({
  aggregates,
  page,
  onPageChange,
}: {
  aggregates: NationalAggregates;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const rows = commissionRows(aggregates);
  const paged = pageOf(rows, page, COMMISSIONS_PER_PAGE);
  const { shown } = paged;
  return (
    <Card role="region" aria-labelledby="ncr-per" className="overflow-hidden p-0 sm:p-0">
      <CardHeading id="ncr-per">{m.byCommissionTitle}</CardHeading>
      <Table caption={m.byCommissionCaption}>
        <TableHeader>
          <TableRow>
            <TableHead>{m.columnCommission}</TableHead>
            <TableHead>{m.columnStatus}</TableHead>
            <TableHead>{m.columnInitial}</TableHead>
            <TableHead>{m.columnBiennial}</TableHead>
            <TableHead>{m.columnFinal}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.slug} id={`ncr-row-${row.slug}`}>
              <TableHead
                scope="row"
                className="min-w-[200px] py-3 text-[14.5px] font-medium whitespace-normal text-foreground"
              >
                {row.name}
              </TableHead>
              <TableCell>
                <IntakeStatusBadge status={row.status} />
              </TableCell>
              {SECTIONS.map((section) => (
                <TableCell key={section} className="min-w-[130px]">
                  <CommissionSection row={row} section={section} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CardPager
        paged={paged}
        total={rows.length}
        labels={{ pagination: m.pagination, pageRows: m.pageRows }}
        onPageChange={onPageChange}
      />
    </Card>
  );
}

function CommissionSection({
  row,
  section,
}: {
  row: CommissionRow;
  section: (typeof SECTIONS)[number];
}) {
  const counts = row[section];
  if (!counts)
    return <span className="text-[13px] text-muted-foreground">{m.notReportedCell}</span>;
  if (section === 'biennial' && row.biennial?.noCycleInPeriod) {
    return <span className="text-[13px] text-muted-foreground">{m.noCycleCell}</span>;
  }
  return <SectionRate counts={counts} />;
}
