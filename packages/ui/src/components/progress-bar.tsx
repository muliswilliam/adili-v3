import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';

export type ProgressBarProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Names the bar; rendered above it. */
  label: ReactNode;
  value: number;
  /** Defaults to 100. */
  max?: number;
  /** Visible text beside the label, e.g. "1,200 of 4,000 rows". Defaults to the percentage. */
  valueText?: string;
  /**
   * The bar announces progress to screen readers each time it crosses one of these percentage
   * steps, instead of on every update. Defaults to 25.
   */
  announceEvery?: number;
};

/**
 * A determinate progress bar. Screen readers can read its value at any time; the live
 * announcement only fires at coarse steps so a fast upload does not flood the reader.
 */
export function ProgressBar({
  label,
  value,
  max = 100,
  valueText,
  announceEvery = 25,
  className,
  ...props
}: ProgressBarProps) {
  const labelId = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = max > 0 ? Math.round((clamped / max) * 100) : 0;
  const text = valueText ?? `${String(percent)}%`;
  // The live region's text only changes when a step is crossed, so that is all that is read.
  // Nothing is said at 0%; the label already tells the user what is running.
  const step = Math.floor(percent / announceEvery) * announceEvery;
  const announced = step > 0 ? `${String(step)}%` : '';

  return (
    <div className={cn('grid gap-1.5', className)} {...props}>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span id={labelId}>{label}</span>
        <span className="text-muted-foreground tabular-nums">{text}</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <div role="status" className="sr-only">
        {announced}
      </div>
    </div>
  );
}
