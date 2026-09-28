import { Badge, DateText, Icon } from '@adili/ui';
import { MinusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import type { ObligationListItem } from '../../server/declarations/client';
import { messages as m } from './messages';

/** Whether the declarant has onboarded: "Yes" with a tick, or a plain "No". */
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

/**
 * Days left or overdue ("Due in 12 days", "3 days overdue"), or when an upcoming one opens.
 * Nothing for a filed or cancelled obligation: its due date no longer counts down.
 */
export function ObligationWhen({
  obligation,
}: {
  obligation: Pick<ObligationListItem, 'status' | 'statementDate' | 'dueDate'>;
}) {
  switch (obligation.status) {
    case 'upcoming':
      return <DateText date={obligation.statementDate} kind="opens" />;
    case 'due':
    case 'overdue':
      return <DateText date={obligation.dueDate} />;
    case 'filed':
    case 'cancelled':
      return null;
  }
}
