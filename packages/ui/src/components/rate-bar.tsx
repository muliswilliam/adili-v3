import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { formatNumber, formatPercent } from '../lib/format-number';

/** `ok` at or above the threshold, `low` below it, `critical` below the critical rate. */
export type RateTone = 'ok' | 'low' | 'critical';

export interface RateBarMessages {
  /** Follows the percentage, read by screen readers: "84% declared". */
  declared: string;
  /** "42 of 50". */
  counts: (declared: string, expected: string) => string;
  /** Nobody was expected to declare. */
  noneExpected: string;
  /** Some declared though nobody was expected: "3 declared, 0 expected". */
  declaredNoneExpected: (declared: string) => string;
}

export const RATE_BAR_MESSAGES: RateBarMessages = {
  declared: 'declared',
  counts: (declared, expected) => `${declared} of ${expected}`,
  noneExpected: 'None expected',
  declaredNoneExpected: (declared) => `${declared} declared, 0 expected`,
};

export type RateBarProps = Omit<ComponentProps<'div'>, 'children'> & {
  declared: number;
  expected: number;
  /** `lg` for a section's headline rate: a taller bar up to 360px wide. */
  size?: 'sm' | 'lg';
  /**
   * Shows "{declared} of {expected}" under the bar. Off where the counts sit beside it already;
   * screen readers still hear them.
   */
  showCounts?: boolean;
  /** The share below which the rate is low (amber). 0.8 by default, the intake's default. */
  threshold?: number;
  /** The share below which the rate is critical (red). 0.6 by default. */
  criticalBelow?: number;
  messages?: Partial<RateBarMessages>;
};

/**
 * A rate to one decimal place. It never rounds up to 100 while someone has not declared, so a
 * Commission with one officer missing does not read as complete, nor down to 0 while someone has.
 */
function percentOf(declared: number, expected: number): number {
  const percent = Math.round((declared / expected) * 1000) / 10;
  return declared < expected ? Math.min(percent, 99.9) : percent;
}

export function rateTone(share: number, threshold = 0.8, criticalBelow = 0.6): RateTone {
  if (share < criticalBelow) return 'critical';
  if (share < threshold) return 'low';
  return 'ok';
}

const TONE = {
  ok: { fill: 'bg-foreground', text: 'text-foreground' },
  low: { fill: 'bg-warning-mark', text: 'text-warning' },
  critical: { fill: 'bg-destructive', text: 'text-destructive' },
} satisfies Record<RateTone, { fill: string; text: string }>;

/**
 * How many declared of those expected (a Form M section, a Commission on the intake, the
 * national totals): a bar, the percentage as text ("84%") and "42 of 50" under it. The bar is
 * decorative; screen readers hear "84% declared, 42 of 50". Amber below `threshold`, red below
 * `criticalBelow`, and the percentage says it in text either way.
 */
export function RateBar({
  declared,
  expected,
  size = 'sm',
  showCounts = true,
  threshold,
  criticalBelow,
  messages,
  className,
  ...props
}: RateBarProps) {
  const copy = { ...RATE_BAR_MESSAGES, ...messages };

  if (expected <= 0) {
    return (
      <div className={cn('text-[13px] text-muted-foreground', className)} {...props}>
        {declared > 0 ? copy.declaredNoneExpected(formatNumber(declared)) : copy.noneExpected}
      </div>
    );
  }

  const percent = percentOf(declared, expected);
  // From the percentage shown, so the colour never disagrees with the number.
  const tone = rateTone(percent / 100, threshold, criticalBelow);
  const text = percent === 0 && declared > 0 ? `<${formatPercent(0.1)}` : formatPercent(percent);
  const counts = copy.counts(formatNumber(declared), formatNumber(expected));

  return (
    <div
      data-tone={tone}
      className={cn(size === 'lg' ? 'w-full max-w-[360px]' : 'min-w-[104px]', className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span
          data-slot="rate-track"
          aria-hidden="true"
          className={cn(
            'relative min-w-12 flex-1 overflow-hidden rounded-full bg-muted',
            size === 'lg' ? 'h-2' : 'h-1.5',
          )}
        >
          <span
            data-slot="rate-fill"
            className={cn('absolute inset-y-0 left-0 rounded-full', TONE[tone].fill)}
            style={{ width: `${String(Math.min(100, percent))}%` }}
          />
        </span>
        <span
          className={cn(
            'min-w-11 text-right text-[13px] font-semibold tabular-nums',
            TONE[tone].text,
          )}
        >
          {text}
        </span>
        <span className="sr-only">{` ${copy.declared}, `}</span>
        {showCounts ? null : <span className="sr-only">{counts}</span>}
      </div>
      {showCounts ? (
        <div className="mt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {counts}
        </div>
      ) : null}
    </div>
  );
}
