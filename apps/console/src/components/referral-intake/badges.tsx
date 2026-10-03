import { Badge, type BadgeProps, Icon, type IconProps, Spinner } from '@adili/ui';
import { AlertCircleIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import type { IcmsStatus } from '../../server/reporting/types';
import { messages as t } from './messages';

const STATUSES: Record<
  IcmsStatus,
  { variant: BadgeProps['variant']; icon: IconProps['icon'] | null }
> = {
  'not-pushed': { variant: 'default', icon: null },
  pushed: { variant: 'info', icon: null },
  registered: { variant: 'success', icon: Tick02Icon },
  'push-failed': { variant: 'destructive', icon: AlertCircleIcon },
};

/**
 * Where a referral's hand-off to ICMS stands: Not pushed (grey), Pushed (blue, a spinner: ICMS
 * accepted it and its case number follows), Registered (green, a tick) or Failed (red, an
 * alert). The status is in the text, never colour alone.
 */
export function IcmsStatusBadge({ status }: { status: IcmsStatus }) {
  const { variant, icon } = STATUSES[status];
  return (
    <Badge variant={variant} data-status={status} className="pl-[7px]">
      {status === 'not-pushed' ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      ) : icon ? (
        <Icon icon={icon} strokeWidth={2.4} />
      ) : (
        <Spinner className="size-2.5 border-[1.5px]" />
      )}
      {t.status[status]}
    </Badge>
  );
}
