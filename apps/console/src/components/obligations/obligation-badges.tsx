import { Badge, Icon, obligationStatusLabel, obligationStatusMeta, StatusBadge } from '@adili/ui';
import { MinusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import type { ObligationStatus } from '../../server/declarations/client';
import { messages as m } from './messages';

/** An obligation's status as a badge with its word (spec 04: the variants of the shared table). */
export function ObligationStatusBadge({ status }: { status: ObligationStatus }) {
  const variant = status === 'cancelled' ? 'neutral' : obligationStatusMeta[status].variant;
  return <StatusBadge variant={variant}>{obligationStatusLabel(status)}</StatusBadge>;
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
