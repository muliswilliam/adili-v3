import { Badge, cn } from '@adili/ui';
import { Check, Link2, Mail, Server } from 'lucide-react';

import type { CommissionType, ReportingOfficer } from '../../server/directory/client';
import { messages as m } from './messages';

export function CommissionTypeBadge({ type }: { type: CommissionType }) {
  return type === 'federated' ? (
    <Badge variant="outline">
      <Link2 aria-hidden="true" />
      {m.typeFederated}
    </Badge>
  ) : (
    <Badge variant="outline">
      <Server aria-hidden="true" />
      {m.typeHosted}
    </Badge>
  );
}

/** State of the current reporting officer; text always carries the meaning, not colour. */
export function OfficerStateBadge({ state }: { state: ReportingOfficer['state'] }) {
  if (state === 'activated') {
    return (
      <Badge variant="success">
        <Check aria-hidden="true" />
        {m.officerActivated}
      </Badge>
    );
  }
  if (state === 'invited') {
    return (
      <Badge variant="warning">
        <Mail aria-hidden="true" />
        {m.officerInvited}
      </Badge>
    );
  }
  return null;
}

/** The issuer code as printed in reference numbers, e.g. `TSC`. */
export function IssuerCode({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cn('font-mono text-xs tracking-wide text-muted-foreground', className)}>
      {code}
    </span>
  );
}
