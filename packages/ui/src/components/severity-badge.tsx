import { InformationCircleIcon } from '@hugeicons/core-free-icons';

import { cn } from '../lib/cn';
import { Badge, type BadgeProps } from './badge';
import { Icon } from './icon';
import { SignalBars } from './priority-badge';

/** A review flag's severity (review.yaml `Severity`). */
export type Severity = 'high' | 'medium' | 'low' | 'info';

export const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low', 'info'];

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

const META: Record<Severity, { variant: NonNullable<BadgeProps['variant']>; bars: number }> = {
  high: { variant: 'destructive', bars: 3 },
  medium: { variant: 'warning', bars: 2 },
  low: { variant: 'info', bars: 1 },
  info: { variant: 'default', bars: 0 },
};

export type SeverityBadgeProps = Omit<BadgeProps, 'children' | 'variant' | 'size'> & {
  severity: Severity;
  /** Replaces the word, e.g. for another language. */
  label?: string;
  /** `sm`: 19px, for a reviewed or closed flag's line and the copilot's flag list. */
  size?: 'default' | 'sm';
};

/**
 * A flag's severity: bars and the word, never colour alone (the kit's `.sevb`). High is red with
 * three bars, medium amber with two, low blue with one, info grey with an info mark. Smaller than
 * a `PriorityBadge`, which ranks a whole case.
 */
export function SeverityBadge({
  severity,
  label,
  size = 'default',
  className,
  ...props
}: SeverityBadgeProps) {
  const { variant, bars } = META[severity];
  return (
    <Badge
      variant={variant}
      data-severity={severity}
      className={cn(
        'font-semibold [&_svg]:size-3',
        size === 'sm' ? 'h-[19px] gap-1 px-1.5 text-[11px]' : 'h-[22px] gap-[5px] px-2 text-xs',
        className,
      )}
      {...props}
    >
      {bars > 0 ? (
        <SignalBars lit={bars} />
      ) : (
        <Icon icon={InformationCircleIcon} strokeWidth={2.2} />
      )}
      {label ?? SEVERITY_LABELS[severity]}
    </Badge>
  );
}
