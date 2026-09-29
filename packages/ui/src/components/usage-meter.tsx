import { Alert02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format-number';
import { Icon } from './icon';

/** From this share of the budget the meter turns amber. */
export const USAGE_HIGH_PERCENT = 80;

/** `normal` below 80% of the budget, `high` from 80%, `used-up` at or over it. */
export type UsageLevel = 'normal' | 'high' | 'used-up';

/** Share of the budget used, 0 and up. Any use of a zero budget counts as 100%. */
export function usagePercent(tokensUsed: number, monthlyTokens: number): number {
  if (monthlyTokens > 0) return (tokensUsed / monthlyTokens) * 100;
  return tokensUsed > 0 ? 100 : 0;
}

export function usageLevel(tokensUsed: number, monthlyTokens: number): UsageLevel {
  const percent = usagePercent(tokensUsed, monthlyTokens);
  if (percent >= 100) return 'used-up';
  if (percent >= USAGE_HIGH_PERCENT) return 'high';
  return 'normal';
}

/** `412800` → `413k`, `1926400` → `1.93M`, `1500000` → `1.5M`. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Number((tokens / 1_000_000).toFixed(2)))}M`;
  if (tokens >= 1_000) return `${String(Math.round(tokens / 1_000))}k`;
  return String(tokens);
}

export interface UsageMeterMessages {
  /** After the tokens used: "of 3M tokens". */
  ofBudget: (budget: string) => string;
  usedUp: string;
  /** Names the meter for screen readers, with full numbers. */
  label: (used: string, budget: string) => string;
  /** Added to the name from 80%. */
  highNote: string;
  /** Added to the name once the budget is used up. */
  usedUpNote: string;
}

const DEFAULT_MESSAGES: UsageMeterMessages = {
  ofBudget: (budget) => `of ${budget} tokens`,
  usedUp: 'Used up',
  label: (used, budget) => `Tokens this month: ${used} of ${budget}`,
  highNote: `Over ${String(USAGE_HIGH_PERCENT)}%`,
  usedUpNote: 'Budget used up',
};

export type UsageMeterProps = Omit<ComponentProps<'div'>, 'children'> & {
  tokensUsed: number;
  monthlyTokens: number;
  /** `lg` is the 10px bar for a Commission's detail. */
  size?: 'default' | 'lg';
  messages?: Partial<UsageMeterMessages>;
};

/**
 * Tokens used this month against a tenant's budget: a bar with a notch at 80%, the tokens used
 * and the percentage. From 80% the bar turns amber and the percentage gets an alert icon; at the
 * budget it turns red and reads "Used up". The level is always in text as well as colour.
 */
export function UsageMeter({
  tokensUsed,
  monthlyTokens,
  size = 'default',
  messages,
  className,
  ...props
}: UsageMeterProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const percent = usagePercent(tokensUsed, monthlyTokens);
  const level = usageLevel(tokensUsed, monthlyTokens);
  const status = level === 'used-up' ? copy.usedUp : `${String(Math.floor(percent))}%`;
  const note =
    level === 'used-up' ? `. ${copy.usedUpNote}` : level === 'high' ? `. ${copy.highNote}` : '';

  return (
    <div
      role="meter"
      aria-label={`${copy.label(formatNumber(tokensUsed), formatNumber(monthlyTokens))}${note}`}
      aria-valuemin={0}
      aria-valuemax={monthlyTokens}
      aria-valuenow={Math.min(tokensUsed, monthlyTokens)}
      aria-valuetext={status}
      data-level={level}
      className={cn('grid min-w-[150px] gap-1.5', className)}
      {...props}
    >
      <div
        className={cn(
          'flex items-baseline justify-between gap-2.5 whitespace-nowrap tabular-nums',
          size === 'lg' ? 'text-sm' : 'text-[13px]',
        )}
      >
        <span>
          <b className="font-semibold">{formatTokenCount(tokensUsed)}</b>{' '}
          <span className="text-muted-foreground">
            {copy.ofBudget(formatTokenCount(monthlyTokens))}
          </span>
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[12.5px] font-semibold [&_svg]:size-[13px]',
            level === 'normal' && 'text-muted-foreground',
            level === 'high' && 'text-warning',
            level === 'used-up' && 'text-destructive',
          )}
        >
          {level === 'normal' ? null : <Icon icon={Alert02Icon} strokeWidth={2.2} />}
          {status}
        </span>
      </div>
      <div
        className={cn(
          'relative overflow-hidden rounded-full bg-muted',
          size === 'lg' ? 'h-2.5' : 'h-1.5',
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            level === 'normal' && 'bg-primary',
            level === 'high' && 'bg-warning',
            level === 'used-up' && 'bg-destructive',
          )}
          style={{ width: `${String(Math.min(100, percent))}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-card"
          style={{ left: `${String(USAGE_HIGH_PERCENT)}%` }}
        />
      </div>
    </div>
  );
}
