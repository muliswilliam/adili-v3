import { ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format-number';
import { Icon } from './icon';

/**
 * Why an open-data figure is not shown: `under-threshold`, it counts over fewer officers than
 * the release's suppression threshold (the contract's `suppressed: true` row); `complementary`,
 * it is hidden so a figure under the threshold cannot be worked out from a published total;
 * `not-reported`, the Commission has not reported for the year (its figures are `null`,
 * unsuppressed).
 */
export type SuppressionKind = 'under-threshold' | 'complementary' | 'not-reported';

export const SUPPRESSION_KINDS: readonly SuppressionKind[] = [
  'under-threshold',
  'complementary',
  'not-reported',
];

/** The default suppression threshold, as the reporting contract's `suppression.threshold`. */
export const DEFAULT_SUPPRESSION_THRESHOLD = 10;

export interface SuppressionMessages {
  /** Shown in the cell, hidden from screen readers: "‹10". */
  underThreshold: (threshold: number) => string;
  /** Read by screen readers in place of the cell's marker. */
  underThresholdText: (threshold: number) => string;
  /** The tooltip on hover. */
  underThresholdTitle: (threshold: number) => string;
  complementary: string;
  complementaryText: string;
  complementaryTitle: string;
  notReported: string;
  /** The legend's sentence. */
  legend: (threshold: number) => string;
  /** How many cells the table hides, beside the legend's sentence. */
  hiddenCount: (count: string) => string;
  /** The legend's key words beside each marker. */
  underThresholdKey: (threshold: number) => string;
  complementaryKey: string;
}

export const SUPPRESSION_MESSAGES: SuppressionMessages = {
  underThreshold: (threshold) => `‹${threshold}`,
  underThresholdText: (threshold) => `Fewer than ${threshold} officers, not shown`,
  underThresholdTitle: (threshold) => `Fewer than ${threshold} officers`,
  complementary: 'Hidden',
  complementaryText: 'Hidden to protect a small group',
  complementaryTitle: 'Hidden so a small group cannot be worked out from the totals',
  notReported: 'Not reported',
  legend: (threshold) =>
    `Cells based on fewer than ${threshold} officers are not shown to protect privacy.`,
  hiddenCount: (count) => `${count} hidden`,
  underThresholdKey: (threshold) => `Under ${threshold}`,
  complementaryKey: 'Protects a total',
};

export type SuppressionMarkerProps = Omit<ComponentProps<'span'>, 'children'> & {
  kind?: SuppressionKind;
  /** The release's suppression threshold. */
  threshold?: number;
  /** Replaces any of the default words, e.g. the Swahili ones on the portal. */
  messages?: Partial<SuppressionMessages>;
};

/**
 * Stands in for an open-data figure that is not shown, in a table cell or a chart's table: "‹10"
 * (semibold) for one over fewer officers than the threshold, "Hidden" for complementary
 * suppression, on a hatched chip, and "Not reported" on a plain muted chip. Screen readers hear a
 * sentence instead of the short form ("Fewer than 10 officers, not shown"); hovering shows the
 * reason. Readable without colour: the words and the hatch say it. Pair a table of markers with a
 * `SuppressionLegend`.
 */
export function SuppressionMarker({
  kind = 'under-threshold',
  threshold = DEFAULT_SUPPRESSION_THRESHOLD,
  messages,
  className,
  ...props
}: SuppressionMarkerProps) {
  const copy = { ...SUPPRESSION_MESSAGES, ...messages };
  const base =
    'inline-flex h-[19px] w-fit shrink-0 items-center rounded-[5px] px-1.5 text-xs whitespace-nowrap tabular-nums shadow-[inset_0_0_0_1px_var(--border)]';

  if (kind === 'not-reported') {
    return (
      <span
        data-suppression={kind}
        className={cn(base, 'bg-muted font-medium text-muted-foreground', className)}
        {...props}
      >
        {copy.notReported}
      </span>
    );
  }

  const [short, text, title] =
    kind === 'complementary'
      ? [copy.complementary, copy.complementaryText, copy.complementaryTitle]
      : [
          copy.underThreshold(threshold),
          copy.underThresholdText(threshold),
          copy.underThresholdTitle(threshold),
        ];
  return (
    <span
      data-suppression={kind}
      title={title}
      className={cn(
        base,
        'bg-stripes-muted cursor-help text-secondary-foreground',
        kind === 'complementary' ? 'font-medium' : 'font-semibold',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

export type SuppressionLegendProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The release's suppression threshold. */
  threshold?: number;
  /** How many cells the table shown hides; left out when not given. */
  hiddenCount?: number | null;
  /** Only the sentence and count, without the key, e.g. in a table toolbar. */
  compact?: boolean;
  messages?: Partial<SuppressionMessages>;
};

/**
 * Explains the suppression markers above a table or chart of open data, as a note: an eye-off
 * icon, "Cells based on fewer than 10 officers are not shown to protect privacy.", the count of
 * cells hidden, and a key pairing each marker with its meaning ("‹10 Under 10", "Hidden Protects a
 * total"; the key's markers are hidden from screen readers, which read the key words). `compact`
 * drops the key.
 */
export function SuppressionLegend({
  threshold = DEFAULT_SUPPRESSION_THRESHOLD,
  hiddenCount,
  compact = false,
  messages,
  className,
  ...props
}: SuppressionLegendProps) {
  const copy = { ...SUPPRESSION_MESSAGES, ...messages };
  return (
    <div
      role="note"
      className={cn(
        'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-secondary-foreground',
        className,
      )}
      {...props}
    >
      <Icon icon={ViewOffSlashIcon} className="size-[15px] text-muted-foreground" />
      <span className="min-w-0 flex-[1_1_260px]">
        {copy.legend(threshold)}
        {hiddenCount != null && (
          <span className="text-[12.5px] text-muted-foreground tabular-nums">
            {' '}
            {copy.hiddenCount(formatNumber(hiddenCount))}
          </span>
        )}
      </span>
      {!compact && (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <SuppressionMarker threshold={threshold} messages={messages} aria-hidden="true" />
          <span className="mr-1.5">{copy.underThresholdKey(threshold)}</span>
          <SuppressionMarker kind="complementary" messages={messages} aria-hidden="true" />
          <span>{copy.complementaryKey}</span>
        </span>
      )}
    </div>
  );
}
