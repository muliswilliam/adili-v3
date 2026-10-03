import { type ComponentProps, type ReactNode, useId, useState } from 'react';

import { clamp } from '../lib/clamp';
import { cn } from '../lib/cn';

const DEFAULT_MAX = 100;
const DEFAULT_ANNOUNCE_EVERY = 25;

export type ProgressBarProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Names the bar for assistive technology, e.g. "Import progress". Not shown. */
  label: ReactNode;
  /** Clamped to 0 to `max`. A value that is not a finite number counts as 0. */
  value: number;
  /** Defaults to 100, which is also used when `max` is not a positive number. */
  max?: number;
  /** Shown under the bar, e.g. "Uploading…" or "12,108 of 48,431 rows". */
  status?: ReactNode;
  /**
   * Read by screen readers instead of the percentage, e.g. "1,200 of 4,000 rows", both as the
   * bar's value and in the step announcements.
   */
  valueText?: string;
  /** Shows the percentage under the bar. Defaults to true. */
  showValue?: boolean;
  /** For when the total is not known yet: a sweeping bar with no value. */
  indeterminate?: boolean;
  /** `sm` is the 6px bar for stat tiles. */
  size?: 'default' | 'sm';
  /** `success` for a finished run, `destructive` for one that stopped. */
  tone?: 'default' | 'success' | 'destructive';
  /**
   * The bar announces progress to screen readers each time it crosses one of these percentage
   * steps, instead of on every update. Defaults to 25, which is also used when the value is not
   * a positive number.
   */
  announceEvery?: number;
  /**
   * Set false when the bar's owner announces progress in its own words (a batch that announces
   * each chunk), so screen readers do not hear it twice. Defaults to true.
   */
  announce?: boolean;
};

/**
 * A progress bar with an optional status line and percentage under it. Screen readers can read
 * its value at any time; the live announcement only fires at coarse steps so a fast upload does
 * not flood the reader.
 */
export function ProgressBar({
  label,
  value,
  max = DEFAULT_MAX,
  status,
  valueText,
  showValue = true,
  indeterminate = false,
  size = 'default',
  tone = 'default',
  announceEvery = DEFAULT_ANNOUNCE_EVERY,
  announce = true,
  className,
  ...props
}: ProgressBarProps) {
  const labelId = useId();
  const safeMax = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX;
  const clamped = Number.isFinite(value) ? clamp(value, 0, safeMax) : 0;
  const percent = Math.round((clamped / safeMax) * 100);
  const text = valueText ?? `${String(percent)}%`;
  const every =
    Number.isFinite(announceEvery) && announceEvery > 0 ? announceEvery : DEFAULT_ANNOUNCE_EVERY;
  // The live region's text only changes when a step is crossed, so that is all that is read.
  // Nothing is said at 0%; the label already tells the user what is running.
  const step = indeterminate ? 0 : Math.floor(percent / every) * every;
  const announcementFor = (at: number) => (at > 0 ? (valueText ?? `${String(at)}%`) : '');
  const [announcement, setAnnouncement] = useState(() => ({ step, text: announcementFor(step) }));
  if (announcement.step !== step) {
    setAnnouncement({ step, text: announcementFor(step) });
  }
  const showMeta = status !== undefined || (showValue && !indeterminate);

  return (
    <div className={cn('grid gap-2', className)} {...props}>
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuetext={indeterminate ? undefined : text}
        className={cn(
          'w-full overflow-hidden rounded-full bg-muted inset-ring inset-ring-border',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'success'
              ? 'bg-success'
              : tone === 'destructive'
                ? 'bg-destructive'
                : 'bg-primary',
            indeterminate
              ? 'w-[32%] animate-indeterminate motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40'
              : 'transition-[width] duration-500 ease-out motion-reduce:transition-none',
          )}
          style={indeterminate ? undefined : { width: `${String(percent)}%` }}
        />
      </div>
      {showMeta ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span>{status}</span>
          {showValue && !indeterminate ? (
            <span className="font-semibold tabular-nums">{`${String(percent)}%`}</span>
          ) : null}
        </div>
      ) : null}
      {announce ? (
        <div role="status" className="sr-only">
          {announcement.text}
        </div>
      ) : null}
    </div>
  );
}
