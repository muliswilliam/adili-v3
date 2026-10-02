import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { formatMoney } from '../lib/money';
import { Badge } from './badge';
import { Tooltip } from './tooltip';

/** Matched changes of this share or more are shaded (the `value-change-25` rule's threshold). */
export const DIFF_HIGHLIGHT_PERCENT = 25;

/**
 * One item compared across two versions. An item in both versions is matched; one with a null
 * side is unmatched (only in the current version, or no longer declared).
 */
export interface DiffRow {
  id: string;
  /** The item's type: "Building". */
  label: string;
  /** "4-bedroom house on LR 12715/482". */
  description?: string;
  /** In integer cents; null when the previous version does not have the item. */
  previousCents: number | null;
  /** In integer cents; null when the current version does not have the item. */
  currentCents: number | null;
  /**
   * The change as a percentage of the previous value, as the review service computed it; null
   * when the previous value was zero. Computed when left out.
   */
  deltaPercent?: number | null;
  /** A short line under the match label: "Marked as changed", "marked as acquired". */
  note?: ReactNode;
}

/** A category of items, e.g. Assets, under its own heading row. */
export interface DiffGroup {
  id: string;
  /** Leave out for a table with a single unnamed group. */
  label?: string;
  rows: DiffRow[];
}

export type DiffKind = 'matched' | 'only-current' | 'only-previous';

/** What a row is: in both versions, or in only one. */
export function diffKind({ previousCents, currentCents }: DiffRow): DiffKind {
  if (previousCents === null) return 'only-current';
  if (currentCents === null) return 'only-previous';
  return 'matched';
}

/** The change in cents, counting a missing side as zero. */
export function diffDelta({ previousCents, currentCents }: DiffRow): number {
  return (currentCents ?? 0) - (previousCents ?? 0);
}

/**
 * A matched row's change as a percentage: the row's own `deltaPercent` when given, else computed;
 * null when the previous value was zero or the row is unmatched.
 */
export function diffPercent(row: DiffRow): number | null {
  if (diffKind(row) !== 'matched') return null;
  if (row.deltaPercent !== undefined) return row.deltaPercent;
  return row.previousCents ? (diffDelta(row) / row.previousCents) * 100 : null;
}

export interface DiffTableMessages {
  item: string;
  /** A version's column: `2` → "Version 2 (KES)". */
  versionColumn: (version: number) => string;
  change: string;
  percent: string;
  match: string;
  matched: string;
  unmatched: string;
  /** Under an unmatched row's label. */
  onlyInCurrent: (version: number) => string;
  notInCurrent: string;
  /** An empty amount cell, for screen readers (the cell shows a dash). */
  none: string;
  /** "n/a" in the percentage column. */
  notApplicable: string;
  /** Why a matched row has no percentage: tooltip and screen reader text. */
  noPercentReason: string;
  /** Why an unmatched row has no percentage, for screen readers. */
  unmatchedPercentReason: string;
  /** The change cell, for screen readers. Amounts are formatted, e.g. "KES 4,900,000". */
  increase: (amount: string) => string;
  decrease: (amount: string) => string;
  noChange: string;
  newItem: (amount: string) => string;
  removedItem: (amount: string) => string;
  /** The percentage cell, for screen readers: "40.8" → "Up 40.8 percent". */
  percentUp: (percent: string) => string;
  percentDown: (percent: string) => string;
}

const DEFAULT_MESSAGES: DiffTableMessages = {
  item: 'Item',
  versionColumn: (version) => `Version ${String(version)} (KES)`,
  change: 'Change (KES)',
  percent: '%',
  match: 'Match',
  matched: 'Matched',
  unmatched: 'Unmatched',
  onlyInCurrent: (version) => `Only in version ${String(version)}`,
  notInCurrent: 'Not in current version',
  none: 'None',
  notApplicable: 'n/a',
  noPercentReason: 'No percentage: the previous value was zero',
  unmatchedPercentReason: 'No percentage: the item is in one version only',
  increase: (amount) => `Increase of ${amount}`,
  decrease: (amount) => `Decrease of ${amount}`,
  noChange: 'No change',
  newItem: (amount) => `New item worth ${amount}`,
  removedItem: (amount) => `No longer declared, previously ${amount}`,
  percentUp: (percent) => `Up ${percent} percent`,
  percentDown: (percent) => `Down ${percent} percent`,
};

// A true minus sign, so negative amounts line up with positive ones in tabular figures.
const MINUS = '−';

const signed = (cents: number) =>
  `${cents > 0 ? '+' : cents < 0 ? MINUS : ''}${formatMoney(Math.abs(cents))}`;

const kes = (cents: number) => formatMoney(Math.abs(cents), { currency: 'KES' });

/** `40.8333` → `40.8`, `-11.27` → `11.3`: one decimal, no sign. */
const percentDigits = (percent: number) => (Math.round(Math.abs(percent) * 10) / 10).toFixed(1);

const direction = (cents: number) => (cents > 0 ? 'up' : cents < 0 ? 'down' : 'zero');

const DIRECTION_TEXT = {
  up: 'font-semibold text-warning',
  down: 'font-semibold text-info-subtle-foreground',
  zero: 'text-muted-foreground',
} as const;

/** Visible text for sighted readers and a sentence for screen readers. */
function Spoken({ shown, said }: { shown: ReactNode; said: string }) {
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{said}</span>
    </>
  );
}

export type DiffTableProps = Omit<ComponentProps<'table'>, 'children'> & {
  /** Names the table for screen readers: "Changes for Wanjiku Kamau between version 1 and 2". */
  caption: string;
  previousVersion: number;
  currentVersion: number;
  groups: DiffGroup[];
  /** Matched changes of this many percent or more are shaded. */
  highlightPercent?: number;
  messages?: Partial<DiffTableMessages>;
};

