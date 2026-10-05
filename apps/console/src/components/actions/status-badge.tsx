import { Badge, type BadgeProps, Icon, type IconProps } from '@adili/ui';
import {
  BanIcon,
  BubbleChatIcon,
  Cancel01Icon,
  Clock01Icon,
  MinusSignIcon,
  SentIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';

import { salaryStopped } from '../../actions/payroll';
import type { ActionStatus, AdministrativeAction, Ladder } from '../../server/actions.server';
import { stoppageCopy as c } from './stoppage-messages';
import { ladderStatusLabel, statusLabel } from './messages';

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
      {statusLabel(status)}
    </Badge>
  );
}

/** "Salary stopped", in red, for a stoppage in force (the prototype's step badge). */
function SalaryStoppedBadge() {
  return (
    <Badge variant="destructive">
      <Icon icon={BanIcon} />
      {c.salaryStopped}
    </Badge>
  );
}

/**
 * A step's badge, as the stepper reads it: "Salary stopped" for a stoppage in force (from
 * payroll's acknowledgements, whatever its status); "Ended" for a step a ladder that ended
 * without compliance left issued; else its status.
 */
export function StepBadge({
  action,
  ladderStatus,
}: {
  action: AdministrativeAction;
  ladderStatus: Ladder['status'];
}) {
  if (salaryStopped(action)) return <SalaryStoppedBadge />;
  if (ladderStatus === 'ended' && (action.status === 'issued' || action.status === 'responded')) {
    return (
      <Badge variant="default">
        <Icon icon={MinusSignIcon} />
        {ladderStatusLabel('ended')}
      </Badge>
    );
  }
  return <ActionStatusBadge status={action.status} />;
}
