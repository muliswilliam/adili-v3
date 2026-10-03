import { Button, type ButtonProps, Icon } from '@adili/ui';
import { RefreshIcon, SentIcon } from '@hugeicons/core-free-icons';

import type { ReferralIntakeItem } from '../../server/reporting/types';
import { messages as t } from './messages';

/** Whether the referral can be pushed to ICMS: not yet, or again after a failed push. */
export function pushable(referral: Pick<ReferralIntakeItem, 'icmsStatus'>): boolean {
  return referral.icmsStatus === 'not-pushed' || referral.icmsStatus === 'push-failed';
}

/** What pushing reads as: Push to ICMS, or Retry after a failed push. */
export function pushAction(referral: Pick<ReferralIntakeItem, 'icmsStatus'>) {
  return referral.icmsStatus === 'push-failed'
    ? { label: t.list.retry, icon: RefreshIcon }
    : { label: t.list.push, icon: SentIcon };
}

/** Push to ICMS, or Retry: the primary action on a row and in the drawer. */
export function PushButton({
  referral,
  onPush,
  size,
  variant,
}: {
  referral: ReferralIntakeItem;
  onPush: (referral: ReferralIntakeItem) => void;
  size?: ButtonProps['size'];
  /** Defaults to secondary for a retry, primary otherwise, as on the prototype's rows. */
  variant?: ButtonProps['variant'];
}) {
  const { label, icon } = pushAction(referral);
  return (
    <Button
      size={size}
      variant={variant ?? (referral.icmsStatus === 'push-failed' ? 'secondary' : 'default')}
      onClick={() => {
        onPush(referral);
      }}
    >
      <Icon icon={icon} />
      {label}
    </Button>
  );
}