/**
 * Items compared between two versions of a declaration: before, after, the change and the
 * percentage, and whether the item matched across versions. Each item is a row header. The change
 * is read out in words ("Increase of KES 4,900,000"); a matched item whose previous value was zero
 * shows "n/a" with a tooltip saying why. Matched changes of 25% or more are shaded; unmatched
 * items sit on a warm fill with "Only in version 2" or "Not in current version".
 */
export function DiffTable({
  caption,
  previousVersion,
  currentVersion,
  groups,
  highlightPercent = DIFF_HIGHLIGHT_PERCENT,
  messages,
  className,
  ...props
}: DiffTableProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const head = 'bg-background/60 px-2 py-[9px] text-xs font-medium whitespace-nowrap';
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        className={cn('w-full border-collapse text-[13.5px] tabular-nums', className)}
        {...props}
      >
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className={cn(head, 'text-left')}>
              {copy.item}
            </th>
            <th scope="col" className={cn(head, 'text-right')}>
              {copy.versionColumn(previousVersion)}
            </th>
            <th scope="col" className={cn(head, 'text-right')}>
              {copy.versionColumn(currentVersion)}
            </th>
            <th scope="col" className={cn(head, 'text-right')}>
              {copy.change}
            </th>
            <th scope="col" className={cn(head, 'text-right')}>
              {copy.percent}
            </th>
            <th scope="col" className={cn(head, 'text-left')}>
              {copy.match}
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            {group.label ? (
              <tr className="border-b">
                <th
                  scope="rowgroup"
                  colSpan={6}
                  className="bg-muted/50 px-2.5 py-1.5 text-left text-xs font-semibold tracking-[0.02em] text-muted-foreground"
                >
                  {group.label}
                </th>
              </tr>
            ) : null}
            {group.rows.map((row) => (
              <DiffTableRow
                key={row.id}
                row={row}
                currentVersion={currentVersion}
                highlightPercent={highlightPercent}
                copy={copy}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function DiffTableRow({
  row,
  currentVersion,
  highlightPercent,
  copy,
}: {
  row: DiffRow;
  currentVersion: number;
  highlightPercent: number;
  copy: DiffTableMessages;
}) {
  const kind = diffKind(row);
  const delta = diffDelta(row);
  const percent = diffPercent(row);
  const dir = direction(delta);
  const big = percent !== null && Math.abs(percent) >= highlightPercent;
  const cell = 'border-b px-2 py-[9px] text-right align-top whitespace-nowrap';

  const amount = (cents: number | null) =>
    cents === null ? (
      <td className={cn(cell, 'text-muted-foreground')}>
        <Spoken shown="-" said={copy.none} />
      </td>
    ) : (
      <td className={cell}>{formatMoney(cents)}</td>
    );

  let deltaSaid: string;
  if (kind === 'only-current') deltaSaid = copy.newItem(kes(delta));
  else if (kind === 'only-previous') deltaSaid = copy.removedItem(kes(delta));
  else if (delta > 0) deltaSaid = copy.increase(kes(delta));
  else if (delta < 0) deltaSaid = copy.decrease(kes(delta));
  else deltaSaid = copy.noChange;

  let percentCell: ReactNode;
  if (kind !== 'matched') {
    percentCell = <Spoken shown={copy.notApplicable} said={copy.unmatchedPercentReason} />;
  } else if (percent === null) {
    percentCell = (
      <Tooltip content={copy.noPercentReason}>
        <span tabIndex={0} className={cn(focusRing, 'cursor-help rounded-xs')}>
          <Spoken shown={copy.notApplicable} said={copy.noPercentReason} />
        </span>
      </Tooltip>
    );
  } else if (delta === 0) {
    percentCell = <Spoken shown="0.0%" said={copy.noChange} />;
  } else {
    const digits = percentDigits(percent);
    percentCell = (
      <Spoken
        shown={`${percent > 0 ? '+' : MINUS}${digits}%`}
        said={percent > 0 ? copy.percentUp(digits) : copy.percentDown(digits)}
      />
    );
  }

  const status =
    kind === 'only-current'
      ? copy.onlyInCurrent(currentVersion)
      : kind === 'only-previous'
        ? copy.notInCurrent
        : null;

  return (
    <tr
      data-kind={kind}
      data-big={big ? '' : undefined}
      className={cn(kind !== 'matched' && 'bg-warning-subtle/25')}
    >
      <th scope="row" className={cn(cell, 'min-w-[150px] text-left font-medium whitespace-normal')}>
        {row.label}
        {row.description ? (
          <div className="mt-px text-[12.5px] font-normal text-muted-foreground">
            {row.description}
          </div>
        ) : null}
      </th>
      {amount(row.previousCents)}
      {amount(row.currentCents)}
      <td className={cn(cell, DIRECTION_TEXT[dir])}>
        <Spoken shown={delta === 0 ? '0' : signed(delta)} said={deltaSaid} />
      </td>
      <td
        className={cn(
          cell,
          kind === 'matched' ? DIRECTION_TEXT[dir] : 'text-muted-foreground',
          big && 'bg-warning-subtle',
        )}
      >
        {percentCell}
      </td>
      <td className={cn(cell, 'max-w-[130px] min-w-[104px] text-left whitespace-normal')}>
        <Badge variant={kind === 'matched' ? 'success' : 'warning'}>
          {kind === 'matched' ? copy.matched : copy.unmatched}
        </Badge>
        {status || row.note ? (
          <div className="mt-[3px] text-[13.5px] text-muted-foreground">
            {status}
            {status && row.note ? ' · ' : null}
            {row.note}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
