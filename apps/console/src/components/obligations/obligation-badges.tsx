import { Badge, Icon, StatusBadge, type StatusBadgeVariant } from '@adili/ui';
import { MinusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import type { ObligationStatus } from '../../server/declarations/client';
import { messages as m, OBLIGATION_STATUS_LABELS } from './messages';

/** Spec 04: upcoming neutral, due info, overdue warning, filed success. */
export const STATUS_VARIANTS: Record<ObligationStatus, StatusBadgeVariant> = {
  upcoming: 'neutral',
  due: 'info',
  overdue: 'warning',
  filed: 'success',
  cancelled: 'neutral',
};

/** An obligation's status as a badge with its word. */
export function ObligationStatusBadge({ status }: { status: ObligationStatus }) {
  return (
    <StatusBadge variant={STATUS_VARIANTS[status]}>{OBLIGATION_STATUS_LABELS[status]}</StatusBadge>
  );
}

/** Whether the officer has onboarded: "Yes" with a tick, or a plain "No". */
export function OnboardedBadge({ onboarded }: { onboarded: boolean }) {
  return onboarded ? (
    <Badge variant="success">
      <Icon icon={Tick02Icon} strokeWidth={2.4} />
      {m.yes}
    </Badge>
  ) : (
    <Badge>
      <Icon icon={MinusSignIcon} strokeWidth={2.4} />
      {m.no}
    </Badge>
  );
}
