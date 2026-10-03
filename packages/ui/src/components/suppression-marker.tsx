import { ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format-number';
import { Icon } from './icon';

/**
 * Why an open-data figure is not shown.
 *
 * - `suppressed`: the contract's suppressed cell (`null` with the marker), shown "‹10". It may
 *   count fewer officers than the threshold, or be a complementary cell over 10 or more hidden
 *   so that one cannot be worked out from a total: the contract does not tell the two apart, so
 *   its words are true of both.
 * - `complementary`: a cell known to be complementary, "Hidden", for when the contract does.
 * - `not-reported`: the Commission has not reported for the year (its figures are `null`,
 *   unsuppressed: a gap, not suppression).
 * - `not-collected`: a figure nobody collects yet (the table's `notCollected`, such as access
 *   requests until spec 10 projects them): `null` for want of data, not suppression.
 */
export type SuppressionKind = 'suppressed' | 'complementary' | 'not-reported' | 'not-collected';

export const SUPPRESSION_KINDS: readonly SuppressionKind[] = [
  'suppressed',
  'complementary',
  'not-reported',
  'not-collected',
];

/** Figures over fewer officers than this are suppressed (ADR 0009, spec 09b). */
export const DEFAULT_SUPPRESSION_THRESHOLD = 10;

/** One kind's words, given the release's threshold. */
export interface SuppressionMarkerCopy {
  /** Shown in the cell, hidden from screen readers: "‹10". */
  short: (threshold: number) => string;
  /** Read by screen readers in place of the short form. */
  text: (threshold: number) => string;
  /** The reason on hover. */
  title: (threshold: number) => string;
}

export type SuppressionMarkerMessages = Record<SuppressionKind, SuppressionMarkerCopy>;

/** Replaces any string of any kind; the rest stay the default. */
export type SuppressionMarkerMessagesOverride = Partial<
  Record<SuppressionKind, Partial<SuppressionMarkerCopy>>
>;

export const SUPPRESSION_MARKER_MESSAGES: SuppressionMarkerMessages = {
  suppressed: {
    short: (threshold) => `‹${threshold}`,
    text: () => 'Not shown to protect privacy',
    title: (threshold) =>
      `Not shown to protect privacy: it counts fewer than ${threshold} officers, or could reveal a figure that does`,
  },
  complementary: {
    short: () => 'Hidden',
    text: () => 'Hidden to protect a small group',
    title: () => 'Hidden so a small group cannot be worked out from the totals',
  },
  'not-reported': {
    short: () => 'Not reported',
    text: () => 'The Commission has not reported for this year',
    title: () => 'The Commission has not reported for this year',
  },
  'not-collected': {
    short: () => 'Not collected',
    text: () => 'Not collected yet',
    title: () => 'Not collected yet: no data is kept for this figure',
  },
};

function markerCopy(
  kind: SuppressionKind,
  messages: SuppressionMarkerMessagesOverride | undefined,
): SuppressionMarkerCopy {
  return { ...SUPPRESSION_MARKER_MESSAGES[kind], ...messages?.[kind] };
}

/** Suppression is hatched; a gap in the data (not reported, not collected) is a plain chip. */
const KIND_CLASS: Record<SuppressionKind, string> = {
  suppressed: 'bg-stripes-muted font-semibold text-secondary-foreground',
  complementary: 'bg-stripes-muted font-medium text-secondary-foreground',
  'not-reported': 'bg-muted font-medium text-muted-foreground',
  'not-collected': 'bg-muted font-medium text-muted-foreground',
};

const CHIP =
  'inline-flex h-[19px] w-fit shrink-0 items-center rounded-[5px] px-1.5 text-xs whitespace-nowrap tabular-nums shadow-[inset_0_0_0_1px_var(--border)]';

/** A legend key's chip: the short form only, hidden from screen readers, which read the key word. */
function KeyChip({
  kind,
  threshold,
  messages,
}: {
  kind: SuppressionKind;
  threshold: number;
  messages?: SuppressionMarkerMessagesOverride;
}) {
  return (
    <span aria-hidden="true" data-suppression={kind} className={cn(CHIP, KIND_CLASS[kind])}>
      {markerCopy(kind, messages).short(threshold)}
    </span>
  );
}

export type SuppressionMarkerProps = Omit<ComponentProps<'span'>, 'children'> & {
  kind?: SuppressionKind;
  /** The release's suppression threshold (the table's `suppression.threshold`). */
  threshold?: number;
  /** Replaces any string of any kind, e.g. the Swahili ones on the portal. */
  messages?: SuppressionMarkerMessagesOverride;
};

/**
 * Stands in for an open-data figure that is not shown, in a table cell or a chart's table: "‹10"
 * (semibold) for a suppressed figure and "Hidden" for a known complementary one, on a hatched
 * chip; "Not reported" and "Not collected" on a plain muted chip. Screen readers hear a sentence
 * instead of the short form ("Not shown to protect privacy"); hovering shows the reason. Readable
 * without colour: the words and the hatch say it. Pair a table of markers with a
 * `SuppressionLegend`.
 */
export function SuppressionMarker({
  kind = 'suppressed',
  threshold = DEFAULT_SUPPRESSION_THRESHOLD,
  messages,
  className,
  ...props
}: SuppressionMarkerProps) {
  const copy = markerCopy(kind, messages);
  return (
    <span
      data-suppression={kind}
      title={copy.title(threshold)}
      className={cn(CHIP, KIND_CLASS[kind], 'cursor-help', className)}
      {...props}
    >
      <span aria-hidden="true">{copy.short(threshold)}</span>
      <span className="sr-only">{copy.text(threshold)}</span>
    </span>
  );
}

export interface SuppressionLegendMessages {
  /** The note's sentence. */
  sentence: (threshold: number) => string;
  /** How many cells the table hides, beside the sentence. */
  cellsSuppressed: (count: number) => string;
  /** The key word beside each kind's chip. */
  keys: Record<SuppressionKind, (threshold: number) => string>;
}

export type SuppressionLegendMessagesOverride = Partial<Omit<SuppressionLegendMessages, 'keys'>> & {
  keys?: Partial<SuppressionLegendMessages['keys']>;
};

export const SUPPRESSION_LEGEND_MESSAGES: SuppressionLegendMessages = {
  sentence: (threshold) =>
    `Figures based on fewer than ${threshold} officers, and figures that could reveal them, are not shown to protect privacy.`,
  cellsSuppressed: (count) => `${formatNumber(count)} hidden`,
  keys: {
    suppressed: () => 'Protects privacy',
    complementary: () => 'Protects a total',
    'not-reported': () => 'Commission has not reported',
    'not-collected': () => 'Not collected yet',
  },
};

export type SuppressionLegendProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The release's suppression threshold (the table's `suppression.threshold`). */
  threshold?: number;
  /**
   * The table's `suppression.cellsSuppressed`: figures hidden by suppression (figures not
   * collected are not counted). Left out when not given.
   */
  cellsSuppressed?: number | null;
  /** The kinds to explain with a chip and a key word, in order; none by default. */
  keys?: readonly SuppressionKind[];
  messages?: SuppressionLegendMessagesOverride;
  /** The words of the key's chips. */
  markerMessages?: SuppressionMarkerMessagesOverride;
};

/**
 * Explains the suppression markers above a table or chart of open data, as a note: an eye-off
 * icon, "Figures based on fewer than 10 officers, and figures that could reveal them, are not
 * shown to protect privacy.", the count of cells hidden, and, for the `keys` asked for, each
 * kind's chip with its key word (the chips are hidden from screen readers, which read the word).
 */
export function SuppressionLegend({
  threshold = DEFAULT_SUPPRESSION_THRESHOLD,
  cellsSuppressed,
  keys = [],
  messages,
  markerMessages,
  className,
  ...props
}: SuppressionLegendProps) {
  const copy = {
    ...SUPPRESSION_LEGEND_MESSAGES,
    ...messages,
    keys: { ...SUPPRESSION_LEGEND_MESSAGES.keys, ...messages?.keys },
  };
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
        {copy.sentence(threshold)}
        {cellsSuppressed != null && (
          <span className="text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">
            {' '}
            {copy.cellsSuppressed(cellsSuppressed)}
          </span>
        )}
      </span>
      {keys.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {keys.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5 not-last:mr-1.5">
              <KeyChip kind={kind} threshold={threshold} messages={markerMessages} />
              {copy.keys[kind](threshold)}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
