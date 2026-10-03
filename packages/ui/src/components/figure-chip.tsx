import { AlertCircleIcon, HashtagIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon } from './icon';

/** A figure as a reader sees it: "National filing rate 2027" and "91.2%". */
export interface FigureLabel {
  label: string;
  value: string;
}

/**
 * Resolves an aggregate key in the ai-gateway scheme (`national.<name>`, `commission.<code>.<name>`,
 * prefixed `fy<fy>.` for a prior year; reporting.yaml `NarrativeParagraph.aggregateRefs`) to its
 * label and formatted value, or null when the key names no figure the caller has.
 */
export type FigureFormatter = (aggregateKey: string) => FigureLabel | null;

export interface FigureChipMessages {
  /** The pressable chip's accessible name. */
  name: (label: string, value: string) => string;
  /** Shown for a key the formatter cannot resolve. */
  notFound: string;
}

export const FIGURE_CHIP_MESSAGES: FigureChipMessages = {
  name: (label, value) => `Figure ${label}: ${value}. Show in table`,
  notFound: 'Figure not found',
};

const chipClassName =
  'inline-flex h-6 max-w-full items-center gap-[5px] overflow-hidden rounded-chip pr-[9px] pl-[7px] text-[12.5px] whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0';

export type FigureChipProps = Omit<ComponentProps<'button'>, 'children' | 'onClick'> & {
  /** The aggregate key a narrative paragraph cites. */
  aggregateKey: string;
  format: FigureFormatter;
  /**
   * Shows the figure where it comes from (the console scrolls to its table row and highlights it).
   * Without it the chip is plain text, for a read-only document.
   */
  onShow?: (aggregateKey: string) => void;
  messages?: Partial<FigureChipMessages>;
};

/**
 * A figure a narrative cites, by its aggregate key rendered through `format` as "{label}: {value}"
 * with the value in bold. A button named "Figure {label}: {value}. Show in table" with `onShow`;
 * a key `format` cannot resolve reads "Figure not found" in amber, the key in its title.
 */
export function FigureChip({
  aggregateKey,
  format,
  onShow,
  messages,
  className,
  ...props
}: FigureChipProps) {
  const copy = { ...FIGURE_CHIP_MESSAGES, ...messages };
  const figure = format(aggregateKey);

  if (!figure) {
    return (
      <span
        title={aggregateKey}
        data-state="not-found"
        className={cn(
          chipClassName,
          'bg-warning-subtle text-warning-subtle-foreground [&_svg]:text-warning',
          className,
        )}
      >
        <Icon icon={AlertCircleIcon} strokeWidth={2} />
        <span className="truncate">{copy.notFound}</span>
      </span>
    );
  }

  const inner = (
    <>
      <Icon icon={HashtagIcon} strokeWidth={2} className="text-muted-foreground" />
      <span className="min-w-0 truncate">
        {figure.label}: <b className="font-semibold text-foreground tabular-nums">{figure.value}</b>
      </span>
    </>
  );
  const tone = 'bg-muted text-secondary-foreground';

  if (!onShow) return <span className={cn(chipClassName, tone, className)}>{inner}</span>;

  return (
    <button
      type="button"
      title={aggregateKey}
      aria-label={copy.name(figure.label, figure.value)}
      {...props}
      onClick={() => {
        onShow(aggregateKey);
      }}
      className={cn(focusRing, chipClassName, tone, 'cursor-pointer hover:bg-input', className)}
    >
      {inner}
    </button>
  );
}
