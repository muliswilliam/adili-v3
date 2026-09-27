import { Badge, cn, Icon } from '@adili/ui';
import {
  Link04Icon,
  Mail01Icon,
  ServerStack01Icon,
  Tick02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';

import type { Commission, ReportingOfficer } from '../../server/directory/types';
import { messages } from './messages';

/** Hosted or Federated, outlined as in the prototype (`.badge-type`); the icon repeats the text. */
export function CommissionTypeBadge({ type }: { type: Commission['type'] }) {
  const hosted = type === 'hosted';
  return (
    <Badge
      className={cn(
        'bg-card ring-1 ring-input ring-inset',
        hosted ? 'text-foreground' : 'text-secondary-foreground',
      )}
    >
      <Icon icon={hosted ? ServerStack01Icon : Link04Icon} />
      {messages.type[type]}
    </Badge>
  );
}

export function OfficerStateBadge({ state }: { state: ReportingOfficer['state'] }) {
  return state === 'activated' ? (
    <Badge variant="success">
      <Icon icon={Tick02Icon} strokeWidth={2.4} />
      {messages.officerState.activated}
    </Badge>
  ) : (
    <Badge variant="warning">
      <Icon icon={Mail01Icon} />
      {messages.officerState.invited}
    </Badge>
  );
}

/** For EACC staff, whose access to the workspace is read only. */
export function ReadOnlyBadge() {
  return (
    <Badge>
      <Icon icon={ViewIcon} />
      {messages.readOnly}
    </Badge>
  );
}
