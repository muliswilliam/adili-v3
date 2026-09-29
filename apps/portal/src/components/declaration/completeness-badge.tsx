import { Badge, Icon } from '@adili/ui';
import { AlertCircleIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import type { DeclarationSection } from '../../server/declarations/types';
import { COMPLETENESS_LABELS } from '../../declaration/labels';

/** A section's or paragraph's completeness in words, with an icon for complete and incomplete. */
export function CompletenessBadge({
  completeness,
}: {
  completeness: DeclarationSection['completeness'];
}) {
  const label = COMPLETENESS_LABELS[completeness];
  if (completeness === 'complete') {
    return (
      <Badge variant="success">
        <Icon icon={Tick02Icon} />
        {label}
      </Badge>
    );
  }
  if (completeness === 'incomplete') {
    return (
      <Badge variant="warning">
        <Icon icon={AlertCircleIcon} />
        {label}
      </Badge>
    );
  }
  return <Badge>{label}</Badge>;
}
