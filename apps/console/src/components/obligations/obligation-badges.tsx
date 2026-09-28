import { Badge, Icon } from '@adili/ui';
import { MinusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons';

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
