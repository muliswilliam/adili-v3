import type { ComponentProps } from 'react';

import { clamp } from '../lib/clamp';
import { cn } from '../lib/cn';

export type MeterProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Clamped to 0 to `max`. A value that is not a finite number counts as 0. */
  value: number;
  /** Defaults to 1, so a share (0.42) reads as is; also used when `max` is not positive. */
  max?: number;
  /**
   * Names the meter for screen readers, e.g. "Cache hit rate". Without it the meter is
   * decorative and hidden from them: the value must then be printed beside it.
   */
  label?: string;
  /** Read instead of the value when labelled, e.g. "42%". */
  valueText?: string;
};

/**
 * A small static bar showing a share of a whole, e.g. a cache hit rate beside its percentage:
 * 6px high on `muted`, filled `secondary-foreground`, 54px wide unless sized. Not for progress
 * (use `ProgressBar`, which announces its steps).
 */
export function Meter({ value, max = 1, label, valueText, className, ...props }: MeterProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const clamped = Number.isFinite(value) ? clamp(value, 0, safeMax) : 0;
  const percent = (clamped / safeMax) * 100;
  const a11y =
    label === undefined
      ? { 'aria-hidden': true }
      : {
          role: 'meter',
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': safeMax,
          'aria-valuenow': clamped,
          'aria-valuetext': valueText,
        };
  return (
    <div
      {...a11y}
      className={cn('block h-1.5 w-[54px] overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-secondary-foreground"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}
