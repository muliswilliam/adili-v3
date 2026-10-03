import { AlertCircleIcon, Clock01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

import { cn } from '../lib/cn';
import { Badge, type BadgeProps } from './badge';
import { Icon, type IconProps } from './icon';

/** Whether a Commission's Form M reached EACC for a financial year, as the reporting contract's `IntakeStatus`. */
export type IntakeStatus = 'not-reported' | 'submitted-on-time' | 'submitted-late';

export const INTAKE_STATUSES: readonly IntakeStatus[] = [
  'submitted-on-time',
  'submitted-late',
  'not-reported',
];

export type IntakeStatusBadgeMessages = Record<IntakeStatus, string>;

export const INTAKE_STATUS_BADGE_MESSAGES: IntakeStatusBadgeMessages = {
  'submitted-on-time': 'Reported on time',
  'submitted-late': 'Reported late',
  'not-reported': 'Not reported',
};

const META: Record<
  IntakeStatus,
  { variant: NonNullable<BadgeProps['variant']>; icon: IconProps['icon']; strokeWidth: number }
> = {
  'submitted-on-time': { variant: 'success', icon: Tick02Icon, strokeWidth: 2.4 },
  'submitted-late': { variant: 'warning', icon: Clock01Icon, strokeWidth: 2.2 },
  'not-reported': { variant: 'destructive', icon: AlertCircleIcon, strokeWidth: 2.2 },
};

export type IntakeStatusBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  status: IntakeStatus;
  /** Replaces any of the default words. */
  messages?: Partial<IntakeStatusBadgeMessages>;
};

/**
 * A Commission's Form M on EACC's intake for a financial year: "Reported on time" (green, a
 * tick), "Reported late" (amber, a clock: received after 31 July) or "Not reported" (red, an
 * alert). The status is in the text, never colour alone.
 */
export function IntakeStatusBadge({
  status,
  messages,
  className,
  ...props
}: IntakeStatusBadgeProps) {
  const copy = { ...INTAKE_STATUS_BADGE_MESSAGES, ...messages };
  const { variant, icon, strokeWidth } = META[status];
  return (
    <Badge variant={variant} data-status={status} className={cn('pl-[7px]', className)} {...props}>
      <Icon icon={icon} strokeWidth={strokeWidth} />
      {copy[status]}
    </Badge>
  );
}
