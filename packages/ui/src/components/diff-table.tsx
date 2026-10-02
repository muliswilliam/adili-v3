import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { formatMoney } from '../lib/money';
import { Badge } from './badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Tooltip } from './tooltip';

/**
 * How an item pairs across two versions. `matched`: the same item is in both. `only-current`:
 * new in the current version. `only-previous`: in the previous version, not in the current one.
 */
export type DiffMatch = 'matched' | 'only-current' | 'only-previous';

export const DIFF_MATCHES: readonly DiffMatch[] = ['matched', 'only-current', 'only-previous'];

export interface DiffTableRow {
  /** A stable key. */
  id: string;
  /** The row header, e.g. the item's type ("Building"). */
  item: ReactNode;
  /** Under the item, e.g. its description. */
  detail?: ReactNode;
  match: DiffMatch;
  /** Value in the previous version, in cents; null when the item is only in the current one. */
  previousCents: number | null;
  /** Value in the current version, in cents; null when the item is only in the previous one. */
  currentCents: number | null;
  /**
   * Change as a percentage of the previous value, e.g. 40.83; null when the previous value was
   * zero. Worked out from the values when left out.
   */
  deltaPercent?: number | null;
  /** Under the match label, e.g. "Marked as changed". */
  note?: ReactNode;
}

export interface DiffTableGroup {
  /** A stable key, e.g. the category. */
  id: string;
  /** The group's heading row, e.g. "Assets". */
  label: ReactNode;
  rows: DiffTableRow[];
}

export interface DiffTableMessages {
  item: string;
  version: (version: number, currency: string) => string;
  change: (currency: string) => string;
  percent: string;
  match: string;
  matched: string;
  unmatched: string;
  /** Under "Unmatched" on a row only in the current version. */
  onlyCurrent: (version: number) => string;
  /** Under "Unmatched" on a row only in the previous version. */
  onlyPrevious: string;
  /** Read for an empty value cell, shown as "-". */
  noValue: string;
  /** Read for a matched row's change. */
  noChange: string;
  increase: (amount: string, percent: string | null) => string;
  decrease: (amount: string, percent: string | null) => string;
  added: (amount: string) => string;
  removed: (amount: string) => string;
  /** Tooltip and accessible name of "n/a" when the previous value was zero. */
  noPercent: string;
  /** Read for "n/a" on an unmatched row. */
  notApplicable: string;
  /** Shown instead of the table when no group has rows. */
  empty: string;
}

export const DIFF_TABLE_MESSAGES: DiffTableMessages = {
  item: 'Item',
  version: (version, currency) => `Version ${String(version)} (${currency})`,
  change: (currency) => `Change (${currency})`,
  percent: '%',
  match: 'Match',
  matched: 'Matched',
  unmatched: 'Unmatched',
  onlyCurrent: (version) => `Only in version ${String(version)}`,
  onlyPrevious: 'Not in current version',
  noValue: 'None',
  noChange: 'No change.',
  increase: (amount, percent) =>
    `Increase of ${amount}, ${percent === null ? 'no percentage because the previous value was zero' : `${percent} percent`}.`,
  decrease: (amount, percent) =>
    `Decrease of ${amount}, ${percent === null ? 'no percentage because the previous value was zero' : `${percent} percent`}.`,
  added: (amount) => `New item worth ${amount}.`,
  removed: (amount) => `Item no longer declared, previously ${amount}.`,
  noPercent: 'No percentage: the previous value was zero',
  notApplicable: 'Not applicable',
  empty: 'Nil declared in both versions',
};

export type DiffTableProps = Omit<ComponentProps<'div'>, 'children'> & {
  groups: DiffTableGroup[];
  previousVersion: number;
  currentVersion: number;
  /** Names the table for screen readers, e.g. "Changes for Wanjiku Kamau between version 1 and version 2". */
  caption: string;
  /** Shown in the column headers and read with each change. Defaults to "KES". */
  currency?: string;
  /** A matched row whose change is at least this percent, up or down, has its % cell tinted. */
  highlightPercent?: number;
  /** Replaces any of the default copy. */
  messages?: Partial<DiffTableMessages>;
};

const MINUS = '−';

type Direction = 'up' | 'down' | 'zero';

const directionClass: Record<Direction, string> = {
  up: 'font-semibold text-warning',
  down: 'font-semibold text-info-subtle-foreground',
  zero: 'text-muted-foreground',
};

const roundPercent = (percent: number) => (Math.round(percent * 10) / 10).toFixed(1);

/** Text shown, hidden from screen readers, with what they read instead. */
function Spoken({ shown, read }: { shown: ReactNode; read: string }) {
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{read}</span>
    </>
  );
}

const cell = 'px-2 py-[9px] text-right align-top whitespace-nowrap tabular-nums last:pr-2';

/**
 * Two versions of a statement side by side: per item the previous and current values, the
 * change and the percentage, and whether the item matched across versions. Items only in one
 * version are "Unmatched", on a faint fill, with where they are. Increases are amber, decreases
 * blue; a change of `highlightPercent` or more tints its % cell. Each change is also read out
 * in words ("Increase of KES 4,900,000, 40.8 percent."); a percentage that cannot be worked out
 * (previous value zero) shows "n/a" with the reason in a tooltip and the accessible name.
 */
