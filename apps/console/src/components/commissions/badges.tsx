import { Badge, cn, Icon } from '@adili/ui';
import {
  Link04Icon,
  Mail01Icon,
  ServerStack01Icon,
  Tick02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';

import type { CommissionType, ReportingOfficer } from '../../server/directory/client';
import { messages as m } from './messages';

/** Hosted or Federated, outlined as in the prototype (`.badge-type`); the icon repeats the text. */
export function CommissionTypeBadge({ type }: { type: CommissionType }) {
  const hosted = type === 'hosted';
  return (
    <Badge
      className={cn(
        'bg-card ring-1 ring-input ring-inset',
        hosted ? 'text-foreground' : 'text-secondary-foreground',
      )}
    >
      <Icon icon={hosted ? ServerStack01Icon : Link04Icon} />
      {hosted ? m.typeHosted : m.typeFederated}
    </Badge>
  );
}

/** State of the current reporting officer; text always carries the meaning, not colour. */
export function OfficerStateBadge({ state }: { state: ReportingOfficer['state'] }) {
  return state === 'activated' ? (
    <Badge variant="success">
      <Icon icon={Tick02Icon} strokeWidth={2.4} />
      {m.officerActivated}
    </Badge>
  ) : (
    <Badge variant="warning">
      <Icon icon={Mail01Icon} />
      {m.officerInvited}
    </Badge>
  );
}

/** For EACC staff, whose access to the workspace is read only. */
export function ReadOnlyBadge() {
  return (
    <Badge>
      <Icon icon={ViewIcon} />
      {m.readOnly}
    </Badge>
  );
}

/** The issuer code as printed in reference numbers, e.g. `TSC`. */
export function IssuerCode({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        'block font-mono text-xs font-medium tracking-[0.04em] text-muted-foreground',
        className,
      )}
    >
      {code}
    </span>
  );
}
