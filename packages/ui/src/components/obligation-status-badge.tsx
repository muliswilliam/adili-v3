import { type ObligationStatus, obligationStatusMeta } from '../lib/obligations';
import { StatusBadge, type StatusBadgeProps } from './status-badge';

export type ObligationStatusBadgeProps = Omit<StatusBadgeProps, 'variant' | 'icon' | 'children'> & {
  status: ObligationStatus;
};

/**
 * A filing obligation's status as a `StatusBadge`, with the word and variant from the shared
 * table (`obligationStatusMeta`), so the portal and the console badge every status alike.
 */
export function ObligationStatusBadge({ status, ...props }: ObligationStatusBadgeProps) {
  const meta = obligationStatusMeta[status];
  return (
    <StatusBadge variant={meta.variant} icon={meta.icon} {...props}>
      {meta.label}
    </StatusBadge>
  );
}