export function DiffTable({
  groups,
  previousVersion,
  currentVersion,
  caption,
  currency = 'KES',
  highlightPercent = 25,
  messages: overrides,
  className,
  ...props
}: DiffTableProps) {
  const messages = { ...DIFF_TABLE_MESSAGES, ...overrides };
  const filled = groups.filter((group) => group.rows.length > 0);

  if (filled.length === 0) {
    return (
      <p className={cn('text-[13px] text-muted-foreground', className)} {...props}>
        {messages.empty}
      </p>
    );
  }

  const amount = (cents: number) => formatMoney(cents);
  const spokenAmount = (cents: number) => formatMoney(cents, { currency });
  const signed = (cents: number) =>
    `${cents > 0 ? '+' : cents < 0 ? MINUS : ''}${amount(Math.abs(cents))}`;
  const none = <Spoken shown="-" read={messages.noValue} />;
  const notApplicable = <Spoken shown="n/a" read={messages.notApplicable} />;
  const columns = 6;

  function renderRow(row: DiffTableRow) {
    const header = (
      <TableHead
        scope="row"
        className="min-w-[150px] px-2 py-[9px] align-top font-medium first:pl-2"
      >
        {row.item}
        {row.detail ? (
          <div className="mt-px text-[12.5px] font-normal text-muted-foreground">{row.detail}</div>
        ) : null}
      </TableHead>
    );
    const note = row.note ? (
      <div className="mt-[3px] text-xs text-muted-foreground">{row.note}</div>
    ) : null;

    if (row.match === 'matched') {
      const previous = row.previousCents ?? 0;
      const current = row.currentCents ?? 0;
      const delta = current - previous;
      const percent =
        row.deltaPercent !== undefined
          ? row.deltaPercent
          : previous === 0
            ? null
            : (delta / previous) * 100;
      const direction: Direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'zero';
      const percentText = percent === null ? null : roundPercent(Math.abs(percent));
      const big = percent !== null && Math.abs(percent) >= highlightPercent;
      const read =
        delta === 0
          ? messages.noChange
          : (delta > 0 ? messages.increase : messages.decrease)(
              spokenAmount(Math.abs(delta)),
              percentText,
            );
      return (
        <TableRow key={row.id} data-match={row.match} data-highlight={big || undefined}>
          {header}
          <TableCell className={cell}>{amount(previous)}</TableCell>
          <TableCell className={cell}>{amount(current)}</TableCell>
          <TableCell className={cn(cell, directionClass[direction])}>
            <Spoken shown={signed(delta)} read={read} />
          </TableCell>
          <TableCell
            className={cn(cell, directionClass[direction], big && 'bg-warning-subtle')}
            data-percent={percent === null ? 'none' : undefined}
          >
            {percent === null ? (
              <Tooltip content={messages.noPercent}>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={messages.noPercent}
                  className={cn('rounded-sm', focusRing)}
                >
                  n/a
                </span>
              </Tooltip>
            ) : (
              `${percent > 0 ? '+' : percent < 0 ? MINUS : ''}${roundPercent(Math.abs(percent))}%`
            )}
          </TableCell>
          <TableCell className="min-w-[104px] px-2 py-[9px] align-top last:pr-2">
            <Badge variant="success">{messages.matched}</Badge>
            {note}
          </TableCell>
        </TableRow>
      );
    }

    const onlyCurrent = row.match === 'only-current';
    const value = (onlyCurrent ? row.currentCents : row.previousCents) ?? 0;
    return (
      <TableRow key={row.id} data-match={row.match} className="bg-note">
        {header}
        <TableCell className={cn(cell, onlyCurrent && 'text-muted-foreground')}>
          {onlyCurrent ? none : amount(value)}
        </TableCell>
        <TableCell className={cn(cell, !onlyCurrent && 'text-muted-foreground')}>
          {onlyCurrent ? amount(value) : none}
        </TableCell>
        <TableCell className={cn(cell, directionClass[onlyCurrent ? 'up' : 'down'])}>
          <Spoken
            shown={signed(onlyCurrent ? value : -value)}
            read={(onlyCurrent ? messages.added : messages.removed)(spokenAmount(value))}
          />
        </TableCell>
        <TableCell className={cn(cell, 'text-muted-foreground')}>{notApplicable}</TableCell>
        <TableCell className="max-w-[160px] min-w-[104px] px-2 py-[9px] align-top last:pr-2">
          <Badge variant="warning">{messages.unmatched}</Badge>
          <div className="mt-[3px] text-xs whitespace-normal text-muted-foreground">
            {onlyCurrent ? messages.onlyCurrent(currentVersion) : messages.onlyPrevious}
            {row.note ? <> · {row.note}</> : null}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const columnHead = 'px-2 py-[9px] text-right text-xs first:pl-2 last:pr-2';

  return (
    <div className={className} {...props}>
      <Table caption={caption} className="text-[13.5px]">
        <TableHeader>
          <TableRow>
            <TableHead className={cn(columnHead, 'text-left')}>{messages.item}</TableHead>
            <TableHead className={columnHead}>
              {messages.version(previousVersion, currency)}
            </TableHead>
            <TableHead className={columnHead}>
              {messages.version(currentVersion, currency)}
            </TableHead>
            <TableHead className={columnHead}>{messages.change(currency)}</TableHead>
            <TableHead className={columnHead}>{messages.percent}</TableHead>
            <TableHead className={cn(columnHead, 'text-left')}>{messages.match}</TableHead>
          </TableRow>
        </TableHeader>
        {filled.map((group) => (
          <TableBody key={group.id} className="[&_tr:last-child]:border-b">
            <TableRow className="bg-muted/50">
              <TableHead
                scope="rowgroup"
                colSpan={columns}
                className="px-2.5 py-1.5 text-xs font-semibold tracking-[0.02em] text-muted-foreground first:pl-2.5"
              >
                {group.label}
              </TableHead>
            </TableRow>
            {group.rows.map(renderRow)}
          </TableBody>
        ))}
      </Table>
    </div>
  );
}
