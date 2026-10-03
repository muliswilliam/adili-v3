import { Badge, type BadgeProps, Icon, type IconProps } from '@adili/ui';
import {
  BubbleChatIcon,
  Cancel01Icon,
  Clock01Icon,
  MinusSignIcon,
  SentIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';

import type { ActionStatus } from '../../server/actions.server';
import { STATUS_LABELS } from './messages';

const LOOK: Record<
  ActionStatus,
  { variant: NonNullable<BadgeProps['variant']>; icon: IconProps['icon'] }
> = {
  proposed: { variant: 'warning', icon: Clock01Icon },
  approved: { variant: 'warning', icon: Clock01Icon },
  'approved-pending-payroll': { variant: 'warning', icon: Clock01Icon },
  declined: { variant: 'destructive', icon: Cancel01Icon },
  issued: { variant: 'info', icon: SentIcon },
  responded: { variant: 'info', icon: BubbleChatIcon },
  complied: { variant: 'success', icon: Tick02Icon },
  reinstated: { variant: 'success', icon: Tick02Icon },
  cancelled: { variant: 'default', icon: MinusSignIcon },
};

/** An administrative action's status in words, with an icon and its tone. */
export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const { variant, icon } = LOOK[status];
  return (
    <Badge variant={variant}>
      <Icon icon={icon} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}
