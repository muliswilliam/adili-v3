import { Alert02Icon, Calendar03Icon, Clock01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import type { Tone } from '../lib/tone';
import { badgeVariants } from './badge';
import { Icon, type IconProps } from './icon';

export type StatusBadgeVariant = 'neutral' | 'info' | 'warning' | 'success';

const variantTones: Record<StatusBadgeVariant, Tone> = {
  neutral: 'default',
  info: 'info',
  warning: 'warning',
  success: 'success',
};

const variantIcons: Record<StatusBadgeVariant, IconProps['icon']> = {
  neutral: Clock01Icon,
  info: Calendar03Icon,
  warning: Alert02Icon,
  success: Tick02Icon,
};

export type StatusBadgeProps = ComponentProps<'span'> & {
  /** `neutral` (default), `info`, `warning` or `success`. */
  variant?: StatusBadgeVariant;
  /** Replaces the variant's icon; `null` shows none. */
  icon?: IconProps['icon'] | null;
};

/**
 * A status as a badge with its word and an icon, never colour alone: `neutral` for something
 * not started (upcoming, a clock), `info` for something open now (due, a calendar), `warning`
 * for something that needs action (overdue, an alert) and `success` for something done (filed,
 * a tick). The children are the status word.
 */
export function StatusBadge({
  variant = 'neutral',
  icon,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  const shown = icon === undefined ? variantIcons[variant] : icon;
  return (
    <span
      data-variant={variant}
      className={cn(badgeVariants({ variant: variantTones[variant] }), className)}
      {...props}
    >
      {shown ? <Icon icon={shown} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}
